from services.intelligence.classifiers import BusinessEventClassifier
from services.intelligence.evidence_validator import EvidenceValidator
from services.intelligence.timeline_engine import TimelineEngine
from services.api.fastapi.database.models import EventType


def test_business_event_classifier():
    """Verify business event classifier detects pricing and discount objections."""
    text_pricing = "VoiceAI Pro is quoting us almost 20% less. Can you give us a discount?"
    res = BusinessEventClassifier.classify_segment(text_pricing, "CUSTOMER")

    assert res is not None
    assert res["type"] in (EventType.PRICING, EventType.OBJECTION, EventType.NEGOTIATION)
    assert res["importance"] == 5


def test_evidence_validator():
    """Verify evidence validator checks claim overlap."""
    claim = "5000 enterprise licenses needed"
    transcript = "We need around 5,000 licenses to cover our operations in India."

    is_valid, confidence, quotes = EvidenceValidator.validate_claim(claim, transcript)
    assert is_valid is True
    assert confidence > 0.5
    assert len(quotes) > 0


def test_timeline_engine():
    """Verify timeline engine generates structured timeline events from segments."""
    segments = [
        {"start_time": 10.0, "end_time": 25.0, "speaker": "CUSTOMER", "text": "We have an annual budget of $120,000 for this software."},
        {"start_time": 30.0, "end_time": 45.0, "speaker": "SALESPERSON", "text": "We agree on setting up a 50-seat pilot POC next month."},
    ]

    timeline = TimelineEngine.generate_timeline(segments, bookmarks=[15.0])
    assert len(timeline) >= 2
    assert any(evt["type"] == EventType.BUDGET for evt in timeline)
