"""
Evidence Validator — SSMI
==========================
Validates AI-extracted claims and timeline events against the raw transcript
to prevent hallucinations in the pipeline output.

How it works:
  - Strip punctuation and stop words from both the claim and the transcript.
  - Compute keyword overlap ratio: overlapping_words / total_claim_words.
  - A claim is considered valid if at least 40% of its content words appear
    in the surrounding transcript text.

This is a fast, deterministic check — not a semantic similarity comparison.
It acts as a guardrail to catch obviously unsupported LLM extractions.
"""

import string
from typing import Any, Dict, List, Tuple


# Words too common to be meaningful evidence signals — filtered out before overlap scoring
_STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were",
    "to", "for", "in", "of", "and", "or",
    "we", "you", "our", "us",
}


class EvidenceValidator:
    """
    Validates AI extraction claims against exact transcript evidence.

    All methods are static — the class is a namespace, not stateful.
    """

    @staticmethod
    def validate_claim(claim: str, transcript_text: str) -> Tuple[bool, float, List[str]]:
        """
        Check if a generated claim is supported by transcript text.

        Computes the fraction of content words in `claim` that also appear
        in `transcript_text`. Content words = all words minus stop words.

        Args:
          claim           : The AI-generated claim to verify (e.g. an event title).
          transcript_text : The raw transcript context to validate against.

        Returns:
          (is_valid, confidence, evidence_quotes) where:
            is_valid        : True if keyword overlap ≥ 40%.
            confidence      : Capped float 0..0.99 proportional to overlap.
            evidence_quotes : The transcript excerpt used for validation.
        """
        # Normalize both strings: remove punctuation and lowercase
        clean = str.maketrans("", "", string.punctuation)
        clean_claim      = claim.translate(clean).lower()
        clean_transcript = transcript_text.translate(clean).lower()

        claim_words      = set(clean_claim.split())
        transcript_words = set(clean_transcript.split())

        # Remove stop words to focus on meaningful content words
        content_words = claim_words - _STOP_WORDS

        # If nothing meaningful remains, accept the claim by default
        if not content_words:
            return True, 1.0, [transcript_text[:100]]

        # Compute overlap between claim content words and transcript vocabulary
        overlap     = content_words.intersection(transcript_words)
        match_ratio = len(overlap) / len(content_words)

        is_valid   = match_ratio >= 0.4          # Require at least 40% overlap
        confidence = round(min(match_ratio * 1.2, 0.99), 2)  # Scale up slightly, cap at 0.99

        return is_valid, confidence, [transcript_text]

    @staticmethod
    def validate_event(
        event: Dict[str, Any],
        transcript_segments: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Validate a timeline event against the surrounding transcript segments.

        Finds all segments that overlap with the event's time window, joins
        their text, and runs validate_claim on the event title.

        Adjustments made to the event dict:
          - evidence   : Replaced with the combined overlapping transcript text.
          - confidence : Averaged with the validation score (penalises unsupported events).

        Args:
          event               : Timeline event dict with start_time/end_time/title.
          transcript_segments : Full list of transcript segments.

        Returns:
          The event dict with updated evidence and confidence fields.
        """
        start_time = event.get("start_time", 0)
        end_time   = event.get("end_time", 0)

        # Find transcript segments that overlap with this event's time window
        matching_segments = [
            seg for seg in transcript_segments
            if seg["start_time"] <= end_time and seg["end_time"] >= start_time
        ]

        if not matching_segments:
            # No transcript context found — penalise confidence
            event["confidence"] = max(event.get("confidence", 0.5) * 0.7, 0.4)
            return event

        # Combine all overlapping segment texts for validation
        combined_text = " ".join(seg["text"] for seg in matching_segments)

        is_valid, score, evidence_quotes = EvidenceValidator.validate_claim(
            event.get("title", ""), combined_text
        )

        # Update event with validated evidence and blended confidence score
        event["evidence"]   = [combined_text] if combined_text else event.get("evidence", [])
        event["confidence"] = round((event.get("confidence", 0.9) + score) / 2.0, 2)

        return event
