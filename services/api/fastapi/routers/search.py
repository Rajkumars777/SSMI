from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from ..database.db import get_db
from ..database.models import Meeting, MeetingEvent, EventType
from ..schemas import SearchResultSchema

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=List[SearchResultSchema])
async def search_meetings(
    q: Optional[str] = Query(None, description="Search query string"),
    event_type: Optional[EventType] = Query(None, description="Filter by event type"),
    db: AsyncSession = Depends(get_db)
):
    """Semantic & keyword search across meeting events, pricing objections, budget discussions, and commitments."""
    stmt = select(MeetingEvent, Meeting).join(Meeting, MeetingEvent.meeting_id == Meeting.id)

    if event_type:
        stmt = stmt.where(MeetingEvent.type == event_type)

    if q and q.strip():
        query_str = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                MeetingEvent.title.ilike(query_str),
                MeetingEvent.description.ilike(query_str),
                Meeting.title.ilike(query_str),
                Meeting.customer_name.ilike(query_str),
                Meeting.customer_company.ilike(query_str),
            )
        )

    stmt = stmt.order_by(MeetingEvent.importance.desc())
    result = await db.execute(stmt)
    rows = result.all()

    results = []
    for evt, meeting in rows:
        snippet = evt.evidence[0] if evt.evidence else evt.description
        results.append(
            SearchResultSchema(
                meetingId=meeting.id,
                meetingTitle=meeting.title,
                customerName=meeting.customer_name,
                customerCompany=meeting.customer_company,
                date=meeting.date,
                eventType=evt.type,
                snippet=snippet,
                startTime=evt.start_time,
                importance=evt.importance,
                confidence=evt.confidence,
            )
        )

    return results
