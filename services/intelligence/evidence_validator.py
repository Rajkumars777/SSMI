from typing import List, Dict, Any, Tuple


class EvidenceValidator:
    """Validates AI extraction claims against exact transcript evidence to prevent hallucinations."""

    @staticmethod
    def validate_claim(claim: str, transcript_text: str) -> Tuple[bool, float, List[str]]:
        """Checks if a generated claim/insight is supported by transcript text."""
        import string
        # Clean punctuation and normalize numbers (e.g. 5,000 -> 5000)
        clean_claim = claim.translate(str.maketrans('', '', string.punctuation)).lower()
        clean_transcript = transcript_text.translate(str.maketrans('', '', string.punctuation)).lower()

        claim_words = set(clean_claim.split())
        transcript_words = set(clean_transcript.split())

        # Filter out common stop words
        stop_words = {"the", "a", "an", "is", "are", "was", "were", "to", "for", "in", "of", "and", "or", "we", "you", "our", "us"}
        content_claim_words = claim_words - stop_words

        if not content_claim_words:
            return True, 1.0, [transcript_text[:100]]

        overlap = content_claim_words.intersection(transcript_words)
        match_ratio = len(overlap) / len(content_claim_words)

        is_valid = match_ratio >= 0.4  # At least 40% keyword overlap required
        confidence = round(min(match_ratio * 1.2, 0.99), 2)

        return is_valid, confidence, [transcript_text]

    @staticmethod
    def validate_event(event: Dict[str, Any], transcript_segments: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Validates an event object against surrounding transcript segments."""
        start_time = event.get("start_time", 0)
        end_time = event.get("end_time", 0)

        matching_segments = [
            seg for seg in transcript_segments
            if seg["start_time"] <= end_time and seg["end_time"] >= start_time
        ]

        if not matching_segments:
            event["confidence"] = max(event.get("confidence", 0.5) * 0.7, 0.4)
            return event

        combined_text = " ".join([seg["text"] for seg in matching_segments])
        is_valid, score, evidence_quotes = EvidenceValidator.validate_claim(event.get("title", ""), combined_text)

        event["evidence"] = [combined_text] if combined_text else event.get("evidence", [])
        event["confidence"] = round((event.get("confidence", 0.9) + score) / 2.0, 2)
        return event
