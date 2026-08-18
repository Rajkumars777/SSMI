"""
STT Unit Tests — SSMI
=======================
Tests for the real Speech-to-Text pipeline behaviour.

Principles:
  - No fake or stub transcript data is ever returned — only real Whisper output.
  - Tests verify error-handling (silent audio, missing Whisper) and utility
    functions (duplicate merging, VRAM-aware model selection) without
    requiring a GPU or a real audio recording.
"""

import os
import tempfile
import wave

import pytest

from services.transcription.stt import (
    HAS_WHISPER,
    TranscriptionError,
    _build_model_fallback_chain,
    _is_memory_error,
    merge_duplicate_segments,
    pick_model_for_vram,
    transcribe_audio,
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _write_silent_wav(path: str, duration_s: float = 1.0, sample_rate: int = 16000):
    """Write a silent (all-zero) mono 16-bit WAV file for test input."""
    n_frames = int(duration_s * sample_rate)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n_frames)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not HAS_WHISPER, reason="faster-whisper not installed")
def test_transcription_rejects_silent_audio():
    """
    Whisper should raise TranscriptionError on audio with no speech content.

    Uses a 2-second silent WAV — VAD filtering should suppress all frames
    and produce zero segments, triggering the error.
    """
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        path = f.name
    try:
        _write_silent_wav(path, duration_s=2.0)
        with pytest.raises(TranscriptionError):
            transcribe_audio(path, model_name="base")
    finally:
        os.unlink(path)


def test_transcription_raises_when_whisper_missing():
    """
    If faster-whisper is not installed, transcribe_audio must raise
    TranscriptionError with a clear install instruction — never silently fail.
    """
    if HAS_WHISPER:
        pytest.skip("Whisper is installed — this test targets the missing-whisper path")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(b"\x00" * 500)  # Minimal content so the file-size check passes
        path = f.name
    try:
        with pytest.raises(TranscriptionError, match="faster-whisper is not installed"):
            transcribe_audio(path)
    finally:
        os.unlink(path)


def test_no_stub_transcript_function():
    """Verify the old fake demo stub function was fully removed from the module."""
    import services.transcription.stt as stt_mod
    assert not hasattr(stt_mod, "_stub_transcript")


def test_merge_duplicate_segments():
    """
    Verify that consecutive duplicate Whisper tail segments are merged into one.

    The first three rows have identical text (Whisper tail repetition artefact).
    After merging they should become a single segment with the max end_time.
    """
    raw = [
        {"text": "And where in the world are we going to find a celebrity?", "start_time": 172.91, "end_time": 178.37, "confidence": 0.9},
        {"text": "And where in the world are we going to find a celebrity?", "start_time": 178.37, "end_time": 178.45, "confidence": 0.8},
        {"text": "And where in the world are we going to find a celebrity?", "start_time": 178.45, "end_time": 178.57, "confidence": 0.8},
        {"text": "Next sentence here.",                                       "start_time": 180.0,  "end_time": 182.0,  "confidence": 0.85},
    ]
    merged = merge_duplicate_segments(raw)

    assert len(merged) == 2                             # 3 duplicates → 1
    assert merged[0]["end_time"] == 178.57              # Extended to last duplicate's end
    assert merged[1]["text"] == "Next sentence here."  # Unique segment preserved


def test_pick_model_for_vram():
    """
    Verify VRAM-aware model selection downgrades when memory is insufficient.

    - Plenty of VRAM (5000 MB) → keep the requested large model.
    - Low VRAM (2000 MB)       → downgrade large-v3-turbo to 'small'.
    - Very low VRAM (1500 MB)  → downgrade medium to 'base'.
    """
    assert pick_model_for_vram("large-v3-turbo", 5000) == "large-v3-turbo"
    assert pick_model_for_vram("large-v3-turbo", 2000) == "small"
    assert pick_model_for_vram("medium", 1500) == "base"


def test_build_model_fallback_chain():
    """
    Verify the fallback chain terminates correctly and doesn't loop.

    Starting from 'base', the only fallback is 'tiny' — chain should be ['base', 'tiny'].
    """
    chain = _build_model_fallback_chain("base")
    assert chain == ["base", "tiny"]


def test_is_memory_error():
    """
    Verify that OOM-related exception messages are correctly identified.

    mkl_malloc failures should be treated as memory errors; generic errors should not.
    """
    assert _is_memory_error(Exception("mkl_malloc: failed to allocate memory"))
    assert not _is_memory_error(Exception("file not found"))
