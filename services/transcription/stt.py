"""
Speech-to-Text pipeline using faster-whisper + ctranslate2.

NEVER returns fabricated demo data. If transcription cannot run, raises TranscriptionError.
"""

import os
import gc
from typing import List, Dict, Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

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

try:
    import ctranslate2
    from faster_whisper import WhisperModel
    HAS_WHISPER = True
except ImportError:
    HAS_WHISPER = False

from .audio_utils import prepare_audio_for_whisper


class TranscriptionError(Exception):
    """Raised when real audio transcription cannot be completed."""


def _detect_device() -> tuple[str, str]:
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
    """Pick a model that can actually run on the current hardware."""
    device, _ = _detect_device()
    if device == "cuda":
        return requested

    # large-v3 / turbo models are impractical on CPU — use lighter models
    cpu_default = os.getenv("WHISPER_CPU_MODEL", "base")
    heavy = {"large-v3", "large-v3-turbo", "large-v2", "large", "medium"}
    if requested in heavy:
        print(f"[STT] Model '{requested}' is too heavy for CPU — using '{cpu_default}' instead.")
        return cpu_default
    return requested or cpu_default


def merge_duplicate_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Collapse Whisper tail repetition — the model often emits many tiny windows
    with identical text at the end of a clip (same sentence, ~0.05s each).
    """
    if not segments:
        return []

    merged: List[Dict[str, Any]] = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue

        entry = dict(seg)
        entry["text"] = text

        if merged:
            prev = merged[-1]
            prev_text = prev["text"].strip()
            if text.lower() == prev_text.lower():
                prev["end_time"] = max(float(prev["end_time"]), float(entry["end_time"]))
                prev["confidence"] = max(float(prev.get("confidence", 0)), float(entry.get("confidence", 0)))
                continue

        merged.append(entry)

    return merged


def transcribe_audio(
    audio_path: str,
    model_name: str = "base",
    language: str = "en",
) -> List[Dict[str, Any]]:
    """
    Transcribe audio file with Whisper. Returns real transcript segments only.
    Raises TranscriptionError on any failure — never returns fake demo data.
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

    prepared_path, is_temp = None, False
    model = None
    try:
        prepared_path, is_temp = prepare_audio_for_whisper(audio_path)
        model_name = resolve_model_name(model_name)

        last_error: Exception | None = None
        for device, compute_type in (_detect_device(), ("cpu", "int8")):
            try:
                print(f"[STT] Loading '{model_name}' on {device.upper()} ({compute_type})...")
                model = WhisperModel(
                    model_name,
                    device=device,
                    compute_type=compute_type,
                    num_workers=1,
                )
                print(f"[STT] Transcribing: {os.path.basename(audio_path)} ({file_size // 1024} KB)")

                segments_iter, info = model.transcribe(
                    prepared_path,
                    language=language if language else None,
                    vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 300},
                    word_timestamps=True,
                    beam_size=5 if device == "cuda" else 3,
                    best_of=3 if device == "cuda" else 1,
                    temperature=0.0,
                    condition_on_previous_text=True,
                    compression_ratio_threshold=2.4,
                    no_speech_threshold=0.6,
                )

                results = []
                for seg in segments_iter:
                    text = seg.text.strip()
                    if not text:
                        continue
                    confidence = max(0.0, min(1.0, round(seg.avg_logprob + 1.0, 3)))
                    results.append({
                        "speaker": "UNKNOWN",
                        "start_time": round(seg.start, 3),
                        "end_time": round(seg.end, 3),
                        "text": text,
                        "confidence": confidence,
                        "words": [
                            {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}
                            for w in (seg.words or [])
                        ],
                    })

                detected_lang = getattr(info, "language", "?")
                lang_prob = getattr(info, "language_probability", 0.0)
                duration_s = getattr(info, "duration", 0.0)

                print(
                    f"[STT] Done: {len(results)} segments, {duration_s:.1f}s audio, "
                    f"lang={detected_lang} ({lang_prob:.0%})"
                )

                if not results:
                    raise TranscriptionError(
                        "No speech detected in the audio. "
                        "Ensure the microphone was active and the recording contains audible speech."
                    )

                deduped = merge_duplicate_segments(results)
                if len(deduped) < len(results):
                    print(f"[STT] Merged {len(results) - len(deduped)} duplicate tail segment(s).")

                return deduped
            except TranscriptionError:
                raise
            except Exception as e:
                last_error = e
                if model is not None:
                    del model
                    model = None
                    gc.collect()
                err_msg = str(e).lower()
                if device == "cuda":
                    print(f"[STT] CUDA failed ({e}) — retrying on CPU...")
                    model_name = resolve_model_name("base")
                    continue
                raise TranscriptionError(f"Whisper transcription failed: {e}") from e
        raise TranscriptionError(f"Whisper transcription failed: {last_error}")
    finally:
        if model is not None:
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
        if is_temp and prepared_path and os.path.exists(prepared_path):
            try:
                os.unlink(prepared_path)
            except OSError:
                pass


class SpeechToTextPipeline:
    def __init__(self, model_name: str = "base"):
        self.model_name = model_name

    def transcribe(self, audio_path: str) -> List[Dict[str, Any]]:
        return transcribe_audio(audio_path, model_name=self.model_name)
