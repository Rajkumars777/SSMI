"""
Meeting Summarizer — SSMI
===========================
Uses Qwen2.5:14b (via Ollama/vLLM) to extract structured intelligence from
meeting transcripts and generate professional follow-up emails.

Two-stage design:
  1. LLM path  : Calls Qwen2.5:14b via the OpenAI-compatible Ollama API to
                 produce a rich, context-aware JSON summary.
  2. Fallback  : If Ollama is unreachable or the call fails, a deterministic
                 transcript-analysis fallback extracts key points, decisions,
                 and action items directly from the timeline events.

Environment variables:
  VLLM_ENDPOINT      : Ollama/vLLM base URL (default: http://localhost:11434/v1)
  VLLM_MODEL_NAME    : Model to call (default: qwen2.5:14b)
  SUMMARIZER_TIMEOUT : HTTP timeout in seconds (default: 120)
"""

import json
import os
import re
import socket
from typing import Any, Dict, List

from pydantic import BaseModel, Field

from services.api.fastapi.database.models import EventType, PurchaseIntent, SentimentType

# ---------------------------------------------------------------------------
# Optional OpenAI client (used to talk to the Ollama OpenAI-compat API)
# ---------------------------------------------------------------------------
try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

# How long to wait for the LLM before falling back to deterministic output.
# 120 seconds gives the 14B model on CPU enough time for its first token.
SUMMARIZER_TIMEOUT = int(os.getenv("SUMMARIZER_TIMEOUT", "120"))


# ---------------------------------------------------------------------------
# Connectivity helper
# ---------------------------------------------------------------------------

def _ollama_is_reachable(endpoint: str, probe_timeout: float = 3.0) -> bool:
    """
    Quick TCP probe to check if Ollama/vLLM is actually listening.

    Avoids wasting 120 seconds on a connection timeout when the server
    is simply not running — fails fast and falls back to deterministic output.
    """
    try:
        from urllib.parse import urlparse
        parsed = urlparse(endpoint)
        host   = parsed.hostname or "localhost"
        port   = parsed.port or 80
        with socket.create_connection((host, port), timeout=probe_timeout):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Pydantic schemas for LLM output validation
# ---------------------------------------------------------------------------

class ActionItemSchema(BaseModel):
    """Schema for a single action item returned by the LLM."""
    title:       str
    description: str  = ""
    owner:       str  = "SALESPERSON"
    deadline:    str  = "TBD"
    priority:    str  = "high"


class SummaryOutputSchema(BaseModel):
    """Schema for the full structured meeting summary returned by the LLM."""
    objective:         str
    overview:          str
    key_points:        List[str]           = Field(default_factory=list)
    decisions:         List[str]           = Field(default_factory=list)
    risks:             List[str]           = Field(default_factory=list)
    customer_sentiment: str                = "positive"
    purchase_intent:   str                 = "very_high"
    next_steps:        List[str]           = Field(default_factory=list)
    action_items:      List[ActionItemSchema] = Field(default_factory=list)


class FollowUpEmailOutputSchema(BaseModel):
    """Schema for the follow-up email returned by the LLM."""
    subject: str
    body:    str
    to_name: str = ""


# ---------------------------------------------------------------------------
# Main summarizer class
# ---------------------------------------------------------------------------

class QwenSummarizer:
    """
    Generates structured meeting summaries and follow-up emails using Qwen 14B.

    Connects to Ollama via the OpenAI-compatible /v1/chat/completions endpoint.
    Falls back to deterministic logic if Ollama is unavailable.
    """

    def __init__(self, vllm_endpoint: str = None):
        self.vllm_endpoint = vllm_endpoint or os.getenv("VLLM_ENDPOINT", "http://localhost:11434/v1")
        self.model_name    = os.getenv("VLLM_MODEL_NAME", "qwen2.5:14b")
        self.client        = None

        if HAS_OPENAI:
            try:
                # Pass explicit timeout so we never hang waiting for Ollama
                self.client = OpenAI(
                    base_url = self.vllm_endpoint,
                    api_key  = "not-needed",   # Ollama does not require auth
                    timeout  = SUMMARIZER_TIMEOUT,
                )
            except Exception as e:
                print(f"[Warning] Could not initialize OpenAI client ({e})")

    def generate_summary_and_actions(
        self,
        customer_name:      str,
        customer_company:   str,
        transcript_segments: List[Dict[str, Any]],
        timeline_events:    List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Generate a structured meeting summary and action items.

        Tries Qwen2.5:14b via Ollama first; falls back to deterministic
        transcript analysis if LLM is unavailable or fails.

        Args:
          customer_name      : Full name of the customer.
          customer_company   : Customer's company name.
          transcript_segments: List of {speaker, text} dicts from STT/diarizer.
          timeline_events    : List of detected business events from TimelineEngine.

        Returns:
          Dict with keys 'summary' (dict) and 'action_items' (list of dicts).
        """
        # Build the full transcript text for the LLM prompt
        full_transcript = "\n".join(
            f"{s.get('speaker', 'UNKNOWN')}: {s.get('text', '')}"
            for s in transcript_segments
        )

        # ── LLM path ─────────────────────────────────────────────────────────
        if self.client is not None:
            if not _ollama_is_reachable(self.vllm_endpoint, probe_timeout=3.0):
                print(f"[Summarizer] Ollama/vLLM not reachable at {self.vllm_endpoint} — using deterministic fallback.")
            else:
                try:
                    # System prompt instructs the model to output only valid JSON
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
                        model       = self.model_name,
                        messages    = [
                            {"role": "system", "content": system_prompt},
                            {"role": "user",   "content": user_prompt},
                        ],
                        temperature = 0.1,       # Low temperature for more deterministic output
                        # Note: response_format is NOT passed — Ollama's OpenAI-compat
                        # layer doesn't support json_object mode; JSON is enforced via
                        # the system prompt instead.
                        timeout     = SUMMARIZER_TIMEOUT,
                    )

                    # Parse the raw response — handle both raw JSON and markdown code blocks
                    raw_content = response.choices[0].message.content or ""
                    json_match  = re.search(r"(\{[\s\S]*\})", raw_content)
                    if json_match:
                        clean_content = json_match.group(1)
                    else:
                        clean_content = re.sub(r"^```json\s*|\s*```$", "", raw_content.strip(), flags=re.MULTILINE)

                    parsed_data = SummaryOutputSchema.model_validate(json.loads(clean_content))

                    # Map string values from the LLM back to our enum types
                    sentiment_map = {
                        "positive": SentimentType.POSITIVE,
                        "neutral":  SentimentType.NEUTRAL,
                        "negative": SentimentType.NEGATIVE,
                        "mixed":    SentimentType.MIXED,
                    }
                    intent_map = {
                        "very_high": PurchaseIntent.VERY_HIGH,
                        "high":      PurchaseIntent.HIGH,
                        "medium":    PurchaseIntent.MEDIUM,
                        "low":       PurchaseIntent.LOW,
                        "none":      PurchaseIntent.NONE,
                    }

                    summary = {
                        "objective":          parsed_data.objective,
                        "overview":           parsed_data.overview,
                        "key_points":         parsed_data.key_points,
                        "decisions":          parsed_data.decisions,
                        "risks":              parsed_data.risks,
                        "customer_sentiment": sentiment_map.get(str(parsed_data.customer_sentiment).lower(), SentimentType.POSITIVE),
                        "purchase_intent":    intent_map.get(str(parsed_data.purchase_intent).lower(), PurchaseIntent.VERY_HIGH),
                        "next_steps":         parsed_data.next_steps,
                    }

                    # Assign evidence timestamps linearly (LLM doesn't know exact timestamps)
                    action_items = [
                        {
                            "title":              act.title,
                            "description":        act.description,
                            "owner":              act.owner,
                            "deadline":           act.deadline,
                            "confidence":         0.95,
                            "evidence_timestamp": 60.0 * (idx + 1),
                            "priority":           act.priority,
                            "completed":          False,
                        }
                        for idx, act in enumerate(parsed_data.action_items)
                    ]

                    print("[Summarizer] Successfully extracted intelligence with Qwen 14B!")
                    return {"summary": summary, "action_items": action_items}

                except Exception as e:
                    print(f"[Warning] LLM summarization call failed ({e}). Using transcript intelligence fallback.")

        # ── Deterministic fallback ────────────────────────────────────────────
        return self._deterministic_summary(
            customer_name, customer_company, full_transcript, transcript_segments, timeline_events
        )

    @staticmethod
    def _deterministic_summary(
        customer_name:      str,
        customer_company:   str,
        full_transcript:    str,
        transcript_segments: List[Dict[str, Any]],
        timeline_events:    List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Build a summary from transcript text and timeline events — no LLM required.

        Extracts sentiment and purchase intent from simple keyword matching,
        uses the first few transcript segments as key points, and derives
        action items from DECISION/COMMITMENT/ACTION_ITEM timeline events.
        """
        full_lower = full_transcript.lower()

        # Sentiment: keyword signals override the default POSITIVE
        sentiment = SentimentType.POSITIVE
        intent    = PurchaseIntent.HIGH

        if any(w in full_lower for w in ("too expensive", "doubt", "concern", "worried", "risk")):
            sentiment = SentimentType.MIXED
        if any(w in full_lower for w in ("not interested", "no budget", "cancel")):
            intent    = PurchaseIntent.LOW
            sentiment = SentimentType.NEGATIVE
        if any(w in full_lower for w in ("sign this month", "ready to buy", "purchase", "go ahead")):
            intent = PurchaseIntent.VERY_HIGH

        # Use the first 6 non-trivial transcript segments as key points
        extracted_key_points = [
            seg["text"].strip()
            for seg in transcript_segments
            if len(seg.get("text", "").strip()) > 20
        ][:6]

        if not extracted_key_points:
            # Nothing useful in the transcript — produce minimal but valid output
            extracted_key_points = [
                f"Discussion with {customer_name} from {customer_company}",
                "Review of requirements, pricing, and next steps",
            ]
            sentiment = SentimentType.NEUTRAL
            intent    = PurchaseIntent.MEDIUM

        # Extract decisions and risks from timeline events
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
            "key_points":         extracted_key_points,
            "decisions":          extracted_decisions or ["No explicit decisions captured — review transcript for commitments."],
            "risks":              extracted_risks or ["No major risks flagged in transcript."],
            "customer_sentiment": sentiment,
            "purchase_intent":    intent,
            "next_steps": [
                "Review extracted action items and assign owners",
                "Follow up with customer on open pricing or timeline questions",
            ],
        }

        # Build action items from timeline events of actionable types
        action_items = [
            {
                "title":              evt.get("title", "Follow up on discussion point"),
                "description":        evt.get("description", ""),
                "owner":              evt.get("speaker", "SALESPERSON"),
                "deadline":           "TBD",
                "confidence":         float(evt.get("confidence", 0.9)),
                "evidence_timestamp": float(evt.get("start_time", 60.0 * (idx + 1))),
                "priority":           "high" if evt.get("importance", 3) >= 4 else "medium",
                "completed":          False,
            }
            for idx, evt in enumerate(timeline_events[:5])
            if evt.get("type") in (EventType.ACTION_ITEM, EventType.COMMITMENT, EventType.DECISION)
        ]

        # Always ensure at least one action item
        if not action_items:
            action_items = [{
                "title":              f"Send follow-up summary to {customer_name}",
                "description":        "Share meeting recap and proposed next steps.",
                "owner":              "SALESPERSON",
                "deadline":           "TBD",
                "confidence":         0.9,
                "evidence_timestamp": 60.0,
                "priority":           "medium",
                "completed":          False,
            }]

        return {"summary": summary, "action_items": action_items}

    def generate_follow_up_email(
        self,
        customer_name:   str,
        customer_company: str,
        meeting_title:   str,
        meeting_date:    str,
        summary:         Dict[str, Any],
        action_items:    List[Dict[str, Any]],
    ) -> Dict[str, str]:
        """
        Generate a professional post-meeting follow-up email.

        Tries Qwen2.5:14b via Ollama for a contextually rich email.
        Falls back to a well-structured template if LLM is unavailable.

        Returns:
          Dict with keys {subject, body, toName}.
        """
        key_points = summary.get("key_points") or summary.get("keyPoints") or []
        decisions  = summary.get("decisions") or []
        next_steps = summary.get("next_steps") or summary.get("nextSteps") or []
        overview   = summary.get("overview") or ""

        # Format action items for the prompt context block
        action_lines = [
            f"- {item.get('title', '')} (Owner: {str(item.get('owner', 'SALESPERSON')).replace('_', ' ').title()}, Due: {item.get('deadline') or 'TBD'})"
            + (f" — {item.get('description', '')}" if item.get("description") else "")
            for item in action_items
        ]

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

        # ── LLM path ─────────────────────────────────────────────────────────
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
                    model       = self.model_name,
                    messages    = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": context_block},
                    ],
                    temperature = 0.3,      # Slightly higher for natural-sounding prose
                    timeout     = SUMMARIZER_TIMEOUT,
                )

                raw_content = response.choices[0].message.content or ""
                json_match  = re.search(r"(\{[\s\S]*\})", raw_content)
                if json_match:
                    clean_content = json_match.group(1)
                else:
                    clean_content = re.sub(r"^```json\s*|\s*```$", "", raw_content.strip(), flags=re.MULTILINE)

                parsed_data = FollowUpEmailOutputSchema.model_validate(json.loads(clean_content))
                print("[Summarizer] Generated follow-up email with Qwen 14B!")
                return {
                    "subject": parsed_data.subject.strip(),
                    "body":    parsed_data.body.strip(),
                    "toName":  parsed_data.to_name.strip() or customer_name,
                }

            except Exception as e:
                print(f"[Warning] Follow-up email LLM call failed ({e}). Using template fallback.")

        # ── Template fallback ─────────────────────────────────────────────────
        return QwenSummarizer._follow_up_email_fallback(
            customer_name, customer_company, meeting_title, meeting_date,
            overview, key_points, decisions, next_steps, action_items,
        )

    @staticmethod
    def _follow_up_email_fallback(
        customer_name:   str,
        customer_company: str,
        meeting_title:   str,
        meeting_date:    str,
        overview:        str,
        key_points:      List[str],
        decisions:       List[str],
        next_steps:      List[str],
        action_items:    List[Dict[str, Any]],
    ) -> Dict[str, str]:
        """
        Build a professional follow-up email from a deterministic template.

        Used when Ollama is unavailable or the LLM call fails. Produces a
        well-structured email without any AI — guaranteed to always succeed.
        """
        first_name = customer_name.split()[0] if customer_name else "there"

        # Build the meeting recap section
        recap_lines: List[str] = []
        if key_points:
            recap_lines.append("Key discussion points:")
            recap_lines.extend(f"  • {p}" for p in key_points[:5])
        if decisions:
            recap_lines.append("\nDecisions we aligned on:")
            recap_lines.extend(f"  • {d}" for d in decisions[:4])

        # Build the action items section
        action_section: List[str] = []
        if action_items:
            action_section.append("\nAction items:")
            for item in action_items:
                owner    = str(item.get("owner", "SALESPERSON")).replace("_", " ").title()
                deadline = item.get("deadline") or "TBD"
                action_section.append(f"  • {item.get('title', 'Follow up')} — {owner} (by {deadline})")

        # Build the next steps section
        next_section: List[str] = []
        if next_steps:
            next_section.append("\nProposed next steps:")
            next_section.extend(f"  • {s}" for s in next_steps[:5])

        # Assemble the full email body
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
            "body":    "\n".join(body_parts),
            "toName":  customer_name,
        }
