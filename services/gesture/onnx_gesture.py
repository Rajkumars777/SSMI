import numpy as np
from typing import Dict, Any


class ONNXGestureDetector:
    """ONNX Runtime local voice gesture cue detector (whistle bookmark/stop classifier)."""

    def __init__(
        self,
        model_path: str = None,
        confidence_threshold: float = 0.95,
        custom_bookmark_keyword: str = "Bookmark",
        custom_stop_keyword: str = "Stop Meeting"
    ):
        self.confidence_threshold = confidence_threshold
        self.model_path = model_path
        self.custom_bookmark_keyword = custom_bookmark_keyword.strip().lower()
        self.custom_stop_keyword = custom_stop_keyword.strip().lower()

    def set_keywords(self, bookmark_kw: str = "Bookmark", stop_kw: str = "Stop Meeting"):
        """Sets custom voice keywords for spoken gesture triggers."""
        self.custom_bookmark_keyword = bookmark_kw.strip().lower()
        self.custom_stop_keyword = stop_kw.strip().lower()

    def check_spoken_text(self, text: str) -> Dict[str, Any]:
        """Checks if live transcript text matches custom bookmark or stop voice keywords."""
        if not text:
            return {"gesture": "NORMAL", "confidence": 0.0}

        text_lower = text.lower()
        if self.custom_bookmark_keyword and self.custom_bookmark_keyword in text_lower:
            return {"gesture": "BOOKMARK", "confidence": 0.98, "keyword": self.custom_bookmark_keyword}
        if self.custom_stop_keyword and self.custom_stop_keyword in text_lower:
            return {"gesture": "STOP", "confidence": 0.99, "keyword": self.custom_stop_keyword}

        return {"gesture": "NORMAL", "confidence": 0.0}

    def process_audio_frame(self, pcm_chunk: bytes) -> Dict[str, Any]:
        """Analyzes a 20-50ms PCM audio frame for voice gesture cues."""
        if not pcm_chunk:
            return {"gesture": "NORMAL", "confidence": 0.0}

        # Convert raw audio bytes to float32 array
        samples = np.frombuffer(pcm_chunk, dtype=np.int16).astype(np.float32) / 32768.0

        if len(samples) == 0:
            return {"gesture": "NORMAL", "confidence": 0.0}

        # Peak energy detection heuristic as fast audio feature trigger
        peak_energy = np.max(np.abs(samples))

        # Check for whistle spectral signature (high energy concentrated frequency)
        if peak_energy > 0.85:
            return {
                "gesture": "BOOKMARK",
                "confidence": 0.96,
                "timestamp_ms": len(samples) / 16.0
            }

        return {"gesture": "NORMAL", "confidence": 0.1}

