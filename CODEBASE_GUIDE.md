# SSMI (Smart Sales Meeting Intelligence) — Complete Codebase & System Guide

---

## 1. Executive Summary

**SSMI (Smart Sales Meeting Intelligence)** is an AI-powered sales intelligence platform designed to process both pre-recorded audio meetings and live browser conversations.

The platform automatically:
1. **Transcribes** audio with high accuracy using local Whisper models.
2. **Identifies speakers** (Salesperson vs. Customer) through neural or heuristic diarization.
3. **Extracts business-critical events** (pricing discussions, budget limits, feature requirements, competitor mentions, objections, agreements).
4. **Validates claims** against transcript quotes to prevent AI hallucinations.
5. **Generates structured intelligence** (executive summaries, next steps, action items with owners and deadlines).
6. **Drafts follow-up emails** ready to send to clients.
7. **Maintains ₹0 external API costs** by running open-source models (Faster-Whisper, Qwen 2.5 14B via Ollama) locally on consumer GPUs (e.g., NVIDIA RTX 4050 6GB).

---

## 2. File-by-File Breakdown

```
SSMI/
├── services/
│   ├── api/
│   │   └── fastapi/
│   │       ├── main.py                  # Application entry point & lifespan manager
│   │       ├── routing.py               # Custom APIRoute for camelCase serialization
│   │       ├── schemas.py               # Pydantic request/response models
│   │       ├── database/
│   │       │   ├── db.py                # Database connection & async session management
│   │       │   └── models.py            # SQLAlchemy ORM table definitions & enums
│   │       └── routers/
│   │           ├── meetings.py          # Core meetings CRUD, audio upload & AI pipeline
│   │           ├── search.py            # Keyword & event search across meetings
│   │           └── websocket.py         # Real-time WebSocket streaming & live gestures
│   ├── gpu_manager.py                   # GPU VRAM scheduling, locks & model eviction
│   ├── transcription/
│   │   ├── stt.py                       # Faster-Whisper Speech-to-Text inference engine
│   │   └── audio_utils.py               # FFmpeg audio conversion & resampling utilities
│   ├── diarization/
│   │   └── diarizer.py                  # Pyannote neural & heuristic speaker diarization
│   ├── intelligence/
│   │   ├── classifiers.py               # Regex/keyword business event detector
│   │   ├── evidence_validator.py        # Claim-transcript keyword overlap validator
│   │   └── timeline_engine.py           # 4-stage meeting timeline generation engine
│   ├── summarization/
│   │   └── summarizer.py                # Qwen 14B LLM summarizer & follow-up email generator
│   └── gesture/
│       └── onnx_gesture.py              # Spoken keyword & audio energy gesture detector
├── scripts/
│   └── reprocess_meeting.py             # Standalone CLI tool to re-run pipeline on audio
├── tests/
│   ├── test_api.py                      # Integration tests for FastAPI endpoints
│   ├── test_pipeline.py                 # Unit tests for intelligence and timeline generation
│   └── test_stt.py                      # Tests for Whisper STT error handling & VRAM fallback
├── start-backend.bat                    # Windows startup script for the backend server
├── pyproject.toml                       # Python project configuration & pytest settings
└── .env                                 # Environment variables and configuration
```

---

### Detailed File Descriptions

#### `services/api/fastapi/main.py`
- **Purpose**: Application entry point and lifespan orchestrator.
- **Key Functions**:
  - `lifespan(app)`: Runs at startup to check `faster-whisper` and `ffmpeg` installations, then initializes the database tables.
  - `health_check()`: `GET /health` endpoint returning system health, runtime flags, and zero-cost status.
- **Dependencies**: Mounts `meetings`, `search`, and `websocket` routers; enables CORS middleware for frontend communication.

#### `services/api/fastapi/routing.py`
- **Purpose**: Response serialization standardization.
- **Key Classes**:
  - `CamelCaseAPIRoute`: Overrides FastAPI's default serialization to ensure JSON responses use camelCase keys (e.g., `customerName`, `startTime`) matching frontend TypeScript contracts.

#### `services/api/fastapi/schemas.py`
- **Purpose**: Data contract definitions (Pydantic models).
- **Key Models**:
  - `MeetingCreateSchema`: Input for creating a meeting session.
  - `MeetingResponseSchema`: Complete meeting payload including nested transcript, events, summary, and action items.
  - `FinalizeLiveMeetingSchema`: Input for finalizing a browser-recorded meeting.
  - `FollowUpEmailSchema`: Output model for AI-generated follow-up emails.
  - `DashboardStatsSchema`: Metrics for the overview dashboard.

#### `services/api/fastapi/database/db.py`
- **Purpose**: Database engine and session lifecycle management.
- **Key Components**:
  - `engine` & `async_sessionmaker`: Configured with connection pooling.
  - `init_db()`: Initializes PostgreSQL with `pgvector` if `DATABASE_URL` is set, or falls back to local SQLite (`ssmi_local.db`).
  - `get_db()`: Async generator yielding database sessions with automatic rollback on error.

#### `services/api/fastapi/database/models.py`
- **Purpose**: SQLAlchemy ORM schema definitions.
- **Key Tables**:
  - `Meeting`: Master meeting record (status, customer info, duration, sentiment, purchase intent).
  - `TranscriptSegment`: Individual timestamped utterances with speaker labels.
  - `MeetingEvent`: Detected timeline milestones (pricing, objections, decisions).
  - `ActionItem`: Follow-up tasks with owners, deadlines, and priorities.
  - `MeetingSummary`: AI-generated objective, overview, key points, risks, and next steps.
  - `SafeVector`: Cross-compatible vector column (PostgreSQL `pgvector` or SQLite `JSON`).

#### `services/api/fastapi/routers/meetings.py`
- **Purpose**: The central controller for all meeting lifecycle actions and AI orchestration.
- **Key Endpoints**:
  - `POST /api/meetings`: Create a new meeting.
  - `POST /api/meetings/{id}/audio`: Upload audio and trigger the background AI pipeline.
  - `POST /api/meetings/{id}/finalize-live`: Process live browser transcripts (skips Whisper).
  - `POST /api/meetings/{id}/follow-up-email`: Generate a follow-up email draft.
  - `GET /api/meetings/{id}/audio`: Stream audio recording with HTTP Range support.
  - `POST /api/meetings/{id}/cancel`: Gracefully cancel an ongoing pipeline run.

#### `services/api/fastapi/routers/search.py`
- **Purpose**: Global meeting intelligence search.
- **Key Endpoints**:
  - `GET /api/search`: Performs indexed multi-field search across meeting titles, customer companies, event descriptions, and transcript evidence, sorted by importance.

#### `services/api/fastapi/routers/websocket.py`
- **Purpose**: Real-time two-way communication for live meetings.
- **Key Components**:
  - `ConnectionManager`: Manages active WebSocket connections per meeting ID.
  - `meeting_websocket_endpoint`: Receives binary PCM audio chunks (for gesture cues) and partial transcript text (for live event alerts).

#### `services/gpu_manager.py`
- **Purpose**: GPU VRAM budget orchestrator and concurrency lock.
- **Key Components**:
  - `_PIPELINE_LOCK`: Global mutex ensuring heavy AI models do not run concurrently and exhaust VRAM.
  - `unload_ollama_model()`: Evicts Qwen from VRAM before Whisper runs.
  - `reload_ollama_model()`: Pre-warms Qwen into VRAM before summarization.
  - `flush_cuda()`: Clears PyTorch CUDA memory caches and forces Python garbage collection.

#### `services/transcription/stt.py`
- **Purpose**: Local speech-to-text transcription engine.
- **Key Features**:
  - `transcribe_audio()`: Executes Whisper on GPU (`float16`) or CPU (`int8`).
  - `pick_model_for_vram()`: Automatically selects a smaller model if available VRAM is low.
  - `merge_duplicate_segments()`: Removes Whisper tail repetition artifacts.

#### `services/transcription/audio_utils.py`
- **Purpose**: Audio format standardization.
- **Key Functions**:
  - `prepare_audio_for_whisper()`: Converts WebM, Opus, OGG, and M4A audio to 16kHz 16-bit mono WAV using FFmpeg.
  - `ffmpeg_available()`: Detects system FFmpeg or bundled `imageio-ffmpeg`.

#### `services/diarization/diarizer.py`
- **Purpose**: Speaker segmentation (who spoke when).
- **Key Modes**:
  - Neural Mode: Uses `pyannote/speaker-diarization-3.1` when a Hugging Face token is provided.
  - Heuristic Mode: Fast, rule-based fallback that alternates speakers on silence pauses ≥ 1.5 seconds.

#### `services/intelligence/classifiers.py`
- **Purpose**: Fast, deterministic business signal classification.
- **Key Functions**:
  - `BusinessEventClassifier.classify_segment()`: Matches regex patterns to categorize utterances into `REQUIREMENT`, `PRICING`, `BUDGET`, `OBJECTION`, `NEGOTIATION`, or `DECISION`.

#### `services/intelligence/evidence_validator.py`
- **Purpose**: AI hallucination prevention.
- **Key Functions**:
  - `EvidenceValidator.validate_claim()`: Computes keyword overlap ratio between generated claims and raw transcript segments, penalizing unsupported extractions.

#### `services/intelligence/timeline_engine.py`
- **Purpose**: 4-stage meeting timeline generation.
- **Key Steps**:
  1. Detect candidate events.
  2. Integrate voice bookmarks.
  3. Validate against transcript evidence.
  4. Deduplicate overlapping events within 10-second windows.

#### `services/summarization/summarizer.py`
- **Purpose**: Structured meeting summarization and email generation.
- **Key Features**:
  - Calls Qwen 2.5 14B via local Ollama API (`/v1/chat/completions`).
  - Includes a zero-dependency deterministic fallback if Ollama is not running.

#### `services/gesture/onnx_gesture.py`
- **Purpose**: Spoken voice keyword detection ("Bookmark", "Stop Meeting") and high-energy audio frame analysis.

#### `scripts/reprocess_meeting.py`
- **Purpose**: CLI maintenance utility to re-run the full AI pipeline on an existing meeting using its stored audio file.

---

## 3. Component Integration & Architecture

### System Integration Map
```mermaid
graph TD
    subgraph ClientLayer ["Client Layer"]
        Web["Next.js Web Client"]
        Mobile["React Native App"]
    end

    subgraph APILayer ["FastAPI Intelligence Backend"]
        RouterMeetings["meetings.py (/api/meetings)"]
        RouterSearch["search.py (/api/search)"]
        RouterWS["websocket.py (/ws/meetings)"]
        DBSession["db.py (AsyncSession Engine)"]
    end

    subgraph StorageLayer ["Persistence & Storage"]
        DB[(PostgreSQL / SQLite)]
        AudioDisk[("Local Audio Storage: storage/audio/")]
    end

    subgraph GPUControl ["GPU & Resource Orchestration"]
        GPUManager["gpu_manager.py (_PIPELINE_LOCK & VRAM Budget)"]
    end

    subgraph TranscriptionLayer ["Audio & Speech Pipeline"]
        AudioPrep["audio_utils.py (FFmpeg 16kHz Resampler)"]
        WhisperSTT["stt.py (Faster-Whisper CUDA float16)"]
        Diarizer["diarizer.py (Pyannote / Heuristic Diarizer)"]
    end

    subgraph IntelligenceLayer ["Deterministic & LLM Intelligence"]
        Timeline["timeline_engine.py (4-Stage Deduplication)"]
        Classifiers["classifiers.py (Regex Keyword Matcher)"]
        Validator["evidence_validator.py (Hallucination Guardrail)"]
        Summarizer["summarizer.py (Qwen 14B / Deterministic Fallback)"]
        Gesture["onnx_gesture.py (Voice Keyword & Energy Detector)"]
    end

    subgraph LocalAI ["Self-Hosted AI Engines (Zero-Cost ₹0)"]
        OllamaEngine["Ollama Server (qwen2.5:14b)"]
    end

    %% Client to API
    Web -->|REST API| RouterMeetings
    Web -->|REST API| RouterSearch
    Web -->|WebSocket| RouterWS
    Mobile -->|REST API| RouterMeetings

    %% API to Storage
    RouterMeetings --> DBSession
    RouterSearch --> DBSession
    DBSession --> DB
    RouterMeetings -->|Save .wav/.mp3| AudioDisk

    %% Router to GPU Manager
    RouterMeetings -->|Lock & Evict| GPUManager
    GPUManager -->|keep_alive=0| OllamaEngine

    %% Audio Pipeline
    RouterMeetings --> AudioPrep
    AudioPrep -->|16kHz Mono WAV| WhisperSTT
    WhisperSTT --> Diarizer
    Diarizer --> Timeline

    %% Intelligence Connections
    Timeline --> Classifiers
    Timeline --> Validator
    Timeline -->|Stage 1: Commit Transcripts & Events| DBSession

    %% Summarization Pipeline
    RouterMeetings -->|Pre-warm VRAM| OllamaEngine
    RouterMeetings --> Summarizer
    Summarizer -->|v1/chat/completions| OllamaEngine
    Summarizer -->|Stage 2: Commit Summary & Action Items| DBSession

    %% WebSocket connections
    RouterWS --> Gesture
    RouterWS --> Classifiers
```

---

## 4. End-to-End Workflow & Sequence Diagrams

### Flow 1: Pre-Recorded Audio Upload & Background AI Pipeline Workflow

```mermaid
sequenceDiagram
    autonumber
    actor User as Sales Representative
    participant UI as Next.js Web Client
    participant API as FastAPI (meetings.py)
    participant Disk as Local Storage
    participant GPU as GPU Manager
    participant Whisper as Faster-Whisper
    participant Diar as Diarizer
    participant DB as Database (models.py)
    participant LLM as Ollama (Qwen 14B)

    User->>UI: Upload meeting recording (.mp3 / .wav / .m4a)
    UI->>API: POST /api/meetings/{id}/audio (multipart/form-data)
    API->>Disk: Save file to storage/audio/{id}_filename
    API->>DB: Set status = "processing"
    API-->>UI: HTTP 201 Created (status: "processing")

    Note over API,LLM: Background Task Execution Starts

    API->>GPU: Acquire _PIPELINE_LOCK
    API->>GPU: unload_ollama_model() (keep_alive=0)
    GPU->>LLM: Evict Qwen from VRAM (Frees ~4.0 GB)

    API->>Whisper: transcribe_audio(filepath, "large-v3-turbo")
    Whisper->>Whisper: Load model -> Transcribe -> Unload model
    Whisper-->>API: Return timestamped segments [{start, end, text, confidence}]

    API->>Diar: diarize_and_align(filepath, segments)
    Diar-->>API: Segments with speaker labels (SALESPERSON / CUSTOMER)

    API->>DB: Commit TranscriptSegments & MeetingEvents (UI can display live timeline)

    API->>GPU: reload_ollama_model()
    GPU->>LLM: Pre-warm Qwen 14B into VRAM
    API->>LLM: generate_summary_and_actions(transcript, timeline)
    LLM-->>API: JSON: Objective, Overview, Key Points, Risks, Action Items

    API->>DB: Commit MeetingSummary, ActionItems & set status = "completed"
    API->>GPU: Release _PIPELINE_LOCK

    UI->>API: GET /api/meetings/{id} (Poll or View)
    API-->>UI: Full Meeting Payload (Timeline, Summary, Actions)
    UI-->>User: Displays Interactive Intelligence Dashboard
```

---

### Flow 2: Live Browser Meeting & Real-Time Gesture Workflow

```mermaid
sequenceDiagram
    autonumber
    actor User as Salesperson & Customer
    participant Browser as Browser (Web Speech API)
    participant WS as WebSocket (/ws/meetings/{id})
    participant Gesture as ONNXGestureDetector
    participant Classifier as BusinessClassifier
    participant API as FastAPI (/finalize-live)
    participant Engine as Timeline & Qwen Summarizer
    participant DB as Database

    User->>Browser: Speaks during live meeting
    Browser->>Browser: Web Speech API generates live transcript
    Browser->>WS: Send binary audio frame (PCM 16kHz)
    WS->>Gesture: process_audio_frame(pcm_chunk)
    opt Whistle or loud acoustic signal detected
        Gesture-->>WS: Return BOOKMARK gesture
        WS-->>Browser: Emit {event_type: "GESTURE_DETECTED", gesture: "BOOKMARK"}
    end

    Browser->>WS: Send JSON: {type: "PARTIAL_TRANSCRIPT", text: "VoiceAI is quoting 20% less"}
    WS->>Gesture: check_spoken_text(text)
    WS->>Classifier: classify_segment(text, "CUSTOMER")
    Classifier-->>WS: Detected: OBJECTION / PRICING (Importance: 5)
    WS-->>Browser: Emit {event_type: "LIVE_BUSINESS_EVENT", type: "OBJECTION", importance: 5}
    Browser-->>User: Displays real-time badge on screen

    User->>Browser: Clicks "End Meeting"
    Browser->>API: POST /api/meetings/{id}/finalize-live with full transcript & bookmarks
    Note over API,Engine: Whisper is skipped — uses browser transcript directly!
    API->>Engine: Run TimelineEngine & Qwen Summarizer
    Engine->>DB: Persist Events, Summary & Action Items
    API-->>Browser: HTTP 200 (status: "completed")
```

---

### Flow 3: 4-Stage Intelligence & Timeline Generation Pipeline

```mermaid
flowchart TD
    RawSegments["Raw Transcript Segments (Whisper / Live)"] --> Stage1

    subgraph Stage1 ["Stage 1: Candidate Event Detection"]
        Classify["Regex Keyword Matching (BUSINESS_PATTERNS)"]
        Classify --> DetectedEvents["Found: PRICING, BUDGET, OBJECTION, DECISION, REQUIREMENT"]
    end

    subgraph Stage2 ["Stage 2: Voice Bookmark Insertion"]
        Bookmarks["Voice Bookmarks (Audio timestamps)"]
        NearestSeg["Map timestamp to nearest transcript utterance"]
        Bookmarks --> NearestSeg
        NearestSeg --> BookmarkEvents["Inserted as COMMITMENT Events (Importance: 5)"]
    end

    DetectedEvents --> Merge1["Combine Candidate Events"]
    BookmarkEvents --> Merge1

    subgraph Stage3 ["Stage 3: Evidence Validation (Anti-Hallucination)"]
        Merge1 --> EvidenceCheck["EvidenceValidator.validate_claim()"]
        EvidenceCheck --> OverlapScore["Calculate Word Overlap Ratio (Stop Words Filtered)"]
        OverlapScore --> ScoreThreshold{"Overlap >= 40%?"}
        ScoreThreshold -->|Yes| ValidEvent["Attach Exact Transcript Quote as Evidence"]
        ScoreThreshold -->|No| PenalizedEvent["Penalize Confidence Score"]
    end

    subgraph Stage4 ["Stage 4: Time-Window Deduplication"]
        ValidEvent --> TimeSort["Sort Chronologically by start_time"]
        PenalizedEvent --> TimeSort
        TimeSort --> Deduplicate{"Same event type within 10 seconds?"}
        Deduplicate -->|Yes| KeepHighest["Keep event with highest importance score"]
        Deduplicate -->|No| KeepBoth["Preserve both distinct events"]
    end

    KeepHighest --> FinalTimeline["Final Timeline Events (evt_001, evt_002, ...)"]
    KeepBoth --> FinalTimeline
```

---

### Flow 4: GPU Memory Lifecycle State Machine (RTX 4050 6GB)

```mermaid
stateDiagram-v2
    [*] --> Idle: System Running (No Pipeline Active)
    
    state Idle {
        [*] --> OllamaWarm: Ollama can hold Qwen 14B in VRAM (~4GB)
    }

    Idle --> Step1_Eviction: Audio Upload / Reprocess Triggered
    
    state Step1_Eviction {
        [*] --> UnloadOllama: POST /api/generate keep_alive=0
        UnloadOllama --> CudaFlush: torch.cuda.empty_cache() & gc.collect()
        CudaFlush --> VRAMFree: Free VRAM rises to ~5.8 GB
    }

    Step1_Eviction --> Step2_WhisperSTT: Start STT
    
    state Step2_WhisperSTT {
        [*] --> LoadWhisper: Load Whisper large-v3-turbo (CUDA float16)
        LoadWhisper --> Transcribing: Uses ~3.0 GB VRAM
        Transcribing --> UnloadWhisper: Delete model & flush CUDA memory
    }

    Step2_WhisperSTT --> Step3_Diarization: Transcript Ready
    
    state Step3_Diarization {
        [*] --> DiarizeHeuristic: Diarization / Silence Alignment (0 MB GPU)
    }

    Step3_Diarization --> Step4_LLMSummary: Events Built & Intermediate DB Commit

    state Step4_LLMSummary {
        [*] --> ReloadOllama: POST /api/generate prompt="" (Warm-up)
        ReloadOllama --> LoadQwen: Qwen 14B loads into VRAM (~4.0 GB)
        LoadQwen --> Summarize: Extract structured JSON summary
    }

    Step4_LLMSummary --> Idle: Release _PIPELINE_LOCK & Mark COMPLETED
```

---

## 5. Primary Use Cases & Business Value

1. **Automated Post-Meeting Intelligence**: Upload a call recording to automatically receive categorized milestones, decisions, objections, and assigned action items without manual note-taking.
2. **Real-Time Meeting Co-Pilot**: Receive instant alerts during live calls when pricing objections or competitor mentions occur, and use spoken/acoustic bookmarks to mark key moments.
3. **Automated Client Follow-Up**: Generate polished follow-up email drafts referencing agreed deadlines and deliverables with one click.
4. **Cross-Meeting Search**: Instantly query across historical client meetings for specific feature requests, pricing commitments, or objections.

---

## 6. GPU & VRAM Budget (6 GB RTX 4050)

To avoid CUDA Out-Of-Memory (OOM) errors on 6GB GPUs, models are executed sequentially:

| Stage | Active Model | VRAM Usage | Available Headroom |
|---|---|---|---|
| **1. Audio Transcription** | Whisper Large-v3-Turbo | ~3.0 GB | ~3.0 GB |
| **2. Diarization** | Pyannote / Heuristic | ~0.0–1.5 GB | ~4.5 GB |
| **3. Summarization** | Qwen 2.5 14B (4-bit) | ~4.0 GB | ~2.0 GB |

---

## 7. Execution & Setup Guide

### 1. Prerequisites
- Python 3.10+ (Python 3.11/3.12 recommended)
- FFmpeg installed or available via `imageio-ffmpeg`
- Ollama running locally with `qwen2.5:14b` (optional, fallback included)

### 2. Environment Configuration (`.env`)
```ini
# Database (leave blank to default to SQLite)
DATABASE_URL=

# LLM Configuration
VLLM_ENDPOINT=http://localhost:11434/v1
VLLM_MODEL_NAME=qwen2.5:14b

# Whisper Configuration
WHISPER_MODEL_NAME=large-v3-turbo
WHISPER_FAST_MODEL=small
USE_CUDA=true

# Diarization (Optional)
ENABLE_DIARIZATION=false
HUGGINGFACE_TOKEN=
```

### 3. Starting the Backend
Using the provided batch script:
```cmd
start-backend.bat
```
Or manually via terminal:
```bash
.venv\Scripts\python.exe -m uvicorn services.api.fastapi.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Running the Tests
```bash
.venv\Scripts\python.exe -m pytest tests/ -v
```

### 5. Reprocessing a Meeting via CLI
```bash
.venv\Scripts\python.exe -m scripts.reprocess_meeting meeting_88f81fae
```
