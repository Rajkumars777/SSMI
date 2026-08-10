import re
from typing import List, Dict, Any, Optional
from services.api.fastapi.database.models import EventType, SpeakerType, PurchaseIntent

# Fast keyword & pattern matching triggers for business events
BUSINESS_PATTERNS = {
    EventType.REQUIREMENT: [
        r"\b(need|require|looking for|must have|feature|seats|licenses|users|rollout|deploy)\b",
    ],
    EventType.PRICING: [
        r"\b(price|pricing|cost|rate|fee|license cost|per seat|subscription)\b",
        r"[\$\₹€£]\s?\d+",
    ],
    EventType.BUDGET: [
        r"\b(budget|allocated|annual budget|spending|afford|ceiling|cap)\b",
        r"\b\d+\s?(thousand|k|million|lakh|crore)\b",
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


class BusinessEventClassifier:
    """Fast, deterministic event detection layer running before LLM deep reasoning."""

    @staticmethod
    def classify_segment(text: str, speaker: str) -> Optional[Dict[str, Any]]:
        text_lower = text.lower()

        # Check explicit budget keywords first
        if "budget" in text_lower or "annual budget" in text_lower:
            return {
                "type": EventType.BUDGET,
                "importance": 4,
                "confidence": 0.95,
                "purchase_intent": PurchaseIntent.HIGH,
            }

        matched_type = None
        highest_score = 0

        for event_type, patterns in BUSINESS_PATTERNS.items():
            matches = 0
            for pattern in patterns:
                if re.search(pattern, text_lower, re.IGNORECASE):
                    matches += 1
            if matches > 0 and matches > highest_score:
                highest_score = matches
                matched_type = event_type

        if not matched_type:
            return None

        # Determine priority/importance score
        importance = 3
        if matched_type in (EventType.PRICING, EventType.OBJECTION, EventType.DECISION, EventType.NEGOTIATION):
            importance = 5
        elif matched_type in (EventType.BUDGET, EventType.REQUIREMENT):
            importance = 4

        # Infer purchase intent
        intent = PurchaseIntent.MEDIUM
        if "sign this month" in text_lower or "definitely renewing" in text_lower or "agreed" in text_lower:
            intent = PurchaseIntent.VERY_HIGH
        elif "budget" in text_lower or "licenses" in text_lower or "need" in text_lower:
            intent = PurchaseIntent.HIGH
        elif "too expensive" in text_lower or "cheaper" in text_lower:
            intent = PurchaseIntent.MEDIUM

        return {
            "type": matched_type,
            "importance": importance,
            "confidence": min(0.85 + (highest_score * 0.05), 0.99),
            "purchase_intent": intent,
        }


def detect_candidate_events(transcript_segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Scans transcript segments and yields candidate business events."""
    classifier = BusinessEventClassifier()
    events = []

    for seg in transcript_segments:
        result = classifier.classify_segment(seg["text"], seg.get("speaker", "UNKNOWN"))
        if result:
            events.append({
                "type": result["type"],
                "title": f"{result['type'].value.title().replace('_', ' ')} Mentioned",
                "description": seg["text"],
                "start_time": seg["start_time"],
                "end_time": seg["end_time"],
                "speaker": seg.get("speaker", "UNKNOWN"),
                "importance": result["importance"],
                "confidence": result["confidence"],
                "evidence": [seg["text"]],
                "purchase_intent": result["purchase_intent"],
            })

    return events
