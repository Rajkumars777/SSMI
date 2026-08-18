"""
FastAPI Application Entry Point — SSMI
=======================================
Configures and exposes the main FastAPI `app` instance used by uvicorn.

Startup sequence (via lifespan):
  1. Check whether faster-whisper is installed and warn loudly if not.
  2. Initialize the database (PostgreSQL → SQLite fallback).

Routers mounted:
  - /api/meetings  → meetings CRUD + AI pipeline triggers
  - /api/search    → keyword search across meeting events
  - /ws/meetings   → real-time WebSocket for live recording
"""

import os

from dotenv import load_dotenv

# Load .env before any other project imports so env vars are available everywhere
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database.db import init_db
from .routing import CamelCaseAPIRoute
from .routers import meetings, search, websocket


# ---------------------------------------------------------------------------
# Application lifespan — runs once on startup and once on shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager.

    Checks critical dependencies (Whisper, ffmpeg) and initialises the
    database before the server begins accepting requests.
    """
    from services.transcription.stt import HAS_WHISPER
    from services.transcription.audio_utils import ffmpeg_available

    # Warn loudly if Whisper isn't installed — audio uploads will fail
    if not HAS_WHISPER:
        print("\n*** CRITICAL: faster-whisper is NOT installed in this Python environment! ***")
        print("*** Audio transcription will FAIL. Run: pip install faster-whisper imageio-ffmpeg ***")
        print("*** Use the project venv: .venv\\Scripts\\python -m uvicorn ... ***\n")
    else:
        ffmpeg_status = "yes" if ffmpeg_available() else "no (install imageio-ffmpeg)"
        print(f"[Startup] faster-whisper OK | ffmpeg={ffmpeg_status}")

    # Initialise DB tables — non-fatal warning so the app can still start
    try:
        await init_db()
    except Exception as e:
        print(f"[Warning] Database initialization notice: {e}")

    yield  # Server runs here
    # (add any shutdown cleanup here if needed in the future)


# ---------------------------------------------------------------------------
# Application instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Smart Sales Meeting Intelligence (SSMI) API",
    description="AI-powered meeting intelligence platform REST & WebSocket API",
    version="1.0.0",
    lifespan=lifespan,
)

# Use camelCase JSON field names so the React frontend receives the keys it expects
app.router.route_class = CamelCaseAPIRoute

# Allow all origins in development — tighten this list for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Mount feature routers
# ---------------------------------------------------------------------------
app.include_router(meetings.router)   # /api/meetings
app.include_router(search.router)     # /api/search
app.include_router(websocket.router)  # /ws/meetings/{id}


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """
    Lightweight liveness probe.

    Returns the status of key runtime dependencies so the frontend
    and monitoring tools can surface helpful error messages.
    """
    from services.transcription.stt import HAS_WHISPER
    from services.transcription.audio_utils import ffmpeg_available

    return {
        "status": "healthy",
        "service": "SSMI FastAPI Intelligence Backend",
        "version": "1.0.0",
        "cost": "₹0 API Fee",
        "whisperInstalled": HAS_WHISPER,
        "ffmpegAvailable": ffmpeg_available(),
    }


# ---------------------------------------------------------------------------
# Direct run (development only — use uvicorn for production)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
