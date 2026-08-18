"""
Meetings Router — SSMI
======================
Handles the full lifecycle of a meeting: creation, audio upload, AI processing,
live meeting finalization, status polling, and follow-up email generation.

AI Pipeline (audio upload path):
  1. Unload Ollama/Qwen from VRAM  (~4 GB freed)
  2. Run Whisper STT               (~3 GB peak, then unloaded)
  3. Run Speaker Diarization        (heuristic fallback; pyannote optional)
  4. Save Transcript + Timeline to DB  (UI can start rendering immediately)
  5. Reload Ollama/Qwen and summarize  (action items + structured summary)

All pipeline steps run in a background task so the HTTP response is returned
immediately with status=processing.
"""

import os
import uuid
import asyncio
import traceback
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..routing import CamelCaseAPIRoute
from ..database.db import get_db, async_session_maker
from ..database.models import (
    Meeting,
    MeetingStatus,
    ProcessingMode,
    TranscriptSegment,
    MeetingEvent,
    ActionItem,
    MeetingSummary,
    Embedding,
    SpeakerType,
    SentimentType,
    PurchaseIntent,
    EventType,
)
from ..schemas import (
    MeetingCreateSchema,
    MeetingResponseSchema,
    ActionItemSchema,
    MeetingSummarySchema,
    DashboardStatsSchema,
    FinalizeLiveMeetingSchema,
    FollowUpEmailSchema,
)
from services.transcription.stt import transcribe_audio, TranscriptionError, pick_model_for_vram
from services.transcription.audio_utils import prepare_audio_for_whisper, ffmpeg_available
from services.diarization.diarizer import SpeakerDiarizer
from services.intelligence.timeline_engine import TimelineEngine
from services.summarization.summarizer import QwenSummarizer
from services.gpu_manager import (
    unload_ollama_model,
    reload_ollama_model,
    flush_cuda,
    vram_free_mb,
    _PIPELINE_LOCK,
    request_pipeline_cancel,
    clear_pipeline_cancel,
    is_pipeline_cancelled,
    PipelineCancelled,
)


# ---------------------------------------------------------------------------
# Router setup
# ---------------------------------------------------------------------------

router = APIRouter(
    prefix="/api/meetings",
    tags=["meetings"],
    route_class=CamelCaseAPIRoute,
)

# Directory where uploaded audio files are persisted
AUDIO_STORAGE_DIR = "storage/audio"
os.makedirs(AUDIO_STORAGE_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Constants loaded from environment
# ---------------------------------------------------------------------------

# Whisper model names — large-v3-turbo for accurate mode, small for fast mode
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL_NAME", "large-v3-turbo")
WHISPER_FAST_MODEL = os.getenv("WHISPER_FAST_MODEL", "small")

# Ollama/vLLM endpoint and model for Qwen summarization
OLLAMA_ENDPOINT = os.getenv("VLLM_ENDPOINT", "http://localhost:11434/v1").replace("/v1", "")
OLLAMA_MODEL    = os.getenv("VLLM_MODEL_NAME", "qwen2.5:14b")


# ---------------------------------------------------------------------------
# Audio MIME type helpers
# ---------------------------------------------------------------------------

# Maps file extensions to their correct MIME types for FileResponse streaming
_AUDIO_MEDIA_TYPES = {
    ".mp3":  "audio/mpeg",
    ".wav":  "audio/wav",
    ".m4a":  "audio/mp4",
    ".aac":  "audio/aac",
    ".ogg":  "audio/ogg",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
    ".mp4":  "audio/mp4",
    ".wma":  "audio/x-ms-wma",
}


def _audio_media_type(path: str) -> str:
    """Return the correct MIME type for the given audio file path."""
    ext = os.path.splitext(path)[1].lower()
    return _AUDIO_MEDIA_TYPES.get(ext, "application/octet-stream")


# ---------------------------------------------------------------------------
# Whisper model selection
# ---------------------------------------------------------------------------

def _whisper_model_for_mode(mode: ProcessingMode, free_vram_mb: int = -1) -> str:
    """
    Choose the Whisper model variant based on processing mode and available VRAM.

    Falls back to a smaller model automatically when VRAM is insufficient for
    the requested model.
    """
    requested = WHISPER_FAST_MODEL if mode == ProcessingMode.FAST else WHISPER_MODEL_NAME
    return pick_model_for_vram(requested, free_vram_mb)


# ---------------------------------------------------------------------------
# Singleton summarizer (HTTP client only — no VRAM, safe to reuse)
# ---------------------------------------------------------------------------

_summarizer: "QwenSummarizer | None" = None


def _get_summarizer() -> "QwenSummarizer":
    """Return a shared QwenSummarizer instance, creating it on first call."""
    global _summarizer
    if _summarizer is None:
        _summarizer = QwenSummarizer()
    return _summarizer


# ---------------------------------------------------------------------------
# Pipeline cancellation helpers
# ---------------------------------------------------------------------------

def _check_pipeline_cancelled(meeting_id: str) -> None:
    """Raise PipelineCancelled if the user has requested cancellation."""
    if is_pipeline_cancelled(meeting_id):
        raise PipelineCancelled("Processing cancelled by user")


async def _mark_meeting_cancelled(meeting_id: str) -> None:
    """Update meeting status to FAILED with a 'cancelled by user' message."""
    async with async_session_maker() as db:
        result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        meeting = result.scalar_one_or_none()
        if meeting and meeting.status == MeetingStatus.PROCESSING:
            meeting.status = MeetingStatus.FAILED
            meeting.processing_error = "Processing cancelled by user"
            await db.commit()


# ---------------------------------------------------------------------------
# Background task schedulers
# ---------------------------------------------------------------------------

def _schedule_pipeline(background_tasks: BackgroundTasks, meeting_id: str, file_path: str) -> None:
    """Queue the full audio AI pipeline (Whisper → Diarization → Summary) as a background task."""
    clear_pipeline_cancel(meeting_id)
    background_tasks.add_task(_run_ai_pipeline, meeting_id, file_path)


def _schedule_intelligence_pipeline(
    background_tasks: BackgroundTasks,
    meeting_id: str,
    segments: list,
    duration: float,
    bookmarks: Optional[list] = None,
) -> None:
    """Queue the intelligence-only pipeline (no Whisper) for live browser recordings."""
    clear_pipeline_cancel(meeting_id)
    background_tasks.add_task(
        _run_intelligence_pipeline,
        meeting_id,
        segments,
        duration,
        bookmarks or [],
    )


# ---------------------------------------------------------------------------
# Speaker / type coercion helpers
# ---------------------------------------------------------------------------

def _live_speaker_to_db(speaker: str) -> SpeakerType:
    """Map loose live-transcript speaker strings to the strict SpeakerType enum."""
    s = str(speaker or "").upper()
    if s in ("SPEAKER_2", "CUSTOMER", "CLIENT"):
        return SpeakerType.CUSTOMER
    if s in ("SPEAKER_1", "SALESPERSON", "SALES", "AGENT"):
        return SpeakerType.SALESPERSON
    return SpeakerType.UNKNOWN


def safe_speaker_type(val: Any) -> SpeakerType:
    """Safely coerce any value to SpeakerType, defaulting to SALESPERSON."""
    if isinstance(val, SpeakerType):
        return val
    s = str(val).upper().strip() if val else ""
    if "CUST" in s or "CLIENT" in s or s == "SPEAKER_2":
        return SpeakerType.CUSTOMER
    if s == "UNKNOWN" or not s:
        return SpeakerType.UNKNOWN
    return SpeakerType.SALESPERSON


def safe_sentiment_type(val: Any) -> SentimentType:
    """Safely coerce any value to SentimentType, defaulting to NEUTRAL."""
    if isinstance(val, SentimentType):
        return val
    s = str(val).lower() if val else ""
    if "pos" in s:
        return SentimentType.POSITIVE
    if "neg" in s:
        return SentimentType.NEGATIVE
    if "mix" in s:
        return SentimentType.MIXED
    return SentimentType.NEUTRAL


def safe_purchase_intent(val: Any) -> Optional[PurchaseIntent]:
    """Safely coerce any value to PurchaseIntent, defaulting to HIGH."""
    if not val:
        return PurchaseIntent.HIGH
    if isinstance(val, PurchaseIntent):
        return val
    s = str(val).lower()
    if "very_high" in s or "very high" in s:
        return PurchaseIntent.VERY_HIGH
    if "high" in s:
        return PurchaseIntent.HIGH
    if "low" in s:
        return PurchaseIntent.LOW
    if "none" in s:
        return PurchaseIntent.NONE
    return PurchaseIntent.MEDIUM


def safe_event_type(val: Any) -> EventType:
    """Safely coerce any value to EventType, defaulting to COMMITMENT."""
    if isinstance(val, EventType):
        return val
    s = str(val).upper() if val else ""
    for et in EventType:
        if et.value == s:
            return et
    return EventType.COMMITMENT


# ---------------------------------------------------------------------------
# Live transcript conversion
# ---------------------------------------------------------------------------

def _segments_from_live_transcript(lines: list, duration: float) -> list:
    """
    Convert browser Web Speech API transcript lines into pipeline segment dicts.

    Infers end timestamps from the next segment's start time. The final
    segment's end time is set to the total meeting duration.
    """
    if not lines:
        return []

    segments = []
    for i, line in enumerate(lines):
        start = float(line.get("start_time", line.get("startTime", 0.0)))

        # End time: use next segment's start, or duration for the last segment
        if i + 1 < len(lines):
            next_start = float(
                lines[i + 1].get("start_time", lines[i + 1].get("startTime", start + 5.0))
            )
            end = max(start + 1.0, next_start)
        else:
            end = max(start + 2.0, float(duration))

        segments.append({
            "speaker":    _live_speaker_to_db(line.get("speaker", "UNKNOWN")).value,
            "start_time": start,
            "end_time":   end,
            "text":       str(line.get("text", "")).strip(),
            "confidence": 0.95,
        })

    # Drop segments with empty text
    return [s for s in segments if s["text"]]


# ===========================================================================
# API Endpoints
# ===========================================================================

@router.post("", response_model=MeetingResponseSchema, status_code=status.HTTP_201_CREATED, response_model_by_alias=False)
async def create_meeting(
    payload: MeetingCreateSchema,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new meeting session in RECORDING state.

    The meeting has no audio yet — audio is uploaded separately via POST /{id}/audio.
    """
    meeting_id = f"meeting_{uuid.uuid4().hex[:8]}"

    # Auto-generate a title if none was provided
    if payload.title and payload.title.strip():
        title = payload.title.strip()
    elif payload.customerCompany:
        title = f"Discussion — {payload.customerCompany}"
    else:
        title = f"Meeting with {payload.customerName}"

    meeting = Meeting(
        id               = meeting_id,
        title            = title,
        customer_name    = payload.customerName,
        customer_company = payload.customerCompany or "Company",
        processing_mode  = ProcessingMode(payload.processingMode.value) if payload.processingMode else ProcessingMode.ACCURATE,
        status           = MeetingStatus.RECORDING,
        date             = datetime.now(timezone.utc),
        duration         = 0.0,
        tags             = [],
    )

    db.add(meeting)
    await db.commit()

    # Re-fetch with all related data so the response schema has everything it needs
    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    return result.scalar_one()


# ---------------------------------------------------------------------------
# Full AI pipeline (audio file path)
# ---------------------------------------------------------------------------

async def _run_ai_pipeline(meeting_id: str, file_path: str):
    """
    Acquire the global pipeline lock and run _run_ai_pipeline_locked.

    Retries once if another pipeline is already running. Cancels gracefully
    if the user requests cancellation via the /cancel endpoint.
    """
    if not _PIPELINE_LOCK.acquire(blocking=False):
        print(f"[Pipeline] Another pipeline is running — {meeting_id} queued for retry.")
        await asyncio.sleep(2)
        if not _PIPELINE_LOCK.acquire(blocking=False):
            # Could not acquire after retry — mark the meeting as failed
            print(f"[Pipeline] Could not acquire lock for {meeting_id}. Marking failed.")
            async with async_session_maker() as db:
                result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
                meeting = result.scalar_one_or_none()
                if meeting:
                    meeting.status = MeetingStatus.FAILED
                    await db.commit()
            return

    try:
        await _run_ai_pipeline_locked(meeting_id, file_path)
    except PipelineCancelled:
        print(f"[Pipeline] Cancelled by user: {meeting_id}")
        await _mark_meeting_cancelled(meeting_id)
    finally:
        clear_pipeline_cancel(meeting_id)
        _PIPELINE_LOCK.release()


async def _run_ai_pipeline_locked(meeting_id: str, file_path: str):
    """
    Core audio AI pipeline — runs with the global pipeline lock held.

    VRAM schedule (RTX 4050, 6 GB):
      [1] Unload Ollama/Qwen  → frees ~4 GB
      [2] Load + run Whisper  → ~3 GB peak, then unloaded
      [3] Diarizer heuristic  → 0 MB VRAM (pyannote optional)
      [4] Ollama reloads Qwen → ~4 GB for summarization
    """
    import time as _time
    t_pipeline_start = _time.time()

    async with async_session_maker() as db:
        try:
            # ── Step 0: Fetch meeting ─────────────────────────────────────────
            result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
            meeting = result.scalar_one_or_none()
            if not meeting:
                print(f"[Pipeline] Meeting {meeting_id} not found — aborting.")
                return

            meeting.status = MeetingStatus.PROCESSING
            await db.commit()

            _check_pipeline_cancelled(meeting_id)

            # ── Step 1: Unload Ollama so Whisper gets full VRAM ──────────────
            free_before = vram_free_mb()
            print(f"\n{'='*70}", flush=True)
            print(f" [STEP 1/4] STARTING AI PIPELINE FOR {meeting_id}", flush=True)
            print(f" VRAM Free Before Unload: {free_before} MB", flush=True)
            print(f"{'='*70}\n", flush=True)

            await asyncio.to_thread(unload_ollama_model, OLLAMA_ENDPOINT, OLLAMA_MODEL)
            free_after = vram_free_mb()
            print(f"[Pipeline] VRAM free after Ollama unload: {free_after} MB", flush=True)

            whisper_model = _whisper_model_for_mode(meeting.processing_mode, free_after)

            _check_pipeline_cancelled(meeting_id)

            # ── Step 2: Speech-to-Text (Whisper loads, transcribes, unloads) ─
            print(f"\n[Pipeline][STT] Running Whisper ({whisper_model}) on GPU CUDA float16...", flush=True)
            t0 = _time.time()
            segments_raw = await asyncio.to_thread(
                transcribe_audio, file_path, whisper_model, "en"
            )

            if not segments_raw:
                raise TranscriptionError("Transcription returned no segments.")

            stt_duration = _time.time() - t0
            sample_text  = segments_raw[0]["text"] if segments_raw else "N/A"

            print(f"\n{'='*70}", flush=True)
            print(f" [STEP 2/4 COMPLETE] SPEECH-TO-TEXT TRANSCRIPTION (Whisper)", flush=True)
            print(f" Model:      Whisper {whisper_model} (GPU CUDA float16)", flush=True)
            print(f" Time Taken: {stt_duration:.2f} seconds", flush=True)
            print(f" Segments:   {len(segments_raw)} transcript segments", flush=True)
            print(f" Sample:     \"{sample_text[:80]}...\"", flush=True)
            print(f"{'='*70}\n", flush=True)

            _check_pipeline_cancelled(meeting_id)

            # ── Step 3: Speaker Diarization ──────────────────────────────────
            # pyannote is optional — falls back to an instant heuristic aligner
            print(f"[Pipeline][DIAR] Running speaker diarization...", flush=True)
            t0 = _time.time()
            diarizer = SpeakerDiarizer()
            segments  = await asyncio.to_thread(diarizer.diarize_and_align, file_path, segments_raw)
            diar_duration = _time.time() - t0

            print(f"\n{'='*70}", flush=True)
            print(f" [STEP 3/4 COMPLETE] SPEAKER DIARIZATION", flush=True)
            print(f" Time Taken: {diar_duration:.2f} seconds", flush=True)
            print(f" Segments:   {len(segments)} segments preserved", flush=True)
            print(f"{'='*70}\n", flush=True)

            # ── Step 4a: Persist Transcript & Timeline (UI live view) ────────
            # Clear any stale data from previous pipeline runs
            await db.execute(delete(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting.id))
            await db.execute(delete(MeetingEvent).where(MeetingEvent.meeting_id == meeting.id))
            await db.execute(delete(ActionItem).where(ActionItem.meeting_id == meeting.id))
            await db.execute(delete(MeetingSummary).where(MeetingSummary.meeting_id == meeting.id))
            await db.commit()

            # Persist all transcript segments
            for seg in segments:
                db.add(TranscriptSegment(
                    id         = f"seg_{uuid.uuid4().hex[:12]}",
                    meeting_id = meeting.id,
                    speaker    = safe_speaker_type(seg.get("speaker")),
                    start_time = float(seg.get("start_time", 0.0)),
                    end_time   = float(seg.get("end_time", 0.0)),
                    text       = str(seg.get("text", "")),
                    confidence = float(seg.get("confidence", 0.95)),
                ))

            # Generate and persist timeline events
            print(f"[Pipeline][TIMELINE] Generating key timeline events...", flush=True)
            t0 = _time.time()
            timeline_events = TimelineEngine.generate_timeline(segments)
            for evt in timeline_events:
                db.add(MeetingEvent(
                    id             = f"evt_{uuid.uuid4().hex[:12]}",
                    meeting_id     = meeting.id,
                    type           = safe_event_type(evt.get("type")),
                    title          = str(evt.get("title", "Key Discussion Point")),
                    description    = str(evt.get("description", "")),
                    start_time     = float(evt.get("start_time", 0.0)),
                    end_time       = float(evt.get("end_time", 0.0)),
                    speaker        = safe_speaker_type(evt.get("speaker")),
                    importance     = int(evt.get("importance", 3)),
                    confidence     = float(evt.get("confidence", 0.95)),
                    evidence       = evt.get("evidence", []),
                    purchase_intent = safe_purchase_intent(evt.get("purchase_intent")),
                ))

            # Commit Stage 1 — transcript + timeline are now live in the DB for UI display
            await db.commit()
            print(
                f"[Pipeline] Transcript ({len(segments)} segs) & "
                f"Timeline ({len(timeline_events)} events) committed. UI live view active!\n",
                flush=True,
            )

            _check_pipeline_cancelled(meeting_id)

            # ── Step 4b: LLM Summarization ───────────────────────────────────
            print(f"[Pipeline][LLM] Pre-warming Ollama Qwen2.5-14B into VRAM...", flush=True)
            await asyncio.to_thread(reload_ollama_model, OLLAMA_ENDPOINT, OLLAMA_MODEL)

            print(f"[Pipeline][LLM] Generating AI summary & action items with Qwen2.5-14B...", flush=True)
            t0           = _time.time()
            summarizer   = _get_summarizer()
            summary_data = await asyncio.to_thread(
                summarizer.generate_summary_and_actions,
                meeting.customer_name, meeting.customer_company, segments, timeline_events,
            )
            llm_duration = _time.time() - t0

            # Persist the structured summary
            sum_dict = summary_data.get("summary", {})
            db.add(MeetingSummary(
                id                 = f"sum_{uuid.uuid4().hex[:12]}",
                meeting_id         = meeting.id,
                objective          = str(sum_dict.get("objective", f"Sales discussion with {meeting.customer_name}")),
                overview           = str(sum_dict.get("overview", "Productive customer discussion.")),
                key_points         = sum_dict.get("key_points", []),
                decisions          = sum_dict.get("decisions", []),
                risks              = sum_dict.get("risks", []),
                customer_sentiment = safe_sentiment_type(sum_dict.get("customer_sentiment")),
                purchase_intent    = safe_purchase_intent(sum_dict.get("purchase_intent")),
                next_steps         = sum_dict.get("next_steps", []),
            ))

            # Persist action items
            actions_list = summary_data.get("action_items", [])
            for act in actions_list:
                db.add(ActionItem(
                    id                 = f"act_{uuid.uuid4().hex[:12]}",
                    meeting_id         = meeting.id,
                    title              = str(act.get("title", "Action Item")),
                    description        = str(act.get("description", "")),
                    owner              = safe_speaker_type(act.get("owner")),
                    deadline           = act.get("deadline"),
                    confidence         = float(act.get("confidence", 0.95)),
                    evidence_timestamp = act.get("evidence_timestamp"),
                    priority           = str(act.get("priority", "medium")),
                    completed          = False,
                ))

            # ── Step 5: Mark meeting as COMPLETED ────────────────────────────
            meeting.status         = MeetingStatus.COMPLETED
            meeting.sentiment      = safe_sentiment_type(sum_dict.get("customer_sentiment"))
            meeting.purchase_intent = safe_purchase_intent(sum_dict.get("purchase_intent"))
            meeting.duration       = max(
                [float(s.get("end_time", 0.0)) for s in segments], default=300.0
            )
            await db.commit()

            # Print final summary to server logs
            total_duration = _time.time() - t_pipeline_start
            key_pts        = sum_dict.get("key_points", [])
            raw_sent       = sum_dict.get("customer_sentiment", "NEUTRAL")
            raw_intent     = sum_dict.get("purchase_intent", "MEDIUM")
            sent_str       = raw_sent.value if hasattr(raw_sent, "value") else str(raw_sent)
            intent_str     = raw_intent.value if hasattr(raw_intent, "value") else str(raw_intent)

            print(f"\n{'='*70}", flush=True)
            print(f" [STEP 4/4 COMPLETE] QWEN 14B AI INTELLIGENCE EXTRACTION", flush=True)
            print(f" Time Taken:  {llm_duration:.2f} seconds", flush=True)
            print(f" Objective:   {sum_dict.get('objective', 'N/A')}", flush=True)
            print(f" Sentiment:   {sent_str}", flush=True)
            print(f" Intent:      {intent_str}", flush=True)
            print(f" Key Points:  {len(key_pts)} points extracted", flush=True)
            print(f" Actions:     {len(actions_list)} action items assigned", flush=True)
            for idx_a, act_item in enumerate(actions_list, 1):
                owner     = act_item.get("owner", "SALESPERSON")
                owner_str = owner.value if hasattr(owner, "value") else str(owner)
                print(f"   {idx_a}. [{owner_str}] {act_item.get('title', '')}", flush=True)
            print(f"{'='*70}", flush=True)
            print(f" ALL PIPELINE STAGES COMPLETED IN {total_duration:.1f} SECONDS", flush=True)
            print(f"{'='*70}\n", flush=True)

        except PipelineCancelled:
            raise  # Let the outer wrapper handle cancellation cleanup

        except TranscriptionError as e:
            # Whisper-specific failure — common cause: no speech in audio
            print(f"[Pipeline] TRANSCRIPTION FAILED for {meeting_id}: {e}")
            try:
                result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
                meeting = result.scalar_one_or_none()
                if meeting:
                    meeting.status = MeetingStatus.FAILED
                    meeting.processing_error = str(e)
                    await db.commit()
            except Exception:
                pass

        except Exception as e:
            # Unexpected pipeline failure
            print(f"[Pipeline] FAILED for {meeting_id}: {e}")
            traceback.print_exc()
            try:
                result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
                meeting = result.scalar_one_or_none()
                if meeting:
                    meeting.status = MeetingStatus.FAILED
                    meeting.processing_error = str(e)
                    await db.commit()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Intelligence-only pipeline (live browser recordings — no Whisper)
# ---------------------------------------------------------------------------

async def _run_intelligence_pipeline(
    meeting_id: str,
    segments: list,
    duration: float,
    bookmarks: list,
):
    """
    Acquire the global pipeline lock and run the intelligence pipeline.

    Used for live meetings recorded in the browser — skips Whisper entirely
    and runs timeline + Qwen summarization on the Web Speech API transcript.
    """
    if not _PIPELINE_LOCK.acquire(blocking=False):
        print(f"[Pipeline] Another pipeline is running — {meeting_id} intelligence queued for retry.")
        await asyncio.sleep(2)
        if not _PIPELINE_LOCK.acquire(blocking=False):
            print(f"[Pipeline] Could not acquire lock for {meeting_id}. Marking failed.")
            async with async_session_maker() as db:
                result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
                meeting = result.scalar_one_or_none()
                if meeting:
                    meeting.status = MeetingStatus.FAILED
                    meeting.processing_error = "Another pipeline is already running"
                    await db.commit()
            return

    try:
        await _run_intelligence_pipeline_locked(meeting_id, segments, duration, bookmarks)
    except PipelineCancelled:
        print(f"[Pipeline] Cancelled by user: {meeting_id}")
        await _mark_meeting_cancelled(meeting_id)
    finally:
        clear_pipeline_cancel(meeting_id)
        _PIPELINE_LOCK.release()


async def _run_intelligence_pipeline_locked(
    meeting_id: str,
    segments: list,
    duration: float,
    bookmarks: list,
):
    """
    Timeline + Qwen summarization from live transcript — skips Whisper entirely.

    Steps:
      1. Validate segments exist
      2. Clear any stale DB data for this meeting
      3. Persist transcript segments + timeline events
      4. Run Qwen summarization and persist summary + action items
      5. Mark meeting as COMPLETED
    """
    import time as _time
    t_pipeline_start = _time.time()

    async with async_session_maker() as db:
        try:
            # Fetch meeting record
            result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
            meeting = result.scalar_one_or_none()
            if not meeting:
                print(f"[Pipeline] Meeting {meeting_id} not found — aborting.")
                return

            # Bail early if there's nothing to process
            if not segments:
                meeting.status = MeetingStatus.FAILED
                meeting.processing_error = "No live transcript to analyze"
                await db.commit()
                return

            meeting.status = MeetingStatus.PROCESSING
            meeting.processing_error = None
            await db.commit()

            _check_pipeline_cancelled(meeting_id)

            print(f"\n{'='*70}", flush=True)
            print(f" [LIVE INTELLIGENCE] STARTING FOR {meeting_id} (Whisper skipped)", flush=True)
            print(f" Segments: {len(segments)} | Duration: {duration:.0f}s", flush=True)
            print(f"{'='*70}\n", flush=True)

            # Clear any previous results for this meeting
            await db.execute(delete(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting.id))
            await db.execute(delete(MeetingEvent).where(MeetingEvent.meeting_id == meeting.id))
            await db.execute(delete(ActionItem).where(ActionItem.meeting_id == meeting.id))
            await db.execute(delete(MeetingSummary).where(MeetingSummary.meeting_id == meeting.id))
            await db.commit()

            # Persist live transcript segments
            for seg in segments:
                db.add(TranscriptSegment(
                    id         = f"seg_{uuid.uuid4().hex[:12]}",
                    meeting_id = meeting.id,
                    speaker    = safe_speaker_type(seg.get("speaker")),
                    start_time = float(seg.get("start_time", 0.0)),
                    end_time   = float(seg.get("end_time", 0.0)),
                    text       = str(seg.get("text", "")),
                    confidence = float(seg.get("confidence", 0.95)),
                ))

            # Generate timeline events — pass bookmarks so voice-marked moments are included
            print(f"[Pipeline][TIMELINE] Generating key timeline events from live transcript...", flush=True)
            t0 = _time.time()
            timeline_events = TimelineEngine.generate_timeline(segments, bookmarks=bookmarks)
            for evt in timeline_events:
                db.add(MeetingEvent(
                    id             = f"evt_{uuid.uuid4().hex[:12]}",
                    meeting_id     = meeting.id,
                    type           = safe_event_type(evt.get("type")),
                    title          = str(evt.get("title", "Key Discussion Point")),
                    description    = str(evt.get("description", "")),
                    start_time     = float(evt.get("start_time", 0.0)),
                    end_time       = float(evt.get("end_time", 0.0)),
                    speaker        = safe_speaker_type(evt.get("speaker")),
                    importance     = int(evt.get("importance", 3)),
                    confidence     = float(evt.get("confidence", 0.95)),
                    evidence       = evt.get("evidence", []),
                    purchase_intent = safe_purchase_intent(evt.get("purchase_intent")),
                ))

            await db.commit()
            print(
                f"[Pipeline] Live transcript ({len(segments)} segs) & "
                f"Timeline ({len(timeline_events)} events) committed.\n",
                flush=True,
            )

            _check_pipeline_cancelled(meeting_id)

            # LLM summarization
            print(f"[Pipeline][LLM] Pre-warming Ollama Qwen2.5-14B into VRAM...", flush=True)
            await asyncio.to_thread(reload_ollama_model, OLLAMA_ENDPOINT, OLLAMA_MODEL)

            print(f"[Pipeline][LLM] Generating AI summary & action items with Qwen2.5-14B...", flush=True)
            t0           = _time.time()
            summarizer   = _get_summarizer()
            summary_data = await asyncio.to_thread(
                summarizer.generate_summary_and_actions,
                meeting.customer_name, meeting.customer_company, segments, timeline_events,
            )
            llm_duration = _time.time() - t0

            # Persist summary
            sum_dict = summary_data.get("summary", {})
            db.add(MeetingSummary(
                id                 = f"sum_{uuid.uuid4().hex[:12]}",
                meeting_id         = meeting.id,
                objective          = str(sum_dict.get("objective", f"Sales discussion with {meeting.customer_name}")),
                overview           = str(sum_dict.get("overview", "Productive customer discussion.")),
                key_points         = sum_dict.get("key_points", []),
                decisions          = sum_dict.get("decisions", []),
                risks              = sum_dict.get("risks", []),
                customer_sentiment = safe_sentiment_type(sum_dict.get("customer_sentiment")),
                purchase_intent    = safe_purchase_intent(sum_dict.get("purchase_intent")),
                next_steps         = sum_dict.get("next_steps", []),
            ))

            # Persist action items
            actions_list = summary_data.get("action_items", [])
            for act in actions_list:
                db.add(ActionItem(
                    id                 = f"act_{uuid.uuid4().hex[:12]}",
                    meeting_id         = meeting.id,
                    title              = str(act.get("title", "Action Item")),
                    description        = str(act.get("description", "")),
                    owner              = safe_speaker_type(act.get("owner")),
                    deadline           = act.get("deadline"),
                    confidence         = float(act.get("confidence", 0.95)),
                    evidence_timestamp = act.get("evidence_timestamp"),
                    priority           = str(act.get("priority", "medium")),
                    completed          = False,
                ))

            # Mark meeting as completed
            meeting.status          = MeetingStatus.COMPLETED
            meeting.sentiment       = safe_sentiment_type(sum_dict.get("customer_sentiment"))
            meeting.purchase_intent = safe_purchase_intent(sum_dict.get("purchase_intent"))
            meeting.duration        = max(
                float(duration),
                max([float(s.get("end_time", 0.0)) for s in segments], default=0.0),
            )
            await db.commit()

            total_duration = _time.time() - t_pipeline_start
            print(f"\n{'='*70}", flush=True)
            print(f" [LIVE INTELLIGENCE COMPLETE] {meeting_id} in {total_duration:.1f}s", flush=True)
            print(f" LLM time: {llm_duration:.2f}s | Actions: {len(actions_list)}", flush=True)
            print(f"{'='*70}\n", flush=True)

        except PipelineCancelled:
            raise  # Let the outer wrapper handle it

        except Exception as e:
            print(f"[Pipeline] LIVE INTELLIGENCE FAILED for {meeting_id}: {e}")
            traceback.print_exc()
            try:
                result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
                meeting = result.scalar_one_or_none()
                if meeting:
                    meeting.status = MeetingStatus.FAILED
                    meeting.processing_error = str(e)
                    await db.commit()
            except Exception:
                pass


# ===========================================================================
# REST Endpoints
# ===========================================================================

@router.post("/{meeting_id}/finalize-live", response_model=MeetingResponseSchema, response_model_by_alias=False)
async def finalize_live_meeting(
    meeting_id: str,
    payload: FinalizeLiveMeetingSchema,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Finalize a live meeting using the browser-captured Web Speech API transcript.

    Skips Whisper STT entirely and runs timeline + Qwen intelligence directly
    on the provided transcript segments. Returns immediately with status=processing.
    """
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if meeting.status == MeetingStatus.PROCESSING:
        raise HTTPException(status_code=409, detail="Meeting is already being processed")

    # Convert LiveTranscriptLineSchema objects to plain dicts for the pipeline
    lines    = [{"speaker": l.speaker, "text": l.text, "start_time": l.startTime} for l in payload.transcript]
    segments = _segments_from_live_transcript(lines, payload.duration)

    if not segments:
        raise HTTPException(status_code=400, detail="Live transcript is empty — nothing to analyze")

    meeting.status = MeetingStatus.PROCESSING
    meeting.processing_error = None
    meeting.duration = float(payload.duration)
    await db.commit()

    _schedule_intelligence_pipeline(
        background_tasks,
        meeting_id,
        segments,
        float(payload.duration),
        list(payload.bookmarks),
    )
    print(f"[API] Live meeting {meeting_id} finalized — intelligence pipeline started (Whisper skipped)")

    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    return result.scalar_one()


@router.get("/{meeting_id}/audio")
async def stream_meeting_audio(
    meeting_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Stream the saved audio recording for a meeting.

    Uses FileResponse which supports HTTP Range requests so the browser
    audio player can seek without re-downloading the entire file.
    """
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    audio_path = meeting.audio_path
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="No audio recording found for this meeting")

    return FileResponse(
        audio_path,
        media_type=_audio_media_type(audio_path),
        filename=os.path.basename(audio_path),
    )


@router.post("/{meeting_id}/audio", response_model=MeetingResponseSchema, response_model_by_alias=False)
async def upload_meeting_audio(
    meeting_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    auto_process: bool = Form(default=True),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload an audio file and optionally start the AI pipeline immediately.

    If the meeting doesn't exist yet, a new one is created automatically.
    Supported formats: mp3, wav, m4a, aac, ogg, flac, webm, mp4, wma.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    allowed_ext = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm", ".mp4", ".wma"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext and ext not in allowed_ext:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{ext}'. Allowed: {', '.join(sorted(allowed_ext))}",
        )

    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()

    # Auto-create the meeting record if it doesn't exist
    if not meeting:
        meeting = Meeting(
            id               = meeting_id,
            title            = f"Uploaded Recording ({file.filename})",
            customer_name    = "Customer",
            customer_company = "Client Company",
            processing_mode  = ProcessingMode.ACCURATE,
            status           = MeetingStatus.PROCESSING,
            date             = datetime.now(timezone.utc),
            duration         = 0.0,
            tags             = [],
        )
        db.add(meeting)

    # Save audio file to disk
    file_path = os.path.join(AUDIO_STORAGE_DIR, f"{meeting_id}_{file.filename}")
    content   = await file.read()
    with open(file_path, "wb") as buffer:
        buffer.write(content)

    meeting.audio_path       = file_path
    meeting.status           = MeetingStatus.PROCESSING if auto_process else MeetingStatus.RECORDING
    meeting.processing_error = None
    await db.commit()

    # Re-fetch with related data for the response
    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    meeting = result.scalar_one()

    if auto_process:
        _schedule_pipeline(background_tasks, meeting_id, file_path)
        print(f"[API] Audio uploaded for {meeting_id}. AI pipeline started in background.")
    else:
        print(f"[API] Audio uploaded for {meeting_id}. Waiting for user to start processing.")

    return meeting


@router.post("/{meeting_id}/process", response_model=MeetingResponseSchema, response_model_by_alias=False)
async def process_meeting(
    meeting_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Start AI processing on an already-uploaded audio file."""
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if meeting.status == MeetingStatus.PROCESSING:
        raise HTTPException(status_code=409, detail="Meeting is already being processed")

    audio_path = meeting.audio_path
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(
            status_code=400,
            detail="No audio file found for this meeting. Upload a recording first.",
        )

    meeting.status = MeetingStatus.PROCESSING
    meeting.processing_error = None
    await db.commit()

    _schedule_pipeline(background_tasks, meeting_id, audio_path)
    print(f"[API] Processing started for {meeting_id}")

    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    return result.scalar_one()


@router.post("/{meeting_id}/cancel", response_model=MeetingResponseSchema, response_model_by_alias=False)
async def cancel_meeting_processing(
    meeting_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Request cancellation of an in-progress AI pipeline run."""
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if meeting.status != MeetingStatus.PROCESSING:
        raise HTTPException(status_code=400, detail="Meeting is not currently processing")

    # Signal the background task to stop at the next checkpoint
    request_pipeline_cancel(meeting_id)
    meeting.status = MeetingStatus.FAILED
    meeting.processing_error = "Processing cancelled by user"
    await db.commit()

    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    return result.scalar_one()


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a meeting and all its associated data (transcript, events, summary, embeddings).

    Also removes the saved audio file from disk if it exists.
    """
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Signal cancellation if the pipeline is still running
    if meeting.status == MeetingStatus.PROCESSING:
        request_pipeline_cancel(meeting_id)

    audio_path = meeting.audio_path

    # Delete all child rows first (FK constraints prevent deleting the meeting row directly)
    await db.execute(delete(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting_id))
    await db.execute(delete(MeetingEvent).where(MeetingEvent.meeting_id == meeting_id))
    await db.execute(delete(ActionItem).where(ActionItem.meeting_id == meeting_id))
    await db.execute(delete(MeetingSummary).where(MeetingSummary.meeting_id == meeting_id))
    await db.execute(delete(Embedding).where(Embedding.meeting_id == meeting_id))
    await db.execute(delete(Meeting).where(Meeting.id == meeting_id))
    await db.commit()

    # Remove the audio file from disk (best-effort)
    if audio_path and os.path.exists(audio_path):
        try:
            os.remove(audio_path)
        except OSError as e:
            print(f"[API] Could not delete audio file {audio_path}: {e}")

    print(f"[API] Deleted meeting {meeting_id}")
    return None


@router.post("/{meeting_id}/reprocess", response_model=MeetingResponseSchema, response_model_by_alias=False)
async def reprocess_meeting(
    meeting_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Re-run the full AI pipeline on an existing meeting's saved audio file."""
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    audio_path = meeting.audio_path
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(
            status_code=400,
            detail="No audio file found for this meeting. Upload a recording first.",
        )

    meeting.status = MeetingStatus.PROCESSING
    meeting.processing_error = None
    await db.commit()

    _schedule_pipeline(background_tasks, meeting_id, audio_path)
    print(f"[API] Reprocessing {meeting_id} from {audio_path}")

    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    return result.scalar_one()


@router.get("", response_model=List[MeetingResponseSchema], response_model_by_alias=False)
async def list_meetings(db: AsyncSession = Depends(get_db)):
    """
    Return all meetings ordered by date (newest first).

    Includes meetings in every status — recording, processing, completed, and failed.
    """
    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .order_by(Meeting.date.desc())
    )
    return result.scalars().all()


@router.get("/dashboard/stats", response_model=DashboardStatsSchema, response_model_by_alias=False)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    """
    Compute and return aggregated dashboard statistics from the database.

    Metrics returned:
      - totalMeetings / totalActionItems / avgMeetingMinutes
      - hoursSaved (estimated time saved by AI summarization)
      - meetingsThisWeek
      - conversionRate (% meetings with HIGH/VERY_HIGH purchase intent)
    """
    # Total meeting count
    total_meetings_res = await db.execute(select(func.count(Meeting.id)))
    total_meetings     = total_meetings_res.scalar() or 0

    # Total action items count
    total_actions_res = await db.execute(select(func.count(ActionItem.id)))
    total_actions     = total_actions_res.scalar() or 0

    # Average meeting duration (in minutes)
    avg_duration_res = await db.execute(select(func.avg(Meeting.duration)))
    avg_seconds      = avg_duration_res.scalar() or 0.0
    avg_minutes      = int(avg_seconds / 60) if avg_seconds else 0

    # Estimated hours saved: 75% of total meeting time (AI replaces manual note-taking)
    hours_saved = int((total_meetings * max(avg_minutes, 15) * 0.75) / 60) if total_meetings > 0 else 0

    # Meetings created in the last 7 days
    one_week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    recent_res   = await db.execute(
        select(func.count(Meeting.id)).where(Meeting.date >= one_week_ago)
    )
    meetings_this_week = recent_res.scalar() or 0

    # Conversion rate: meetings with HIGH or VERY_HIGH purchase intent
    high_intent_res = await db.execute(
        select(func.count(Meeting.id)).where(
            Meeting.purchase_intent.in_([PurchaseIntent.HIGH, PurchaseIntent.VERY_HIGH])
        )
    )
    high_intent_count = high_intent_res.scalar() or 0
    conversion_rate   = int((high_intent_count / total_meetings) * 100) if total_meetings > 0 else 0

    return DashboardStatsSchema(
        totalMeetings     = total_meetings,
        totalActionItems  = total_actions,
        avgMeetingMinutes = avg_minutes,
        hoursSaved        = hours_saved,
        meetingsThisWeek  = meetings_this_week,
        conversionRate    = conversion_rate,
    )


@router.get("/{meeting_id}/status")
async def get_meeting_status(meeting_id: str, db: AsyncSession = Depends(get_db)):
    """
    Lightweight status polling endpoint for the AI pipeline.

    Returns status, duration, and any processing error — much cheaper than
    fetching the full meeting with all related data.
    """
    result = await db.execute(
        select(Meeting.status, Meeting.duration).where(Meeting.id == meeting_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")

    err_result = await db.execute(
        select(Meeting.processing_error).where(Meeting.id == meeting_id)
    )
    err_row = err_result.first()

    return {
        "status":          row[0],
        "duration":        row[1],
        "processingError": err_row[0] if err_row else None,
    }


@router.get("/{meeting_id}", response_model=MeetingResponseSchema, response_model_by_alias=False)
async def get_meeting(meeting_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch the full detail of a single meeting including transcript, timeline, and summary."""
    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.transcript_segments),
            selectinload(Meeting.events),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.post("/{meeting_id}/follow-up-email", response_model=FollowUpEmailSchema, response_model_by_alias=False)
async def generate_follow_up_email(meeting_id: str, db: AsyncSession = Depends(get_db)):
    """
    Generate a professional follow-up email draft from the meeting's summary and action items.

    Requires the meeting to be in COMPLETED status with a summary available.
    Uses Qwen 14B if Ollama is reachable, otherwise uses the deterministic template fallback.
    """
    result = await db.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.summary),
            selectinload(Meeting.action_items),
        )
        .where(Meeting.id == meeting_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if meeting.status != MeetingStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Meeting must be completed before generating a follow-up email")

    if not meeting.summary:
        raise HTTPException(status_code=400, detail="No meeting summary available — run AI processing first")

    summary = meeting.summary

    # Serialize action items to plain dicts for the summarizer
    action_items = [
        {
            "title":       item.title,
            "description": item.description,
            "owner":       item.owner.value if hasattr(item.owner, "value") else str(item.owner),
            "deadline":    item.deadline,
            "priority":    item.priority,
        }
        for item in (meeting.action_items or [])
    ]

    meeting_date = meeting.date.strftime("%B %d, %Y") if meeting.date else "recently"
    summarizer   = _get_summarizer()

    email_data = await asyncio.to_thread(
        summarizer.generate_follow_up_email,
        meeting.customer_name,
        meeting.customer_company or "",
        meeting.title,
        meeting_date,
        {
            "overview":    summary.overview,
            "key_points":  summary.key_points or [],
            "decisions":   summary.decisions or [],
            "next_steps":  summary.next_steps or [],
        },
        action_items,
    )

    return FollowUpEmailSchema(
        subject = email_data["subject"],
        body    = email_data["body"],
        toName  = email_data.get("toName") or meeting.customer_name,
    )
