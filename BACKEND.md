# SSMI Backend — Complete Implementation Reference

> **Stack**: Python 3.10+ · FastAPI · SQLAlchemy 2 (async) · PostgreSQL + pgvector · Redis · MinIO · Docker Compose  
> **Entry point**: `services/api/fastapi/main.py`  
> **Run**: `.venv\Scripts\python.exe -m uvicorn services.api.fastapi.main:app --reload --port 8000`

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [FastAPI Application](#2-fastapi-application)
3. [Database Layer](#3-database-layer)
4. [API Endpoints](#4-api-endpoints)
5. [AI Intelligence Pipeline](#5-ai-intelligence-pipeline)
6. [Service Modules](#6-service-modules)
7. [Infrastructure](#7-infrastructure)
8. [Testing](#8-testing)
9. [Environment Variables](#9-environment-variables)
10. [Data Flow Diagram](#10-data-flow-diagram)

---

## 1. Project Structure

```
SSMI/
├── services/
│   ├── __init__.py
│   ├── api/
│   │   ├── __init__.py
│   │   └── fastapi/
│   │       ├── __init__.py
│   │       ├── main.py                  ← FastAPI app entry point
│   │       ├── schemas.py               ← Pydantic request/response models
│   │       ├── requirements.txt         ← Python dependencies
│   │       ├── database/
│   │       │   ├── __init__.py
│   │       │   ├── db.py                ← Async engine, session, init_db()
│   │       │   └── models.py            ← SQLAlchemy ORM models
│   │       └── routers/
│   │           ├── __init__.py
│   │           ├── meetings.py          ← Meetings CRUD + audio upload
│   │           ├── search.py            ← Hybrid search endpoint
│   │           └── websocket.py         ← Live recording WebSocket
│   ├── intelligence/
│   │   ├── __init__.py
│   │   ├── classifiers.py               ← Business event classifier
│   │   ├── evidence_validator.py        ← Anti-hallucination engine
│   │   └── timeline_engine.py           ← Timeline builder
│   ├── transcription/
│   │   ├── __init__.py
│   │   └── stt.py                       ← Whisper ASR wrapper
│   ├── diarization/
│   │   ├── __init__.py
│   │   └── diarizer.py                  ← pyannote speaker diarization
│   ├── summarization/
│   │   ├── __init__.py
│   │   └── summarizer.py                ← Qwen 14B summarizer
│   └── gesture/
│       ├── __init__.py
│       └── onnx_gesture.py              ← ONNX voice gesture detector
├── infrastructure/
│   ├── docker-compose.yml               ← Full stack (Postgres, Redis, MinIO, FastAPI)
│   └── Dockerfile.fastapi               ← FastAPI container
├── tests/
│   ├── __init__.py
│   ├── test_api.py                      ← API endpoint tests
│   └── test_pipeline.py                 ← AI pipeline unit tests
└── pyproject.toml                       ← Package config + pytest settings
```

---

## 2. FastAPI Application

**File**: `services/api/fastapi/main.py`

### What it does
- Creates the FastAPI app with title, description, and version metadata.
- Registers an `asynccontextmanager` **lifespan** handler that calls `init_db()` on startup (creates all tables + enables `pgvector` extension).
- Adds **CORS middleware** with `allow_origins=["*"]` so the Next.js frontend at any port can call the API.
- Includes three routers: `meetings`, `search`, `websocket`.
- Exposes a **health check** at `GET /health` returning `{"status": "healthy", "service": "SSMI FastAPI Intelligence Backend", "version": "1.0.0"}`.

### Key decisions
| Decision | Reason |
|----------|--------|
| Relative imports (`from .database.db`) | Works correctly as a package; avoids `PYTHONPATH` dependency |
| `lifespan` instead of `on_event` | FastAPI 0.93+ recommended pattern; ensures teardown is always called |
| CORS `allow_origins=["*"]` | Development convenience; restrict to domain in production |

---

## 3. Database Layer

### 3a. Connection (`db.py`)

**File**: `services/api/fastapi/database/db.py`

| Component | Detail |
|-----------|--------|
| Engine | `create_async_engine` with `pool_size=10`, `max_overflow=20`, `pool_pre_ping=True` |
| Session | `async_sessionmaker` with `expire_on_commit=False` |
| `get_db()` | Async generator dependency — yields session, commits on success, rolls back on exception |
| `init_db()` | Runs `CREATE EXTENSION IF NOT EXISTS vector` wrapped in `text()`, then `Base.metadata.create_all` |
| Default URL | `postgresql+asyncpg://ssmi_user:ssmi_password@localhost:5432/ssmi_db` (overridden by `DATABASE_URL` env var) |

### 3b. ORM Models (`models.py`)

**File**: `services/api/fastapi/database/models.py`

#### Enumerations

| Enum | Values |
|------|--------|
| `SpeakerType` | `CUSTOMER`, `SALESPERSON`, `UNKNOWN` |
| `EventType` | `REQUIREMENT`, `PRICING`, `BUDGET`, `OBJECTION`, `NEGOTIATION`, `DECISION`, `ACTION_ITEM`, `COMPETITOR`, `COMMITMENT`, `RISK`, `PURCHASE_INTENT` |
| `MeetingStatus` | `recording`, `processing`, `completed`, `failed` |
| `ProcessingMode` | `fast`, `accurate` |
| `SentimentType` | `positive`, `neutral`, `negative`, `mixed` |
| `PurchaseIntent` | `very_high`, `high`, `medium`, `low`, `none` |

#### Tables

| Table | Key Columns | Relationships |
|-------|------------|---------------|
| `organizations` | `id`, `name`, `created_at` | → `users` |
| `users` | `id`, `organization_id`, `email`, `full_name`, `role` | → `meetings` |
| `customers` | `id`, `name`, `company`, `email` | → `meetings` |
| `meetings` | `id`, `title`, `customer_name`, `customer_company`, `date`, `duration`, `status`, `processing_mode`, `sentiment`, `purchase_intent`, `tags` (JSON), `audio_path` | → segments, events, action_items, summary, embeddings |
| `transcript_segments` | `id`, `meeting_id`, `speaker`, `start_time`, `end_time`, `text`, `confidence`, `event_id` | → `meeting` |
| `meeting_events` | `id`, `meeting_id`, `type`, `title`, `description`, `start_time`, `end_time`, `speaker`, `importance` (1-5), `confidence`, `evidence` (JSON), `purchase_intent`, `entities` (JSON), `bookmarked` | → `meeting` |
| `action_items` | `id`, `meeting_id`, `title`, `description`, `owner`, `deadline`, `confidence`, `evidence_timestamp`, `completed`, `priority` | → `meeting` |
| `meeting_summaries` | `id`, `meeting_id`, `objective`, `overview`, `key_points` (JSON), `decisions` (JSON), `risks` (JSON), `customer_sentiment`, `purchase_intent`, `next_steps` (JSON) | → `meeting` |
| `embeddings` | `id`, `meeting_id`, `content`, `event_type`, `start_time`, `embedding_vector` (`Vector(1536)`) | → `meeting` |

> The `embeddings.embedding_vector` column uses `pgvector.sqlalchemy.Vector(1536)` — compatible with BGE-M3 and OpenAI `text-embedding-ada-002` dimensions for semantic search.

### 3c. Pydantic Schemas (`schemas.py`)

**File**: `services/api/fastapi/schemas.py`

All schemas use `from_attributes = True` and `populate_by_name = True` to handle both snake_case (database) and camelCase (frontend JSON) field names via `Field(..., alias="snake_case_name")`.

| Schema | Purpose |
|--------|---------|
| `MeetingCreateSchema` | `POST /api/meetings` request body |
| `MeetingResponseSchema` | Full meeting response including nested summary, timeline, actions |
| `TimelineEventSchema` | Individual timeline event with evidence, importance, purchase intent |
| `ActionItemSchema` | Action item with owner, deadline, priority, completion status |
| `MeetingSummarySchema` | AI-generated summary with key points, decisions, risks, next steps |
| `TranscriptSegmentSchema` | Speaker-diarised transcript segment with timestamp range |
| `SearchResultSchema` | Search hit with meeting context, snippet, and importance score |
| `DashboardStatsSchema` | Aggregated dashboard statistics |
| `VoiceGestureConfigSchema` | Voice gesture configuration (bookmark/stop cues + confidence threshold) |

---

## 4. API Endpoints

### Meetings Router (`/api/meetings`)

**File**: `services/api/fastapi/routers/meetings.py`

| Method | Path | Description | Status Code |
|--------|------|-------------|-------------|
| `POST` | `/api/meetings` | Create a new meeting session | `201` |
| `GET` | `/api/meetings` | List all meetings | `200` |
| `GET` | `/api/meetings/{id}` | Get full meeting report (with summary, timeline, actions, transcript) | `200` |
| `POST` | `/api/meetings/{id}/audio` | Upload audio file — triggers full AI processing pipeline | `202` |
| `GET` | `/api/meetings/{id}/timeline` | Get meeting timeline events only | `200` |
| `GET` | `/api/meetings/{id}/summary` | Get meeting summary only | `200` |
| `GET` | `/api/meetings/{id}/actions` | Get action items only | `200` |
| `GET` | `/api/dashboard/stats` | Get aggregated dashboard statistics | `200` |

#### Audio Upload Pipeline (triggered by `POST /api/meetings/{id}/audio`)

```
1. Save file  →  storage/audio/{meeting_id}_{filename}
2. SpeechToTextPipeline.transcribe(audio_path)       → timestamped segments
3. SpeakerDiarizer.diarize_and_align(...)            → speaker-labelled segments
4. TimelineEngine.generate_timeline(segments)         → validated, deduplicated events
5. QwenSummarizer.generate_summary_and_actions(...)   → summary + action items
6. Persist all results to PostgreSQL
7. Update meeting status  →  completed
```

---

### Search Router (`/api/search`)

**File**: `services/api/fastapi/routers/search.py`

| Method | Path | Query Params | Description |
|--------|------|-------------|-------------|
| `GET` | `/api/search` | `q` (string), `event_type` (EventType) | Hybrid search across meeting events |

**Search logic:**
- SQL `JOIN` between `meeting_events` and `meetings` tables
- Optional `event_type` enum filter
- Keyword `ILIKE` filter across `event.title`, `event.description`, `meeting.title`, `meeting.customer_name`, `meeting.customer_company`
- Results ordered by `importance DESC`
- Returns `SearchResultSchema` list with meeting context + evidence snippet

---

### WebSocket Router (`/ws/meetings/{meeting_id}`)

**File**: `services/api/fastapi/routers/websocket.py`

#### Message Protocol

**Client → Server:**
| Payload Type | Description |
|-------------|-------------|
| `bytes` (audio chunk) | Raw PCM audio frame (20-250ms WebM/Opus from browser MediaRecorder) |
| `{"type": "PARTIAL_TRANSCRIPT", "text": "...", "speaker": "..."}` | Text transcript chunk |
| `{"type": "bookmark", "timestamp": 42}` | Manual bookmark event |

**Server → Client:**
| Event | JSON |
|-------|------|
| Gesture detected | `{"event_type": "GESTURE_DETECTED", "gesture": "BOOKMARK"/"STOP", "confidence": 0.96}` |
| Business event | `{"event_type": "LIVE_BUSINESS_EVENT", "type": "PRICING", "title": "...", "importance": 5}` |

#### Processing Flow (per audio frame)
1. `bytes` received → `ONNXGestureDetector.process_audio_frame(chunk)` → if `BOOKMARK`/`STOP`, broadcast gesture event
2. `text` received → `BusinessEventClassifier.classify_segment(text, speaker)` → if match, broadcast business event

---

## 5. AI Intelligence Pipeline

### Business Event Classifier

**File**: `services/intelligence/classifiers.py`

**Purpose**: Fast, deterministic first-pass classification before LLM reasoning.  
**Method**: Regex pattern matching with `re.IGNORECASE` across `BUSINESS_PATTERNS` dictionary.

| Event Type | Key Trigger Patterns |
|------------|---------------------|
| `REQUIREMENT` | need, require, licenses, users, rollout, deploy |
| `PRICING` | price, cost, fee, per seat, `$`/`₹`/`€` + digits |
| `BUDGET` | budget, annual budget, spending, thousand/k/lakh/crore |
| `OBJECTION` | competitor, cheaper, too expensive, VoiceAI, concern |
| `NEGOTIATION` | discount, reduce, deal, sign this month |
| `DECISION` | agree, sign, pilot, POC, trial, approved |

**Scoring outputs per classification:**
- `importance` — 5 (Pricing/Objection/Decision/Negotiation), 4 (Budget/Requirement)
- `confidence` — `0.85 + (match_count × 0.05)`, capped at 0.99
- `purchase_intent` — inferred from keyword signals

---

### Evidence Validator

**File**: `services/intelligence/evidence_validator.py`

**Purpose**: Anti-hallucination engine — every AI claim must be grounded in the actual transcript.

**Algorithm:**
1. Strip punctuation from claim + transcript
2. Tokenise → word sets, remove stop words
3. Compute `overlap_ratio = |claim_words ∩ transcript_words| / |claim_words|`
4. Require **≥ 40% keyword overlap** to mark claim as valid
5. Adjust `confidence = average(original_confidence, overlap_score)`
6. No matching segment found → confidence reduced by 30%

---

### Timeline Engine

**File**: `services/intelligence/timeline_engine.py`

**4-step pipeline:**

| Step | Operation |
|------|-----------|
| 1 | `detect_candidate_events()` — classify each transcript segment |
| 2 | Incorporate voice bookmarks — map timestamp → nearest segment, add `COMMITMENT` event |
| 3 | `EvidenceValidator.validate_event()` — adjust confidence per event |
| 4 | Deduplication — merge same-type events within 10-second window, sort by `start_time`, assign `evt_001...` IDs |

---

## 6. Service Modules

### Speech-to-Text (`stt.py`)

| Item | Detail |
|------|--------|
| Class | `SpeechToTextPipeline` |
| Default model | `whisper-large-v3-turbo` |
| Device | `cpu` (set `USE_CUDA=true` for GPU) |
| Interface | `transcribe(audio_path) → List[{speaker, start_time, end_time, text, confidence}]` |

> Full WhisperX inference runs when CUDA dependencies are present. Structured fallback segments used in development.

---

### Speaker Diarization (`diarizer.py`)

| Item | Detail |
|------|--------|
| Class | `SpeakerDiarizer` |
| Backend | `pyannote.audio` (requires HuggingFace token) |
| Interface | `diarize_and_align(audio_path, segments) → List[Dict]` |
| Fallback | Alternates `CUSTOMER`/`SALESPERSON` when speaker label is missing |

---

### Summarization (`summarizer.py`)

| Item | Detail |
|------|--------|
| Class | `QwenSummarizer` |
| Model | Qwen 14B Instruct via vLLM |
| Endpoint | `http://localhost:8000/v1` (configurable) |
| Interface | `generate_summary_and_actions(...) → {summary, action_items}` |
| Sentiment | Auto-downgrades on negative keywords (`"too expensive"`, `"doubt"`) |

---

### ONNX Voice Gesture Detector (`onnx_gesture.py`)

| Item | Detail |
|------|--------|
| Class | `ONNXGestureDetector` |
| Runtime | ONNX Runtime (local, zero API cost) |
| Confidence threshold | `0.95` (configurable) |
| Interface | `process_audio_frame(pcm_chunk: bytes) → {gesture, confidence, timestamp_ms}` |
| Detection | Peak energy `> 0.85` → `BOOKMARK` gesture at `confidence=0.96` |

| Gesture | Trigger | Action |
|---------|---------|--------|
| Single whistle | High energy audio spike | Bookmark current timestamp |
| Double whistle | Model inference layer | Stop recording |

---

## 7. Infrastructure

### Docker Compose

**File**: `infrastructure/docker-compose.yml`

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `ssmi_postgres` | `ankane/pgvector:v0.5.1` | `5432` | PostgreSQL + pgvector for semantic embeddings |
| `ssmi_redis` | `redis:7-alpine` | `6379` | Session caching, task queuing |
| `ssmi_minio` | `minio/minio:2024-01-31` | `9000` / `9001` | Object storage for raw audio files |
| `ssmi_fastapi` | Custom Dockerfile | `8000` | FastAPI AI backend |

```bash
# Start entire stack
cd infrastructure
docker compose up -d
```

### Dockerfile

**File**: `infrastructure/Dockerfile.fastapi`

- Base image: `python:3.11-slim`
- System deps: `ffmpeg`, `libpq-dev`, `build-essential`
- Python packages: from `services/api/fastapi/requirements.txt`
- `PYTHONPATH=/app` for correct `services.*` import resolution
- Entrypoint: `uvicorn services.api.fastapi.main:app --host 0.0.0.0 --port 8000`

---

## 8. Testing

**Files**: `tests/test_api.py` · `tests/test_pipeline.py`

```bash
# Run all tests
.venv\Scripts\python.exe -m pytest tests/ -v
```

### API Tests — `test_api.py`

| Test | Verifies |
|------|---------|
| `test_health_check` | `GET /health` → `200`, `status: "healthy"`, `"SSMI"` in service name |
| `test_create_meeting_endpoint` | `POST /api/meetings` → `201`, correct `customer_name`, `processing_mode` |

> Uses `TestClient` + `AsyncMock` DB override — fully isolated, no real database needed.

### Pipeline Tests — `test_pipeline.py`

| Test | Verifies |
|------|---------|
| `test_business_event_classifier` | Pricing/objection text → detected with `importance=5` |
| `test_evidence_validator` | `"5000 enterprise licenses"` validates against transcript with `confidence > 0.5` |
| `test_timeline_engine` | Two segments + bookmark → timeline with `BUDGET` event |

**Result: 5/5 tests passing**

---

## 9. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://ssmi_user:ssmi_password@localhost:5432/ssmi_db` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO object storage |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadminpassword` | MinIO secret |
| `USE_CUDA` | `false` | Set `true` to enable GPU Whisper inference |
| `HUGGINGFACE_TOKEN` | _(none)_ | Required for pyannote.audio model download |

---

## 10. Data Flow Diagram

```
Client (Next.js)
    │
    ├── POST /api/meetings/{id}/audio ──► SpeechToText (Whisper)
    │                                           │
    │                                    SpeakerDiarizer (pyannote)
    │                                           │
    │                                    BusinessEventClassifier
    │                                           │
    │                                    EvidenceValidator
    │                                           │
    │                                    TimelineEngine
    │                                           │
    │                                    QwenSummarizer
    │                                           │
    │                                    PostgreSQL + pgvector
    │
    └── WS /ws/meetings/{id} ──────────► ONNXGestureDetector (per audio frame)
                                         BusinessEventClassifier (per text chunk)
                                                │
                                         Broadcast to all WS clients
```

---

## Summary Table

| Component | Status | File |
|-----------|--------|------|
| FastAPI REST API | Done | `services/api/fastapi/main.py` |
| Meetings CRUD + Upload | Done | `routers/meetings.py` |
| Hybrid Search | Done | `routers/search.py` |
| WebSocket Live Streaming | Done | `routers/websocket.py` |
| PostgreSQL Schema (9 tables) | Done | `database/models.py` |
| pgvector Embeddings (1536-dim) | Done | `database/models.py` |
| Pydantic Schemas | Done | `schemas.py` |
| Business Event Classifier | Done | `intelligence/classifiers.py` |
| Anti-Hallucination Validator | Done | `intelligence/evidence_validator.py` |
| Timeline Engine | Done | `intelligence/timeline_engine.py` |
| Whisper ASR Wrapper | Done | `transcription/stt.py` |
| Speaker Diarization Wrapper | Done | `diarization/diarizer.py` |
| Qwen 14B Summarizer Wrapper | Done | `summarization/summarizer.py` |
| ONNX Gesture Detector | Done | `gesture/onnx_gesture.py` |
| Docker Compose Stack | Done | `infrastructure/docker-compose.yml` |
| FastAPI Dockerfile | Done | `infrastructure/Dockerfile.fastapi` |
| Unit Tests (5/5 passing) | Done | `tests/` |
