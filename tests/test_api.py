import pytest
from fastapi.testclient import TestClient
from services.api.fastapi.main import app

client = TestClient(app)


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
    assert data["customerName"] == "Arjun Mehta"
    assert data["customerCompany"] == "TechCorp Solutions"
    assert data["processingMode"] == "accurate"
    assert "meeting_" in data["id"]
