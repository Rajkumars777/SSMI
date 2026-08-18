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


class FollowUpEmailOutputSchema(BaseModel):
    subject: str
    body: str
    to_name: str = ""


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

    def generate_follow_up_email(
        self,
        customer_name: str,
        customer_company: str,
        meeting_title: str,
        meeting_date: str,
        summary: Dict[str, Any],
        action_items: List[Dict[str, Any]],
    ) -> Dict[str, str]:
        """Generates a professional post-meeting follow-up email from summary + action items."""

        key_points = summary.get("key_points") or summary.get("keyPoints") or []
        decisions = summary.get("decisions") or []
        next_steps = summary.get("next_steps") or summary.get("nextSteps") or []
        overview = summary.get("overview") or ""

        action_lines = []
        for item in action_items:
            owner = str(item.get("owner", "SALESPERSON")).replace("_", " ").title()
            deadline = item.get("deadline") or "TBD"
            title = item.get("title", "")
            desc = item.get("description", "")
            line = f"- {title} (Owner: {owner}, Due: {deadline})"
            if desc:
                line += f" — {desc}"
            action_lines.append(line)

        context_block = (
            f"Customer: {customer_name} ({customer_company})\n"
            f"Meeting: {meeting_title}\n"
            f"Date: {meeting_date}\n\n"
            f"Overview:\n{overview}\n\n"
            f"Key Points:\n" + "\n".join(f"- {p}" for p in key_points) + "\n\n"
            f"Decisions:\n" + "\n".join(f"- {d}" for d in decisions) + "\n\n"
            f"Next Steps:\n" + "\n".join(f"- {s}" for s in next_steps) + "\n\n"
            f"Action Items:\n" + ("\n".join(action_lines) if action_lines else "- None captured")
        )

        if self.client is not None and _ollama_is_reachable(self.vllm_endpoint, probe_timeout=3.0):
            try:
                system_prompt = (
                    "You are an expert B2B sales assistant. Write a concise, professional post-meeting "
                    "follow-up email to the customer.\n"
                    "Tone: warm, confident, and action-oriented — not salesy or overly long.\n"
                    "Include: brief thank-you, meeting recap highlights, agreed decisions, and clear next steps "
                    "with owners/deadlines from the action items.\n"
                    "Respond ONLY in valid JSON matching this exact structure:\n"
                    '{\n  "subject": "Email subject line",\n  "body": "Full email body with greeting and sign-off",\n'
                    f'  "to_name": "{customer_name}"\n}}'
                )

                response = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": context_block},
                    ],
                    temperature=0.3,
                    timeout=SUMMARIZER_TIMEOUT,
                )

                raw_content = response.choices[0].message.content or ""
                json_match = re.search(r"(\{[\s\S]*\})", raw_content)
                if json_match:
                    clean_content = json_match.group(1)
                else:
                    clean_content = re.sub(r"^```json\s*|\s*```$", "", raw_content.strip(), flags=re.MULTILINE)

                parsed_data = FollowUpEmailOutputSchema.model_validate(json.loads(clean_content))
                print("[Summarizer] Generated follow-up email with Qwen 14B!")
                return {
                    "subject": parsed_data.subject.strip(),
                    "body": parsed_data.body.strip(),
                    "toName": parsed_data.to_name.strip() or customer_name,
                }
            except Exception as e:
                print(f"[Warning] Follow-up email LLM call failed ({e}). Using template fallback.")

        return self._follow_up_email_fallback(
            customer_name, customer_company, meeting_title, meeting_date,
            overview, key_points, decisions, next_steps, action_items,
        )

    @staticmethod
    def _follow_up_email_fallback(
        customer_name: str,
        customer_company: str,
        meeting_title: str,
        meeting_date: str,
        overview: str,
        key_points: List[str],
        decisions: List[str],
        next_steps: List[str],
        action_items: List[Dict[str, Any]],
    ) -> Dict[str, str]:
        """Deterministic template when LLM is unavailable."""
        first_name = customer_name.split()[0] if customer_name else "there"

        recap_lines = []
        if key_points:
            recap_lines.append("Key discussion points:")
            recap_lines.extend(f"  • {p}" for p in key_points[:5])
        if decisions:
            recap_lines.append("\nDecisions we aligned on:")
            recap_lines.extend(f"  • {d}" for d in decisions[:4])

        action_section = []
        if action_items:
            action_section.append("\nAction items:")
            for item in action_items:
                owner = str(item.get("owner", "SALESPERSON")).replace("_", " ").title()
                deadline = item.get("deadline") or "TBD"
                action_section.append(f"  • {item.get('title', 'Follow up')} — {owner} (by {deadline})")

        next_section = []
        if next_steps:
            next_section.append("\nProposed next steps:")
            next_section.extend(f"  • {s}" for s in next_steps[:5])

        body_parts = [
            f"Hi {first_name},",
            "",
            f"Thank you for taking the time to meet with us on {meeting_date}. "
            f"It was great discussing {meeting_title} with you and the {customer_company} team.",
            "",
        ]
        if overview:
            body_parts.extend([overview, ""])
        body_parts.extend(recap_lines)
        body_parts.extend(action_section)
        body_parts.extend(next_section)
        body_parts.extend([
            "",
            "Please let me know if I missed anything or if you'd like to adjust any of the above.",
            "",
            "Best regards,",
            "[Your Name]",
        ])

        return {
            "subject": f"Follow-up: {meeting_title} — {customer_company}",
            "body": "\n".join(body_parts),
            "toName": customer_name,
        }

