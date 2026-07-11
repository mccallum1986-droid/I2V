"""
Image-to-Video provider abstraction.

Each supported AI model is implemented behind a common `ImageToVideoProvider`
interface so new models can be added without touching the API layer or the
frontend. The API routes requests to the correct provider via `get_provider`.

NOTE: Real image-to-video engines (Wan 2.7 / 2.6 / R2V) require a paid provider
API key (e.g. fal.ai). No key was supplied, so these providers run in MOCKED
mode: they simulate the full generation lifecycle (queued -> processing ->
completed) using time-based progress and return royalty-free sample clips as the
"generated" video. To go live, implement `generate_video` / `check_status` /
`get_result` with real API calls -- the rest of the app is already wired.
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
    # Real fal.ai model slug used when a fal.ai key is configured (LIVE mode).
    # Left as None on the base class -> that model stays mock-only.
    # Confirm/adjust a slug on its fal.ai model page if fal renames it.
    fal_model: Optional[str] = None

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


class Wan27Provider(_MockProvider):
    model_id = "wan-2.7"
    name = "Wan 2.7"
    description = "Our most advanced model. Cinematic motion, sharp detail, and superb prompt adherence."
    speed = "Slow"
    quality = "Ultra"
    use_case = "Hero shots, cinematic reels, and premium client deliverables."
    gen_seconds = 22
    badge = "Newest"
    fal_model = "fal-ai/wan/v2.2-a14b/image-to-video"
    supported_settings = [
        "duration", "resolution", "aspect_ratio", "motion_strength",
        "camera_movement", "creativity", "seed", "fps", "guidance_scale",
    ]


class Wan26Provider(_MockProvider):
    model_id = "wan-2.6"
    name = "Wan 2.6"
    description = "The balanced workhorse. Great quality with a faster turnaround for everyday creation."
    speed = "Balanced"
    quality = "High"
    use_case = "Social clips, product loops, and rapid iteration."
    gen_seconds = 15
    badge = "Popular"
    fal_model = "fal-ai/wan/v2.2-a14b/image-to-video"
    supported_settings = [
        "duration", "resolution", "aspect_ratio", "motion_strength",
        "camera_movement", "creativity", "seed", "fps",
    ]


class Wan26R2VProvider(_MockProvider):
    model_id = "wan-2.6-r2v"
    name = "Wan 2.6 R2V"
    description = "Reference-to-Video. Preserves your subject's identity with lightning-fast renders."
    speed = "Fast"
    quality = "High"
    use_case = "Portrait animation and identity-consistent motion."
    gen_seconds = 10
    badge = "Fastest"
    fal_model = "fal-ai/wan-i2v"
    supported_settings = [
        "duration", "resolution", "aspect_ratio", "motion_strength",
        "creativity", "seed",
    ]


_REGISTRY: Dict[str, ImageToVideoProvider] = {
    p.model_id: p
    for p in (Wan27Provider(), Wan26Provider(), Wan26R2VProvider())
}

DEFAULT_MODEL = "wan-2.6"


def list_models() -> List[Dict[str, Any]]:
    return [p.metadata() for p in _REGISTRY.values()]


def get_provider(model_id: str) -> Optional[ImageToVideoProvider]:
    return _REGISTRY.get(model_id)
