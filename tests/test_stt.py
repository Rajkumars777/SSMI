"""Tests for real STT behavior — no fake stub data."""

import os
import tempfile
import wave
import pytest
from services.transcription.stt import transcribe_audio, TranscriptionError, HAS_WHISPER


def _write_silent_wav(path: str, duration_s: float = 1.0, sample_rate: int = 16000):
    n_frames = int(duration_s * sample_rate)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * n_frames)


@pytest.mark.skipif(not HAS_WHISPER, reason="faster-whisper not installed")
def test_transcription_rejects_silent_audio():
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        path = f.name
    try:
        _write_silent_wav(path, duration_s=2.0)
        with pytest.raises(TranscriptionError):
            transcribe_audio(path, model_name="base")
    finally:
        os.unlink(path)


def test_transcription_raises_when_whisper_missing():
    if HAS_WHISPER:
        pytest.skip("Whisper is installed")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(b"\x00" * 500)
        path = f.name
    try:
        with pytest.raises(TranscriptionError, match="faster-whisper is not installed"):
            transcribe_audio(path)
    finally:
        os.unlink(path)


def test_no_stub_transcript_function():
    """Ensure the old fake demo stub was removed."""
    import services.transcription.stt as stt_mod
    assert not hasattr(stt_mod, "_stub_transcript")


def test_merge_duplicate_segments():
    from services.transcription.stt import merge_duplicate_segments

    raw = [
        {"text": "And where in the world are we going to find a celebrity?", "start_time": 172.91, "end_time": 178.37, "confidence": 0.9},
        {"text": "And where in the world are we going to find a celebrity?", "start_time": 178.37, "end_time": 178.45, "confidence": 0.8},
        {"text": "And where in the world are we going to find a celebrity?", "start_time": 178.45, "end_time": 178.57, "confidence": 0.8},
        {"text": "Next sentence here.", "start_time": 180.0, "end_time": 182.0, "confidence": 0.85},
    ]
    merged = merge_duplicate_segments(raw)
    assert len(merged) == 2
    assert merged[0]["end_time"] == 178.57
    assert merged[1]["text"] == "Next sentence here."
