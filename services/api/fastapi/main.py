import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database.db import init_db
from .routing import CamelCaseAPIRoute
from .routers import meetings, search, websocket
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler initializing DB tables and pgvector."""
    from services.transcription.stt import HAS_WHISPER
    from services.transcription.audio_utils import ffmpeg_available
    if not HAS_WHISPER:
        print("\n*** CRITICAL: faster-whisper is NOT installed in this Python environment! ***")
        print("*** Audio transcription will FAIL. Run: pip install faster-whisper imageio-ffmpeg ***")
        print("*** Use the project venv: .venv\\Scripts\\python -m uvicorn ... ***\n")
    else:
        print(f"[Startup] faster-whisper OK | ffmpeg={'yes' if ffmpeg_available() else 'no (install imageio-ffmpeg)'}")
    try:
        await init_db()
    except Exception as e:
        print(f"[Warning] Database initialization notice: {e}")
    yield


app = FastAPI(
    title="Smart Sales Meeting Intelligence (SSMI) API",
    description="AI-powered meeting intelligence platform REST & WebSocket API",
    version="1.0.0",
    lifespan=lifespan,
)
app.router.route_class = CamelCaseAPIRoute
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers (camelCase JSON field names for frontend)
app.include_router(meetings.router)
app.include_router(search.router)
app.include_router(websocket.router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
