"""
Search Router — SSMI
=====================
Provides keyword search across meeting events, enabling the frontend to
surface pricing discussions, objections, competitor mentions, and other
business-critical moments across all meetings.

Endpoint:
  GET /api/search?q=<query>&event_type=<type>

Results are ordered by event importance (descending) so the most significant
matches surface at the top.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.db import get_db
from ..database.models import EventType, Meeting, MeetingEvent
from ..routing import CamelCaseAPIRoute
from ..schemas import SearchResultSchema

router = APIRouter(prefix="/api/search", tags=["search"], route_class=CamelCaseAPIRoute)


@router.get("", response_model=List[SearchResultSchema], response_model_by_alias=False)
async def search_meetings(
    q: Optional[str]          = Query(None, description="Keyword search query"),
    event_type: Optional[EventType] = Query(None, description="Filter by event type"),
    db: AsyncSession           = Depends(get_db),
):
    """
    Keyword search across meeting events.

    - `q`          : Searches event title/description and meeting title/customer fields.
    - `event_type` : Optionally restricts results to a specific event category.

    Returns up to all matching events ordered by importance score (highest first).
    """
    # Base query: join events with their parent meeting
    stmt = select(MeetingEvent, Meeting).join(Meeting, MeetingEvent.meeting_id == Meeting.id)

    # Optional filter: restrict to a specific event type
    if event_type:
        stmt = stmt.where(MeetingEvent.type == event_type)

    # Optional filter: keyword search across multiple text fields
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

    # Order by importance so the most critical events appear first
    stmt   = stmt.order_by(MeetingEvent.importance.desc())
    result = await db.execute(stmt)
    rows   = result.all()

    # Build the response — use the first evidence quote as the snippet when available
    results = []
    for evt, meeting in rows:
        snippet = evt.evidence[0] if evt.evidence else evt.description
        results.append(
            SearchResultSchema(
                meetingId       = meeting.id,
                meetingTitle    = meeting.title,
                customerName    = meeting.customer_name,
                customerCompany = meeting.customer_company,
                date            = meeting.date,
                eventType       = evt.type,
                snippet         = snippet,
                startTime       = evt.start_time,
                importance      = evt.importance,
                confidence      = evt.confidence,
            )
        )

    return results
