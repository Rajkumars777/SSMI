from typing import List, Dict, Any
from .classifiers import detect_candidate_events
from .evidence_validator import EvidenceValidator


class TimelineEngine:
    """Combines business importance, customer intent, and evidence to build the final meeting timeline."""

    @staticmethod
    def generate_timeline(
        transcript_segments: List[Dict[str, Any]],
        bookmarks: List[float] = None
    ) -> List[Dict[str, Any]]:
        if not transcript_segments:
            return []

        bookmarks = bookmarks or []

        # Step 1: Detect candidate events
        candidate_events = detect_candidate_events(transcript_segments)

        # Step 2: Incorporate voice bookmarks
        for bm_time in bookmarks:
            # Find closest transcript segment
            closest_seg = min(
                transcript_segments,
                key=lambda s: abs(s["start_time"] - bm_time),
                default=None
            )
            if closest_seg:
                candidate_events.append({
                    "type": "COMMITMENT",
                    "title": "Voice Bookmarked Segment",
                    "description": closest_seg["text"],
                    "start_time": closest_seg["start_time"],
                    "end_time": closest_seg["end_time"],
                    "speaker": closest_seg.get("speaker", "UNKNOWN"),
                    "importance": 5,
                    "confidence": 0.99,
                    "evidence": [closest_seg["text"]],
                    "bookmarked": True,
                })

        # Step 3: Validate each event with evidence engine
        validated_events = []
        for evt in candidate_events:
            validated_evt = EvidenceValidator.validate_event(evt, transcript_segments)
            validated_events.append(validated_evt)

        # Step 4: Deduplicate overlapping events of the same type within 10 seconds
        final_timeline = []
        for evt in sorted(validated_events, key=lambda x: x["start_time"]):
            if not final_timeline:
                final_timeline.append(evt)
                continue

            last = final_timeline[-1]
            if last["type"] == evt["type"] and abs(evt["start_time"] - last["start_time"]) < 10.0:
                # Merge into highest importance
                if evt["importance"] > last["importance"]:
                    final_timeline[-1] = evt
            else:
                final_timeline.append(evt)

        # Assign unique event IDs
        for idx, evt in enumerate(final_timeline, start=1):
            evt["id"] = f"evt_{idx:03d}"

        return final_timeline
