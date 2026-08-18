"""
Intelligence Pipeline Tests — SSMI
=====================================
Unit tests for the deterministic intelligence layer:
  - BusinessEventClassifier  : keyword pattern matching
  - EvidenceValidator        : transcript-claim overlap scoring
  - TimelineEngine           : full timeline generation pipeline
  - QwenSummarizer           : structured summary output (offline fallback)

No network or GPU required — all tests use the deterministic code paths.
"""

from services.api.fastapi.database.models import EventType
from services.intelligence.classifiers import BusinessEventClassifier
from services.intelligence.evidence_validator import EvidenceValidator
from services.intelligence.timeline_engine import TimelineEngine


def test_business_event_classifier():
    """
    Verify that the classifier detects pricing and discount objections.

    The sample sentence mentions a competitor price and requests a discount —
    this should match PRICING, OBJECTION, or NEGOTIATION at importance=5.
    """
    text = "VoiceAI Pro is quoting us almost 20% less. Can you give us a discount?"
    res  = BusinessEventClassifier.classify_segment(text, "CUSTOMER")

    assert res is not None
    assert res["type"] in (EventType.PRICING, EventType.OBJECTION, EventType.NEGOTIATION)
    assert res["importance"] == 5


def test_evidence_validator():
    """
    Verify that the validator correctly scores claim-transcript overlap.

    The claim mentions '5000 enterprise licenses' and the transcript
    contains '5,000 licenses' — expected overlap ratio >= 0.4.
    """
    claim      = "5000 enterprise licenses needed"
    transcript = "We need around 5,000 licenses to cover our operations in India."

    is_valid, confidence, quotes = EvidenceValidator.validate_claim(claim, transcript)

    assert is_valid is True
    assert confidence > 0.5
    assert len(quotes) > 0


def test_timeline_engine():
    """
    Verify that TimelineEngine generates structured events including bookmarks.

    Two segments cover budget and decision keywords; one voice bookmark is
    included. The output should contain at least 2 events with a BUDGET type.
    """
    segments = [
        {
            "start_time": 10.0, "end_time": 25.0,
            "speaker": "CUSTOMER",
            "text": "We have an annual budget of $120,000 for this software.",
        },
        {
            "start_time": 30.0, "end_time": 45.0,
            "speaker": "SALESPERSON",
            "text": "We agree on setting up a 50-seat pilot POC next month.",
        },
    ]

    timeline = TimelineEngine.generate_timeline(segments, bookmarks=[15.0])

    assert len(timeline) >= 2
    assert any(evt["type"] == EventType.BUDGET for evt in timeline)


def test_qwen_summarizer():
    """
    Verify that QwenSummarizer returns a correctly structured output via the
    deterministic fallback (no Ollama connection required).
    """
    from services.summarization.summarizer import QwenSummarizer

    # Point to an offline port so unit test tests the deterministic fallback immediately
    summarizer = QwenSummarizer(vllm_endpoint="http://127.0.0.1:9999/v1")
    segments = [
        {"speaker": "CUSTOMER",    "text": "We have an annual budget of $120,000 for this software."},
        {"speaker": "SALESPERSON", "text": "We can offer a 15% discount if you sign this month."},
    ]

    result = summarizer.generate_summary_and_actions("Acme Corp", "Acme", segments, [])

    assert "summary"      in result
    assert "action_items" in result
    assert result["summary"]["objective"] is not None
    assert len(result["action_items"]) > 0
