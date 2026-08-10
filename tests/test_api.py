import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock
from services.api.fastapi.main import app
from services.api.fastapi.database.db import get_db
from services.api.fastapi.database.models import Meeting, MeetingStatus, ProcessingMode

client = TestClient(app)


# Mock DB session dependency for isolated unit testing
async def override_get_db():
    mock_session = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
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
        "processingMode": "accurate"
    }
    response = client.post("/api/meetings", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data.get("customer_name") == "Arjun Mehta" or data.get("customerName") == "Arjun Mehta"
    assert data.get("customer_company") == "TechCorp Solutions" or data.get("customerCompany") == "TechCorp Solutions"
    assert data.get("processing_mode") == "accurate" or data.get("processingMode") == "accurate"
    assert "meeting_" in data["id"]
