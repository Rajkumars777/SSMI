import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock
from services.api.fastapi.main import app
from services.api.fastapi.database.db import get_db
from services.api.fastapi.database.models import (
    Meeting,
    MeetingStatus,
    ProcessingMode,
)

client = TestClient(app)


from datetime import datetime, timezone

def _make_meeting(**kwargs) -> Meeting:
    defaults = {
        "id": "meeting_test1234",
        "title": "Discussion — TechCorp Solutions",
        "customer_name": "Arjun Mehta",
        "customer_company": "TechCorp Solutions",
        "processing_mode": ProcessingMode.ACCURATE,
        "status": MeetingStatus.RECORDING,
        "date": datetime.now(timezone.utc),
        "duration": 0.0,
        "tags": [],
    }
    defaults.update(kwargs)
    meeting = Meeting(**defaults)
    meeting.summary = None
    meeting.events = []
    meeting.action_items = []
    meeting.transcript_segments = []
    return meeting


async def override_get_db():
    mock_session = AsyncMock()
    mock_session.add = MagicMock()

    stored_meeting = _make_meeting()

    async def mock_execute(stmt):
        result = MagicMock()
        result.scalar_one = MagicMock(return_value=stored_meeting)
        result.scalar_one_or_none = MagicMock(return_value=stored_meeting)
        result.first = MagicMock(return_value=(MeetingStatus.RECORDING, 0.0))
        result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        return result

    mock_session.execute = mock_execute
    mock_session.commit = AsyncMock()
    yield mock_session


app.dependency_overrides[get_db] = override_get_db


def test_health_check():
    """Verify backend health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "SSMI" in data["service"]


def test_create_meeting_endpoint():
    """Verify meeting creation endpoint validation."""
    payload = {
        "customerName": "Arjun Mehta",
        "customerCompany": "TechCorp Solutions",
        "processingMode": "accurate",
    }
    response = client.post("/api/meetings", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data.get("customerName") == "Arjun Mehta"
    assert data.get("customerCompany") == "TechCorp Solutions"
    assert data.get("processingMode") == "accurate"
    assert "meeting_" in data["id"]
