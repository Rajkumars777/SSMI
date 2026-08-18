"""
Speaker Diarization — SSMI
============================
Identifies which speaker (SALESPERSON or CUSTOMER) is talking in each
Whisper transcript segment.

Two modes depending on availability:
  1. pyannote.audio speaker-diarization-3.1 (via HuggingFace — requires auth token
     and model gating approval). Gives per-segment diarization with GPU acceleration.
  2. Heuristic fallback (always available). Groups segments by silence gaps and
     alternates speakers: first speaker → SALESPERSON, second → CUSTOMER.

Controlled by environment variable:
  ENABLE_DIARIZATION=true   — attempt pyannote pipeline (default: false)
  HUGGINGFACE_TOKEN         — HuggingFace access token for the gated model
"""

import os
from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# Optional PyTorch — needed only for pyannote's GPU placement
# ---------------------------------------------------------------------------
try:
    import torch
    HAS_TORCH = True
except ImportError:
    torch = None   # type: ignore
    HAS_TORCH = False

# Load .env so HUGGINGFACE_TOKEN and USE_CUDA are available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ---------------------------------------------------------------------------
# HuggingFace token forwarding — pyannote reads these env vars
# ---------------------------------------------------------------------------
hf_token = os.getenv("HUGGINGFACE_TOKEN", "")
if hf_token:
    os.environ["HF_TOKEN"]               = hf_token
    os.environ["HUGGINGFACE_HUB_TOKEN"]  = hf_token
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# ---------------------------------------------------------------------------
# Optional pyannote import
# ---------------------------------------------------------------------------
try:
    from pyannote.audio import Pipeline
    HAS_PYANNOTE = True
except ImportError:
    HAS_PYANNOTE = False

# Whether to attempt real pyannote diarization (costly — requires HF token + model approval)
ENABLE_DIARIZATION = os.getenv("ENABLE_DIARIZATION", "false").lower() == "true"


def _cuda_available() -> bool:
    """
    Check if a CUDA GPU is available using ctranslate2.

    Uses ctranslate2 rather than PyTorch so the check works even when PyTorch
    was not compiled with CUDA support.
    """
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        # Fall back to env var if ctranslate2 is unavailable
        return os.getenv("USE_CUDA", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Module-level pyannote pipeline cache
# (loaded once per process — expensive to initialise)
# ---------------------------------------------------------------------------
_PYANNOTE_PIPELINE = None   # Cached pyannote Pipeline instance
_PYANNOTE_FAILED   = False  # Set to True permanently after any load error


class SpeakerDiarizer:
    """
    Aligns Whisper transcript segments with speaker identities.

    If pyannote is enabled and loadable, uses neural speaker diarization.
    Otherwise falls back to a fast heuristic that assigns speakers based
    on silence gaps between segments.
    """

    def __init__(self, auth_token: str = None):
        global _PYANNOTE_PIPELINE, _PYANNOTE_FAILED

        self.auth_token = auth_token or os.getenv("HUGGINGFACE_TOKEN")
        self.device     = (
            torch.device("cuda" if _cuda_available() else "cpu")
            if HAS_TORCH else "cpu"
        )
        self.pipeline = _PYANNOTE_PIPELINE

        # Skip loading attempt if diarization is disabled via env var
        if not ENABLE_DIARIZATION:
            self.pipeline = None
            return

        # Attempt to load pyannote only if it hasn't already failed
        if self.pipeline is None and not _PYANNOTE_FAILED:
            if not self.auth_token:
                # No token → skip network call immediately (saves 20+ seconds)
                _PYANNOTE_FAILED = True
                print("[Diarizer] No HUGGINGFACE_TOKEN set. Using instant heuristic speaker alignment.")
                self.pipeline = None

            elif HAS_PYANNOTE:
                print(f"[Diarizer] Initializing pyannote pipeline on {self.device}...")
                try:
                    # Try new kwarg name first; fall back to deprecated use_auth_token
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
        """
        Map pyannote speaker IDs (SPEAKER_00, SPEAKER_01…) to SALESPERSON / CUSTOMER.

        Convention: the speaker who appears FIRST in the audio is the SALESPERSON
        (the sales rep who opened the call). The second unique speaker becomes CUSTOMER.
        Any additional speakers alternate between the two roles.
        """
        label = str(speaker_label).strip()
        if label not in speaker_order:
            if len(speaker_order) == 0:
                speaker_order[label] = "SALESPERSON"       # First speaker
            elif len(speaker_order) == 1:
                speaker_order[label] = "CUSTOMER"          # Second speaker
            else:
                # 3+ speakers: alternate between roles based on order of appearance
                idx = len(speaker_order)
                speaker_order[label] = "CUSTOMER" if idx % 2 != 0 else "SALESPERSON"
        return speaker_order[label]

    def diarize_and_align(
        self,
        audio_path:          str,
        transcript_segments: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Assign speaker labels to each Whisper transcript segment.

        Strategy:
          1. If ENABLE_DIARIZATION=false → fast-pass with SALESPERSON label.
          2. If pyannote pipeline is loaded → run full neural diarization.
          3. Otherwise → heuristic: alternate speakers on silence gaps ≥ 1.5s.

        Args:
          audio_path          : Path to the audio file (used by pyannote).
          transcript_segments : List of segment dicts from Whisper.

        Returns:
          The same segments with `speaker` set to 'SALESPERSON' or 'CUSTOMER'.
        """
        # ── Fast-pass: diarization disabled ─────────────────────────────────
        if not ENABLE_DIARIZATION:
            print("[Diarizer] Diarization feature is ON HOLD. Fast-passing transcript segments.")
            aligned = []
            for seg in transcript_segments:
                seg_copy = dict(seg)
                # Default UNKNOWN speakers to SALESPERSON
                if seg_copy.get("speaker") in ("UNKNOWN", "", None):
                    seg_copy["speaker"] = "SALESPERSON"
                aligned.append(seg_copy)
            return aligned

        aligned: List[Dict[str, Any]] = []
        speaker_order: Dict[str, str] = {}

        # ── pyannote neural diarization ─────────────────────────────────────
        if self.pipeline is not None and os.path.exists(audio_path):
            try:
                # Load audio via torchaudio to bypass torchcodec issues on Windows
                # (torchcodec requires FFmpeg DLLs that are often missing)
                import torchaudio
                waveform, sample_rate = torchaudio.load(audio_path)

                # pyannote expects float32 tensor of shape (channels, samples)
                if waveform.dtype != torch.float32:
                    waveform = waveform.float()
                audio_input = {"waveform": waveform, "sample_rate": sample_rate}
                print(f"[Diarizer] Audio loaded via torchaudio: {waveform.shape}, {sample_rate} Hz")

                diarization = self.pipeline(audio_input)

                for seg in transcript_segments:
                    seg_copy = dict(seg)
                    seg_start = seg_copy.get("start_time", 0.0)
                    seg_end   = seg_copy.get("end_time", 0.0)

                    # Find the pyannote speaker turn with the most overlap
                    assigned_label = None
                    max_overlap    = 0.0
                    for turn, _, speaker in diarization.itertracks(yield_label=True):
                        overlap = max(0.0, min(seg_end, turn.end) - max(seg_start, turn.start))
                        if overlap > max_overlap:
                            max_overlap    = overlap
                            assigned_label = speaker

                    if assigned_label is not None:
                        seg_copy["speaker"] = self._map_pyannote_label(assigned_label, speaker_order)
                    else:
                        # No overlap found — default to SALESPERSON
                        seg_copy["speaker"] = "SALESPERSON"

                    aligned.append(seg_copy)

                if aligned:
                    speakers_found = set(s["speaker"] for s in aligned)
                    print(f"[Diarizer] Diarization complete on {self.device}. Speakers: {speakers_found}")
                    return aligned

            except Exception as e:
                print(f"[Diarizer] pyannote diarization failed ({e}). Falling back to heuristic alignment.")

        # ── Heuristic fallback: silence-gap speaker alternation ─────────────
        # A gap ≥ PAUSE_THRESHOLD seconds between segments suggests a speaker change.
        PAUSE_THRESHOLD = 1.5
        current_speaker = "SALESPERSON"

        for idx, seg in enumerate(transcript_segments):
            seg_copy = dict(seg)

            # Keep the label if it was already assigned (e.g. by upstream processing)
            existing = seg_copy.get("speaker", "")
            if existing in ("SALESPERSON", "CUSTOMER"):
                aligned.append(seg_copy)
                current_speaker = existing
                continue

            # Switch speaker on a significant pause
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
