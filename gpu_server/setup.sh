#!/bin/bash
# WanStudio GPU Setup Script
# Run this once on your Vast.ai instance after renting it.
# It downloads the Wan model and starts the generation API server on port 8080.
#
# Usage (after SSH-ing into your Vast.ai instance):
#   curl -sSL https://raw.githubusercontent.com/mccallum1986-droid/I2V/main/gpu_server/setup.sh | bash
#
# Or if you've cloned the repo onto the instance:
#   bash gpu_server/setup.sh

set -e

echo "======================================"
echo "  WanStudio GPU Server Setup"
echo "======================================"

# ── 1. System packages ────────────────────────────────────────────────────────
echo ""
echo "[1/5] Installing system packages..."
apt-get update -qq
apt-get install -y -qq git wget curl ffmpeg libgl1 libglib2.0-0

# ── 2. Python dependencies ───────────────────────────────────────────────────
echo ""
echo "[2/5] Installing Python packages..."
pip install -q --upgrade pip
pip install -q \
  fastapi==0.111.0 \
  uvicorn==0.29.0 \
  torch==2.3.0 \
  torchvision==0.18.0 \
  diffusers==0.28.0 \
  transformers==4.41.0 \
  accelerate==0.30.0 \
  huggingface_hub==0.23.0 \
  Pillow==10.3.0 \
  imageio==2.34.0 \
  imageio-ffmpeg==0.5.1 \
  numpy==1.26.4 \
  python-multipart==0.0.9 \
  httpx==0.27.0

# ── 3. Download Wan model weights ────────────────────────────────────────────
echo ""
echo "[3/5] Downloading Wan 2.1 model weights (this takes ~20 min on first run)..."
mkdir -p /workspace/models
python3 - <<'PYEOF'
from huggingface_hub import snapshot_download
import os

model_dir = "/workspace/models/wan-2.1-i2v"
if os.path.exists(model_dir) and len(os.listdir(model_dir)) > 5:
    print("  Model already downloaded, skipping.")
else:
    print("  Downloading from HuggingFace (Wan-AI/Wan2.1-I2V-14B-480P)...")
    snapshot_download(
        repo_id="Wan-AI/Wan2.1-I2V-14B-480P",
        local_dir=model_dir,
        ignore_patterns=["*.md", "*.txt", "flax_model*", "tf_model*"],
    )
    print("  Download complete.")
PYEOF

# ── 4. Copy the API server ────────────────────────────────────────────────────
echo ""
echo "[4/5] Setting up API server..."
mkdir -p /workspace/wanstudio

# Write the server.py directly so this script is fully self-contained
cat > /workspace/wanstudio/server.py << 'SERVEREOF'
"""
WanStudio self-hosted GPU API server.
Runs on the Vast.ai instance — receives generation requests from the WanStudio app.
Exposes three endpoints on port 8080:
  POST /generate
  GET  /status/{job_id}
  GET  /result/{job_id}
"""
import asyncio
import base64
import io
import os
import threading
import time
import uuid
from typing import Any, Dict, Optional

import torch
from diffusers import WanImageToVideoPipeline
from diffusers.utils import export_to_video
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
import uvicorn
from pydantic import BaseModel

MODEL_DIR = os.environ.get("MODEL_DIR", "/workspace/models/wan-2.1-i2v")
VIDEO_DIR = "/workspace/videos"
PORT = int(os.environ.get("PORT", "8080"))

os.makedirs(VIDEO_DIR, exist_ok=True)

app = FastAPI(title="WanStudio GPU Server")

# ── Pipeline (loaded once at startup) ────────────────────────────────────────
print("Loading Wan pipeline...", flush=True)
pipe = WanImageToVideoPipeline.from_pretrained(
    MODEL_DIR,
    torch_dtype=torch.bfloat16,
)
pipe.enable_model_cpu_offload()
print("Pipeline ready.", flush=True)

# ── Job store ────────────────────────────────────────────────────────────────
_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()

RESOLUTION_MAP = {
    "480p":  (832, 480),
    "720p":  (1280, 720),
    "1080p": (1920, 1080),
}

ASPECT_SIZE_MAP = {
    "16:9": (832, 480),
    "9:16": (480, 832),
    "1:1":  (640, 640),
}


def _res_for(resolution: str, aspect_ratio: str):
    if resolution in RESOLUTION_MAP:
        w, h = RESOLUTION_MAP[resolution]
        # Flip for portrait
        if aspect_ratio == "9:16":
            return h, w
        return w, h
    if aspect_ratio in ASPECT_SIZE_MAP:
        return ASPECT_SIZE_MAP[aspect_ratio]
    return 832, 480


def _run_generation(job_id: str, image_b64: str, prompt: str, negative_prompt: str,
                    resolution: str, aspect_ratio: str, duration: int):
    try:
        with _lock:
            _jobs[job_id]["status"] = "processing"
            _jobs[job_id]["stage"] = "Loading image"
            _jobs[job_id]["progress"] = 10.0

        # Decode image
        header = "data:image/jpeg;base64,"
        raw = image_b64[len(header):] if image_b64.startswith(header) else image_b64
        image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")

        width, height = _res_for(resolution, aspect_ratio)
        num_frames = min(max(int(duration * 16), 16), 320)  # 16fps, cap at 320 frames

        with _lock:
            _jobs[job_id]["stage"] = "Generating video"
            _jobs[job_id]["progress"] = 20.0

        output = pipe(
            image=image,
            prompt=prompt,
            negative_prompt=negative_prompt or "",
            height=height,
            width=width,
            num_frames=num_frames,
            guidance_scale=5.0,
            num_inference_steps=30,
        )

        with _lock:
            _jobs[job_id]["stage"] = "Encoding video"
            _jobs[job_id]["progress"] = 90.0

        video_path = os.path.join(VIDEO_DIR, f"{job_id}.mp4")
        export_to_video(output.frames[0], video_path, fps=16)

        with _lock:
            _jobs[job_id]["status"] = "completed"
            _jobs[job_id]["stage"] = "Completed"
            _jobs[job_id]["progress"] = 100.0
            _jobs[job_id]["video_path"] = video_path

    except Exception as exc:
        with _lock:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = str(exc)
            _jobs[job_id]["stage"] = "Failed"
        print(f"Generation {job_id} failed: {exc}", flush=True)


# ── Routes ───────────────────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    image_url: str
    prompt: str
    negative_prompt: str = ""
    resolution: str = "720p"
    aspect_ratio: str = "16:9"
    duration: int = 5


@app.post("/generate")
def generate(req: GenerateRequest):
    job_id = str(uuid.uuid4())
    with _lock:
        _jobs[job_id] = {
            "status": "queued",
            "progress": 0.0,
            "stage": "Queued",
            "error": None,
            "video_path": None,
            "created_at": time.time(),
        }
    t = threading.Thread(
        target=_run_generation,
        args=(job_id, req.image_url, req.prompt, req.negative_prompt,
              req.resolution, req.aspect_ratio, req.duration),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id}


@app.get("/status/{job_id}")
def status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "status": job["status"],
        "progress": job["progress"],
        "stage": job["stage"],
        "error": job.get("error"),
    }


@app.get("/result/{job_id}")
def result(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Job not completed (status: {job['status']})")
    video_path = job.get("video_path")
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=500, detail="Video file missing")
    return FileResponse(video_path, media_type="video/mp4", filename=f"{job_id}.mp4")


@app.get("/health")
def health():
    return {"status": "ok", "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
SERVEREOF

# ── 5. Start the server ───────────────────────────────────────────────────────
echo ""
echo "[5/5] Starting WanStudio API server on port 8080..."
echo ""
echo "======================================"
echo "  Setup complete!"
echo "  Server starting at http://0.0.0.0:8080"
echo "  Health check: curl http://localhost:8080/health"
echo "======================================"
echo ""

cd /workspace/wanstudio
nohup python3 server.py > /workspace/wanstudio/server.log 2>&1 &
SERVER_PID=$!
echo "Server running (PID $SERVER_PID)"
echo "Logs: tail -f /workspace/wanstudio/server.log"
echo ""

# Wait for server to come up
echo "Waiting for server to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    echo "Server is ready!"
    break
  fi
  sleep 2
done
