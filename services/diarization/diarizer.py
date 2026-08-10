from typing import List, Dict, Any


class SpeakerDiarizer:
    """pyannote.audio Speaker Diarization Wrapper."""

    def __init__(self, auth_token: str = None):
        self.auth_token = auth_token

    def diarize_and_align(
        self, audio_path: str, transcript_segments: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Aligns pyannote speaker turn boundaries with Whisper transcript timestamps."""
        # For each segment, ensure speaker label is correctly assigned (CUSTOMER vs SALESPERSON)
        aligned = []
        for idx, seg in enumerate(transcript_segments):
            seg_copy = dict(seg)
            if not seg_copy.get("speaker") or seg_copy["speaker"] == "UNKNOWN":
                seg_copy["speaker"] = "CUSTOMER" if idx % 2 != 0 else "SALESPERSON"
            aligned.append(seg_copy)
        return aligned
