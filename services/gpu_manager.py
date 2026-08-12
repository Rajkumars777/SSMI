"""
GPU Memory Orchestrator for SSMI AI Pipeline
=============================================

RTX 4050 (6 GB VRAM) allocation strategy:
  - Whisper large-v3-turbo : ~3.0 GB VRAM
  - pyannote diarization   : ~1.5 GB VRAM  (if available)
  - Qwen2.5:14b via Ollama : ~4.0 GB VRAM  (Ollama manages this)

Pipeline order (sequential, never overlapping):
  1. Unload Ollama from VRAM    (frees ~4 GB)
  2. Load + run Whisper         (uses ~3 GB)
  3. Unload Whisper             (frees ~3 GB)
  4. Load + run pyannote        (uses ~1.5 GB) [optional]
  5. Unload pyannote            (frees ~1.5 GB)
  6. Ollama auto-reloads Qwen   (uses ~4 GB for summarization)
"""

import gc
import os
import time
import requests
import threading
from typing import Optional

try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

try:
    import ctranslate2
    HAS_CT2 = True
except ImportError:
    HAS_CT2 = False

_PIPELINE_LOCK = threading.Lock()  # Prevent concurrent pipeline runs
_cancelled_meetings: set[str] = set()


def request_pipeline_cancel(meeting_id: str) -> None:
    """Mark a meeting pipeline run for cancellation."""
    _cancelled_meetings.add(meeting_id)


def clear_pipeline_cancel(meeting_id: str) -> None:
    _cancelled_meetings.discard(meeting_id)


def is_pipeline_cancelled(meeting_id: str) -> bool:
    return meeting_id in _cancelled_meetings


class PipelineCancelled(Exception):
    """Raised when a pipeline run was cancelled by the user."""


def vram_free_mb() -> int:
    """Return free VRAM in MB. Returns -1 if unavailable."""
    if HAS_TORCH:
        try:
            if torch.cuda.is_available():
                props = torch.cuda.get_device_properties(0)
                used = torch.cuda.memory_allocated(0)
                return int((props.total_memory - used) / 1024 / 1024)
        except Exception:
            pass
    try:
        import subprocess
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            timeout=3,
        ).decode().strip()
        return int(out.split("\n")[0].strip())
    except Exception:
        return -1


def flush_cuda(label: str = "") -> None:
    """Release all unused GPU memory and force garbage collection."""
    if HAS_TORCH:
        try:
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        except Exception:
            pass
    gc.collect()
    free = vram_free_mb()
    tag = f" [{label}]" if label else ""
    print(f"[GPU]{tag} VRAM flushed. Free: {free} MB" if free >= 0 else f"[GPU]{tag} VRAM flushed.")


def unload_ollama_model(
    endpoint: str = "http://localhost:11434",
    model: str = "qwen2.5:14b",
    timeout: float = 8.0,
) -> bool:
    """
    Instruct Ollama to evict the model from GPU VRAM by setting keep_alive=0.
    Returns True if the unload request succeeded.
    """
    try:
        resp = requests.post(
            f"{endpoint}/api/generate",
            json={"model": model, "keep_alive": 0},
            timeout=timeout,
        )
        if resp.status_code == 200:
            print(f"[GPU] Ollama model '{model}' evicted from VRAM.")
            time.sleep(1.5)  # Give Ollama time to actually release VRAM
            flush_cuda("after-ollama-unload")
            return True
        else:
            print(f"[GPU] Ollama unload response: {resp.status_code}")
            return False
    except Exception as e:
        print(f"[GPU] Could not contact Ollama to unload model ({e}). Continuing.")
        return False


def reload_ollama_model(
    endpoint: str = "http://localhost:11434",
    model: str = "qwen2.5:14b",
    timeout: float = 15.0,
) -> bool:
    """
    Warm-pings Ollama so that the model is reloaded into VRAM before we call it.
    This prevents the first-token latency surprise during summarization.
    """
    try:
        resp = requests.post(
            f"{endpoint}/api/generate",
            json={"model": model, "prompt": "", "keep_alive": "5m"},
            timeout=timeout,
        )
        if resp.status_code == 200:
            print(f"[GPU] Ollama model '{model}' preloaded into VRAM.")
            return True
    except Exception as e:
        print(f"[GPU] Ollama warm-ping failed ({e}). It will load on first use.")
    return False
