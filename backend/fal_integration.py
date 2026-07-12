"""
fal.ai image-to-video integration (LIVE mode).

This talks to fal's async **queue** API directly with `requests` (no extra SDK):
    submit  -> POST  https://queue.fal.run/{model}
    poll    -> GET   https://queue.fal.run/{app_id}/requests/{id}/status
    result  -> GET   https://queue.fal.run/{app_id}/requests/{id}

`app_id` is the first two path segments of the model slug (owner/app); any
deeper segments are routing on submit only.

Provider -> fal model slugs live on each provider in providers.py (`fal_model`).
"""
from __future__ import annotations

import base64
import io
import struct
import zlib
from typing import Any, Dict

import requests

BASE = "https://queue.fal.run"
SUBMIT_TIMEOUT = 30
POLL_TIMEOUT = 20
RESULT_TIMEOUT = 30

_SAFE_RESOLUTIONS = {"480p", "580p", "720p", "1080p"}
_SAFE_ASPECT_RATIOS = {"16:9", "9:16", "1:1"}
_ASPECT_RATIO_DEFAULT = "16:9"

# Prepended to every user prompt to push fal toward cinematic quality output.
_PROMPT_PREFIX = (
    "Cinematic, high quality, sharp focus, professional photography, "
    "smooth motion, realistic lighting, ultra detailed, 4K, "
)

# Always appended so the user's own keywords come through naturally.
_PROMPT_SUFFIX = ""

# Fixed negative prompt merged with anything the user provides.
_NEGATIVE_BASE = (
    "blurry, low quality, chaotic, deformed, watermark, bad anatomy, "
    "shaky camera, overexposed, underexposed, grainy, pixelated, "
    "duplicate, extra limbs, distorted face, ugly, poorly drawn, "
    "out of focus, flickering, choppy motion, compression artifacts"
)


def _headers(key: str) -> Dict[str, str]:
    return {"Authorization": f"Key {key}", "Content-Type": "application/json"}


def _app_id(model: str) -> str:
    # fal's status/result queue endpoints use only owner/app (first 2 segments).
    # The full routing path is only needed on submit.
    parts = [p for p in model.split("/") if p]
    return "/".join(parts[:2]) if len(parts) >= 2 else model


def _image_dimensions(image_base64: str) -> tuple[int, int] | None:
    """Return (width, height) by peeking at the image header bytes.

    Supports JPEG and PNG — the two formats the app produces. Returns None
    if the header can't be parsed so callers can fall back gracefully.
    """
    try:
        raw = base64.b64decode(image_base64[:2048])  # only need the header
    except Exception:
        return None

    # JPEG: scan for SOF markers (0xFF C0/C1/C2) which carry W/H.
    if raw[:2] == b"\xff\xd8":
        i = 2
        while i + 4 < len(raw):
            if raw[i] != 0xFF:
                break
            marker = raw[i + 1]
            seg_len = struct.unpack(">H", raw[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2) and i + 9 < len(raw):
                h = struct.unpack(">H", raw[i + 5:i + 7])[0]
                w = struct.unpack(">H", raw[i + 7:i + 9])[0]
                return w, h
            i += 2 + seg_len
        return None

    # PNG: IHDR is always the first chunk; W/H at bytes 16-24.
    if raw[:8] == b"\x89PNG\r\n\x1a\n" and len(raw) >= 24:
        w = struct.unpack(">I", raw[16:20])[0]
        h = struct.unpack(">I", raw[20:24])[0]
        return w, h

    return None


def _aspect_ratio_from_image(image_base64: str, fallback: str) -> str:
    """Pick the closest fal-supported aspect ratio from the image's actual W:H.

    This prevents fal from cropping the image — we tell it the ratio that
    matches the photo so the full image appears in the output video.
    """
    dims = _image_dimensions(image_base64)
    if not dims:
        return fallback if fallback in _SAFE_ASPECT_RATIOS else _ASPECT_RATIO_DEFAULT
    w, h = dims
    if w == 0 or h == 0:
        return _ASPECT_RATIO_DEFAULT
    ratio = w / h
    # Map to closest supported ratio: 16:9 ≈ 1.78, 1:1 = 1.0, 9:16 ≈ 0.56
    if ratio >= 1.33:
        return "16:9"
    if ratio <= 0.75:
        return "9:16"
    return "1:1"


def _build_input(
    image_base64: str,
    prompt: str,
    negative_prompt: str,
    settings: Dict[str, Any],
) -> Dict[str, Any]:
    """Map settings onto a fal Wan input payload."""
    enhanced_prompt = f"{_PROMPT_PREFIX}{prompt}{_PROMPT_SUFFIX}".strip()

    user_neg = negative_prompt.strip()
    full_negative = f"{_NEGATIVE_BASE}, {user_neg}" if user_neg else _NEGATIVE_BASE

    payload: Dict[str, Any] = {
        "image_url": f"data:image/jpeg;base64,{image_base64}",
        "prompt": enhanced_prompt,
        "negative_prompt": full_negative,
    }

    resolution = str(settings.get("resolution", "480p"))
    if resolution in _SAFE_RESOLUTIONS:
        payload["resolution"] = resolution

    # Auto-detect aspect ratio from image so fal never crops the picture.
    # The user's stored preference is used only as a fallback when we can't
    # read the image header.
    stored_ratio = str(settings.get("aspect_ratio", _ASPECT_RATIO_DEFAULT))
    payload["aspect_ratio"] = _aspect_ratio_from_image(image_base64, stored_ratio)

    seed = settings.get("seed")
    if seed not in (None, "", 0):
        try:
            payload["seed"] = int(seed)
        except (TypeError, ValueError):
            pass
    return payload


def submit(
    model: str,
    key: str,
    image_base64: str,
    prompt: str,
    negative_prompt: str,
    settings: Dict[str, Any],
) -> str:
    """Queue a generation. Returns fal's request_id."""
    resp = requests.post(
        f"{BASE}/{model}",
        headers=_headers(key),
        json=_build_input(image_base64, prompt, negative_prompt, settings),
        timeout=SUBMIT_TIMEOUT,
    )
    if resp.status_code == 401:
        raise RuntimeError("fal.ai rejected the API key (401). Check the key in Settings.")
    if not resp.ok:
        raise RuntimeError(f"fal.ai submit error {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    request_id = data.get("request_id")
    if not request_id:
        raise RuntimeError("fal.ai did not return a request id.")
    return request_id


def poll(model: str, key: str, request_id: str) -> Dict[str, Any]:
    """Return {status, progress, stage} for a queued job."""
    resp = requests.get(
        f"{BASE}/{_app_id(model)}/requests/{request_id}/status",
        headers=_headers(key),
        timeout=POLL_TIMEOUT,
    )
    if not resp.ok:
        raise RuntimeError(f"fal.ai poll error {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    fal_status = (data.get("status") or "").upper()

    if fal_status == "COMPLETED":
        return {"status": "completed", "progress": 100.0, "stage": "Completed"}
    if fal_status in ("IN_QUEUE", "ENQUEUED"):
        pos = data.get("queue_position")
        stage = "Queued" if pos is None else f"Queued (position {pos})"
        return {"status": "processing", "progress": 10.0, "stage": stage}
    if fal_status == "IN_PROGRESS":
        return {"status": "processing", "progress": 60.0, "stage": "Rendering video"}
    return {"status": "failed", "progress": 0.0, "stage": "Failed", "error": f"fal.ai status: {fal_status or 'unknown'}"}


def fetch_result(model: str, key: str, request_id: str) -> Dict[str, Any]:
    """Fetch the finished output and return {video_url}."""
    resp = requests.get(
        f"{BASE}/{_app_id(model)}/requests/{request_id}",
        headers=_headers(key),
        timeout=RESULT_TIMEOUT,
    )
    if not resp.ok:
        raise RuntimeError(f"fal.ai result error {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    video = data.get("video") or (data.get("output") or {}).get("video") or {}
    url = video.get("url") if isinstance(video, dict) else None
    if not url and isinstance(data.get("video_url"), str):
        url = data["video_url"]
    if not url:
        raise RuntimeError("fal.ai finished but returned no video URL.")
    return {"video_url": url}
