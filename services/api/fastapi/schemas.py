"""
Pydantic API Schemas — SSMI
============================
Request / response schemas for all FastAPI endpoints.

Naming convention
-----------------
- Fields that map to snake_case ORM columns use a `Field(alias=...)` so that
  the database model can be converted via `from_attributes=True`.
- `populate_by_name=True` allows both the alias and the Python field name to
  be used when constructing the schema (useful in tests and scripts).

Schema map
----------
  TranscriptSegmentSchema  — a single STT output line
  TimelineEventSchema      — an AI-detected business event on the timeline
  ActionItemSchema         — a follow-up task extracted from the meeting
  MeetingSummarySchema     — structured AI-generated meeting summary
  MeetingCreateSchema      — body for POST /api/meetings
  MeetingResponseSchema    — full meeting detail response (all related data)
  SearchResultSchema       — one result from GET /api/search
  DashboardStatsSchema     — aggregated statistics for the dashboard
  VoiceGestureConfigSchema — per-user voice keyword configuration
  LiveTranscriptLineSchema — single line from a live browser recording
  FinalizeLiveMeetingSchema — body for POST /api/meetings/{id}/finalize-live
  FollowUpEmailSchema      — response from POST /api/meetings/{id}/follow-up-email
"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from .database.models import (
    SpeakerType,
    EventType,
    MeetingStatus,
    ProcessingMode,
    SentimentType,
    PurchaseIntent,
)


# ---------------------------------------------------------------------------
# Sub-object schemas (used as nested fields in MeetingResponseSchema)
# ---------------------------------------------------------------------------

class TranscriptSegmentSchema(BaseModel):
    """One speaker turn in the meeting transcript."""
    id:         str
    speaker:    SpeakerType
    startTime:  float           = Field(..., alias="start_time")
    endTime:    float           = Field(..., alias="end_time")
    text:       str
    confidence: float
    eventId:    Optional[str]   = Field(None, alias="event_id")

    class Config:
        from_attributes  = True
        populate_by_name = True


class TimelineEventSchema(BaseModel):
    """An AI-detected business event pinned on the meeting timeline."""
    id:             str
    meetingId:      str                   = Field(..., alias="meeting_id")
    type:           EventType
    title:          str
    description:    str
    startTime:      float                 = Field(..., alias="start_time")
    endTime:        float                 = Field(..., alias="end_time")
    speaker:        SpeakerType
    importance:     int                   # 1 (low) → 5 (critical)
    confidence:     float
    evidence:       List[str]             = []
    purchaseIntent: Optional[PurchaseIntent] = Field(None, alias="purchase_intent")
    entities:       List[str]             = []
    bookmarked:     bool                  = False

    class Config:
        from_attributes  = True
        populate_by_name = True


class ActionItemSchema(BaseModel):
    """A follow-up task assigned during the meeting."""
    id:                 str
    meetingId:          str                   = Field(..., alias="meeting_id")
    title:              str
    description:        str
    owner:              SpeakerType
    deadline:           Optional[str]         = None
    confidence:         float
    evidenceTimestamp:  Optional[float]       = Field(None, alias="evidence_timestamp")
    completed:          bool                  = False
    priority:           str                   = "medium"  # "high" | "medium" | "low"

    class Config:
        from_attributes  = True
        populate_by_name = True


class MeetingSummarySchema(BaseModel):
    """Structured AI-generated meeting summary."""
    objective:        str
    overview:         str
    keyPoints:        List[str]      = Field(..., alias="key_points")
    decisions:        List[str]
    risks:            List[str]
    customerSentiment: SentimentType = Field(..., alias="customer_sentiment")
    purchaseIntent:   PurchaseIntent = Field(..., alias="purchase_intent")
    nextSteps:        List[str]      = Field(..., alias="next_steps")

    class Config:
        from_attributes  = True
        populate_by_name = True


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class MeetingCreateSchema(BaseModel):
    """Body for POST /api/meetings — creates a new meeting session."""
    customerName:    str
    customerCompany: Optional[str]    = ""
    processingMode:  ProcessingMode   = ProcessingMode.ACCURATE
    title:           Optional[str]    = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class MeetingResponseSchema(BaseModel):
    """Full meeting response — includes all related data loaded via selectin."""
    id:              str
    title:           str
    customerName:    str                              = Field(..., alias="customer_name")
    customerCompany: str                              = Field(..., alias="customer_company")
    date:            datetime
    duration:        float
    status:          MeetingStatus
    processingMode:  ProcessingMode                   = Field(..., alias="processing_mode")
    sentiment:       Optional[SentimentType]          = None
    purchaseIntent:  Optional[PurchaseIntent]         = Field(None, alias="purchase_intent")
    tags:            List[str]                        = []
    processingError: Optional[str]                    = Field(None, alias="processing_error")
    # Related data — may be None while still processing
    summary:     Optional[MeetingSummarySchema]           = None
    timeline:    Optional[List[TimelineEventSchema]]      = Field(None, alias="events")
    actionItems: Optional[List[ActionItemSchema]]         = Field(None, alias="action_items")
    transcript:  Optional[List[TranscriptSegmentSchema]]  = Field(None, alias="transcript_segments")

    class Config:
        from_attributes  = True
        populate_by_name = True


class SearchResultSchema(BaseModel):
    """A single result returned by GET /api/search."""
    meetingId:      str
    meetingTitle:   str
    customerName:   str
    customerCompany: str
    date:           datetime
    eventType:      EventType
    snippet:        str       # Best evidence quote for this result
    startTime:      float
    importance:     int
    confidence:     float


class DashboardStatsSchema(BaseModel):
    """Aggregated statistics shown on the dashboard overview page."""
    totalMeetings:    int
    totalActionItems: int
    avgMeetingMinutes: int
    hoursSaved:       int
    meetingsThisWeek: int
    conversionRate:   int    # Percentage of meetings with HIGH/VERY_HIGH purchase intent


class VoiceGestureConfigSchema(BaseModel):
    """Per-user voice keyword and gesture configuration."""
    bookmarkGesture:        str   = "whistle_single"
    customBookmarkKeyword:  str   = "Bookmark"
    stopGesture:            str   = "whistle_double"
    customStopKeyword:      str   = "Stop Meeting"
    confidenceThreshold:    float = 0.95


# ---------------------------------------------------------------------------
# Live meeting schemas (browser-recorded sessions without Whisper STT)
# ---------------------------------------------------------------------------

class LiveTranscriptLineSchema(BaseModel):
    """One line of live transcript sent from the browser's Web Speech API."""
    speaker:   str
    text:      str
    startTime: float = Field(0.0, alias="start_time")

    class Config:
        populate_by_name = True


class FinalizeLiveMeetingSchema(BaseModel):
    """Body for POST /api/meetings/{id}/finalize-live — triggers intelligence pipeline."""
    transcript: List[LiveTranscriptLineSchema]
    duration:   float       = 0.0
    bookmarks:  List[float] = []   # Audio timestamps of voice-bookmarked moments


class FollowUpEmailSchema(BaseModel):
    """Response from POST /api/meetings/{id}/follow-up-email."""
    subject: str
    body:    str
    toName:  str = Field("", alias="to_name")

    class Config:
        from_attributes  = True
        populate_by_name = True
