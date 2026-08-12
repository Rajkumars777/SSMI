@echo off
REM Always use the project venv so faster-whisper is available for real transcription.
cd /d "%~dp0"
.venv\Scripts\python.exe -m uvicorn services.api.fastapi.main:app --host 0.0.0.0 --port 8000 --reload
