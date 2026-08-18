"""
ONNX Voice Gesture Detector — SSMI
=====================================
Detects voice gesture cues (bookmark / stop) from live audio frames and
spoken transcript text during real-time meeting recording.

Two detection modes:
  1. Audio frame analysis : Checks raw PCM for high-energy signals (whistle-like cues).
  2. Spoken text matching : Checks live transcript text for custom keywords
                            (e.g. saying "Bookmark" or "Stop Meeting").

Note: The ONNX model path is accepted as a parameter for future use when a
trained whistle-detection model is available. Currently, audio gesture detection
uses a simple peak-energy heuristic as a fast placeholder.
"""

import numpy as np
from typing import Any, Dict


class ONNXGestureDetector:
    """
    Detects voice gesture cues during live meeting recording.

    Supports two trigger mechanisms:
      - Audio energy heuristic : Detects sudden high-energy sounds (whistles, claps).
      - Keyword matching       : Detects spoken custom keywords in the live transcript.

    Gestures:
      BOOKMARK : User wants to flag this moment for easy review later.
      STOP     : User wants to end the recording.
      NORMAL   : No gesture detected.
    """

    def __init__(
        self,
        model_path: str              = None,
        confidence_threshold: float  = 0.95,
        custom_bookmark_keyword: str = "Bookmark",
        custom_stop_keyword: str     = "Stop Meeting",
    ):
        """
        Args:
          model_path              : Path to ONNX model file (reserved for future use).
          confidence_threshold    : Minimum confidence to emit a gesture event (0..1).
          custom_bookmark_keyword : Voice keyword that triggers a BOOKMARK gesture.
          custom_stop_keyword     : Voice keyword that triggers a STOP gesture.
        """
        self.confidence_threshold     = confidence_threshold
        self.model_path               = model_path
        self.custom_bookmark_keyword  = custom_bookmark_keyword.strip().lower()
        self.custom_stop_keyword      = custom_stop_keyword.strip().lower()

    def set_keywords(self, bookmark_kw: str = "Bookmark", stop_kw: str = "Stop Meeting"):
        """Update the voice keywords used for spoken gesture detection at runtime."""
        self.custom_bookmark_keyword = bookmark_kw.strip().lower()
        self.custom_stop_keyword     = stop_kw.strip().lower()

    def check_spoken_text(self, text: str) -> Dict[str, Any]:
        """
        Check if a live transcript segment contains a spoken gesture keyword.

        Performs case-insensitive substring matching — the keyword just needs
        to appear anywhere in the transcript text.

        Args:
          text : The partial or final transcript text from the browser's Web Speech API.

        Returns:
          Dict with keys {gesture, confidence} and optional {keyword}.
          gesture is one of: "BOOKMARK", "STOP", "NORMAL".
        """
        if not text:
            return {"gesture": "NORMAL", "confidence": 0.0}

        text_lower = text.lower()

        # Check for bookmark keyword first (more common action)
        if self.custom_bookmark_keyword and self.custom_bookmark_keyword in text_lower:
            return {
                "gesture":    "BOOKMARK",
                "confidence": 0.98,
                "keyword":    self.custom_bookmark_keyword,
            }

        # Check for stop keyword
        if self.custom_stop_keyword and self.custom_stop_keyword in text_lower:
            return {
                "gesture":    "STOP",
                "confidence": 0.99,
                "keyword":    self.custom_stop_keyword,
            }

        return {"gesture": "NORMAL", "confidence": 0.0}

    def process_audio_frame(self, pcm_chunk: bytes) -> Dict[str, Any]:
        """
        Analyse a raw PCM audio frame for high-energy gesture cues.

        Expected format: 16-bit signed PCM (int16), mono, 16 kHz.
        Frame length: typically 20–50 ms (320–800 samples at 16 kHz).

        Detection heuristic:
          - Compute the peak absolute amplitude of the frame.
          - A peak > 0.85 (85% of max int16 range) is treated as a BOOKMARK
            gesture (consistent with a short sharp whistle or clap).

        Args:
          pcm_chunk : Raw audio bytes from the WebSocket binary message.

        Returns:
          Dict with keys {gesture, confidence} and optional {timestamp_ms}.
        """
        if not pcm_chunk:
            return {"gesture": "NORMAL", "confidence": 0.0}

        # Convert raw bytes to normalised float32 samples in range [-1.0, 1.0]
        samples = np.frombuffer(pcm_chunk, dtype=np.int16).astype(np.float32) / 32768.0

        if len(samples) == 0:
            return {"gesture": "NORMAL", "confidence": 0.0}

        # Peak energy — high value indicates a sudden loud sound (whistle, clap)
        peak_energy = np.max(np.abs(samples))

        if peak_energy > 0.85:
            # Approximate timestamp based on frame length at 16 kHz
            return {
                "gesture":      "BOOKMARK",
                "confidence":   0.96,
                "timestamp_ms": len(samples) / 16.0,  # ms = samples / sample_rate * 1000
            }

        return {"gesture": "NORMAL", "confidence": 0.1}
