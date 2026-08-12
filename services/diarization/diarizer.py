import os
from typing import List, Dict, Any

try:
    import torch
    HAS_TORCH = True
except ImportError:
    torch = None  # type: ignore
    HAS_TORCH = False

# Load .env so HUGGINGFACE_TOKEN and USE_CUDA are available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

hf_token = os.getenv("HUGGINGFACE_TOKEN", "")
if hf_token:
    os.environ["HF_TOKEN"] = hf_token
    os.environ["HUGGINGFACE_HUB_TOKEN"] = hf_token
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

try:
    from pyannote.audio import Pipeline
    HAS_PYANNOTE = True
except ImportError:
    HAS_PYANNOTE = False


def _cuda_available() -> bool:
    """Check GPU via ctranslate2 (doesn't need CUDA-compiled PyTorch)."""
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return os.getenv("USE_CUDA", "false").lower() == "true"


_PYANNOTE_PIPELINE = None
_PYANNOTE_FAILED = False


ENABLE_DIARIZATION = os.getenv("ENABLE_DIARIZATION", "false").lower() == "true"


class SpeakerDiarizer:
    """pyannote.audio Speaker Diarization — maps speaker turns to SALESPERSON / CUSTOMER."""

    def __init__(self, auth_token: str = None):
        global _PYANNOTE_PIPELINE, _PYANNOTE_FAILED

        self.auth_token = auth_token or os.getenv("HUGGINGFACE_TOKEN")
        self.device = (
            torch.device("cuda" if _cuda_available() else "cpu")
            if HAS_TORCH
            else "cpu"
        )
        self.pipeline = _PYANNOTE_PIPELINE

        if not ENABLE_DIARIZATION:
            self.pipeline = None
            return

        if self.pipeline is None and not _PYANNOTE_FAILED:
            if not self.auth_token:
                # No HF token — skip network attempt immediately (saves 20+ seconds)
                _PYANNOTE_FAILED = True
                print("[Diarizer] No HUGGINGFACE_TOKEN set. Using instant heuristic speaker alignment.")
                self.pipeline = None
            elif HAS_PYANNOTE:
                print(f"[Diarizer] Initializing pyannote pipeline on {self.device}...")
                try:
                    try:
                        p = Pipeline.from_pretrained(
                            "pyannote/speaker-diarization-3.1",
                            token=self.auth_token,
                        )
                    except TypeError:
                        p = Pipeline.from_pretrained(
                            "pyannote/speaker-diarization-3.1",
                            use_auth_token=self.auth_token,
                        )
                    if p is not None:
                        p = p.to(self.device)
                        _PYANNOTE_PIPELINE = p
                        self.pipeline = p
                        print(f"[Diarizer] pyannote speaker-diarization-3.1 loaded on {self.device}.")
                except Exception as e:
                    _PYANNOTE_FAILED = True
                    err_msg = str(e)
                    if "403" in err_msg or "gated" in err_msg.lower():
                        print("[Diarizer] HuggingFace gated model (403). Using instant heuristic alignment.")
                    else:
                        print(f"[Diarizer] pyannote load error ({e}). Using instant heuristic alignment.")
                    self.pipeline = None

    def _map_pyannote_label(self, speaker_label: str, speaker_order: Dict[str, str]) -> str:
        """Maps pyannote speaker IDs (SPEAKER_00, SPEAKER_01…) to SALESPERSON / CUSTOMER.
        
        Convention: the speaker who appears FIRST in the audio is the SALESPERSON
        (the sales rep who initiated and opened the call). The next unique speaker
        becomes CUSTOMER. All others fall through to SALESPERSON.
        """
        label = str(speaker_label).strip()
        if label not in speaker_order:
            if len(speaker_order) == 0:
                speaker_order[label] = "SALESPERSON"
            elif len(speaker_order) == 1:
                speaker_order[label] = "CUSTOMER"
            else:
                # More than 2 speakers: alternate between SALESPERSON / CUSTOMER
                idx = len(speaker_order)
                speaker_order[label] = "CUSTOMER" if idx % 2 != 0 else "SALESPERSON"
        return speaker_order[label]

    def diarize_and_align(
        self, audio_path: str, transcript_segments: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Aligns pyannote speaker turn boundaries with Whisper transcript timestamps."""
        if not ENABLE_DIARIZATION:
            print("[Diarizer] Diarization feature is ON HOLD. Fast-passing transcript segments.")
            aligned = []
            for seg in transcript_segments:
                seg_copy = dict(seg)
                if seg_copy.get("speaker") in ("UNKNOWN", "", None):
                    seg_copy["speaker"] = "SALESPERSON"
                aligned.append(seg_copy)
            return aligned

        aligned = []
        speaker_order: Dict[str, str] = {}

        if self.pipeline is not None and os.path.exists(audio_path):
            try:
                # Pre-load audio via torchaudio — bypasses torchcodec (broken on Windows
                # without FFmpeg DLLs). pyannote accepts {"waveform": Tensor, "sample_rate": int}.
                import torchaudio
                waveform, sample_rate = torchaudio.load(audio_path)
                # pyannote expects (channels, samples) float32 tensor
                if waveform.dtype != torch.float32:
                    waveform = waveform.float()
                audio_input = {"waveform": waveform, "sample_rate": sample_rate}
                print(f"[Diarizer] Audio loaded via torchaudio: {waveform.shape}, {sample_rate} Hz")

                diarization = self.pipeline(audio_input)

                for seg in transcript_segments:
                    seg_copy = dict(seg)
                    seg_start = seg_copy.get("start_time", 0.0)
                    seg_end   = seg_copy.get("end_time", 0.0)

                    # Find speaker turn with max time overlap
                    assigned_label = None
                    max_overlap = 0.0
                    for turn, _, speaker in diarization.itertracks(yield_label=True):
                        overlap = max(0.0, min(seg_end, turn.end) - max(seg_start, turn.start))
                        if overlap > max_overlap:
                            max_overlap = overlap
                            assigned_label = speaker

                    if assigned_label is not None:
                        seg_copy["speaker"] = self._map_pyannote_label(assigned_label, speaker_order)
                    else:
                        # No overlap found — keep SALESPERSON as fallback
                        seg_copy["speaker"] = "SALESPERSON"

                    aligned.append(seg_copy)

                if aligned:
                    speakers_found = set(s["speaker"] for s in aligned)
                    print(f"[Diarizer] Diarization complete on {self.device}. Speakers: {speakers_found}")
                    return aligned

            except Exception as e:
                print(f"[Diarizer] pyannote diarization failed ({e}). Falling back to heuristic alignment.")

        # ── Heuristic fallback: alternating speaker assignment ────────────────
        # Groups consecutive segments by gap — long pauses indicate speaker changes
        PAUSE_THRESHOLD = 1.5  # seconds gap → likely a speaker turn
        current_speaker = "SALESPERSON"

        for idx, seg in enumerate(transcript_segments):
            seg_copy = dict(seg)

            # If segment already has a valid speaker label, keep it
            existing = seg_copy.get("speaker", "")
            if existing in ("SALESPERSON", "CUSTOMER"):
                aligned.append(seg_copy)
                current_speaker = existing
                continue

            # Check if there's a significant pause before this segment
            if idx > 0:
                prev_end   = transcript_segments[idx - 1].get("end_time", 0.0)
                this_start = seg_copy.get("start_time", 0.0)
                if (this_start - prev_end) >= PAUSE_THRESHOLD:
                    current_speaker = "CUSTOMER" if current_speaker == "SALESPERSON" else "SALESPERSON"

            seg_copy["speaker"] = current_speaker
            aligned.append(seg_copy)

        speakers_found = set(s["speaker"] for s in aligned)
        print(f"[Diarizer] Heuristic assignment complete. Speakers: {speakers_found}")
        return aligned

