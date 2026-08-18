"""
API Integration Tests — SSMI
==============================
Tests the FastAPI HTTP endpoints using a mocked async database session.
No real database connection is required to run these tests.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from services.api.fastapi.main import app
from services.api.fastapi.database.db import get_db
from services.api.fastapi.database.models import Meeting, MeetingStatus, ProcessingMode


# ---------------------------------------------------------------------------
# Test client
# ---------------------------------------------------------------------------

client = TestClient(app)


# ---------------------------------------------------------------------------
# DB mock helpers
# ---------------------------------------------------------------------------

def _make_meeting(**kwargs) -> Meeting:
    """
    Create a Meeting ORM instance with sensible test defaults.

    Pass keyword arguments to override any default field value.
    """
    defaults = {
        "id":               "meeting_test1234",
        "title":            "Discussion — TechCorp Solutions",
        "customer_name":    "Arjun Mehta",
        "customer_company": "TechCorp Solutions",
        "processing_mode":  ProcessingMode.ACCURATE,
        "status":           MeetingStatus.RECORDING,
        "date":             datetime.now(timezone.utc),
        "duration":         0.0,
        "tags":             [],
    }
    defaults.update(kwargs)

    meeting = Meeting(**defaults)
    # Initialise related collections to empty so schema serialization doesn't fail
    meeting.summary           = None
    meeting.events            = []
    meeting.action_items      = []
    meeting.transcript_segments = []
    return meeting


async def override_get_db():
    """
    Dependency override that returns a fully mocked async database session.

    Replaces the real `get_db` dependency for all tests in this module.
    """
    mock_session = AsyncMock()
    mock_session.add    = MagicMock()
    mock_session.commit = AsyncMock()

    stored_meeting = _make_meeting()

    async def mock_execute(stmt):
        """Return mock query results that satisfy the endpoint's expectations."""
        result = MagicMock()
        result.scalar_one           = MagicMock(return_value=stored_meeting)
        result.scalar_one_or_none   = MagicMock(return_value=stored_meeting)
        result.first                = MagicMock(return_value=(MeetingStatus.RECORDING, 0.0))
        result.scalars              = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        return result

    mock_session.execute = mock_execute
    yield mock_session


# Register the DB override for all tests in this module
app.dependency_overrides[get_db] = override_get_db


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_health_check():
    """Verify the /health endpoint returns a healthy status with the expected fields."""
    response = client.get("/health")
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "healthy"
    assert "SSMI" in data["service"]


def test_create_meeting_endpoint():
    """
    Verify that POST /api/meetings creates a meeting with the submitted fields.

    The mocked session returns the stored_meeting fixture, so we check that
    the response includes the camelCase fields the frontend expects.
    """
    payload = {
        "customerName":   "Arjun Mehta",
        "customerCompany": "TechCorp Solutions",
        "processingMode": "accurate",
    }
    response = client.post("/api/meetings", json=payload)
    assert response.status_code == 201

    data = response.json()
    assert data.get("customerName")    == "Arjun Mehta"
    assert data.get("customerCompany") == "TechCorp Solutions"
    assert data.get("processingMode")  == "accurate"
    assert "meeting_" in data["id"]
