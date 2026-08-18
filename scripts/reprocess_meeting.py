"""
reprocess_meeting.py — SSMI CLI Utility
=========================================
Manually re-runs the full AI pipeline (STT → Diarization → Summarization)
for an existing meeting that already has an audio file saved on disk.

USE CASE
--------
Run this when a meeting was processed with stub/fake data, encountered an
error mid-pipeline, or simply needs a fresh re-run without going through
the web UI.

USAGE
-----
    # From the project root directory:
    python -m scripts.reprocess_meeting <meeting_id>

    # Example:
    python -m scripts.reprocess_meeting meeting_88f81fae

PREREQUISITES
-------------
- The meeting must already exist in the database.
- The meeting must have a valid audio_path recorded.
- The pipeline uses the same GPU-orchestrated flow as a normal upload.
"""

import asyncio
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Ensure the project root is on sys.path so internal imports work when the
# script is run directly (e.g. `python scripts/reprocess_meeting.py`).
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# ---------------------------------------------------------------------------
# Project-level imports (placed here after the sys.path fix above)
# ---------------------------------------------------------------------------
from sqlalchemy import select                                                # DB query builder
from services.api.fastapi.database.db import init_db, async_session_maker  # DB setup
from services.api.fastapi.database.models import Meeting                    # ORM model
from services.api.fastapi.routers.meetings import _run_ai_pipeline         # Core AI pipeline


# Default meeting ID used when none is provided via CLI argument
DEFAULT_MEETING_ID = "meeting_88f81fae"


async def fetch_meeting(meeting_id: str) -> Meeting | None:
    """
    Look up a meeting by its ID in the database.

    Args:
      meeting_id : The unique string ID of the meeting (e.g. 'meeting_88f81fae').

    Returns:
      The Meeting ORM object if found, otherwise None.
    """
    async with async_session_maker() as db:
        result = await db.execute(
            select(Meeting).where(Meeting.id == meeting_id)
        )
        return result.scalar_one_or_none()


async def main() -> None:
    """
    Entry point for the reprocess script.

    Steps:
      1. Parse the meeting ID from CLI args (or use the default).
      2. Initialize the database connection (PostgreSQL → SQLite fallback).
      3. Fetch the meeting and validate it has an audio file path.
      4. Kick off the full AI pipeline (_run_ai_pipeline).
    """
    # ── Step 1: Resolve the target meeting ID ────────────────────────────────
    meeting_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MEETING_ID
    print(f"[Reprocess] Target meeting: {meeting_id}")

    # ── Step 2: Initialize database (PostgreSQL → SQLite fallback) ───────────
    print("[Reprocess] Initializing database …")
    await init_db()

    # ── Step 3: Fetch and validate the meeting record ────────────────────────
    meeting = await fetch_meeting(meeting_id)

    if meeting is None:
        print(f"[Reprocess] ❌  Meeting '{meeting_id}' not found in the database.")
        return

    if not meeting.audio_path:
        print(f"[Reprocess] ❌  Meeting '{meeting_id}' has no audio file path — cannot reprocess.")
        return

    print(f"[Reprocess] ✅  Found meeting. Audio path: {meeting.audio_path}")

    # ── Step 4: Re-run the full AI pipeline ──────────────────────────────────
    print("[Reprocess] 🚀  Starting AI pipeline …")
    await _run_ai_pipeline(meeting_id, meeting.audio_path)
    print("[Reprocess] ✅  Pipeline completed successfully.")


# ---------------------------------------------------------------------------
# Script entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    asyncio.run(main())
