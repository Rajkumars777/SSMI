"""Reprocess a meeting with real Whisper transcription (fixes fake stub data)."""
import asyncio
import sys

async def main():
    meeting_id = sys.argv[1] if len(sys.argv) > 1 else "meeting_88f81fae"
    from services.api.fastapi.routers.meetings import _run_ai_pipeline
    from services.api.fastapi.database.db import init_db, async_session_maker
    from sqlalchemy import select
    from services.api.fastapi.database.models import Meeting

    await init_db()

    async with async_session_maker() as db:
        result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
        meeting = result.scalar_one_or_none()
        if not meeting or not meeting.audio_path:
            print(f"Meeting {meeting_id} not found or has no audio.")
            return
        print(f"Reprocessing {meeting_id}: {meeting.audio_path}")

    await _run_ai_pipeline(meeting_id, meeting.audio_path)
    print("Done.")

if __name__ == "__main__":
    asyncio.run(main())
