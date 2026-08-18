"""
Audio Preprocessing Utilities — SSMI
======================================
Prepares audio files for Whisper transcription by ensuring they are in a
format that faster-whisper can decode reliably.

Browser live recordings are often captured as WebM/Opus — these must be
converted to 16 kHz mono WAV using ffmpeg before Whisper can process them.

Public API:
  ffmpeg_available()          : Check if ffmpeg is on PATH or bundled.
  prepare_audio_for_whisper() : Return a path to a WAV-format audio file,
                                converting if necessary.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


# File extensions that require conversion to WAV before Whisper can read them
CONVERTIBLE_EXTENSIONS = {".webm", ".ogg", ".opus", ".m4a", ".aac", ".wma", ".mp4", ".mkv"}


def _resolve_ffmpeg() -> str | None:
    """
    Locate the ffmpeg binary.

    Checks the system PATH first, then falls back to the bundled ffmpeg
    provided by the imageio-ffmpeg package (installed via pip).
    Returns None if ffmpeg cannot be found anywhere.
    """
    # Prefer a system-installed ffmpeg (consistent version, well-tested)
    system = shutil.which("ffmpeg")
    if system:
        return system

    # Fall back to the pip-bundled ffmpeg from imageio-ffmpeg
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def ffmpeg_available() -> bool:
    """Return True if ffmpeg is available (on PATH or via imageio-ffmpeg)."""
    return _resolve_ffmpeg() is not None


def prepare_audio_for_whisper(source_path: str) -> tuple[str, bool]:
    """
    Ensure the audio file is in a format Whisper can decode reliably.

    - WAV files are returned as-is (no conversion needed).
    - Formats in CONVERTIBLE_EXTENSIONS are converted to 16 kHz mono WAV.
    - Other formats are returned as-is and Whisper will attempt to decode them.

    Args:
      source_path : Absolute path to the input audio file.

    Returns:
      (path_to_use, is_temp_file) where is_temp_file=True means the caller
      is responsible for deleting the returned path after use.

    Raises:
      RuntimeError : If conversion is needed but ffmpeg is not available,
                     or if ffmpeg produces an empty/invalid output file.
    """
    ext = Path(source_path).suffix.lower()

    # WAV is already in the right format — pass through unchanged
    if ext == ".wav":
        return source_path, False

    # Non-convertible formats — let Whisper try to read them directly
    if ext not in CONVERTIBLE_EXTENSIONS:
        return source_path, False

    # We need to convert — check ffmpeg is available
    ffmpeg = _resolve_ffmpeg()
    if not ffmpeg:
        raise RuntimeError(
            f"Audio format '{ext}' requires ffmpeg for conversion. "
            "Install ffmpeg or run: pip install imageio-ffmpeg"
        )

    # Create a temporary WAV file to write the converted audio into
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    out_path = tmp.name

    # ffmpeg conversion: resample to 16 kHz mono PCM (Whisper's expected format)
    cmd = [
        ffmpeg, "-y",             # Overwrite output without prompting
        "-i", source_path,        # Input file
        "-ar", "16000",           # Resample to 16 kHz
        "-ac", "1",               # Convert to mono
        "-c:a", "pcm_s16le",      # 16-bit signed PCM
        out_path,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10-minute timeout for very long recordings
        )

        if result.returncode != 0:
            # Include the last 500 chars of stderr for diagnostics
            err = (result.stderr or result.stdout or "unknown ffmpeg error")[-500:]
            raise RuntimeError(f"ffmpeg conversion failed: {err}")

        # Sanity-check: a valid WAV file must be larger than the 44-byte header
        if not os.path.exists(out_path) or os.path.getsize(out_path) < 44:
            raise RuntimeError("ffmpeg produced an empty or invalid WAV file.")

        print(f"[Audio] Converted {ext} → WAV ({os.path.getsize(out_path) // 1024} KB)")
        return out_path, True  # is_temp=True — caller must delete this file

    except Exception:
        # Clean up the partial output file before re-raising
        if os.path.exists(out_path):
            os.unlink(out_path)
        raise
