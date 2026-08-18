"""
Timeline Engine — SSMI
========================
Builds the final, deduplicated meeting timeline from raw transcript segments
and optional voice bookmarks.

Pipeline (4 steps):
  1. Detect candidate business events using fast keyword classifiers.
  2. Insert voice-bookmarked moments as COMMITMENT events.
  3. Validate each event against transcript evidence to remove hallucinations.
  4. Deduplicate overlapping events of the same type (keep highest importance).

Output is sorted chronologically by start_time and each event gets a unique
sequential ID (evt_001, evt_002, …).
"""

from typing import Any, Dict, List

from .classifiers import detect_candidate_events
from .evidence_validator import EvidenceValidator
from services.api.fastapi.database.models import EventType


class TimelineEngine:
    """
    Orchestrates the full meeting timeline generation pipeline.

    All methods are static — the class is a stateless namespace.
    """

    @staticmethod
    def generate_timeline(
        transcript_segments: List[Dict[str, Any]],
        bookmarks: List[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Generate a deduplicated, evidence-validated meeting timeline.

        Args:
          transcript_segments : List of segment dicts from Whisper/diarizer.
          bookmarks           : List of audio timestamps (seconds) for voice-bookmarked moments.

        Returns:
          Chronologically sorted list of timeline event dicts, each with a
          unique `id` field (e.g. 'evt_001').
        """
        if not transcript_segments:
            return []

        bookmarks = bookmarks or []

        # ── Step 1: Detect candidate events via keyword patterns ─────────────
        candidate_events = detect_candidate_events(transcript_segments)

        # ── Step 2: Incorporate voice bookmarks ──────────────────────────────
        # Each bookmark timestamp is mapped to the nearest transcript segment
        # and added as a high-importance COMMITMENT event.
        for bm_time in bookmarks:
            closest_seg = min(
                transcript_segments,
                key=lambda s: abs(s["start_time"] - bm_time),
                default=None,
            )
            if closest_seg:
                candidate_events.append({
                    "type":        EventType.COMMITMENT,
                    "title":       "Voice Bookmarked Segment",
                    "description": closest_seg["text"],
                    "start_time":  closest_seg["start_time"],
                    "end_time":    closest_seg["end_time"],
                    "speaker":     closest_seg.get("speaker", "UNKNOWN"),
                    "importance":  5,         # Bookmarks are always maximum importance
                    "confidence":  0.99,
                    "evidence":    [closest_seg["text"]],
                    "bookmarked":  True,
                })

        # ── Step 3: Validate each event against transcript evidence ──────────
        # This step penalises events whose title doesn't appear in the transcript
        # and attaches the supporting transcript quote as evidence.
        validated_events = [
            EvidenceValidator.validate_event(evt, transcript_segments)
            for evt in candidate_events
        ]

        # ── Step 4: Deduplicate overlapping events of the same type ─────────
        # Two events of the same type within 10 seconds are merged into one
        # (the one with the higher importance score is kept).
        final_timeline: List[Dict[str, Any]] = []
        for evt in sorted(validated_events, key=lambda x: x["start_time"]):
            if not final_timeline:
                final_timeline.append(evt)
                continue

            last = final_timeline[-1]
            same_type    = last["type"] == evt["type"]
            close_in_time = abs(evt["start_time"] - last["start_time"]) < 10.0

            if same_type and close_in_time:
                # Keep whichever event has the higher importance
                if evt["importance"] > last["importance"]:
                    final_timeline[-1] = evt
            else:
                final_timeline.append(evt)

        # ── Assign unique sequential IDs ─────────────────────────────────────
        for idx, evt in enumerate(final_timeline, start=1):
            evt["id"] = f"evt_{idx:03d}"

        return final_timeline
