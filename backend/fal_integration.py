"""
fal.ai image-to-video integration (LIVE mode).

The app ships in MOCKED mode by default (see providers.py). The moment a fal.ai
API key is present -- either the FAL_KEY env var or a key saved from the app's
Settings screen -- generations are routed here instead and produce real videos.

This talks to fal's async **queue** API directly with `requests` (no extra SDK):
    submit  -> POST  https://queue.fal.run/{model}
    poll    -> GET   https://queue.fal.run/{app_id}/requests/{id}/status
    result  -> GET   https://queue.fal.run/{app_id}/requests/{id}

`app_id` is the first two path segments of the model slug (owner/app); any
deeper segments are routing on submit only. If fal ever changes this routing,
this is the one place to adjust.

Provider -> fal model slugs live on each provider in providers.py (`fal_model`).
Confirm/adjust a slug on its fal.ai model page if fal renames it.
"""
from __future__ import annotations

from typing import Any, Dict

import requests

BASE = "https://queue.fal.run"
SUBMIT_TIMEOUT = 30
POLL_TIMEOUT = 20
RESULT_TIMEOUT = 30

# fal Wan accepts these resolution tiers; anything else is dropped so fal falls
# back to its own default (keeps us from sending an unsupported value).
_SAFE_RESOLUTIONS = {"480p", "580p", "720p", "1080p"}


def _headers(key: str) -> Dict[str, str]:
    return {"Authorization": f"Key {key}", "Content-Type": "application/json"}


def _app_id(model: str) -> str:
    # fal's status/result queue endpoints use only owner/app (first 2 segments).
    # The full routing path is only needed on submit.
    parts = [p for p in model.split("/") if p]
    return "/".join(parts[:2]) if len(parts) >= 2 else model


def _build_input(image_base64: str, prompt: str, settings: Dict[str, Any]) -> Dict[str, Any]:
    """Map our stored settings onto a minimal, widely-accepted fal Wan input.

    We keep this deliberately small: extra/unknown fields make fal reject the
    request. image is passed as a JPEG data URI (matches what the app uploads).
    """
    payload: Dict[str, Any] = {
        "image_url": f"data:image/jpeg;base64,{image_base64}",
        "prompt": prompt,
    }
    resolution = str(settings.get("resolution", "480p"))
    if resolution in _SAFE_RESOLUTIONS:
        payload["resolution"] = resolution
    seed = settings.get("seed")
    if seed not in (None, "", 0):
        try:
            payload["seed"] = int(seed)
        except (TypeError, ValueError):
            pass
    return payload


def submit(model: str, key: str, image_base64: str, prompt: str, settings: Dict[str, Any]) -> str:
    """Queue a generation. Returns fal's request_id."""
    resp = requests.post(
        f"{BASE}/{model}",
        headers=_headers(key),
        json=_build_input(image_base64, prompt, settings),
        timeout=SUBMIT_TIMEOUT,
    )
    if resp.status_code == 401:
        raise RuntimeError("fal.ai rejected the API key (401). Check the key in Settings.")
    if not resp.ok:
        raise RuntimeError(f"fal.ai submit error {resp.status_code}: {resp.text[:400]}")
    resp.raise_for_status()
    data = resp.json()
    request_id = data.get("request_id")
    if not request_id:
        raise RuntimeError("fal.ai did not return a request id.")
    return request_id


def poll(model: str, key: str, request_id: str) -> Dict[str, Any]:
    """Return {status, progress, stage} for a queued job.

    status is one of: "processing" | "completed" | "failed".
    """
    resp = requests.get(
        f"{BASE}/{_app_id(model)}/requests/{request_id}/status",
        headers=_headers(key),
        timeout=POLL_TIMEOUT,
    )
    if not resp.ok:
        raise RuntimeError(f"fal.ai poll error {resp.status_code}: {resp.text[:400]}")
    resp.raise_for_status()
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
    # Anything else (e.g. an error state) -> surface as failed.
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
    resp.raise_for_status()
    data = resp.json()
    # fal Wan returns {"video": {"url": ...}}; some models nest under "output".
    video = data.get("video") or (data.get("output") or {}).get("video") or {}
    url = video.get("url") if isinstance(video, dict) else None
    if not url and isinstance(data.get("video_url"), str):
        url = data["video_url"]
    if not url:
        raise RuntimeError("fal.ai finished but returned no video URL.")
    return {"video_url": url}
