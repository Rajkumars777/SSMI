"""Audio preprocessing utilities for the STT pipeline."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


CONVERTIBLE_EXTENSIONS = {".webm", ".ogg", ".opus", ".m4a", ".aac", ".wma", ".mp4", ".mkv"}


def _resolve_ffmpeg() -> str | None:
    """Find ffmpeg binary — system PATH first, then bundled imageio-ffmpeg."""
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def ffmpeg_available() -> bool:
    return _resolve_ffmpeg() is not None


def prepare_audio_for_whisper(source_path: str) -> tuple[str, bool]:
    """
    Ensure audio is in a format Whisper can decode reliably.

    Returns (path_to_use, is_temp_file).
    Browser live recordings are often WebM/Opus — convert to 16 kHz mono WAV when needed.
    """
    ext = Path(source_path).suffix.lower()

    if ext == ".wav":
        return source_path, False

    if ext not in CONVERTIBLE_EXTENSIONS:
        return source_path, False

    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        raise RuntimeError(
            f"Audio format '{ext}' requires ffmpeg for conversion. "
            "Install ffmpeg or run: pip install imageio-ffmpeg"
        )

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    out_path = tmp.name

    cmd = [
        ffmpeg, "-y", "-i", source_path,
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
        out_path,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "unknown ffmpeg error")[-500:]
            raise RuntimeError(f"ffmpeg conversion failed: {err}")
        if not os.path.exists(out_path) or os.path.getsize(out_path) < 44:
            raise RuntimeError("ffmpeg produced an empty or invalid WAV file.")
        print(f"[Audio] Converted {ext} -> WAV ({os.path.getsize(out_path) // 1024} KB)")
        return out_path, True
    except Exception:
        if os.path.exists(out_path):
            os.unlink(out_path)
        raise
