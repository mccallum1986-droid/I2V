"""
A2E.ai video integration (LIVE mode).

A2E (video.a2e.ai) exposes two image-to-video engine families, and this module
drives both behind one interface (`submit` / `poll` / `fetch_result`), selected
by a `family` string:

  "image2video"  A2E's own face-optimised model
      start -> POST userImage2Video/start   (model_type GENERAL, video_time)
      poll  -> GET  video/awsList           (?current=..&pageSize=..)

  "wan25"        the Wan family (Wan 2.5 / 2.6 / 2.6-flash / 2.7)
      start -> POST userWan25/start         (model=wan2.x-i2v, duration, resolution, ...)
      poll  -> GET  userWan25/allRecords    (?pageNum=..&pageSize=..)

In both, a job is polled by finding its `_id` in the user's result list; a
finished item carries `status` ("success"), `process` (0-100) and `result`
(the mp4 URL). Auth is a Bearer token on every request.

A2E fetches the source image from a public URL (it does not accept base64), so
the caller passes an https URL we serve ourselves — see
`GET /api/generations/{id}/source-image` in server.py.

Both families are verified against the live API (submit -> poll -> result). The
result shapes differ by family, so `_extract_status` / `_extract_url` / `_as_list`
accept both key sets: Face uses status/result under `data.data`; Wan uses
current_status/result_url under `data.rows`.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import requests

BASE = "https://video.a2e.ai/api/v1"
SUBMIT_TIMEOUT = 30
POLL_TIMEOUT = 20

# How far back to look for our job in the user's result list (newest first).
_LIST_PAGE_SIZE = 20
_LIST_MAX_PAGES = 3

# Per-family endpoint routing. `page_param` differs: awsList pages by `current`,
# the Wan list pages by `pageNum`.
_FAMILIES: Dict[str, Dict[str, str]] = {
    "image2video": {"start": "userImage2Video/start", "list": "video/awsList", "page_param": "current"},
    "wan25": {"start": "userWan25/start", "list": "userWan25/allRecords", "page_param": "pageNum"},
    "wanspicy": {"start": "userWanSpicy/start", "list": "userWanSpicy/allRecords", "page_param": "pageNum"},
}

# A2E face model clip lengths (seconds) via `video_time`.
_VIDEO_TIMES = (5, 10, 15, 20)

# Wan clip lengths (seconds) per model — Wan 2.5 only supports 5/10.
_WAN_DURATIONS: Dict[str, tuple] = {
    "wan2.5-i2v-preview": (5, 10),
    "wan2.6-i2v": (5, 10, 15),
    "wan2.6-i2v-flash": (5, 10, 15),
    "wan2.7-i2v": (5, 10, 15),
}
_WAN_DURATION_DEFAULT = (5, 10, 15)
_RESOLUTIONS = {"480p", "720p", "1080p"}

# Wan Spicy (uncensored) clip lengths per model. 2.2 supports 5/8; 2.7 supports 2-15.
_SPICY_DURATIONS: Dict[str, tuple] = {
    "wan2.2-i2v-spicy": (5, 8),
    "wan2.7-i2v-spicy": (5, 8, 10, 15),
}

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

# Field names A2E uses for a job's state / output URL inside a result item.
# The two families differ (all live-verified):
#   Face (awsList): status `status`="success", url `result`,      list `data.data`
#   Wan  (allRecords): status `current_status`="completed", url `result_url`, list `data.rows`
_STATUS_KEYS = ("current_status", "status", "state", "video_status", "process_status")
_URL_KEYS = ("result", "result_url", "video_url", "videoUrl", "url", "output", "video")
_DONE_WORDS = {"success", "succeeded", "completed", "complete", "done", "finished"}
_FAILED_WORDS = {"failed", "fail", "error", "cancelled", "canceled", "timeout"}
# Keys that hold a job's list of items inside the `data` envelope, per family.
_LIST_KEYS = ("rows", "data", "list", "items", "records", "results")


def _headers(key: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def get_credits(key: str) -> Dict[str, Any]:
    """Return the account's live A2E balance: {coins, diamonds}."""
    resp = requests.get(f"{BASE}/user/remainingCoins", headers=_headers(key), timeout=POLL_TIMEOUT)
    if resp.status_code in (401, 403):
        raise RuntimeError("A2E rejected the API token.")
    if not resp.ok:
        raise RuntimeError(f"A2E credits error {resp.status_code}: {resp.text[:200]}")
    data = resp.json().get("data") or {}
    return {"coins": data.get("coins"), "diamonds": data.get("diamonds")}


def _build_prompt(prompt: str, negative_prompt: str) -> tuple[str, str]:
    # The app appends a visible, user-editable suffix to the prompt, so we no
    # longer prepend a hidden quality prefix here — the user's own text leads.
    enhanced = prompt.strip()
    user_neg = negative_prompt.strip()
    full_negative = f"{_NEGATIVE_BASE}, {user_neg}" if user_neg else _NEGATIVE_BASE
    return enhanced, full_negative


def _bool(val: Any, default: bool) -> bool:
    if val is None:
        return default
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() in ("1", "true", "yes", "on")


def _snap(want: Any, allowed: tuple, fallback: int) -> int:
    try:
        n = int(want)
    except (TypeError, ValueError):
        return fallback
    if n in allowed:
        return n
    return min(allowed, key=lambda v: abs(v - n))


def _resolution(settings: Dict[str, Any]) -> str:
    r = str(settings.get("resolution", "720p"))
    return r if r in _RESOLUTIONS else "720p"


def _seed(settings: Dict[str, Any]) -> Optional[int]:
    seed = settings.get("seed")
    if seed in (None, "", 0):
        return None
    try:
        val = int(seed)
    except (TypeError, ValueError):
        return None
    return val if 0 <= val <= 2147483647 else None


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------
def _post_start(key: str, family: str, payload: Dict[str, Any]) -> str:
    resp = requests.post(
        f"{BASE}/{_FAMILIES[family]['start']}",
        headers=_headers(key),
        json=payload,
        timeout=SUBMIT_TIMEOUT,
    )
    if resp.status_code in (401, 403):
        raise RuntimeError("A2E rejected the API token. Check the token in Settings.")
    if not resp.ok:
        raise RuntimeError(f"A2E submit error {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    # Envelope: {"code": 0, "data": {"_id": ...}}; non-zero code == error.
    if isinstance(data, dict) and data.get("code") not in (0, None):
        raise RuntimeError(f"A2E submit failed: {data.get('message') or data.get('msg') or data}")
    body = data.get("data") if isinstance(data, dict) else None
    job_id = None
    if isinstance(body, dict):
        job_id = body.get("_id") or body.get("id")
    if not job_id:
        raise RuntimeError("A2E did not return a job id (_id).")
    return job_id


def submit(
    key: str,
    family: str,
    image_url: str,
    prompt: str,
    negative_prompt: str,
    settings: Dict[str, Any],
    *,
    model: Optional[str] = None,
    task_type: Optional[str] = None,
    first_clip_url: Optional[str] = None,
    name: str = "WanStudio",
) -> str:
    """Queue a generation on the given engine family. Returns A2E's job id."""
    enhanced, full_negative = _build_prompt(prompt, negative_prompt)
    enhance = _bool(settings.get("enhance_prompt"), True)

    if family == "wanspicy":
        allowed = _SPICY_DURATIONS.get(model or "", (5,))
        payload: Dict[str, Any] = {
            "name": name,
            "model": model,  # wan2.2-i2v-spicy | wan2.7-i2v-spicy
            "prompt": enhanced,
            "image_url": image_url,
            "resolution": _resolution(settings),
            "duration": _snap(settings.get("duration", allowed[0]), allowed, allowed[0]),  # number, not str
            "prompt_extend": enhance,
        }
        if model == "wan2.7-i2v-spicy":  # negative_prompt only valid on 2.7 spicy
            payload["negative_prompt"] = full_negative
        seed = _seed(settings)
        if seed is not None:
            payload["seed"] = seed
        # Deliberately NOT setting minor_suspected_skip -> A2E's minor-detection
        # safeguard stays active.
        return _post_start(key, "wanspicy", payload)

    if family == "wan25":
        allowed = _WAN_DURATIONS.get(model or "", _WAN_DURATION_DEFAULT)
        payload: Dict[str, Any] = {
            "name": name,
            "prompt": enhanced,
            "negative_prompt": full_negative,
            "model": model,
            "duration": str(_snap(settings.get("duration", allowed[0]), allowed, allowed[0])),
            "resolution": _resolution(settings),
            "enable_prompt_expansion": enhance,
            "multi_shots": False,
            "audio": _bool(settings.get("audio"), False),
        }
        if task_type == "video_extend" and first_clip_url:
            # Extend an existing clip — video source instead of an image.
            payload["task_type"] = "video_extend"
            payload["first_clip_url"] = first_clip_url
        else:
            payload["image_url"] = image_url
            if task_type:  # only Wan 2.7 uses task_type; others ignore it
                payload["task_type"] = task_type
        seed = _seed(settings)
        if seed is not None:
            payload["seed"] = seed
        return _post_start(key, "wan25", payload)

    # Default: A2E's own face model (userImage2Video)
    payload = {
        "name": name,
        "image_url": image_url,
        "prompt": enhanced,
        "negative_prompt": full_negative,
        "model_type": "GENERAL",  # standard image-to-video (vs FLF2V)
        "video_time": _snap(settings.get("duration", 5), _VIDEO_TIMES, 5),
        "extend_prompt": enhance,
        "skip_face_enhance": False,
    }
    return _post_start(key, "image2video", payload)


# ---------------------------------------------------------------------------
# Poll / result — find the job in the user's result list
# ---------------------------------------------------------------------------
def _fetch_list(key: str, family: str) -> List[Dict[str, Any]]:
    """Return the user's most recent result items for a family (newest first)."""
    cfg = _FAMILIES[family]
    items: List[Dict[str, Any]] = []
    for page in range(1, _LIST_MAX_PAGES + 1):
        resp = requests.get(
            f"{BASE}/{cfg['list']}",
            headers=_headers(key),
            params={cfg["page_param"]: page, "pageSize": _LIST_PAGE_SIZE},
            timeout=POLL_TIMEOUT,
        )
        if not resp.ok:
            raise RuntimeError(f"A2E poll error {resp.status_code}: {resp.text[:400]}")
        data = resp.json()
        body = data.get("data") if isinstance(data, dict) else data
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
        for k in _LIST_KEYS:
            v = body.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
    return []


def _find_item(key: str, family: str, job_id: str) -> Optional[Dict[str, Any]]:
    for item in _fetch_list(key, family):
        if str(item.get("_id") or item.get("id")) == str(job_id):
            return item
    return None


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


def _extract_status(item: Dict[str, Any]) -> str:
    """Map a result item to one of: completed | processing | failed."""
    # A finished clip carries an output URL even if the status label is odd.
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


def poll(key: str, family: str, job_id: str) -> Dict[str, Any]:
    """Return {status, progress, stage} for a queued job."""
    item = _find_item(key, family, job_id)
    if not item:
        # Job hasn't surfaced in the list yet — still queued.
        return {"status": "processing", "progress": 10.0, "stage": "Queued"}
    state = _extract_status(item)
    if state == "completed":
        return {"status": "completed", "progress": 100.0, "stage": "Completed"}
    if state == "failed":
        msg = (item.get("failed_message") or item.get("msg") or item.get("message")
               or item.get("error") or "A2E generation failed.")
        return {"status": "failed", "progress": 0.0, "stage": "Failed", "error": str(msg)}
    try:
        pct = float(item.get("process", 0) or 0)
    except (TypeError, ValueError):
        pct = 0.0
    return {"status": "processing", "progress": min(95.0, max(15.0, pct)), "stage": "Rendering video"}


def fetch_result(key: str, family: str, job_id: str) -> Dict[str, Any]:
    """Fetch the finished clip and return {video_url}."""
    item = _find_item(key, family, job_id)
    url = _extract_url(item) if item else None
    if not url:
        raise RuntimeError("A2E finished but returned no video URL.")
    return {"video_url": url}
