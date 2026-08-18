"""
Database ORM Models — SSMI
==========================
Defines all SQLAlchemy table models used by the FastAPI backend.

Tables:
  - Organization  : Top-level tenant grouping users
  - User          : Salesperson account within an org
  - Customer      : Customer contact linked to meetings
  - Meeting       : Core meeting record with metadata and status
  - TranscriptSegment : Individual STT output segments with speaker labels
  - MeetingEvent  : Timeline events extracted by the AI pipeline
  - ActionItem    : Follow-up tasks assigned from meeting content
  - MeetingSummary: AI-generated structured meeting summary
  - Embedding     : Vector embeddings for semantic search (pgvector / JSON fallback)
"""

import uuid
import enum
from datetime import datetime

from sqlalchemy import (
    Column,
    String,
    Float,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    Enum as SQLEnum,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator

from .db import Base

# ---------------------------------------------------------------------------
# pgvector is optional — used only when PostgreSQL + pgvector extension is available.
# Falls back to storing the vector as JSON on SQLite.
# ---------------------------------------------------------------------------
try:
    from pgvector.sqlalchemy import Vector as PGVector
    HAS_PGVECTOR = True
except ImportError:
    HAS_PGVECTOR = False
    PGVector = None


# ===========================================================================
# Enumerations
# ===========================================================================

class SpeakerType(str, enum.Enum):
    """Who is speaking in a transcript segment."""
    CUSTOMER    = "CUSTOMER"
    SALESPERSON = "SALESPERSON"
    UNKNOWN     = "UNKNOWN"


class EventType(str, enum.Enum):
    """Category of a detected business event in the meeting timeline."""
    REQUIREMENT    = "REQUIREMENT"
    PRICING        = "PRICING"
    BUDGET         = "BUDGET"
    OBJECTION      = "OBJECTION"
    NEGOTIATION    = "NEGOTIATION"
    DECISION       = "DECISION"
    ACTION_ITEM    = "ACTION_ITEM"
    COMPETITOR     = "COMPETITOR"
    COMMITMENT     = "COMMITMENT"
    RISK           = "RISK"
    PURCHASE_INTENT = "PURCHASE_INTENT"


class MeetingStatus(str, enum.Enum):
    """Lifecycle state of a meeting."""
    RECORDING  = "recording"
    PROCESSING = "processing"
    COMPLETED  = "completed"
    FAILED     = "failed"


class ProcessingMode(str, enum.Enum):
    """AI pipeline accuracy/speed trade-off chosen at upload time."""
    FAST     = "fast"      # Uses smaller Whisper model — faster, less accurate
    ACCURATE = "accurate"  # Uses large-v3-turbo — slower, higher quality


class SentimentType(str, enum.Enum):
    """Overall customer sentiment derived from the meeting transcript."""
    POSITIVE = "positive"
    NEUTRAL  = "neutral"
    NEGATIVE = "negative"
    MIXED    = "mixed"


class PurchaseIntent(str, enum.Enum):
    """Likelihood that the customer will make a purchase."""
    VERY_HIGH = "very_high"
    HIGH      = "high"
    MEDIUM    = "medium"
    LOW       = "low"
    NONE      = "none"


# ===========================================================================
# ORM Models
# ===========================================================================

class Organization(Base):
    """Top-level tenant — groups users belonging to the same company."""
    __tablename__ = "organizations"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name       = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    users = relationship("User", back_populates="organization")


class User(Base):
    """Salesperson account that owns meetings."""
    __tablename__ = "users"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=True)
    email           = Column(String(255), unique=True, nullable=False)
    full_name       = Column(String(255), nullable=False)
    role            = Column(String(100), default="Sales Executive")
    created_at      = Column(DateTime, default=datetime.utcnow)

    # Relationships
    organization = relationship("Organization", back_populates="users")
    meetings     = relationship("Meeting", back_populates="user")


class Customer(Base):
    """Customer contact associated with one or more meetings."""
    __tablename__ = "customers"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name       = Column(String(255), nullable=False)
    company    = Column(String(255), nullable=False)
    email      = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    meetings = relationship("Meeting", back_populates="customer")


class Meeting(Base):
    """Core meeting record — links all AI-processed data together."""
    __tablename__ = "meetings"

    id               = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title            = Column(String(255), nullable=False)
    user_id          = Column(String(36), ForeignKey("users.id"), nullable=True)
    customer_id      = Column(String(36), ForeignKey("customers.id"), nullable=True)
    customer_name    = Column(String(255), nullable=False)
    customer_company = Column(String(255), nullable=False)
    date             = Column(DateTime, default=datetime.utcnow)
    duration         = Column(Float, default=0.0)           # Duration in seconds
    status           = Column(SQLEnum(MeetingStatus), default=MeetingStatus.COMPLETED)
    processing_mode  = Column(SQLEnum(ProcessingMode), default=ProcessingMode.ACCURATE)
    sentiment        = Column(SQLEnum(SentimentType), nullable=True)
    purchase_intent  = Column(SQLEnum(PurchaseIntent), nullable=True)
    tags             = Column(JSON, default=list)            # List of string tags
    audio_path       = Column(String(512), nullable=True)   # Path to saved audio file
    processing_error = Column(Text, nullable=True)          # Set when status=FAILED

    # Relationships — all loaded eagerly via selectin to avoid N+1 queries
    user               = relationship("User", back_populates="meetings")
    customer           = relationship("Customer", back_populates="meetings")
    transcript_segments = relationship(
        "TranscriptSegment", back_populates="meeting",
        cascade="all, delete-orphan", lazy="selectin",
    )
    events = relationship(
        "MeetingEvent", back_populates="meeting",
        cascade="all, delete-orphan", lazy="selectin",
    )
    action_items = relationship(
        "ActionItem", back_populates="meeting",
        cascade="all, delete-orphan", lazy="selectin",
    )
    summary = relationship(
        "MeetingSummary", back_populates="meeting",
        uselist=False, cascade="all, delete-orphan", lazy="selectin",
    )
    embeddings = relationship(
        "Embedding", back_populates="meeting", cascade="all, delete-orphan",
    )


class TranscriptSegment(Base):
    """A single STT output segment — one spoken sentence with timestamps and speaker."""
    __tablename__ = "transcript_segments"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    speaker    = Column(SQLEnum(SpeakerType), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time   = Column(Float, nullable=False)
    text       = Column(Text, nullable=False)
    confidence = Column(Float, default=1.0)
    event_id   = Column(String(36), ForeignKey("meeting_events.id"), nullable=True)

    # Relationship back to meeting
    meeting = relationship("Meeting", back_populates="transcript_segments")


class MeetingEvent(Base):
    """A detected business event on the meeting timeline (e.g. pricing discussion)."""
    __tablename__ = "meeting_events"

    id             = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id     = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    type           = Column(SQLEnum(EventType), nullable=False)
    title          = Column(String(255), nullable=False)
    description    = Column(Text, nullable=False)
    start_time     = Column(Float, nullable=False)
    end_time       = Column(Float, nullable=False)
    speaker        = Column(SQLEnum(SpeakerType), nullable=False)
    importance     = Column(Integer, default=3)              # Scale 1–5
    confidence     = Column(Float, default=0.95)
    evidence       = Column(JSON, default=list)              # Direct transcript quotes
    purchase_intent = Column(SQLEnum(PurchaseIntent), nullable=True)
    entities       = Column(JSON, default=list)              # Named entities (products, companies…)
    bookmarked     = Column(Boolean, default=False)

    # Relationship back to meeting
    meeting = relationship("Meeting", back_populates="events")


class ActionItem(Base):
    """A follow-up task assigned to a salesperson or customer during the meeting."""
    __tablename__ = "action_items"

    id                 = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id         = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    title              = Column(String(255), nullable=False)
    description        = Column(Text, nullable=False)
    owner              = Column(SQLEnum(SpeakerType), default=SpeakerType.SALESPERSON)
    deadline           = Column(String(50), nullable=True)
    confidence         = Column(Float, default=0.95)
    evidence_timestamp = Column(Float, nullable=True)        # Timestamp in audio where this was raised
    completed          = Column(Boolean, default=False)
    priority           = Column(String(20), default="medium")  # "high" | "medium" | "low"

    # Relationship back to meeting
    meeting = relationship("Meeting", back_populates="action_items")


class MeetingSummary(Base):
    """AI-generated structured meeting summary — one per meeting (unique FK)."""
    __tablename__ = "meeting_summaries"

    id                = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id        = Column(String(36), ForeignKey("meetings.id"), unique=True, nullable=False)
    objective         = Column(Text, nullable=False)
    overview          = Column(Text, nullable=False)
    key_points        = Column(JSON, default=list)
    decisions         = Column(JSON, default=list)
    risks             = Column(JSON, default=list)
    customer_sentiment = Column(SQLEnum(SentimentType), default=SentimentType.POSITIVE)
    purchase_intent   = Column(SQLEnum(PurchaseIntent), default=PurchaseIntent.HIGH)
    next_steps        = Column(JSON, default=list)

    # Relationship back to meeting
    meeting = relationship("Meeting", back_populates="summary")


class SafeVector(TypeDecorator):
    """
    Cross-database vector column type.

    - PostgreSQL + pgvector: uses Vector(1536) for real semantic search.
    - SQLite (local dev):     stores the vector as JSON (no vector ops).
    """
    impl     = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            try:
                from pgvector.sqlalchemy import Vector
                return dialect.type_descriptor(Vector(1536))
            except ImportError:
                pass
        # Fallback — store as JSON array on SQLite
        return dialect.type_descriptor(JSON())


class Embedding(Base):
    """Semantic vector embedding for a meeting content chunk (for pgvector search)."""
    __tablename__ = "embeddings"

    id               = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id       = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    content          = Column(Text, nullable=False)
    event_type       = Column(SQLEnum(EventType), nullable=True)
    start_time       = Column(Float, nullable=True)
    embedding_vector = Column(SafeVector, nullable=True)  # BGE-M3 / OpenAI-compatible 1536-dim

    # Relationship back to meeting
    meeting = relationship("Meeting", back_populates="embeddings")
