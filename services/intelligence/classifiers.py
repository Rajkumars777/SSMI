"""
Business Event Classifiers — SSMI
====================================
Fast, deterministic keyword/pattern matching layer that runs BEFORE the LLM
to detect business-relevant events in live and recorded transcripts.

Why two-stage detection?
  - The classifier runs in microseconds and flags high-signal moments in real
    time (e.g. during live WebSocket streaming) so the UI can show live events.
  - The LLM then does deeper reasoning on the full transcript to produce
    structured summaries with nuanced context.

Public API:
  BUSINESS_PATTERNS           : Regex patterns keyed by EventType.
  BusinessEventClassifier     : Classifies a single transcript segment.
  detect_candidate_events()   : Batch-classify all segments in a transcript.
"""

import re
from typing import Any, Dict, List, Optional

from services.api.fastapi.database.models import EventType, PurchaseIntent, SpeakerType


# ---------------------------------------------------------------------------
# Keyword & regex pattern definitions
# ---------------------------------------------------------------------------
# Each EventType maps to a list of regex patterns. A segment that matches any
# pattern in a category is considered a candidate event of that type.

BUSINESS_PATTERNS: Dict[EventType, List[str]] = {
    EventType.REQUIREMENT: [
        r"\b(need|require|looking for|must have|feature|seats|licenses|users|rollout|deploy)\b",
    ],
    EventType.PRICING: [
        r"\b(price|pricing|cost|rate|fee|license cost|per seat|subscription)\b",
        r"[\$\₹€£]\s?\d+",  # Any currency amount
    ],
    EventType.BUDGET: [
        r"\b(budget|allocated|annual budget|spending|afford|ceiling|cap)\b",
        r"\b\d+\s?(thousand|k|million|lakh|crore)\b",  # Large numbers implying budget
    ],
    EventType.OBJECTION: [
        r"\b(competitor|cheaper|too expensive|higher than|alternative|VoiceAI|concern|issue|doubt)\b",
        r"\b(discount|quote|quoting us|less for|match that)\b",
    ],
    EventType.NEGOTIATION: [
        r"\b(discount|off|reduce|drop|deal|sign this month|give us|if you can)\b",
    ],
    EventType.DECISION: [
        r"\b(agree|agreed|decided|deal|sign|pilot|POC|trial|renew|renewing|approved)\b",
    ],
}


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------

class BusinessEventClassifier:
    """
    Fast, deterministic event detection that runs before LLM deep reasoning.

    Checks each transcript segment against BUSINESS_PATTERNS and returns
    a classification result with importance and purchase intent signals.
    """

    @staticmethod
    def classify_segment(text: str, speaker: str) -> Optional[Dict[str, Any]]:
        """
        Classify a single transcript segment.

        Args:
          text    : The spoken text to analyse.
          speaker : Speaker label (e.g. 'CUSTOMER', 'SALESPERSON').

        Returns:
          A dict with keys {type, importance, confidence, purchase_intent}
          if a business event is detected, or None if no pattern matches.
        """
        text_lower = text.lower()

        # ── Budget fast-path (highest priority signal) ───────────────────────
        # Budget mentions are the clearest purchase-intent signal — check them first
        if "budget" in text_lower or "annual budget" in text_lower:
            return {
                "type":           EventType.BUDGET,
                "importance":     4,
                "confidence":     0.95,
                "purchase_intent": PurchaseIntent.HIGH,
            }

        # ── General pattern matching ─────────────────────────────────────────
        matched_type  = None
        highest_score = 0

        for event_type, patterns in BUSINESS_PATTERNS.items():
            matches = sum(
                1 for pattern in patterns
                if re.search(pattern, text_lower, re.IGNORECASE)
            )
            if matches > 0 and matches > highest_score:
                highest_score = matches
                matched_type  = event_type

        if not matched_type:
            return None  # No business event detected in this segment

        # ── Importance scoring ───────────────────────────────────────────────
        # Critical events (pricing objections, decisions) score highest
        if matched_type in (EventType.PRICING, EventType.OBJECTION, EventType.DECISION, EventType.NEGOTIATION):
            importance = 5
        elif matched_type in (EventType.BUDGET, EventType.REQUIREMENT):
            importance = 4
        else:
            importance = 3

        # ── Purchase intent inference ────────────────────────────────────────
        if "sign this month" in text_lower or "definitely renewing" in text_lower or "agreed" in text_lower:
            intent = PurchaseIntent.VERY_HIGH
        elif "budget" in text_lower or "licenses" in text_lower or "need" in text_lower:
            intent = PurchaseIntent.HIGH
        elif "too expensive" in text_lower or "cheaper" in text_lower:
            intent = PurchaseIntent.MEDIUM  # Hesitation — not a rejection
        else:
            intent = PurchaseIntent.MEDIUM

        return {
            "type":           matched_type,
            "importance":     importance,
            "confidence":     min(0.85 + (highest_score * 0.05), 0.99),  # More matches → higher confidence
            "purchase_intent": intent,
        }


# ---------------------------------------------------------------------------
# Batch helper
# ---------------------------------------------------------------------------

def detect_candidate_events(transcript_segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Scan all transcript segments and return a list of candidate business events.

    Used by TimelineEngine as the first step of timeline generation.

    Args:
      transcript_segments : List of segment dicts {text, start_time, end_time, speaker}.

    Returns:
      List of event dicts ready to be passed to EvidenceValidator.
    """
    classifier = BusinessEventClassifier()
    events     = []

    for seg in transcript_segments:
        result = classifier.classify_segment(seg["text"], seg.get("speaker", "UNKNOWN"))
        if result:
            events.append({
                "type":           result["type"],
                "title":          f"{result['type'].value.title().replace('_', ' ')} Mentioned",
                "description":    seg["text"],
                "start_time":     seg["start_time"],
                "end_time":       seg["end_time"],
                "speaker":        seg.get("speaker", "UNKNOWN"),
                "importance":     result["importance"],
                "confidence":     result["confidence"],
                "evidence":       [seg["text"]],
                "purchase_intent": result["purchase_intent"],
            })

    return events
