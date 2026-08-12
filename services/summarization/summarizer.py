import os
import json
import re
import socket
from typing import List, Dict, Any
from pydantic import BaseModel, Field
from services.api.fastapi.database.models import SentimentType, PurchaseIntent, EventType

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

# How long (seconds) to wait for the LLM API before falling back to deterministic.
# 120 sec gives 14B model on CPU enough time for first-token generation.
SUMMARIZER_TIMEOUT = int(os.getenv("SUMMARIZER_TIMEOUT", "120"))


def _ollama_is_reachable(endpoint: str, probe_timeout: float = 3.0) -> bool:
    """Quick TCP probe to check if Ollama/vLLM is listening before sending a request."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(endpoint)
        host = parsed.hostname or "localhost"
        port = parsed.port or 80
        with socket.create_connection((host, port), timeout=probe_timeout):
            return True
    except OSError:
        return False


class ActionItemSchema(BaseModel):
    title: str
    description: str = ""
    owner: str = "SALESPERSON"
    deadline: str = "TBD"
    priority: str = "high"


class SummaryOutputSchema(BaseModel):
    objective: str
    overview: str
    key_points: List[str] = Field(default_factory=list)
    decisions: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    customer_sentiment: str = "positive"
    purchase_intent: str = "very_high"
    next_steps: List[str] = Field(default_factory=list)
    action_items: List[ActionItemSchema] = Field(default_factory=list)


class QwenSummarizer:
    """Qwen 14B Instruct served via vLLM / Ollama for structured meeting intelligence summarization."""

    def __init__(self, vllm_endpoint: str = None):
        self.vllm_endpoint = vllm_endpoint or os.getenv("VLLM_ENDPOINT", "http://localhost:11434/v1")
        self.model_name = os.getenv("VLLM_MODEL_NAME", "qwen2.5:14b")
        self.client = None
        if HAS_OPENAI:
            try:
                # Pass explicit timeout so we never hang waiting for Ollama
                self.client = OpenAI(
                    base_url=self.vllm_endpoint,
                    api_key="not-needed",
                    timeout=SUMMARIZER_TIMEOUT,
                )
            except Exception as e:
                print(f"[Warning] Could not initialize OpenAI client ({e})")

    def generate_summary_and_actions(
        self,
        customer_name: str,
        customer_company: str,
        transcript_segments: List[Dict[str, Any]],
        timeline_events: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Generates structured summary and action items from meeting transcript & timeline."""

        full_transcript = "\n".join([f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}" for s in transcript_segments])

        if self.client is not None:
            # Fast TCP probe — skip LLM entirely if Ollama isn't running
            if not _ollama_is_reachable(self.vllm_endpoint, probe_timeout=3.0):
                print(f"[Summarizer] Ollama/vLLM not reachable at {self.vllm_endpoint} — using deterministic fallback.")
            else:
                try:
                    system_prompt = (
                        "You are an expert Sales AI Assistant. Analyze the customer meeting transcript and extract concise intelligence.\n"
                        "Respond ONLY in valid JSON matching this exact structure:\n"
                        "{\n"
                        '  "objective": "Meeting goal",\n'
                        '  "overview": "Summary narrative",\n'
                        '  "key_points": ["Point 1", "Point 2"],\n'
                        '  "decisions": ["Decision 1"],\n'
                        '  "risks": ["Risk 1"],\n'
                        '  "customer_sentiment": "positive"|"neutral"|"negative"|"mixed",\n'
                        '  "purchase_intent": "very_high"|"high"|"medium"|"low"|"none",\n'
                        '  "next_steps": ["Step 1"],\n'
                        '  "action_items": [{"title": "Task", "description": "Details", "owner": "SALESPERSON"|"CUSTOMER", "deadline": "YYYY-MM-DD", "priority": "high"|"medium"|"low"}]\n'
                        "}"
                    )

                    user_prompt = f"Customer: {customer_name} ({customer_company})\n\nTRANSCRIPT:\n{full_transcript}"

                    response = self.client.chat.completions.create(
                        model=self.model_name,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        temperature=0.1,
                        # Note: response_format is NOT passed — Ollama's OpenAI-compat
                        # layer doesn't support json_object mode; JSON is enforced via
                        # the system prompt instead.
                        timeout=SUMMARIZER_TIMEOUT,
                    )

                    raw_content = response.choices[0].message.content or ""
                    json_match = re.search(r"(\{[\s\S]*\})", raw_content)
                    if json_match:
                        clean_content = json_match.group(1)
                    else:
                        clean_content = re.sub(r"^```json\s*|\s*```$", "", raw_content.strip(), flags=re.MULTILINE)

                    parsed_json = json.loads(clean_content)
                    parsed_data = SummaryOutputSchema.model_validate(parsed_json)

                    # Map sentiment & intent strings to enums
                    sentiment_map = {
                        "positive": SentimentType.POSITIVE,
                        "neutral": SentimentType.NEUTRAL,
                        "negative": SentimentType.NEGATIVE,
                        "mixed": SentimentType.MIXED
                    }
                    intent_map = {
                        "very_high": PurchaseIntent.VERY_HIGH,
                        "high": PurchaseIntent.HIGH,
                        "medium": PurchaseIntent.MEDIUM,
                        "low": PurchaseIntent.LOW,
                        "none": PurchaseIntent.NONE
                    }

                    summary = {
                        "objective": parsed_data.objective,
                        "overview": parsed_data.overview,
                        "key_points": parsed_data.key_points,
                        "decisions": parsed_data.decisions,
                        "risks": parsed_data.risks,
                        "customer_sentiment": sentiment_map.get(str(parsed_data.customer_sentiment).lower(), SentimentType.POSITIVE),
                        "purchase_intent": intent_map.get(str(parsed_data.purchase_intent).lower(), PurchaseIntent.VERY_HIGH),
                        "next_steps": parsed_data.next_steps,
                    }

                    action_items = []
                    for idx, act in enumerate(parsed_data.action_items):
                        action_items.append({
                            "title": act.title,
                            "description": act.description,
                            "owner": act.owner,
                            "deadline": act.deadline,
                            "confidence": 0.95,
                            "evidence_timestamp": 60.0 * (idx + 1),
                            "priority": act.priority,
                            "completed": False,
                        })

                    print("[Summarizer] Successfully extracted intelligence with Qwen 14B!")
                    return {
                        "summary": summary,
                        "action_items": action_items,
                    }
                except Exception as e:
                    print(f"[Warning] LLM summarization call failed ({e}). Using transcript intelligence fallback.")

        # Intelligence extraction fallback based on actual transcript segments
        full_lower = full_transcript.lower()
        sentiment = SentimentType.POSITIVE
        intent = PurchaseIntent.HIGH

        if any(w in full_lower for w in ("too expensive", "doubt", "concern", "worried", "risk")):
            sentiment = SentimentType.MIXED
        if any(w in full_lower for w in ("not interested", "no budget", "cancel")):
            intent = PurchaseIntent.LOW
            sentiment = SentimentType.NEGATIVE
        if any(w in full_lower for w in ("sign this month", "ready to buy", "purchase", "go ahead")):
            intent = PurchaseIntent.VERY_HIGH

        extracted_key_points = []
        for seg in transcript_segments:
            txt = seg.get("text", "").strip()
            if len(txt) > 20 and len(extracted_key_points) < 6:
                extracted_key_points.append(txt)

        if not extracted_key_points:
            extracted_key_points = [
                f"Discussion with {customer_name} from {customer_company}",
                "Review of requirements, pricing, and next steps",
            ]
            sentiment = SentimentType.NEUTRAL
            intent = PurchaseIntent.MEDIUM

        extracted_decisions = [
            evt.get("title", "")
            for evt in timeline_events
            if evt.get("type") == EventType.DECISION and evt.get("title")
        ][:4]

        extracted_risks = [
            evt.get("description", "")
            for evt in timeline_events
            if evt.get("type") in (EventType.RISK, EventType.OBJECTION, EventType.COMPETITOR)
        ][:4]

        summary = {
            "objective": f"Sales discussion with {customer_name} ({customer_company}) covering requirements, pricing, and deployment.",
            "overview": (
                f"Meeting with {customer_name} from {customer_company} covering {len(transcript_segments)} "
                f"discussion segments and {len(timeline_events)} detected business events."
            ),
            "key_points": extracted_key_points,
            "decisions": extracted_decisions or ["No explicit decisions captured — review transcript for commitments."],
            "risks": extracted_risks or ["No major risks flagged in transcript."],
            "customer_sentiment": sentiment,
            "purchase_intent": intent,
            "next_steps": [
                "Review extracted action items and assign owners",
                "Follow up with customer on open pricing or timeline questions",
            ],
        }

        action_items = []
        for idx, evt in enumerate(timeline_events[:5]):
            if evt.get("type") in (EventType.ACTION_ITEM, EventType.COMMITMENT, EventType.DECISION):
                action_items.append({
                    "title": evt.get("title", "Follow up on discussion point"),
                    "description": evt.get("description", ""),
                    "owner": evt.get("speaker", "SALESPERSON"),
                    "deadline": "TBD",
                    "confidence": float(evt.get("confidence", 0.9)),
                    "evidence_timestamp": float(evt.get("start_time", 60.0 * (idx + 1))),
                    "priority": "high" if evt.get("importance", 3) >= 4 else "medium",
                    "completed": False,
                })

        if not action_items:
            action_items = [{
                "title": f"Send follow-up summary to {customer_name}",
                "description": "Share meeting recap and proposed next steps.",
                "owner": "SALESPERSON",
                "deadline": "TBD",
                "confidence": 0.9,
                "evidence_timestamp": 60.0,
                "priority": "medium",
                "completed": False,
            }]

        return {
            "summary": summary,
            "action_items": action_items,
        }

