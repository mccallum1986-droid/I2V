"""
A2E.ai image-to-video integration (LIVE mode).

A2E (video.a2e.ai) animates a source image — it is tuned for human/portrait
subjects (a person speaking, looking at the camera, natural eye/lip motion) —
and exposes a small REST API:

    start   -> POST https://video.a2e.ai/api/v1/userImage2Video/start
    poll /  -> GET  https://video.a2e.ai/api/v1/video/awsList?current=..&pageSize=..
    result     (the finished clip appears as an item in that list, matched by _id)

Auth is a Bearer token (your A2E "API token"), sent as `Authorization: Bearer <token>`.

A2E fetches the source image from a public URL (it does not accept base64), so
the caller passes an https URL we serve from our own backend — see
`GET /api/generations/{id}/source-image` in server.py.

A2E's model outputs a 720p clip optimised for faces. The start endpoint takes
the image + prompt/negative prompt plus a small set of options; we use
`video_time` for clip length (5/10/15/20s) and default `model_type=GENERAL`.
(FLF2V — first-and-last-frame — and `lora` presets exist but aren't wired up.)

Response shapes (verified against the live API):
    start  -> {"code": 0, "data": {"_id": "<job id>", ...}}
    awsList-> {"code": 0, "data": {"current": 1, "total": N, "success": true,
                 "data": [ {"_id", "status": "success"|..., "process": 0-100,
                            "result": "<mp4 url>", "msg": ""}, ... ]}}
`_extract_status` / `_extract_url` stay lenient about key names so a future
field rename can't silently break generation.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests

BASE = "https://video.a2e.ai/api/v1"
SUBMIT_TIMEOUT = 30
POLL_TIMEOUT = 20
RESULT_TIMEOUT = 30

# How far back to look for our job in the user's result list (newest first).
_LIST_PAGE_SIZE = 20
_LIST_MAX_PAGES = 3

# A2E accepts a fixed set of clip lengths (seconds) via `video_time`.
_VIDEO_TIMES = (5, 10, 15, 20)


def _video_time(settings: Dict[str, Any]) -> int:
    """Map the app's `duration` setting onto an A2E-supported clip length."""
    try:
        want = int(settings.get("duration", 5) or 5)
    except (TypeError, ValueError):
        want = 5
    if want in _VIDEO_TIMES:
        return want
    return min(_VIDEO_TIMES, key=lambda v: abs(v - want))  # snap to nearest

# Prepended to every user prompt to push toward clean, high quality output.
# (Shared with the self-hosted Studio path, so kept engine-neutral.)
_PROMPT_PREFIX = (
    "Cinematic, high quality, sharp focus, professional photography, "
    "smooth motion, realistic lighting, ultra detailed, 4K, "
)

# Fixed negative prompt merged with anything the user provides.
_NEGATIVE_BASE = (
    "blurry, low quality, chaotic, deformed, watermark, bad anatomy, "
    "shaky camera, overexposed, underexposed, grainy, pixelated, "
    "duplicate, extra limbs, distorted face, ugly, poorly drawn, "
    "out of focus, flickering, choppy motion, compression artifacts"
)

# Field names A2E uses for a job's state / output URL inside an awsList item.
# `status` + `result` are the live-verified names; the extras are defensive.
_STATUS_KEYS = ("status", "state", "video_status", "process_status")
_URL_KEYS = ("result", "video_url", "videoUrl", "url", "output", "video", "result_url")
_DONE_WORDS = {"success", "succeeded", "completed", "complete", "done", "finished"}
_FAILED_WORDS = {"failed", "fail", "error", "cancelled", "canceled", "timeout"}


def _headers(key: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _build_prompt(prompt: str, negative_prompt: str) -> tuple[str, str]:
    enhanced = f"{_PROMPT_PREFIX}{prompt}".strip()
    user_neg = negative_prompt.strip()
    full_negative = f"{_NEGATIVE_BASE}, {user_neg}" if user_neg else _NEGATIVE_BASE
    return enhanced, full_negative


def submit(
    key: str,
    image_url: str,
    prompt: str,
    negative_prompt: str,
    settings: Dict[str, Any],
    name: str = "WanStudio",
) -> str:
    """Queue an A2E image-to-video job. Returns A2E's job id (_id)."""
    enhanced, full_negative = _build_prompt(prompt, negative_prompt)
    payload = {
        "name": name,
        "image_url": image_url,
        "prompt": enhanced,
        "negative_prompt": full_negative,
        "model_type": "GENERAL",       # standard image-to-video (vs FLF2V)
        "video_time": _video_time(settings),  # 5 / 10 / 15 / 20 seconds
        "extend_prompt": True,         # let A2E auto-enrich the prompt
        "skip_face_enhance": False,    # keep A2E's face-similarity pass on
    }
    resp = requests.post(
        f"{BASE}/userImage2Video/start",
        headers=_headers(key),
        json=payload,
        timeout=SUBMIT_TIMEOUT,
    )
    if resp.status_code in (401, 403):
        raise RuntimeError("A2E rejected the API token. Check the token in Settings.")
    if not resp.ok:
        raise RuntimeError(f"A2E submit error {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    # A2E envelope: {"code": 0, "data": {"_id": "...", ...}}; non-zero code == error.
    if isinstance(data, dict) and data.get("code") not in (0, None) and not data.get("data"):
        raise RuntimeError(f"A2E submit failed: {data.get('msg') or data.get('message') or data}")
    body = data.get("data") if isinstance(data, dict) else None
    job_id = None
    if isinstance(body, dict):
        job_id = body.get("_id") or body.get("id")
    if not job_id:
        raise RuntimeError("A2E did not return a job id (_id).")
    return job_id


def _fetch_list(key: str) -> List[Dict[str, Any]]:
    """Return the user's most recent result-video items (newest first)."""
    items: List[Dict[str, Any]] = []
    for page in range(1, _LIST_MAX_PAGES + 1):
        resp = requests.get(
            f"{BASE}/video/awsList",
            headers=_headers(key),
            params={"current": page, "pageSize": _LIST_PAGE_SIZE},
            timeout=POLL_TIMEOUT,
        )
        if not resp.ok:
            raise RuntimeError(f"A2E poll error {resp.status_code}: {resp.text[:400]}")
        data = resp.json()
        body = data.get("data") if isinstance(data, dict) else data
        # data may be a bare list or {"list": [...]} / {"items": [...]} / {"data": [...]}
        page_items = _as_list(body)
        if not page_items:
            break
        items.extend(page_items)
        if len(page_items) < _LIST_PAGE_SIZE:
            break
    return items


def _as_list(body: Any) -> List[Dict[str, Any]]:
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        for k in ("list", "items", "data", "records", "results"):
            v = body.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


def _find_item(key: str, job_id: str) -> Optional[Dict[str, Any]]:
    for item in _fetch_list(key):
        if str(item.get("_id") or item.get("id")) == str(job_id):
            return item
    return None


def _extract_status(item: Dict[str, Any]) -> str:
    """Map an A2E item to one of: completed | processing | failed."""
    # A finished clip generally carries an output URL even if the status label
    # is ambiguous, so treat a present URL as completion.
    if _extract_url(item):
        return "completed"
    raw = ""
    for k in _STATUS_KEYS:
        if item.get(k) not in (None, ""):
            raw = str(item[k]).strip().lower()
            break
    if raw in _DONE_WORDS:
        return "completed"
    if raw in _FAILED_WORDS:
        return "failed"
    return "processing"


def _extract_url(item: Dict[str, Any]) -> Optional[str]:
    for k in _URL_KEYS:
        v = item.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
        if isinstance(v, dict):
            inner = v.get("url") or v.get("video_url")
            if isinstance(inner, str) and inner.startswith("http"):
                return inner
    return None


def poll(key: str, job_id: str) -> Dict[str, Any]:
    """Return {status, progress, stage} for a queued A2E job."""
    item = _find_item(key, job_id)
    if not item:
        # Job hasn't surfaced in the list yet — still queued.
        return {"status": "processing", "progress": 10.0, "stage": "Queued"}
    state = _extract_status(item)
    if state == "completed":
        return {"status": "completed", "progress": 100.0, "stage": "Completed"}
    if state == "failed":
        msg = item.get("msg") or item.get("message") or item.get("error") or "A2E generation failed."
        return {"status": "failed", "progress": 0.0, "stage": "Failed", "error": str(msg)}
    # A2E reports 0-100 in `process`; keep it in a sensible in-progress band.
    try:
        pct = float(item.get("process", 0) or 0)
    except (TypeError, ValueError):
        pct = 0.0
    progress = min(95.0, max(15.0, pct))
    return {"status": "processing", "progress": progress, "stage": "Rendering video"}


def fetch_result(key: str, job_id: str) -> Dict[str, Any]:
    """Fetch the finished A2E clip and return {video_url}."""
    item = _find_item(key, job_id)
    url = _extract_url(item) if item else None
    if not url:
        raise RuntimeError("A2E finished but returned no video URL.")
    return {"video_url": url}
