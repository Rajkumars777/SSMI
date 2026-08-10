import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from services.api.fastapi.database.db import init_db
from services.api.fastapi.routers import meetings, search, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler initializing DB tables and pgvector."""
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

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(meetings.router)
app.include_router(search.router)
app.include_router(websocket.router)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "SSMI FastAPI Intelligence Backend",
        "version": "1.0.0",
        "cost": "₹0 API Fee"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
