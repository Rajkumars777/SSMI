import os
import uuid
import shutil
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..database.db import get_db
from ..database.models import (
    Meeting,
    MeetingStatus,
    ProcessingMode,
    TranscriptSegment,
    MeetingEvent,
    ActionItem,
    MeetingSummary,
)
from ..schemas import (
    MeetingCreateSchema,
    MeetingResponseSchema,
    TimelineEventSchema,
    ActionItemSchema,
    MeetingSummarySchema,
    DashboardStatsSchema,
)
from services.transcription.stt import SpeechToTextPipeline
from services.diarization.diarizer import SpeakerDiarizer
from services.intelligence.timeline_engine import TimelineEngine
from services.summarization.summarizer import QwenSummarizer

router = APIRouter(prefix="/api/meetings", tags=["meetings"])
AUDIO_STORAGE_DIR = "storage/audio"
os.makedirs(AUDIO_STORAGE_DIR, exist_ok=True)


@router.post("", response_model=MeetingResponseSchema, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    payload: MeetingCreateSchema,
    db: AsyncSession = Depends(get_db)
):
    """Creates a new meeting session."""
    meeting_id = f"meeting_{uuid.uuid4().hex[:8]}"
    title = payload.title or f"Meeting with {payload.customerName}"
    if payload.customerCompany:
        title = f"Discussion — {payload.customerCompany}"

    from datetime import datetime
    meeting = Meeting(
        id=meeting_id,
        title=title,
        customer_name=payload.customerName,
        customer_company=payload.customerCompany or "Company",
        processing_mode=payload.processingMode,
        status=MeetingStatus.RECORDING,
        date=datetime.utcnow(),
        duration=0.0,
        tags=[],
    )

    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)
    return meeting


@router.post("/{meeting_id}/audio", response_model=MeetingResponseSchema)
async def upload_meeting_audio(
    meeting_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Uploads audio file for processing through the AI intelligence pipeline."""
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()

    if not meeting:
        # Create meeting if not found
        meeting = Meeting(
            id=meeting_id,
            title=f"Uploaded Recording ({file.filename})",
            customer_name="Customer",
            customer_company="Client Company",
            status=MeetingStatus.PROCESSING,
        )
        db.add(meeting)

    # Save audio file to storage
    file_path = os.path.join(AUDIO_STORAGE_DIR, f"{meeting_id}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    meeting.audio_path = file_path
    meeting.status = MeetingStatus.PROCESSING
    await db.commit()

    # Trigger AI pipeline
    stt = SpeechToTextPipeline(model_name="whisper-large-v3-turbo")
    segments_raw = stt.transcribe(file_path)

    diarizer = SpeakerDiarizer()
    segments = diarizer.diarize_and_align(file_path, segments_raw)

    # Save transcript segments
    for seg in segments:
        db_seg = TranscriptSegment(
            meeting_id=meeting.id,
            speaker=seg["speaker"],
            start_time=seg["start_time"],
            end_time=seg["end_time"],
            text=seg["text"],
            confidence=seg.get("confidence", 0.98),
        )
        db.add(db_seg)

    # Generate timeline
    timeline_events = TimelineEngine.generate_timeline(segments)
    for evt in timeline_events:
        db_evt = MeetingEvent(
            id=evt["id"],
            meeting_id=meeting.id,
            type=evt["type"],
            title=evt["title"],
            description=evt["description"],
            start_time=evt["start_time"],
            end_time=evt["end_time"],
            speaker=evt["speaker"],
            importance=evt["importance"],
            confidence=evt["confidence"],
            evidence=evt["evidence"],
            purchase_intent=evt.get("purchase_intent"),
        )
        db.add(db_evt)

    # Generate summary & action items
    summarizer = QwenSummarizer()
    summary_data = summarizer.generate_summary_and_actions(
        meeting.customer_name, meeting.customer_company, segments, timeline_events
    )

    db_summary = MeetingSummary(
        meeting_id=meeting.id,
        objective=summary_data["summary"]["objective"],
        overview=summary_data["summary"]["overview"],
        key_points=summary_data["summary"]["key_points"],
        decisions=summary_data["summary"]["decisions"],
        risks=summary_data["summary"]["risks"],
        customer_sentiment=summary_data["summary"]["customer_sentiment"],
        purchase_intent=summary_data["summary"]["purchase_intent"],
        next_steps=summary_data["summary"]["next_steps"],
    )
    db.add(db_summary)

    for act in summary_data["action_items"]:
        db_act = ActionItem(
            meeting_id=meeting.id,
            title=act["title"],
            description=act["description"],
            owner=act["owner"],
            deadline=act.get("deadline"),
            confidence=act.get("confidence", 0.95),
            evidence_timestamp=act.get("evidence_timestamp"),
            priority=act.get("priority", "medium"),
            completed=act.get("completed", False),
        )
        db.add(db_act)

    meeting.status = MeetingStatus.COMPLETED
    meeting.sentiment = summary_data["summary"]["customer_sentiment"]
    meeting.purchase_intent = summary_data["summary"]["purchase_intent"]
    meeting.duration = max([s["end_time"] for s in segments], default=300.0)

    await db.commit()
    await db.refresh(meeting)
    return meeting


@router.get("", response_model=List[MeetingResponseSchema])
async def list_meetings(db: AsyncSession = Depends(get_db)):
    """Lists all processed meetings."""
    result = await db.execute(select(Meeting).order_by(Meeting.date.desc()))
    meetings = result.scalars().all()
    return meetings


@router.get("/{meeting_id}", response_model=MeetingResponseSchema)
async def get_meeting(meeting_id: str, db: AsyncSession = Depends(get_db)):
    """Fetches details for a specific meeting."""
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting
