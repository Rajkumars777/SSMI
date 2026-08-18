"""
GPU Memory Orchestrator — SSMI
================================
Manages VRAM allocation across the three AI models used in the pipeline so
that they never overlap and cause out-of-memory errors on the RTX 4050 (6 GB).

VRAM allocation per model:
  - Whisper large-v3-turbo : ~3.0 GB
  - pyannote diarization   : ~1.5 GB  (optional — gated HuggingFace model)
  - Qwen2.5:14b via Ollama : ~4.0 GB  (Ollama manages its own VRAM)

Sequential pipeline order (models never loaded at the same time):
  1. Unload Ollama/Qwen  → frees ~4 GB for Whisper
  2. Load + run Whisper  → uses ~3 GB, then explicitly unloaded
  3. Load + run pyannote → uses ~1.5 GB, then unloaded   [if available]
  4. Ollama reloads Qwen → uses ~4 GB for summarization

Public API:
  _PIPELINE_LOCK        : threading.Lock — prevents concurrent pipeline runs.
  request_pipeline_cancel(id) : Signal a running pipeline to stop.
  clear_pipeline_cancel(id)   : Clear the cancellation flag after handling.
  is_pipeline_cancelled(id)   : Check if cancellation was requested.
  PipelineCancelled     : Exception raised at pipeline checkpoints on cancel.
  vram_free_mb()        : Return free VRAM in MB (-1 if unavailable).
  flush_cuda(label)     : Release unused GPU memory and force GC.
  unload_ollama_model() : Evict the Qwen model from Ollama's VRAM.
  reload_ollama_model() : Warm-ping Ollama to pre-load the model before use.
"""

import gc
import os
import time
import threading

import requests

# ---------------------------------------------------------------------------
# Optional GPU libraries — gracefully degrade when not installed
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Pipeline lock & cancellation state
# ---------------------------------------------------------------------------

# Global lock ensures only one AI pipeline runs at a time (prevents VRAM OOM)
_PIPELINE_LOCK = threading.Lock()

# Set of meeting IDs whose pipelines have been requested to stop
_cancelled_meetings: set[str] = set()


def request_pipeline_cancel(meeting_id: str) -> None:
    """Signal that the pipeline for `meeting_id` should stop at the next checkpoint."""
    _cancelled_meetings.add(meeting_id)


def clear_pipeline_cancel(meeting_id: str) -> None:
    """Remove the cancellation flag once the pipeline has stopped or finished."""
    _cancelled_meetings.discard(meeting_id)


def is_pipeline_cancelled(meeting_id: str) -> bool:
    """Return True if cancellation has been requested for this meeting's pipeline."""
    return meeting_id in _cancelled_meetings


class PipelineCancelled(Exception):
    """Raised inside the pipeline when the user requests cancellation."""


# ---------------------------------------------------------------------------
# VRAM utilities
# ---------------------------------------------------------------------------

def vram_free_mb() -> int:
    """
    Return free GPU VRAM in megabytes.

    Tries PyTorch first (most accurate), then falls back to nvidia-smi.
    Returns -1 if no GPU is detectable.
    """
    if HAS_TORCH:
        try:
            if torch.cuda.is_available():
                props = torch.cuda.get_device_properties(0)
                used  = torch.cuda.memory_allocated(0)
                return int((props.total_memory - used) / 1024 / 1024)
        except Exception:
            pass

    # Fallback: query nvidia-smi directly
    try:
        import subprocess
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            timeout=3,
        ).decode().strip()
        return int(out.split("\n")[0].strip())
    except Exception:
        return -1  # GPU not available or nvidia-smi not on PATH


def flush_cuda(label: str = "") -> None:
    """
    Release all unused GPU memory caches and force Python garbage collection.

    Call this after unloading a model to reclaim VRAM before loading the next one.
    """
    if HAS_TORCH:
        try:
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        except Exception:
            pass

    gc.collect()

    free = vram_free_mb()
    tag  = f" [{label}]" if label else ""
    if free >= 0:
        print(f"[GPU]{tag} VRAM flushed. Free: {free} MB")
    else:
        print(f"[GPU]{tag} VRAM flushed.")


# ---------------------------------------------------------------------------
# Ollama model lifecycle
# ---------------------------------------------------------------------------

def unload_ollama_model(
    endpoint: str  = "http://localhost:11434",
    model: str     = "qwen2.5:14b",
    timeout: float = 8.0,
) -> bool:
    """
    Instruct Ollama to evict the model from GPU VRAM by setting keep_alive=0.

    This must be called before loading Whisper so both models don't compete
    for the available 6 GB. Returns True if the unload request succeeded.
    """
    try:
        resp = requests.post(
            f"{endpoint}/api/generate",
            json={"model": model, "keep_alive": 0},
            timeout=timeout,
        )
        if resp.status_code == 200:
            print(f"[GPU] Ollama model '{model}' evicted from VRAM.")
            time.sleep(1.5)  # Give Ollama time to fully release the memory
            flush_cuda("after-ollama-unload")
            return True
        else:
            print(f"[GPU] Ollama unload response: {resp.status_code}")
            return False
    except Exception as e:
        # Not fatal — Whisper will simply compete for VRAM
        print(f"[GPU] Could not contact Ollama to unload model ({e}). Continuing.")
        return False


def reload_ollama_model(
    endpoint: str  = "http://localhost:11434",
    model: str     = "qwen2.5:14b",
    timeout: float = 15.0,
) -> bool:
    """
    Warm-ping Ollama to pre-load the model into VRAM before the summarization call.

    Without this, the first token generation would stall while Ollama loads
    the model (~4 GB) from disk, causing an unexpected latency spike.
    Returns True if the model was successfully preloaded.
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
        # Not fatal — the model will load on the first actual summarization call
        print(f"[GPU] Ollama warm-ping failed ({e}). It will load on first use.")
    return False
