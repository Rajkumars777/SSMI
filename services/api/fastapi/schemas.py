from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from .database.models import (
    SpeakerType,
    EventType,
    MeetingStatus,
    ProcessingMode,
    SentimentType,
    PurchaseIntent,
)


class TranscriptSegmentSchema(BaseModel):
    id: str
    speaker: SpeakerType
    startTime: float = Field(..., alias="start_time")
    endTime: float = Field(..., alias="end_time")
    text: str
    confidence: float
    eventId: Optional[str] = Field(None, alias="event_id")

    class Config:
        from_attributes = True
        populate_by_name = True


class TimelineEventSchema(BaseModel):
    id: str
    meetingId: str = Field(..., alias="meeting_id")
    type: EventType
    title: str
    description: str
    startTime: float = Field(..., alias="start_time")
    endTime: float = Field(..., alias="end_time")
    speaker: SpeakerType
    importance: int
    confidence: float
    evidence: List[str] = []
    purchaseIntent: Optional[PurchaseIntent] = Field(None, alias="purchase_intent")
    entities: List[str] = []
    bookmarked: bool = False

    class Config:
        from_attributes = True
        populate_by_name = True


class ActionItemSchema(BaseModel):
    id: str
    meetingId: str = Field(..., alias="meeting_id")
    title: str
    description: str
    owner: SpeakerType
    deadline: Optional[str] = None
    confidence: float
    evidenceTimestamp: Optional[float] = Field(None, alias="evidence_timestamp")
    completed: bool = False
    priority: str = "medium"

    class Config:
        from_attributes = True
        populate_by_name = True


class MeetingSummarySchema(BaseModel):
    objective: str
    overview: str
    keyPoints: List[str] = Field(..., alias="key_points")
    decisions: List[str]
    risks: List[str]
    customerSentiment: SentimentType = Field(..., alias="customer_sentiment")
    purchaseIntent: PurchaseIntent = Field(..., alias="purchase_intent")
    nextSteps: List[str] = Field(..., alias="next_steps")

    class Config:
        from_attributes = True
        populate_by_name = True


class MeetingCreateSchema(BaseModel):
    customerName: str
    customerCompany: Optional[str] = ""
    processingMode: ProcessingMode = ProcessingMode.ACCURATE
    title: Optional[str] = None


class MeetingResponseSchema(BaseModel):
    id: str
    title: str
    customerName: str = Field(..., alias="customer_name")
    customerCompany: str = Field(..., alias="customer_company")
    date: datetime
    duration: float
    status: MeetingStatus
    processingMode: ProcessingMode = Field(..., alias="processing_mode")
    sentiment: Optional[SentimentType] = None
    purchaseIntent: Optional[PurchaseIntent] = Field(None, alias="purchase_intent")
    tags: List[str] = []
    processingError: Optional[str] = Field(None, alias="processing_error")
    summary: Optional[MeetingSummarySchema] = None
    timeline: Optional[List[TimelineEventSchema]] = Field(None, alias="events")
    actionItems: Optional[List[ActionItemSchema]] = Field(None, alias="action_items")
    transcript: Optional[List[TranscriptSegmentSchema]] = Field(None, alias="transcript_segments")

    class Config:
        from_attributes = True
        populate_by_name = True


class SearchResultSchema(BaseModel):
    meetingId: str
    meetingTitle: str
    customerName: str
    customerCompany: str
    date: datetime
    eventType: EventType
    snippet: str
    startTime: float
    importance: int
    confidence: float


class DashboardStatsSchema(BaseModel):
    totalMeetings: int
    totalActionItems: int
    avgMeetingMinutes: int
    hoursSaved: int
    meetingsThisWeek: int
    conversionRate: int


class VoiceGestureConfigSchema(BaseModel):
    bookmarkGesture: str = "whistle_single"
    customBookmarkKeyword: str = "Bookmark"
    stopGesture: str = "whistle_double"
    customStopKeyword: str = "Stop Meeting"
    confidenceThreshold: float = 0.95


class LiveTranscriptLineSchema(BaseModel):
    speaker: str
    text: str
    startTime: float = Field(0.0, alias="start_time")

    class Config:
        populate_by_name = True


class FinalizeLiveMeetingSchema(BaseModel):
    transcript: List[LiveTranscriptLineSchema]
    duration: float = 0.0
    bookmarks: List[float] = []

