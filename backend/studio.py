"""
Self-hosted GPU studio — Vast.ai instance management + generation proxy.

Architecture:
  - Vast.ai API key + instance ID stored in MongoDB (set via app Settings)
  - Start/stop calls go to Vast.ai's REST API
  - Generation requests proxy to the HTTP endpoint running on the GPU instance
    (a simple FastAPI wrapper around the Wan model — see README for setup)

GPU endpoint contract (what must run on the rented machine):
  POST /generate   body: {image_url, prompt, negative_prompt, resolution, aspect_ratio}
                   returns: {job_id: str}
  GET  /status/{job_id}
                   returns: {status: "queued"|"processing"|"completed"|"failed",
                             progress: float, stage: str, error?: str}
  GET  /result/{job_id}
                   returns: {video_url: str}
"""
from __future__ import annotations

import time
from typing import Any, Dict, Optional, Tuple

import requests

VASTAI_BASE = "https://cloud.vast.ai/api/v0"
INSTANCE_BOOT_POLL_SECS = 5
INSTANCE_BOOT_TIMEOUT_SECS = 300  # 5 min max wait for GPU to come online


def _vastai_headers(api_key: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def get_account_info(api_key: str) -> Dict[str, Any]:
    """Return Vast.ai account balance and credit info."""
    resp = requests.get(
        f"{VASTAI_BASE}/users/current/",
        headers=_vastai_headers(api_key),
        timeout=15,
    )
    if not resp.ok:
        raise RuntimeError(f"Vast.ai account lookup failed {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    # Vast.ai returns credit in dollars as a float
    return {
        "balance": round(float(data.get("credit", 0)), 4),
        "username": data.get("username", ""),
        "email": data.get("email", ""),
    }


# ---------------------------------------------------------------------------
# Instance lifecycle
# ---------------------------------------------------------------------------

def get_instance_status(api_key: str, instance_id: str) -> Dict[str, Any]:
    """Return raw Vast.ai instance info dict."""
    resp = requests.get(
        f"{VASTAI_BASE}/instances/{instance_id}/",
        headers=_vastai_headers(api_key),
        timeout=15,
    )
    if not resp.ok:
        raise RuntimeError(f"Vast.ai instance lookup failed {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    instance = data.get("instances")
    if isinstance(instance, dict):
        return instance
    if isinstance(instance, list) and instance:
        return instance[0]
    if "id" in data:
        return data
    raise RuntimeError("Instance not found — check the instance ID in Studio settings.")


def parse_gpu_state(instance: Dict[str, Any]) -> Tuple[str, Optional[str]]:
    """Return (state, public_ip_or_none).

    state is one of: "off" | "starting" | "ready" | "unknown"
    public_ip includes the mapped external port for port 8080.
    """
    actual_status = (instance.get("actual_status") or "").lower()
    intended_status = (instance.get("intended_status") or "").lower()
    public_ip = instance.get("public_ipaddr") or None

    # Resolve the external port mapped to internal 10100 (our API server port)
    ports = instance.get("ports") or {}
    port_mappings = ports.get("10100/tcp") or []
    external_port = None
    for m in port_mappings:
        if m.get("HostIp") == "0.0.0.0":
            external_port = m.get("HostPort")
            break

    # Return ip:port so the rest of the stack can use it directly
    if public_ip and external_port:
        public_ip_with_port = f"{public_ip}:{external_port}"
    else:
        public_ip_with_port = public_ip

    if actual_status == "running" and public_ip:
        return "ready", public_ip_with_port
    if intended_status == "running" or actual_status in ("loading", "provisioning", "starting"):
        return "starting", None
    if actual_status in ("stopped", "exited", "offline") or intended_status == "stopped":
        return "off", None
    return "unknown", public_ip_with_port


def start_instance(api_key: str, instance_id: str) -> None:
    resp = requests.put(
        f"{VASTAI_BASE}/instances/{instance_id}/",
        headers=_vastai_headers(api_key),
        json={"state": "running"},
        timeout=20,
    )
    if not resp.ok:
        raise RuntimeError(f"Failed to start GPU instance {resp.status_code}: {resp.text[:300]}")


def stop_instance(api_key: str, instance_id: str) -> None:
    resp = requests.put(
        f"{VASTAI_BASE}/instances/{instance_id}/",
        headers=_vastai_headers(api_key),
        json={"state": "stopped"},
        timeout=20,
    )
    if not resp.ok:
        raise RuntimeError(f"Failed to stop GPU instance {resp.status_code}: {resp.text[:300]}")


# ---------------------------------------------------------------------------
# Generation proxy
# ---------------------------------------------------------------------------

def _gpu_url(public_ip: str, port: int = 8081) -> str:
    # public_ip may already contain :port from parse_gpu_state
    if ":" in public_ip:
        return f"http://{public_ip}"
    return f"http://{public_ip}:{port}"


def submit_generation(
    public_ip: str,
    image_base64: str,
    prompt: str,
    negative_prompt: str,
    settings: Dict[str, Any],
    port: int = 8080,
) -> str:
    """Submit a generation to the self-hosted endpoint. Returns job_id."""
    payload = {
        "image_url": f"data:image/jpeg;base64,{image_base64}",
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "resolution": settings.get("resolution", "720p"),
        "aspect_ratio": settings.get("aspect_ratio", "16:9"),
        "duration": settings.get("duration", 5),
    }
    resp = requests.post(
        f"{_gpu_url(public_ip, port)}/generate",
        json=payload,
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"Studio GPU error {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    job_id = data.get("job_id")
    if not job_id:
        raise RuntimeError("GPU endpoint did not return a job_id.")
    return job_id


def poll_generation(public_ip: str, job_id: str, port: int = 8080) -> Dict[str, Any]:
    resp = requests.get(
        f"{_gpu_url(public_ip, port)}/status/{job_id}",
        timeout=20,
    )
    if not resp.ok:
        raise RuntimeError(f"Studio poll error {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def fetch_result(public_ip: str, job_id: str, port: int = 8080) -> Dict[str, Any]:
    resp = requests.get(
        f"{_gpu_url(public_ip, port)}/result/{job_id}",
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"Studio result error {resp.status_code}: {resp.text[:300]}")
    return resp.json()
