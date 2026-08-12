import uuid
from datetime import datetime
from typing import List, Optional
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
from .db import Base
import enum

# pgvector is optional — used only when PostgreSQL + pgvector extension is available
try:
    from pgvector.sqlalchemy import Vector as PGVector
    HAS_PGVECTOR = True
except ImportError:
    HAS_PGVECTOR = False
    PGVector = None



class SpeakerType(str, enum.Enum):
    CUSTOMER = "CUSTOMER"
    SALESPERSON = "SALESPERSON"
    UNKNOWN = "UNKNOWN"


class EventType(str, enum.Enum):
    REQUIREMENT = "REQUIREMENT"
    PRICING = "PRICING"
    BUDGET = "BUDGET"
    OBJECTION = "OBJECTION"
    NEGOTIATION = "NEGOTIATION"
    DECISION = "DECISION"
    ACTION_ITEM = "ACTION_ITEM"
    COMPETITOR = "COMPETITOR"
    COMMITMENT = "COMMITMENT"
    RISK = "RISK"
    PURCHASE_INTENT = "PURCHASE_INTENT"


class MeetingStatus(str, enum.Enum):
    RECORDING = "recording"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ProcessingMode(str, enum.Enum):
    FAST = "fast"
    ACCURATE = "accurate"


class SentimentType(str, enum.Enum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    MIXED = "mixed"


class PurchaseIntent(str, enum.Enum):
    VERY_HIGH = "very_high"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    NONE = "none"


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="organization")


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=True)
    email = Column(String(255), unique=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(100), default="Sales Executive")
    created_at = Column(DateTime, default=datetime.utcnow)

    organization = relationship("Organization", back_populates="users")
    meetings = relationship("Meeting", back_populates="user")


class Customer(Base):
    __tablename__ = "customers"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    company = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    meetings = relationship("Meeting", back_populates="customer")


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(255), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    customer_id = Column(String(36), ForeignKey("customers.id"), nullable=True)
    customer_name = Column(String(255), nullable=False)
    customer_company = Column(String(255), nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    duration = Column(Float, default=0.0)  # seconds
    status = Column(SQLEnum(MeetingStatus), default=MeetingStatus.COMPLETED)
    processing_mode = Column(SQLEnum(ProcessingMode), default=ProcessingMode.ACCURATE)
    sentiment = Column(SQLEnum(SentimentType), nullable=True)
    purchase_intent = Column(SQLEnum(PurchaseIntent), nullable=True)
    tags = Column(JSON, default=list)  # list of strings
    audio_path = Column(String(512), nullable=True)
    processing_error = Column(Text, nullable=True)

    user = relationship("User", back_populates="meetings")
    customer = relationship("Customer", back_populates="meetings")
    transcript_segments = relationship(
        "TranscriptSegment", back_populates="meeting", cascade="all, delete-orphan", lazy="selectin"
    )
    events = relationship(
        "MeetingEvent", back_populates="meeting", cascade="all, delete-orphan", lazy="selectin"
    )
    action_items = relationship(
        "ActionItem", back_populates="meeting", cascade="all, delete-orphan", lazy="selectin"
    )
    summary = relationship(
        "MeetingSummary", back_populates="meeting", uselist=False, cascade="all, delete-orphan", lazy="selectin"
    )
    embeddings = relationship("Embedding", back_populates="meeting", cascade="all, delete-orphan")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    speaker = Column(SQLEnum(SpeakerType), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    text = Column(Text, nullable=False)
    confidence = Column(Float, default=1.0)
    event_id = Column(String(36), ForeignKey("meeting_events.id"), nullable=True)

    meeting = relationship("Meeting", back_populates="transcript_segments")


class MeetingEvent(Base):
    __tablename__ = "meeting_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    type = Column(SQLEnum(EventType), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    speaker = Column(SQLEnum(SpeakerType), nullable=False)
    importance = Column(Integer, default=3)  # 1 to 5
    confidence = Column(Float, default=0.95)
    evidence = Column(JSON, default=list)  # list of quotes
    purchase_intent = Column(SQLEnum(PurchaseIntent), nullable=True)
    entities = Column(JSON, default=list)
    bookmarked = Column(Boolean, default=False)

    meeting = relationship("Meeting", back_populates="events")


class ActionItem(Base):
    __tablename__ = "action_items"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    owner = Column(SQLEnum(SpeakerType), default=SpeakerType.SALESPERSON)
    deadline = Column(String(50), nullable=True)
    confidence = Column(Float, default=0.95)
    evidence_timestamp = Column(Float, nullable=True)
    completed = Column(Boolean, default=False)
    priority = Column(String(20), default="medium")  # high, medium, low

    meeting = relationship("Meeting", back_populates="action_items")


class MeetingSummary(Base):
    __tablename__ = "meeting_summaries"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String(36), ForeignKey("meetings.id"), unique=True, nullable=False)
    objective = Column(Text, nullable=False)
    overview = Column(Text, nullable=False)
    key_points = Column(JSON, default=list)
    decisions = Column(JSON, default=list)
    risks = Column(JSON, default=list)
    customer_sentiment = Column(SQLEnum(SentimentType), default=SentimentType.POSITIVE)
    purchase_intent = Column(SQLEnum(PurchaseIntent), default=PurchaseIntent.HIGH)
    next_steps = Column(JSON, default=list)

    meeting = relationship("Meeting", back_populates="summary")


from sqlalchemy.types import TypeDecorator

class SafeVector(TypeDecorator):
    """Uses pgvector Vector(1536) on PostgreSQL and JSON/Text on SQLite."""
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            try:
                from pgvector.sqlalchemy import Vector
                return dialect.type_descriptor(Vector(1536))
            except ImportError:
                pass
        return dialect.type_descriptor(JSON())


class Embedding(Base):
    __tablename__ = "embeddings"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String(36), ForeignKey("meetings.id"), nullable=False)
    content = Column(Text, nullable=False)
    event_type = Column(SQLEnum(EventType), nullable=True)
    start_time = Column(Float, nullable=True)
    embedding_vector = Column(SafeVector, nullable=True)  # BGE-M3 or OpenAI compatibility dimension

    meeting = relationship("Meeting", back_populates="embeddings")

