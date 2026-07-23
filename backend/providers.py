"""
Image-to-Video provider abstraction.

Each supported AI model is implemented behind a common `ImageToVideoProvider`
interface so new models can be added without touching the API layer or the
frontend. The API routes requests to the correct provider via `get_provider`.

NOTE: The cloud engine (A2E, video.a2e.ai) requires an API token. Until one is
supplied the provider runs in MOCKED mode: it simulates the full generation
lifecycle (queued -> processing -> completed) using time-based progress and
returns royalty-free sample clips as the "generated" video. When an A2E token is
configured (Settings screen or the A2E_API_KEY env var) a `live_capable`
provider routes to A2E for real generation — see `a2e_integration.py`. The
self-hosted GPU path (Studio) is separate and unaffected.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import hashlib

# Royalty-free sample clips used only while running in MOCKED mode.
SAMPLE_VIDEOS: List[str] = [
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
]

STAGES = [
    (0, "Queued"),
    (5, "Analyzing image"),
    (20, "Interpreting prompt"),
    (40, "Generating motion frames"),
    (70, "Rendering video"),
    (90, "Finalizing & encoding"),
    (100, "Completed"),
]


def _stage_for(progress: float) -> str:
    stage = STAGES[0][1]
    for threshold, label in STAGES:
        if progress >= threshold:
            stage = label
    return stage


class ImageToVideoProvider(ABC):
    """Common interface every image-to-video model must implement."""

    model_id: str
    name: str
    description: str
    speed: str  # "Fast" | "Balanced" | "Slow"
    quality: str  # "Standard" | "High" | "Ultra"
    use_case: str
    gen_seconds: int  # simulated generation time (mock)
    supported_settings: List[str]
    badge: str
    # True when a real cloud engine backs this provider (A2E) once a token is
    # configured. Left False on the base class -> that model stays mock-only.
    live_capable: bool = False

    def metadata(self) -> Dict[str, Any]:
        return {
            "model_id": self.model_id,
            "name": self.name,
            "description": self.description,
            "speed": self.speed,
            "quality": self.quality,
            "use_case": self.use_case,
            "supported_settings": self.supported_settings,
            "badge": self.badge,
            "est_seconds": self.gen_seconds,
        }

    @abstractmethod
    def generate_video(self, image_base64: str, prompt: str, settings: Dict[str, Any]) -> str:
        """Kick off a generation. Returns a provider job id."""

    @abstractmethod
    def check_status(self, provider_job_id: str, started_at: datetime) -> Dict[str, Any]:
        """Return current {status, progress, stage} for a running job."""

    @abstractmethod
    def get_result(self, provider_job_id: str) -> Dict[str, Any]:
        """Return the final {video_url} once completed."""


class _MockProvider(ImageToVideoProvider):
    """Shared MOCKED implementation driven by elapsed wall-clock time."""

    def generate_video(self, image_base64: str, prompt: str, settings: Dict[str, Any]) -> str:
        seed = f"{self.model_id}:{prompt}:{settings.get('seed', '')}"
        return "job_" + hashlib.sha1(seed.encode()).hexdigest()[:16]

    def check_status(self, provider_job_id: str, started_at: datetime) -> Dict[str, Any]:
        now = datetime.now(timezone.utc)
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        elapsed = (now - started_at).total_seconds()
        progress = min(100.0, round((elapsed / max(self.gen_seconds, 1)) * 100, 1))
        status = "completed" if progress >= 100 else "processing"
        return {"status": status, "progress": progress, "stage": _stage_for(progress)}

    def get_result(self, provider_job_id: str) -> Dict[str, Any]:
        idx = int(hashlib.sha1(provider_job_id.encode()).hexdigest(), 16) % len(SAMPLE_VIDEOS)
        return {"video_url": SAMPLE_VIDEOS[idx]}


class A2EProvider(_MockProvider):
    """A2E (video.a2e.ai) image-to-video — the cloud engine.

    A2E's start endpoint takes just the source image + prompt/negative prompt,
    so this provider deliberately exposes no extra generation settings. It's
    tuned for human/portrait subjects (a person speaking, natural face motion).
    Runs MOCKED until an A2E token is configured, then routes live via
    a2e_integration (see server._run_generation).
    """
    model_id = "a2e"
    name = "A2E"
    description = "Cloud engine by A2E. Brings a portrait to life — natural face, eye, and lip motion from a single photo."
    speed = "Balanced"
    quality = "High"
    use_case = "Talking portraits and lifelike people from a still image."
    gen_seconds = 18  # mock timing; live jobs are driven by A2E's own progress.
    badge = "Cloud"
    live_capable = True
    # A2E's API only consumes the image + prompts, so no extra knobs are shown.
    supported_settings: List[str] = []


_REGISTRY: Dict[str, ImageToVideoProvider] = {
    p.model_id: p for p in (A2EProvider(),)
}

DEFAULT_MODEL = "a2e"


def list_models() -> List[Dict[str, Any]]:
    return [p.metadata() for p in _REGISTRY.values()]


def get_provider(model_id: str) -> Optional[ImageToVideoProvider]:
    return _REGISTRY.get(model_id)
