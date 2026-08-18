"""
Speech-to-Text Pipeline — SSMI
================================
Transcribes audio files using faster-whisper + ctranslate2.

Design principles:
  - NEVER returns fabricated or demo data. Any failure raises TranscriptionError.
  - Automatically falls back to a smaller Whisper model when OOM occurs.
  - Automatically falls back from CUDA to CPU when CUDA is unavailable or fails.
  - Deduplicates Whisper's tail repetition artifacts after transcription.

Environment variables:
  WHISPER_MODEL_NAME   : Primary accurate-mode model (default: large-v3-turbo)
  WHISPER_FAST_MODEL   : Fast-mode model (default: small)
  WHISPER_CPU_MODEL    : CPU fallback model when GPU unavailable (default: base)
  WHISPER_CPU_THREADS  : Thread count for CPU inference (default: 1)
  USE_CUDA             : Force CUDA detection even when ctranslate2 reports 0 devices
"""

import gc
import os
from typing import Any, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Cap BLAS/MKL thread pools to prevent RAM spikes on CPU inference.
# Must be set before any numpy/torch import.
# ---------------------------------------------------------------------------
os.environ.setdefault("OMP_NUM_THREADS",     os.getenv("WHISPER_CPU_THREADS", "1"))
os.environ.setdefault("MKL_NUM_THREADS",     os.getenv("WHISPER_CPU_THREADS", "1"))
os.environ.setdefault("OPENBLAS_NUM_THREADS", os.getenv("WHISPER_CPU_THREADS", "1"))

# Load .env so WHISPER_* and USE_CUDA variables are available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Windows: add NVIDIA DLL directories to PATH so ctranslate2 can find cuBLAS
# ---------------------------------------------------------------------------
if os.name == "nt":
    import site
    for site_pkg in site.getsitepackages():
        nvidia_dir = os.path.join(site_pkg, "nvidia")
        if os.path.exists(nvidia_dir):
            for root, dirs, _ in os.walk(nvidia_dir):
                if "bin" in dirs:
                    bin_dir = os.path.join(root, "bin")
                    try:
                        os.add_dll_directory(bin_dir)
                        os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
                    except Exception:
                        pass

# ---------------------------------------------------------------------------
# Optional faster-whisper import
# ---------------------------------------------------------------------------
try:
    import ctranslate2
    from faster_whisper import WhisperModel
    HAS_WHISPER = True
except ImportError:
    HAS_WHISPER = False

from .audio_utils import prepare_audio_for_whisper


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class TranscriptionError(Exception):
    """Raised when real audio transcription cannot be completed."""


# ---------------------------------------------------------------------------
# Model fallback chain
# ---------------------------------------------------------------------------

# When a model fails with an OOM error, automatically try the next smaller model
_MODEL_FALLBACK: Dict[str, str] = {
    "large-v3-turbo": "small",
    "large-v3":       "small",
    "large-v2":       "small",
    "large":          "small",
    "medium":         "base",
    "small":          "base",
    "base":           "tiny",
}


def _is_memory_error(exc: Exception) -> bool:
    """Return True if the exception looks like a GPU or CPU OOM error."""
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "out of memory",
            "mkl_malloc",
            "failed to allocate",
            "cuda error",
            "cublas",
            "not enough memory",
        )
    )


def pick_model_for_vram(requested: str, free_vram_mb: int) -> str:
    """
    Downgrade the Whisper model if free VRAM is too low to load it.

    Thresholds (conservative, leaving headroom for ctranslate2 buffers):
      - Large models (large-v3-turbo, large-v3, large-v2, large): need ≥ 3500 MB
      - Medium: needs ≥ 2000 MB
    """
    heavy = {"large-v3-turbo", "large-v3", "large-v2", "large"}
    if requested in heavy and 0 <= free_vram_mb < 3500:
        print(f"[STT] VRAM low ({free_vram_mb} MB) — using 'small' instead of '{requested}'.")
        return "small"
    if requested == "medium" and 0 <= free_vram_mb < 2000:
        print(f"[STT] VRAM low ({free_vram_mb} MB) — using 'base' instead of 'medium'.")
        return "base"
    return requested


def _build_model_fallback_chain(requested: str) -> List[str]:
    """
    Build the ordered list of models to try, starting with the requested one.

    Example: requested='large-v3-turbo' → ['large-v3-turbo', 'small', 'base', 'tiny']
    """
    chain: List[str] = []
    current = resolve_model_name(requested)
    seen: set[str] = set()

    while current and current not in seen:
        seen.add(current)
        chain.append(current)
        current = _MODEL_FALLBACK.get(current)

    return chain or ["base"]


# ---------------------------------------------------------------------------
# Device detection
# ---------------------------------------------------------------------------

def _detect_device() -> Tuple[str, str]:
    """
    Determine the best inference device and compute type.

    Returns:
      ("cuda", "float16") if a CUDA GPU is available.
      ("cpu",  "int8")    otherwise.
    """
    use_cuda_env = os.getenv("USE_CUDA", "false").lower() == "true"
    if HAS_WHISPER:
        try:
            cuda_n = ctranslate2.get_cuda_device_count()
        except Exception:
            cuda_n = 0
        if cuda_n > 0:
            return "cuda", "float16"
        if use_cuda_env:
            print("[STT] USE_CUDA=true but no CUDA device found — using CPU.")
    return "cpu", "int8"


def resolve_model_name(requested: str) -> str:
    """
    Resolve the model name to one that can actually run on the current hardware.

    Large models are replaced with a lighter CPU-safe alternative when no GPU
    is available — large-v3-turbo on CPU would take hours and likely OOM.
    """
    device, _ = _detect_device()
    if device == "cuda":
        return requested  # GPU can handle any model

    # On CPU, large/medium/small models are impractical — use a tiny default
    cpu_default = os.getenv("WHISPER_CPU_MODEL", "base")
    heavy = {"large-v3", "large-v3-turbo", "large-v2", "large", "medium", "small"}
    if requested in heavy:
        print(f"[STT] Model '{requested}' is too heavy for CPU — using '{cpu_default}' instead.")
        return cpu_default
    return requested or cpu_default


# ---------------------------------------------------------------------------
# Duplicate segment merging
# ---------------------------------------------------------------------------

def merge_duplicate_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Collapse Whisper's tail repetition artefacts.

    Whisper sometimes emits dozens of tiny windows (0.05 s each) with
    identical text at the end of a clip. This merges consecutive identical
    segments into one, extending its end_time and keeping the higher confidence.
    """
    if not segments:
        return []

    merged: List[Dict[str, Any]] = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue  # Skip empty segments

        entry = dict(seg)
        entry["text"] = text

        if merged:
            prev      = merged[-1]
            prev_text = prev["text"].strip()
            if text.lower() == prev_text.lower():
                # Duplicate — extend the previous segment's end time and keep best confidence
                prev["end_time"]   = max(float(prev["end_time"]),   float(entry["end_time"]))
                prev["confidence"] = max(float(prev.get("confidence", 0)), float(entry.get("confidence", 0)))
                continue

        merged.append(entry)

    return merged


# ---------------------------------------------------------------------------
# Core Whisper inference
# ---------------------------------------------------------------------------

def _run_whisper_pass(
    model_name:    str,
    prepared_path: str,
    file_size:     int,
    audio_basename: str,
    device:        str,
    compute_type:  str,
    language:      str,
) -> List[Dict[str, Any]]:
    """
    Load Whisper, run a single transcription pass, then unload the model from VRAM.

    VAD filtering is enabled to skip silent portions and reduce hallucinations.
    Word timestamps are requested on CUDA for higher alignment accuracy.
    Raises TranscriptionError if no speech is detected.
    Raises any other exception on failure (caller handles fallback logic).
    """
    cpu_threads  = max(1, int(os.getenv("WHISPER_CPU_THREADS", "1")))
    use_word_ts  = (device == "cuda")  # Word timestamps only available reliably on GPU

    print(f"[STT] Loading '{model_name}' on {device.upper()} ({compute_type})...")
    model = WhisperModel(
        model_name,
        device       = device,
        compute_type = compute_type,
        cpu_threads  = cpu_threads,
        num_workers  = 1,
    )

    try:
        print(f"[STT] Transcribing: {audio_basename} ({file_size // 1024} KB)")

        segments_iter, info = model.transcribe(
            prepared_path,
            language                  = language if language else None,
            vad_filter                = True,                  # Skip silent segments
            vad_parameters            = {"min_silence_duration_ms": 300},
            word_timestamps           = use_word_ts,
            beam_size                 = 5 if device == "cuda" else 1,
            best_of                   = 3 if device == "cuda" else 1,
            temperature               = 0.0,                   # Greedy decoding — most deterministic
            condition_on_previous_text = (device == "cuda"),   # Better context on GPU
            compression_ratio_threshold = 2.4,
            no_speech_threshold       = 0.6,
            chunk_length              = 30,
        )

        # Materialise the lazy segment iterator into a list
        results = []
        for seg in segments_iter:
            text = seg.text.strip()
            if not text:
                continue
            # Convert avg_logprob (-∞..0) to a 0..1 confidence score
            confidence = max(0.0, min(1.0, round(seg.avg_logprob + 1.0, 3)))
            results.append({
                "speaker":    "UNKNOWN",  # Diarizer assigns speakers later
                "start_time": round(seg.start, 3),
                "end_time":   round(seg.end, 3),
                "text":       text,
                "confidence": confidence,
                "words": [
                    {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}
                    for w in (seg.words or [])
                ] if use_word_ts else [],
            })

        # Log detection metadata
        detected_lang = getattr(info, "language", "?")
        lang_prob     = getattr(info, "language_probability", 0.0)
        duration_s    = getattr(info, "duration", 0.0)
        print(
            f"[STT] Done: {len(results)} segments, {duration_s:.1f}s audio, "
            f"lang={detected_lang} ({lang_prob:.0%})"
        )

        if not results:
            raise TranscriptionError(
                "No speech detected in the audio. "
                "Ensure the microphone was active and the recording contains audible speech."
            )

        # Remove duplicate tail segments emitted by Whisper
        deduped = merge_duplicate_segments(results)
        if len(deduped) < len(results):
            print(f"[STT] Merged {len(results) - len(deduped)} duplicate tail segment(s).")

        return deduped

    finally:
        # Always unload the model to free VRAM — even if transcription failed
        del model
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
        except Exception:
            pass
        print("[STT] Model unloaded from VRAM.")


# ---------------------------------------------------------------------------
# Public transcription entry point
# ---------------------------------------------------------------------------

def transcribe_audio(
    audio_path: str,
    model_name: str = "base",
    language:   str = "en",
) -> List[Dict[str, Any]]:
    """
    Transcribe an audio file with Whisper and return real transcript segments.

    Never returns fabricated data — raises TranscriptionError on any failure.

    Fallback strategy:
      1. Try the requested model on the primary device (CUDA or CPU).
      2. If CUDA fails, retry on CPU with the same model.
      3. If an OOM occurs, step down to the next smaller model and retry.
      4. If all fallbacks are exhausted, raise TranscriptionError.

    Args:
      audio_path : Absolute path to the audio file.
      model_name : Whisper model variant to use (e.g. 'large-v3-turbo', 'base').
      language   : BCP-47 language code (e.g. 'en', 'hi').

    Returns:
      List of segment dicts: {speaker, start_time, end_time, text, confidence, words}.

    Raises:
      TranscriptionError : On any failure (file not found, no speech, OOM, etc.).
    """
    if not os.path.exists(audio_path):
        raise TranscriptionError(f"Audio file not found: {audio_path}")

    file_size = os.path.getsize(audio_path)
    if file_size < 256:
        raise TranscriptionError(
            f"Audio file is too small ({file_size} bytes). "
            "The recording may be empty or corrupted."
        )

    if not HAS_WHISPER:
        raise TranscriptionError(
            "faster-whisper is not installed. Run: pip install faster-whisper"
        )

    prepared_path: str | None = None
    is_temp = False
    try:
        # Convert non-WAV formats (webm, ogg, m4a…) to 16 kHz mono WAV via ffmpeg
        prepared_path, is_temp = prepare_audio_for_whisper(audio_path)

        primary_device, primary_compute = _detect_device()

        # Always try CUDA first; add CPU as a fallback if on a CUDA machine
        device_attempts: List[Tuple[str, str]] = [(primary_device, primary_compute)]
        if primary_device == "cuda":
            device_attempts.append(("cpu", "int8"))

        last_error: Exception | None = None
        for try_model in _build_model_fallback_chain(model_name):
            for device, compute_type in device_attempts:
                try:
                    return _run_whisper_pass(
                        try_model,
                        prepared_path,
                        file_size,
                        os.path.basename(audio_path),
                        device,
                        compute_type,
                        language,
                    )
                except TranscriptionError:
                    raise  # Don't suppress — these are user-visible errors

                except Exception as e:
                    last_error = e
                    if device == "cuda":
                        print(f"[STT] CUDA failed ({e}) — retrying on CPU...")
                        continue
                    if _is_memory_error(e):
                        print(f"[STT] Memory error with '{try_model}' — trying smaller model...")
                        break  # Move to next model in the fallback chain
                    raise TranscriptionError(f"Whisper transcription failed: {e}") from e

        raise TranscriptionError(f"Whisper transcription failed: {last_error}")

    finally:
        # Clean up the temporary WAV file created by prepare_audio_for_whisper
        if is_temp and prepared_path and os.path.exists(prepared_path):
            try:
                os.unlink(prepared_path)
            except OSError:
                pass
