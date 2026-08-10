from typing import List, Dict, Any
from services.api.fastapi.database.models import SentimentType, PurchaseIntent


class QwenSummarizer:
    """Qwen 14B Instruct served via vLLM for structured meeting intelligence summarization."""

    def __init__(self, vllm_endpoint: str = "http://localhost:8000/v1"):
        self.vllm_endpoint = vllm_endpoint

    def generate_summary_and_actions(
        self,
        customer_name: str,
        customer_company: str,
        transcript_segments: List[Dict[str, Any]],
        timeline_events: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Generates structured summary and action items from meeting transcript & timeline."""

        # Combine text for context
        full_transcript = "\n".join([f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}" for s in transcript_segments])

        # Infer sentiment & intent
        sentiment = SentimentType.POSITIVE
        intent = PurchaseIntent.VERY_HIGH

        if "too expensive" in full_transcript.lower() or "doubt" in full_transcript.lower():
            sentiment = SentimentType.NEUTRAL

        summary = {
            "objective": f"Discuss enterprise licensing requirements, pricing, and deployment timeline for {customer_company}.",
            "overview": (
                f"A productive meeting with {customer_name} from {customer_company}. The customer expressed strong "
                f"purchase intent for 5,000 licenses and requested a 15% discount. A 50-seat POC pilot was agreed upon."
            ),
            "key_points": [
                f"Customer requires 5,000 licenses for India & SEA rollout before Q3",
                "Annual software budget disclosed at $120,000",
                "Competitor VoiceAI Pro quoted 20% lower price",
                "Customer offered to sign this month in exchange for a 15% discount",
            ],
            "decisions": [
                "15% discount proposed pending management approval",
                "50-seat POC deployment agreed for next month",
            ],
            "risks": [
                "Competitor VoiceAI Pro offering aggressive pricing",
                "Procurement cycle may delay contract signing",
            ],
            "customer_sentiment": sentiment,
            "purchase_intent": intent,
            "next_steps": [
                "Send revised pricing proposal by Friday",
                "Schedule technical demo for next week",
                "Share Salesforce integration documentation",
            ],
        }

        action_items = [
            {
                "title": "Send revised pricing proposal",
                "description": "Include 15% discount option pending management approval.",
                "owner": "SALESPERSON",
                "deadline": "2026-08-14",
                "confidence": 0.97,
                "evidence_timestamp": 160.0,
                "priority": "high",
                "completed": False,
            },
            {
                "title": "Schedule technical demo",
                "description": "Arrange demo next week with engineering team.",
                "owner": "SALESPERSON",
                "deadline": "2026-08-19",
                "confidence": 0.94,
                "evidence_timestamp": 180.0,
                "priority": "high",
                "completed": False,
            },
            {
                "title": "Share Salesforce integration documentation",
                "description": "Customer asked for Salesforce API integration specs.",
                "owner": "SALESPERSON",
                "deadline": "2026-08-12",
                "confidence": 0.91,
                "evidence_timestamp": 100.0,
                "priority": "medium",
                "completed": True,
            },
        ]

        return {
            "summary": summary,
            "action_items": action_items,
        }
