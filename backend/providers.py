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
    # A2E routing (see a2e_integration): which engine family + model this maps to.
    a2e_family: str = "image2video"       # "image2video" | "wan25"
    a2e_model: Optional[str] = None        # Wan model id, e.g. "wan2.7-i2v"
    a2e_task_type: Optional[str] = None    # Wan 2.7 generation mode (first_frame)
    # Per-model UI option sets surfaced to the app (empty -> control hidden).
    duration_options: List[int] = []
    resolution_options: List[str] = []
    supports_audio: bool = False
    requires_vip: bool = False
    # Generation modes (A2E task_types) this model offers. >1 -> app shows a mode
    # picker. Empty -> single default mode (standard image-to-video).
    modes: List[str] = []
    credit_rate: int = 0  # A2E credits per second at 720p (0 -> unknown/mock)
    # Exact per-duration cost overrides for non-linear pricing (e.g. Spicy).
    # Keys are seconds; when a duration is present here it wins over credit_rate.
    credit_costs: Dict[int, int] = {}

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
            "duration_options": self.duration_options,
            "resolution_options": self.resolution_options,
            "supports_audio": self.supports_audio,
            "requires_vip": self.requires_vip,
            "credit_rate": self.credit_rate,
            "credit_costs": self.credit_costs,
            "modes": self.modes,
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


class _A2EBase(_MockProvider):
    """Shared base for the A2E-backed cloud models (live once a token is set)."""
    live_capable = True


class A2EFaceProvider(_A2EBase):
    """A2E's own face-optimised model (userImage2Video)."""
    model_id = "a2e"
    name = "A2E Faces"
    description = "A2E's face model — brings a portrait to life with natural face, eye, and lip motion from a single photo."
    speed = "Balanced"
    quality = "High"
    use_case = "Talking portraits and lifelike people from a still image."
    gen_seconds = 18
    badge = "Faces"
    a2e_family = "image2video"
    supported_settings = ["duration", "enhance_prompt"]
    duration_options = [5, 10, 15, 20]
    credit_rate = 6


class _WanBase(_A2EBase):
    """Shared config for the Wan family (userWan25 endpoint).

    All Wan models run standard image-to-video (`task_type=first_frame`) and
    share the same controls; subclasses set the model id, labels and duration set.
    """
    a2e_family = "wan25"
    a2e_task_type = "first_frame"  # standard image-to-video mode
    supported_settings = ["duration", "resolution", "seed", "audio", "enhance_prompt"]
    # 720p is confirmed for every Wan model (480p is rejected by e.g. flash);
    # 720p is the default. A2E surfaces a clear error if a model rejects 1080p.
    resolution_options = ["720p", "1080p"]
    supports_audio = True


class Wan27Provider(_WanBase):
    model_id = "wan-2.7"
    name = "Wan 2.7"
    description = "The newest Wan model. Cinematic motion, sharp detail, and superb prompt adherence."
    speed = "Slow"
    quality = "Ultra"
    use_case = "Hero shots and premium, cinematic image-to-video."
    gen_seconds = 30
    badge = "Newest"
    a2e_model = "wan2.7-i2v"
    requires_vip = True
    duration_options = [5, 10, 15]
    credit_rate = 24
    modes = ["first_frame", "video_extend"]


class Wan26Provider(_WanBase):
    model_id = "wan-2.6"
    name = "Wan 2.6"
    description = "High-quality Wan generation with strong motion and detail."
    speed = "Balanced"
    quality = "Ultra"
    use_case = "Polished clips when you want top quality."
    gen_seconds = 22
    badge = "Pro"
    a2e_model = "wan2.6-i2v"
    requires_vip = True
    duration_options = [5, 10, 15]
    credit_rate = 15


class Wan26FlashProvider(_WanBase):
    model_id = "wan-2.6-flash"
    name = "Wan 2.6 Flash"
    description = "Fast Wan model available on any plan. Great quality with a quick turnaround."
    speed = "Fast"
    quality = "High"
    use_case = "Everyday creation and rapid iteration."
    gen_seconds = 12
    badge = "Free"
    a2e_model = "wan2.6-i2v-flash"
    duration_options = [5, 10, 15]
    credit_rate = 6


class Wan25Provider(_WanBase):
    model_id = "wan-2.5"
    name = "Wan 2.5"
    description = "The Wan 2.5 preview model. Reliable image-to-video at 5 or 10 seconds."
    speed = "Balanced"
    quality = "High"
    use_case = "Solid general-purpose image-to-video."
    gen_seconds = 15
    badge = "Preview"
    a2e_model = "wan2.5-i2v-preview"
    duration_options = [5, 10]
    credit_rate = 15


class Wan22SpicyProvider(_A2EBase):
    """Uncensored Wan 2.2 (userWanSpicy). Image-to-video, no audio."""
    model_id = "wan-2.2-spicy"
    name = "Wan 2.2 Spicy"
    description = "Uncensored Wan 2.2 image-to-video. 5 or 8 seconds, no audio."
    speed = "Balanced"
    quality = "High"
    use_case = "Unrestricted image-to-video."
    gen_seconds = 18
    badge = "Spicy"
    a2e_family = "wanspicy"
    a2e_model = "wan2.2-i2v-spicy"
    supported_settings = ["duration", "resolution", "seed", "enhance_prompt"]
    duration_options = [5, 8]
    resolution_options = ["480p", "720p"]
    credit_costs = {5: 200, 8: 320}


class Wan27SpicyProvider(_A2EBase):
    """Uncensored Wan 2.7 (userWanSpicy). Image-to-video."""
    model_id = "wan-2.7-spicy"
    name = "Wan 2.7 Spicy"
    description = "Uncensored Wan 2.7 image-to-video. Up to 1080p."
    speed = "Slow"
    quality = "Ultra"
    use_case = "Unrestricted, high-quality image-to-video."
    gen_seconds = 30
    badge = "Spicy"
    a2e_family = "wanspicy"
    a2e_model = "wan2.7-i2v-spicy"
    supported_settings = ["duration", "resolution", "seed", "enhance_prompt"]
    duration_options = [5, 8, 10, 15]
    resolution_options = ["720p", "1080p"]
    credit_costs = {5: 250, 8: 400, 10: 500, 15: 759}


_REGISTRY: Dict[str, ImageToVideoProvider] = {
    p.model_id: p
    for p in (
        Wan27Provider(),
        Wan26FlashProvider(),
        Wan26Provider(),
        Wan25Provider(),
        A2EFaceProvider(),
        Wan27SpicyProvider(),
        Wan22SpicyProvider(),
    )
}

# Free on any plan, so a safe default engine.
DEFAULT_MODEL = "wan-2.6-flash"


def list_models() -> List[Dict[str, Any]]:
    return [p.metadata() for p in _REGISTRY.values()]


def get_provider(model_id: str) -> Optional[ImageToVideoProvider]:
    return _REGISTRY.get(model_id)
