"""WanStudio API — AI Image-to-Video Studio backend (FastAPI + MongoDB)."""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

import fal_integration as fal
import providers

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


# ---------------------------------------------------------------------------
# AI engine (provider) key resolution
# ---------------------------------------------------------------------------
# Generations run in MOCKED mode until a fal.ai key is available. The key can
# come from a value saved in-app (Settings screen -> stored in Mongo) or from
# the FAL_KEY env var on the host. The saved key takes priority.
async def resolve_fal_key() -> tuple[Optional[str], Optional[str]]:
    doc = await config_col.find_one({"_id": "provider"})
    if doc and doc.get("fal_api_key"):
        return doc["fal_api_key"], "stored"
    env_key = os.environ.get("FAL_KEY") or os.environ.get("FAL_API_KEY")
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
    # Empty string clears the saved key (reverts to env var / mock mode).
    fal_api_key: str = ""


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
    key, source = await resolve_fal_key()
    return {
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
    val = body.fal_api_key.strip()
    if val:
        await config_col.update_one(
            {"_id": "provider"},
            {"$set": {"fal_api_key": val, "updated_by": user["id"], "updated_at": now_iso()}},
            upsert=True,
        )
    else:
        await config_col.update_one(
            {"_id": "provider"}, {"$unset": {"fal_api_key": ""}}, upsert=True
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

    LIVE mode (a fal.ai key is configured and the model has a `fal_model` slug)
    routes to fal.ai; otherwise it runs MOCKED. Blocking fal HTTP calls are run
    off the event loop via asyncio.to_thread.
    """
    gen = await generations_col.find_one({"id": gen_id})
    if not gen:
        return
    provider = providers.get_provider(gen["model"])
    if not provider:
        await _fail_generation(gen_id, "Unknown model")
        return

    key, _source = await resolve_fal_key()
    fal_model = getattr(provider, "fal_model", None)
    live = bool(key) and bool(fal_model)

    # --- kick off ---
    try:
        if live:
            provider_job_id = await asyncio.to_thread(
                fal.submit, fal_model, key, gen["image_base64"], gen["prompt"], gen["settings"]
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
                st = await asyncio.to_thread(fal.poll, fal_model, key, provider_job_id)
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
                        fal.fetch_result, fal_model, key, provider_job_id
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
    docs = await generations_col.find(query).sort(sort_field, direction).to_list(500)
    return [public_generation(d) for d in docs]


@api.get("/generations/{gen_id}")
async def get_generation(gen_id: str, user=Depends(get_current_user)):
    doc = await generations_col.find_one({"id": gen_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Generation not found")
    return public_generation(doc)


@api.post("/generations/{gen_id}/cancel")
async def cancel_generation(gen_id: str, user=Depends(get_current_user)):
    doc = await generations_col.find_one({"id": gen_id, "user_id": user["id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Generation not found")
    if doc["status"] in ("queued", "processing"):
        await generations_col.update_one(
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
    await generations_col.delete_one({"id": gen_id, "user_id": user["id"]})
    return {"ok": True}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
