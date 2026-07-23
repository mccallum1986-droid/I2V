"""WanStudio API — AI Image-to-Video Studio backend (FastAPI + MongoDB)."""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
import requests
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

import a2e_integration as a2e
import providers
import studio as studio_gpu

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("wanstudio")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

users_col = db["users"]
prompts_col = db["prompts"]
generations_col = db["generations"]
reset_col = db["password_reset_tokens"]
config_col = db["app_config"]
studio_col = db["studio_config"]
studio_gens_col = db["studio_generations"]
studio_videos_col = db["studio_videos"]  # durable video bytes (base64), keyed by gen id


# ---------------------------------------------------------------------------
# AI engine (provider) key resolution
# ---------------------------------------------------------------------------
# Generations run in MOCKED mode until an A2E API token is available. The token
# can come from a value saved in-app (Settings screen -> stored in Mongo) or from
# the A2E_API_KEY env var on the host. The saved token takes priority.
async def resolve_a2e_key() -> tuple[Optional[str], Optional[str]]:
    doc = await config_col.find_one({"_id": "provider"})
    if doc and doc.get("a2e_api_key"):
        return doc["a2e_api_key"], "stored"
    env_key = os.environ.get("A2E_API_KEY") or os.environ.get("A2E_TOKEN")
    if env_key:
        return env_key, "env"
    return None, None


def _mask_key(key: str) -> str:
    return ("•" * 4 + key[-4:]) if key and len(key) >= 4 else "•" * 4


def _friendly_error(exc: Exception) -> str:
    msg = str(exc).strip()
    return msg or "Generation failed. Please try again."

# ---------------------------------------------------------------------------
# Auth config
# ---------------------------------------------------------------------------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "43200"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password[:72])


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain[:72], hashed)


def create_access_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# The mobile app is a standalone build with no cleartext-HTTP exception, so it
# cannot load the GPU's http:// video endpoint directly. We serve every studio
# video through this HTTPS backend instead (see stream_studio_video), which
# proxies the bytes from the GPU. RENDER_EXTERNAL_URL is injected by Render.
RENDER_BASE_URL = (os.environ.get("RENDER_EXTERNAL_URL") or os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/")


def _make_video_url(gen_id: str) -> str:
    return f"{RENDER_BASE_URL}/api/studio/generations/{gen_id}/video"


DEFAULT_SETTINGS = {
    "default_model": providers.DEFAULT_MODEL,
    "theme": "system",
    "notifications": True,
    "generation": {
        "duration": 5,
        "resolution": "720p",
        "aspect_ratio": "16:9",
        "motion_strength": 0.5,
        "camera_movement": "static",
        "creativity": 0.5,
        "fps": 24,
        "guidance_scale": 7.0,
    },
}

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)
    name: str = Field(min_length=1, max_length=60)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=72)


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None


class ProviderKeyUpdate(BaseModel):
    # Empty string clears the saved token (reverts to env var / mock mode).
    a2e_api_key: str = ""


class PromptCreate(BaseModel):
    text: str = Field(min_length=1)
    negative_prompt: str = ""
    is_favourite: bool = False


class GenerationCreate(BaseModel):
    prompt: str = Field(min_length=1)
    negative_prompt: str = ""
    model: str
    image_base64: str = Field(min_length=1)
    settings: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------
async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Dict[str, Any]:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await users_col.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "created_at": user.get("created_at"),
        "settings": user.get("settings", DEFAULT_SETTINGS),
    }


def public_generation(g: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in g.items() if k != "_id"}


# ---------------------------------------------------------------------------
# App + router
# ---------------------------------------------------------------------------
app = FastAPI(title="WanStudio API")
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": "WanStudio API", "status": "ok"}


# ------------------------------- Auth --------------------------------------
@api.post("/auth/register")
async def register(body: RegisterRequest):
    existing = await users_col.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    user = {
        "id": str(uuid.uuid4()),
        "email": body.email.lower(),
        "name": body.name.strip(),
        "hashed_password": hash_password(body.password),
        "created_at": now_iso(),
        "settings": DEFAULT_SETTINGS,
    }
    await users_col.insert_one(user)
    token = create_access_token(user["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@api.post("/auth/login")
async def login(body: LoginRequest):
    user = await users_col.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@api.post("/auth/password/forgot")
async def forgot_password(body: ForgotPasswordRequest):
    user = await users_col.find_one({"email": body.email.lower()})
    if not user:
        return {"message": "If the account exists, a reset code has been sent."}
    await reset_col.delete_many({"user_id": user["id"]})
    raw_token = secrets.token_urlsafe(6)[:8].upper()
    await reset_col.insert_one({
        "user_id": user["id"],
        "token": raw_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
        "created_at": now_iso(),
    })
    # No email provider configured — return the code for in-app reset (dev/demo).
    return {"message": "Reset code generated.", "reset_code": raw_token}


@api.post("/auth/password/reset")
async def reset_password(body: ResetPasswordRequest):
    rec = await reset_col.find_one({"token": body.token.strip().upper()})
    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")
    if datetime.fromisoformat(rec["expires_at"]) < datetime.now(timezone.utc):
        await reset_col.delete_many({"user_id": rec["user_id"]})
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")
    await users_col.update_one(
        {"id": rec["user_id"]},
        {"$set": {"hashed_password": hash_password(body.new_password)}},
    )
    await reset_col.delete_many({"user_id": rec["user_id"]})
    return {"message": "Password reset successful"}


@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return public_user(user)


@api.put("/auth/profile")
async def update_profile(body: ProfileUpdate, user=Depends(get_current_user)):
    updates: Dict[str, Any] = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.settings is not None:
        merged = {**user.get("settings", DEFAULT_SETTINGS), **body.settings}
        updates["settings"] = merged
    if updates:
        await users_col.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await users_col.find_one({"id": user["id"]})
    return public_user(fresh)


# ------------------------------- Models ------------------------------------
@api.get("/models")
async def get_models():
    return providers.list_models()


# --------------------------- Provider settings -----------------------------
async def _provider_status() -> Dict[str, Any]:
    key, source = await resolve_a2e_key()
    return {
        "provider": "a2e",
        "mode": "live" if key else "mock",
        "has_key": bool(key),
        "key_source": source,
        "key_masked": _mask_key(key) if key else None,
    }


@api.get("/settings/provider")
async def get_provider_settings(user=Depends(get_current_user)):
    return await _provider_status()


@api.put("/settings/provider")
async def set_provider_settings(body: ProviderKeyUpdate, user=Depends(get_current_user)):
    val = body.a2e_api_key.strip()
    if val:
        await config_col.update_one(
            {"_id": "provider"},
            {"$set": {"a2e_api_key": val, "updated_by": user["id"], "updated_at": now_iso()}},
            upsert=True,
        )
    else:
        await config_col.update_one(
            {"_id": "provider"}, {"$unset": {"a2e_api_key": ""}}, upsert=True
        )
    return await _provider_status()


# ------------------------------- Prompts -----------------------------------
@api.get("/prompts")
async def list_prompts(favourite: bool = False, user=Depends(get_current_user)):
    query: Dict[str, Any] = {"user_id": user["id"]}
    if favourite:
        query["is_favourite"] = True
    docs = await prompts_col.find(query).sort("created_at", -1).to_list(200)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]


@api.post("/prompts")
async def save_prompt(body: PromptCreate, user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "text": body.text.strip(),
        "negative_prompt": body.negative_prompt.strip(),
        "is_favourite": body.is_favourite,
        "created_at": now_iso(),
    }
    await prompts_col.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.put("/prompts/{prompt_id}/favourite")
async def toggle_prompt_favourite(prompt_id: str, user=Depends(get_current_user)):
    doc = await prompts_col.find_one({"id": prompt_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Prompt not found")
    new_val = not doc.get("is_favourite", False)
    await prompts_col.update_one({"id": prompt_id}, {"$set": {"is_favourite": new_val}})
    return {"id": prompt_id, "is_favourite": new_val}


@api.delete("/prompts/{prompt_id}")
async def delete_prompt(prompt_id: str, user=Depends(get_current_user)):
    await prompts_col.delete_one({"id": prompt_id, "user_id": user["id"]})
    return {"ok": True}


# ---------------------------- Generations ----------------------------------
async def _fail_generation(gen_id: str, error: str) -> None:
    await generations_col.update_one(
        {"id": gen_id},
        {"$set": {"status": "failed", "error": error, "updated_at": now_iso()}},
    )


async def _run_generation(gen_id: str):
    """Background task: drive a generation through its provider lifecycle.

    LIVE mode (an A2E token is configured and the provider is `live_capable`)
    routes to A2E; otherwise it runs MOCKED. Blocking A2E HTTP calls are run
    off the event loop via asyncio.to_thread.

    A2E fetches the source image over HTTPS rather than accepting base64, so we
    hand it a public URL served by this backend (see stream_source_image).
    """
    gen = await generations_col.find_one({"id": gen_id})
    if not gen:
        return
    provider = providers.get_provider(gen["model"])
    if not provider:
        await _fail_generation(gen_id, "Unknown model")
        return

    key, _source = await resolve_a2e_key()
    live = bool(key) and getattr(provider, "live_capable", False)
    if live and not RENDER_BASE_URL:
        await _fail_generation(
            gen_id,
            "Live generation needs a public backend URL (set RENDER_EXTERNAL_URL "
            "or PUBLIC_BASE_URL) so A2E can fetch the image.",
        )
        return

    # --- kick off ---
    try:
        if live:
            image_url = f"{RENDER_BASE_URL}/api/generations/{gen_id}/source-image"
            provider_job_id = await asyncio.to_thread(
                a2e.submit, key, image_url, gen["prompt"],
                gen.get("negative_prompt", ""), gen["settings"]
            )
        else:
            provider_job_id = provider.generate_video(
                gen["image_base64"], gen["prompt"], gen["settings"]
            )
    except Exception as exc:  # noqa: BLE001 - surface a friendly message to the app
        logger.exception("generation submit failed for %s", gen_id)
        await _fail_generation(gen_id, _friendly_error(exc))
        return

    started_at = datetime.now(timezone.utc)
    await generations_col.update_one(
        {"id": gen_id},
        {"$set": {
            "status": "processing",
            "provider_job_id": provider_job_id,
            "mode": "live" if live else "mock",
            "started_at": started_at.isoformat(),
            "updated_at": now_iso(),
        }},
    )

    # --- poll to completion ---
    while True:
        await asyncio.sleep(2 if live else 1)
        current = await generations_col.find_one({"id": gen_id})
        if not current or current.get("status") == "cancelled":
            return
        try:
            if live:
                st = await asyncio.to_thread(a2e.poll, key, provider_job_id)
            else:
                st = provider.check_status(provider_job_id, started_at)
        except Exception as exc:  # noqa: BLE001
            logger.exception("generation poll failed for %s", gen_id)
            await _fail_generation(gen_id, _friendly_error(exc))
            return

        if st["status"] == "failed":
            await _fail_generation(gen_id, st.get("error") or "Generation failed.")
            return
        if st["status"] == "completed":
            try:
                if live:
                    result = await asyncio.to_thread(
                        a2e.fetch_result, key, provider_job_id
                    )
                else:
                    result = provider.get_result(provider_job_id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("generation result fetch failed for %s", gen_id)
                await _fail_generation(gen_id, _friendly_error(exc))
                return
            await generations_col.update_one(
                {"id": gen_id},
                {"$set": {
                    "status": "completed",
                    "progress": 100.0,
                    "stage": "Completed",
                    "video_url": result["video_url"],
                    "completed_at": now_iso(),
                    "updated_at": now_iso(),
                }},
            )
            return
        await generations_col.update_one(
            {"id": gen_id},
            {"$set": {
                "progress": st["progress"],
                "stage": st["stage"],
                "updated_at": now_iso(),
            }},
        )


def _new_generation_doc(user_id: str, body: GenerationCreate, provider) -> Dict[str, Any]:
    filtered = {k: v for k, v in body.settings.items() if k in provider.supported_settings}
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "prompt": body.prompt.strip(),
        "negative_prompt": body.negative_prompt.strip(),
        "model": body.model,
        "model_name": provider.name,
        "image_base64": body.image_base64,
        "thumbnail_base64": body.image_base64,
        "settings": filtered,
        "status": "queued",
        "progress": 0.0,
        "stage": "Queued",
        "video_url": None,
        "error": None,
        "is_favourite": False,
        "est_seconds": provider.gen_seconds,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


@api.post("/generations")
async def create_generation(body: GenerationCreate, user=Depends(get_current_user)):
    provider = providers.get_provider(body.model)
    if not provider:
        raise HTTPException(status_code=400, detail="Unsupported model")
    doc = _new_generation_doc(user["id"], body, provider)
    await generations_col.insert_one(doc)
    asyncio.create_task(_run_generation(doc["id"]))
    return public_generation(doc)


@api.get("/generations")
async def list_generations(
    search: str = "",
    model: str = "",
    favourite: bool = False,
    sort: str = "date",
    user=Depends(get_current_user),
):
    query: Dict[str, Any] = {"user_id": user["id"]}
    if model:
        query["model"] = model
    if favourite:
        query["is_favourite"] = True
    if search:
        query["prompt"] = {"$regex": search, "$options": "i"}
    sort_field = "model" if sort == "model" else "created_at"
    direction = 1 if sort == "model" else -1
    # Project OUT heavy base64 image fields — a list of 30+ full-res images is
    # ~11MB of JSON, which the app can't parse/render (it comes back 200 but the
    # gallery shows nothing). The per-item detail endpoint still returns them.
    LIST_PROJ = {"image_base64": 0, "thumbnail_base64": 0}
    docs = await generations_col.find(query, LIST_PROJ).sort(sort_field, direction).to_list(500)
    results = [public_generation(d) for d in docs]

    # Merge studio generations into gallery (also without embedded images)
    studio_docs = await studio_gens_col.find({"user_id": user["id"]}, LIST_PROJ).sort("created_at", -1).to_list(100)
    for doc in studio_docs:
        if doc.get("status") == "completed" and not doc.get("video_url"):
            video_url = _make_video_url(doc["id"])
            await studio_gens_col.update_one({"id": doc["id"]}, {"$set": {"video_url": video_url}})
            doc["video_url"] = video_url
        results.append({
            "id": doc["id"],
            "prompt": doc.get("prompt", ""),
            "negative_prompt": doc.get("negative_prompt", ""),
            "model": "studio",
            "model_name": "Wan 2.1 I2V-14B",
            "image_base64": "",
            "thumbnail_base64": "",
            "settings": doc.get("settings", {}),
            "status": doc.get("status", "processing"),
            "progress": doc.get("progress", 0),
            "stage": doc.get("stage", ""),
            "video_url": doc.get("video_url"),
            "error": doc.get("error"),
            "is_favourite": False,
            "est_seconds": 720,
            "created_at": doc.get("created_at", ""),
            "updated_at": doc.get("updated_at", ""),
        })

    results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return results


@api.get("/generations/{gen_id}")
async def get_generation(gen_id: str, user=Depends(get_current_user)):
    doc = await generations_col.find_one({"id": gen_id, "user_id": user["id"]})
    if doc:
        return public_generation(doc)
    # Fall back to studio generations
    sdoc = await studio_gens_col.find_one({"id": gen_id, "user_id": user["id"]})
    if sdoc:
        if sdoc.get("status") == "completed" and not sdoc.get("video_url"):
            video_url = _make_video_url(sdoc["id"])
            await studio_gens_col.update_one({"id": sdoc["id"]}, {"$set": {"video_url": video_url}})
            sdoc["video_url"] = video_url
        return {
            "id": sdoc["id"],
            "prompt": sdoc.get("prompt", ""),
            "negative_prompt": sdoc.get("negative_prompt", ""),
            "model": "studio",
            "model_name": "Wan 2.1 I2V-14B",
            "image_base64": "",
            "thumbnail_base64": sdoc.get("image_base64", ""),
            "settings": sdoc.get("settings", {}),
            "status": sdoc.get("status", "processing"),
            "progress": sdoc.get("progress", 0),
            "stage": sdoc.get("stage", ""),
            "video_url": sdoc.get("video_url"),
            "error": sdoc.get("error"),
            "is_favourite": False,
            "est_seconds": 720,
            "created_at": sdoc.get("created_at", ""),
            "updated_at": sdoc.get("updated_at", ""),
        }
    raise HTTPException(status_code=404, detail="Generation not found")


@api.post("/generations/{gen_id}/cancel")
async def cancel_generation(gen_id: str, user=Depends(get_current_user)):
    doc = await generations_col.find_one({"id": gen_id, "user_id": user["id"]})
    if doc:
        if doc["status"] in ("queued", "processing"):
            await generations_col.update_one(
                {"id": gen_id}, {"$set": {"status": "cancelled", "updated_at": now_iso()}}
            )
        return {"id": gen_id, "status": "cancelled"}
    # Fall back to studio generations (separate collection, merged into gallery)
    sdoc = await studio_gens_col.find_one({"id": gen_id, "user_id": user["id"]})
    if not sdoc:
        raise HTTPException(status_code=404, detail="Generation not found")
    if sdoc.get("status") in ("queued", "processing"):
        await studio_gens_col.update_one(
            {"id": gen_id}, {"$set": {"status": "cancelled", "updated_at": now_iso()}}
        )
    return {"id": gen_id, "status": "cancelled"}


@api.post("/generations/{gen_id}/retry")
async def retry_generation(gen_id: str, user=Depends(get_current_user)):
    doc = await generations_col.find_one({"id": gen_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Generation not found")
    await generations_col.update_one(
        {"id": gen_id},
        {"$set": {
            "status": "queued", "progress": 0.0, "stage": "Queued",
            "video_url": None, "error": None, "updated_at": now_iso(),
        }},
    )
    asyncio.create_task(_run_generation(gen_id))
    updated = await generations_col.find_one({"id": gen_id})
    return public_generation(updated)


@api.post("/generations/{gen_id}/duplicate")
async def duplicate_generation(gen_id: str, user=Depends(get_current_user)):
    doc = await generations_col.find_one({"id": gen_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Generation not found")
    provider = providers.get_provider(doc["model"])
    if not provider:
        raise HTTPException(status_code=400, detail="Unsupported model")
    body = GenerationCreate(
        prompt=doc["prompt"], negative_prompt=doc.get("negative_prompt", ""),
        model=doc["model"], image_base64=doc["image_base64"], settings=doc.get("settings", {}),
    )
    new_doc = _new_generation_doc(user["id"], body, provider)
    await generations_col.insert_one(new_doc)
    asyncio.create_task(_run_generation(new_doc["id"]))
    return public_generation(new_doc)


@api.put("/generations/{gen_id}/favourite")
async def toggle_generation_favourite(gen_id: str, user=Depends(get_current_user)):
    doc = await generations_col.find_one({"id": gen_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Generation not found")
    new_val = not doc.get("is_favourite", False)
    await generations_col.update_one({"id": gen_id}, {"$set": {"is_favourite": new_val}})
    return {"id": gen_id, "is_favourite": new_val}


@api.delete("/generations/{gen_id}")
async def delete_generation(gen_id: str, user=Depends(get_current_user)):
    res = await generations_col.delete_one({"id": gen_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        # Not a regular generation — try the studio collection (merged into gallery)
        await studio_gens_col.delete_one({"id": gen_id, "user_id": user["id"]})
        await studio_videos_col.delete_one({"_id": gen_id})
    return {"ok": True}


@api.get("/generations/{gen_id}/source-image")
async def stream_source_image(gen_id: str):
    """Serve a generation's source image over HTTPS.

    The A2E cloud engine fetches the source image by URL (it doesn't accept
    base64), so we expose the stored image here for it to pull. Unauthenticated
    on purpose: A2E's fetcher can't send our auth header, and gen_id is an
    unguessable UUID.
    """
    doc = await generations_col.find_one({"id": gen_id})
    if not doc or not doc.get("image_base64"):
        raise HTTPException(status_code=404, detail="Source image not found")
    try:
        content = base64.b64decode(doc["image_base64"])
    except Exception:
        raise HTTPException(status_code=500, detail="Stored image is corrupt")
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f'inline; filename="{gen_id}.jpg"',
        },
    )


# ===========================================================================
# Studio — self-hosted GPU routes
# ===========================================================================

async def _get_studio_config() -> Dict[str, Any]:
    doc = await studio_col.find_one({"_id": "config"}) or {}
    return {
        "vastai_api_key": doc.get("vastai_api_key", ""),
        "instance_id": doc.get("instance_id", ""),
        "gpu_port": int(doc.get("gpu_port", 8081)),
        "configured": bool(doc.get("vastai_api_key") and doc.get("instance_id")),
    }


class StudioConfigUpdate(BaseModel):
    vastai_api_key: str = ""
    instance_id: str = ""
    gpu_port: int = 8081


class StudioGenerationCreate(BaseModel):
    prompt: str = Field(min_length=1)
    negative_prompt: str = ""
    image_base64: str = Field(min_length=1)
    settings: Dict[str, Any] = Field(default_factory=dict)


@api.get("/studio/config")
async def get_studio_config(user=Depends(get_current_user)):
    cfg = await _get_studio_config()
    # Mask the key before returning
    key = cfg["vastai_api_key"]
    return {**cfg, "vastai_api_key": f"...{key[-4:]}" if len(key) > 4 else ("set" if key else "")}


@api.put("/studio/config")
async def update_studio_config(body: StudioConfigUpdate, user=Depends(get_current_user)):
    update: Dict[str, Any] = {"gpu_port": body.gpu_port}
    if body.vastai_api_key.strip():
        update["vastai_api_key"] = body.vastai_api_key.strip()
    if body.instance_id.strip():
        update["instance_id"] = body.instance_id.strip()
    await studio_col.update_one({"_id": "config"}, {"$set": update}, upsert=True)
    return {"ok": True}


@api.get("/studio/account")
async def studio_account(user=Depends(get_current_user)):
    cfg = await _get_studio_config()
    if not cfg["configured"]:
        raise HTTPException(status_code=400, detail="Studio not configured.")
    try:
        info = await asyncio.to_thread(studio_gpu.get_account_info, cfg["vastai_api_key"])
        return info
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@api.get("/studio/gpu/status")
async def studio_gpu_status(user=Depends(get_current_user)):
    cfg = await _get_studio_config()
    if not cfg["configured"]:
        return {"state": "unconfigured", "public_ip": None}
    try:
        instance = await asyncio.to_thread(
            studio_gpu.get_instance_status, cfg["vastai_api_key"], cfg["instance_id"]
        )
        state, public_ip = studio_gpu.parse_gpu_state(instance)
        return {
            "state": state,
            "public_ip": public_ip,
            "machine_id": instance.get("machine_id"),
            "gpu_name": instance.get("gpu_name", ""),
            "dph_total": instance.get("dph_total"),
        }
    except Exception as exc:
        logger.exception("studio gpu status failed")
        return {"state": "error", "error": str(exc), "public_ip": None}


@api.post("/studio/gpu/start")
async def studio_gpu_start(user=Depends(get_current_user)):
    cfg = await _get_studio_config()
    if not cfg["configured"]:
        raise HTTPException(status_code=400, detail="Studio not configured. Add your Vast.ai key and instance ID in Settings.")
    try:
        await asyncio.to_thread(studio_gpu.start_instance, cfg["vastai_api_key"], cfg["instance_id"])
        return {"ok": True, "message": "GPU starting — usually takes 2-4 minutes."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@api.post("/studio/gpu/stop")
async def studio_gpu_stop(user=Depends(get_current_user)):
    cfg = await _get_studio_config()
    if not cfg["configured"]:
        raise HTTPException(status_code=400, detail="Studio not configured.")
    try:
        await asyncio.to_thread(studio_gpu.stop_instance, cfg["vastai_api_key"], cfg["instance_id"])
        return {"ok": True, "message": "GPU stopped. Billing paused."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@api.post("/studio/generate")
async def studio_generate(body: StudioGenerationCreate, user=Depends(get_current_user)):
    cfg = await _get_studio_config()
    if not cfg["configured"]:
        raise HTTPException(status_code=400, detail="Studio not configured.")

    # NOTE: We deliberately do NOT check GPU readiness here. That check hits the
    # Vast.ai API synchronously and can take 10-20s or hang, which blocks the
    # request, times out the app, and leaves the generation invisible in the
    # gallery even though it started. The readiness check now happens inside
    # _run_studio_generation so this endpoint returns a "queued" job instantly.

    from a2e_integration import _PROMPT_PREFIX, _NEGATIVE_BASE
    user_prompt = body.prompt.strip()
    user_neg = body.negative_prompt.strip()
    enhanced_prompt = f"{_PROMPT_PREFIX}{user_prompt}".strip()
    full_negative = f"{_NEGATIVE_BASE}, {user_neg}" if user_neg else _NEGATIVE_BASE

    gen_id = str(uuid.uuid4())
    doc = {
        "id": gen_id,
        "user_id": user["id"],
        "prompt": enhanced_prompt,
        "negative_prompt": full_negative,
        "image_base64": body.image_base64,
        "settings": body.settings,
        "status": "queued",
        "progress": 0.0,
        "stage": "Queued",
        "video_url": None,
        "error": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "public_ip": None,
        "gpu_port": cfg["gpu_port"],
    }
    await studio_gens_col.insert_one(doc)
    asyncio.create_task(_run_studio_generation(gen_id))
    return {k: v for k, v in doc.items() if k not in ("_id", "image_base64", "public_ip", "gpu_port")}


@api.get("/studio/generations")
async def list_studio_generations(user=Depends(get_current_user)):
    # Exclude the heavy base64 image so this stays small (it's polled every ~2s).
    docs = await studio_gens_col.find({"user_id": user["id"]}, {"image_base64": 0}).sort("created_at", -1).to_list(100)
    # Fix any completed gens missing video_url
    for doc in docs:
        if doc.get("status") == "completed" and not doc.get("video_url"):
            video_url = _make_video_url(doc["id"])
            await studio_gens_col.update_one({"id": doc["id"]}, {"$set": {"video_url": video_url}})
            doc["video_url"] = video_url
    return [{k: v for k, v in d.items() if k not in ("_id", "image_base64", "public_ip", "gpu_port")} for d in docs]


@api.get("/studio/generations/{gen_id}/video")
async def stream_studio_video(gen_id: str):
    """Serve a studio video over HTTPS.

    Prefers the durable copy stored in Mongo (survives GPU restarts / instance
    destruction). Falls back to a live proxy from the GPU if no stored copy exists.
    Unauthenticated on purpose: the native video player / downloader can't attach
    the auth header, and gen_id is an unguessable UUID.
    """
    # 1. Durable copy first
    stored = await studio_videos_col.find_one({"_id": gen_id})
    if stored and stored.get("data"):
        content = base64.b64decode(stored["data"])
        return Response(
            content=content,
            media_type="video/mp4",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=86400",
                "Content-Disposition": f'inline; filename="{gen_id}.mp4"',
            },
        )

    # 2. Fall back to live proxy from the GPU
    doc = await studio_gens_col.find_one({"id": gen_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Generation not found")
    public_ip = doc.get("public_ip")
    port = doc.get("gpu_port", 10100)
    job_id = doc.get("job_id") or doc.get("id")
    if not public_ip:
        raise HTTPException(status_code=404, detail="Video source unavailable")
    base = f"http://{public_ip}" if ":" in str(public_ip) else f"http://{public_ip}:{port}"
    gpu_url = f"{base}/result/{job_id}"

    def _fetch() -> bytes:
        r = requests.get(gpu_url, timeout=60)
        r.raise_for_status()
        return r.content

    try:
        content = await asyncio.to_thread(_fetch)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch video from GPU: {exc}")

    return Response(
        content=content,
        media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f'inline; filename="{gen_id}.mp4"',
        },
    )


@api.get("/studio/generations/{gen_id}")
async def get_studio_generation(gen_id: str, user=Depends(get_current_user)):
    doc = await studio_gens_col.find_one({"id": gen_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Studio generation not found")
    return {k: v for k, v in doc.items() if k not in ("_id", "image_base64", "public_ip", "gpu_port")}


@api.delete("/studio/generations/{gen_id}")
async def delete_studio_generation(gen_id: str, user=Depends(get_current_user)):
    result = await studio_gens_col.delete_one({"id": gen_id, "user_id": user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Studio generation not found")
    await studio_videos_col.delete_one({"_id": gen_id})
    return {"ok": True}


async def _run_studio_generation(gen_id: str):
    doc = await studio_gens_col.find_one({"id": gen_id})
    if not doc:
        return

    # Resolve GPU readiness + public IP here (kept off the request path so the
    # app gets an instant "queued" generation instead of blocking on Vast.ai).
    cfg = await _get_studio_config()
    if not cfg["configured"]:
        await studio_gens_col.update_one({"id": gen_id}, {"$set": {"status": "failed", "error": "Studio not configured.", "updated_at": now_iso()}})
        return

    await studio_gens_col.update_one({"id": gen_id}, {"$set": {"stage": "Checking GPU", "updated_at": now_iso()}})
    try:
        instance = await asyncio.to_thread(
            studio_gpu.get_instance_status, cfg["vastai_api_key"], cfg["instance_id"]
        )
        state, public_ip = studio_gpu.parse_gpu_state(instance)
    except Exception as exc:
        await studio_gens_col.update_one({"id": gen_id}, {"$set": {"status": "failed", "error": f"Could not reach GPU: {exc}", "updated_at": now_iso()}})
        return

    if state != "ready" or not public_ip:
        await studio_gens_col.update_one({"id": gen_id}, {"$set": {"status": "failed", "error": f"GPU is not ready (state: {state}). Start it and wait for it to boot.", "updated_at": now_iso()}})
        return

    port = cfg["gpu_port"]
    await studio_gens_col.update_one({"id": gen_id}, {"$set": {"public_ip": public_ip, "stage": "Submitting", "updated_at": now_iso()}})

    try:
        job_id = await asyncio.to_thread(
            studio_gpu.submit_generation,
            public_ip, doc["image_base64"], doc["prompt"],
            doc.get("negative_prompt", ""), doc["settings"], port,
        )
    except Exception as exc:
        await studio_gens_col.update_one({"id": gen_id}, {"$set": {"status": "failed", "error": str(exc), "updated_at": now_iso()}})
        return

    await studio_gens_col.update_one({"id": gen_id}, {"$set": {"status": "processing", "job_id": job_id, "progress": 5.0, "stage": "Submitted", "updated_at": now_iso()}})

    while True:
        await asyncio.sleep(3)
        try:
            st = await asyncio.to_thread(studio_gpu.poll_generation, public_ip, job_id, port)
        except Exception as exc:
            await studio_gens_col.update_one({"id": gen_id}, {"$set": {"status": "failed", "error": str(exc), "updated_at": now_iso()}})
            return

        status_val = st.get("status", "processing")
        await studio_gens_col.update_one({"id": gen_id}, {"$set": {
            "status": status_val if status_val in ("processing", "completed", "failed") else "processing",
            "progress": st.get("progress", 0),
            "stage": st.get("stage", ""),
            "updated_at": now_iso(),
        }})

        if status_val == "completed":
            # Pull the finished video off the GPU and store it durably in Mongo, so it
            # survives GPU restarts / instance destruction. Falls back to live proxy if
            # the download fails for any reason.
            base = f"http://{public_ip}" if ":" in str(public_ip) else f"http://{public_ip}:{port}"
            gpu_url = f"{base}/result/{job_id}"
            try:
                content = await asyncio.to_thread(lambda: requests.get(gpu_url, timeout=120).content)
                b64 = base64.b64encode(content).decode()
                await studio_videos_col.update_one(
                    {"_id": gen_id}, {"$set": {"data": b64}}, upsert=True
                )
                logger.info("Stored %d bytes of video for %s", len(content), gen_id)
            except Exception as exc:
                logger.warning("Could not persist video for %s: %s", gen_id, exc)
            video_url = _make_video_url(gen_id)
            await studio_gens_col.update_one({"id": gen_id}, {"$set": {"video_url": video_url, "status": "completed", "progress": 100.0, "stage": "Completed", "updated_at": now_iso()}})
            return
        if status_val == "failed":
            await studio_gens_col.update_one({"id": gen_id}, {"$set": {"error": st.get("error", "Generation failed"), "updated_at": now_iso()}})
            return


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def repair_studio_video_urls():
    """Clear any video_url that isn't the HTTPS proxy form so it rebuilds correctly.

    Old rows point straight at the GPU's http:// endpoint, which the app can't load.
    Anything that isn't our /studio/generations/{id}/video proxy path gets reset.
    """
    docs = await studio_gens_col.find({"status": "completed", "video_url": {"$exists": True, "$ne": None}}).to_list(500)
    for doc in docs:
        url = doc.get("video_url") or ""
        if "/studio/generations/" not in url or url.startswith("http://"):
            await studio_gens_col.update_one({"id": doc["id"]}, {"$unset": {"video_url": ""}})
            logger.info("Cleared stale video_url for %s", doc["id"])

    # Fail studio generations stuck in queued/processing for over 30 min. Their
    # polling task died (instance destroyed or backend restart), so they'd spin
    # forever. now_iso() is a tz-aware ISO string, so string comparison is valid.
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    stale = await studio_gens_col.update_many(
        {"status": {"$in": ["queued", "processing"]}, "updated_at": {"$lt": cutoff}},
        {"$set": {"status": "failed", "error": "Generation interrupted (GPU instance changed).",
                  "stage": "Failed", "updated_at": now_iso()}},
    )
    if stale.modified_count:
        logger.info("Marked %d stale studio generations as failed", stale.modified_count)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
