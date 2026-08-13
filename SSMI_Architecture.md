# Smart Sales Meeting Intelligence (SSMI)
## Final High-Accuracy + High-Speed Production Architecture

## 1. Executive Summary

Smart Sales Meeting Intelligence (SSMI) is an AI-powered meeting intelligence platform designed for sales professionals.

The system records live meetings or processes uploaded audio recordings, then automatically:

- Transcribes conversations
- Identifies speakers
- Detects important business discussions
- Extracts requirements, pricing, objections, decisions, and action items
- Generates an intelligent meeting timeline
- Produces evidence-backed summaries
- Enables users to jump directly to critical conversation segments
- Supports searchable meeting history

### Primary goals

1. Highest practical accuracy
2. Fast processing and low latency
3. ₹0 API/service cost through self-hosted open-source components
4. Production-grade architecture
5. Privacy-first local processing
6. Ability to scale later without redesigning the core AI pipeline

---

# 2. Final Technology Stack

| Layer | Final Choice |
|---|---|
| Web | **Next.js + TypeScript** |
| Mobile | **React Native** |
| API | **FastAPI** |
| Realtime | **WebSocket** |
| Database | **PostgreSQL** |
| Vector Search | **pgvector** |
| Queue | **Redis + Celery** |
| Storage | **MinIO** |
| Audio Processing | **FFmpeg** |
| Voice Activity Detection | **Silero VAD** |
| Speech-to-Text | **Whisper Large-v3-Turbo** |
| STT Pipeline | **WhisperX** |
| Maximum-Accuracy STT | **Whisper Large-v3** |
| Speaker Diarization | **pyannote.audio** |
| Embeddings | **BGE-M3** |
| LLM | **Qwen 14B Instruct** |
| LLM Serving | **vLLM** |
| LLM Quantization | **4-bit; benchmark AWQ/GPTQ** |
| Voice Gesture Model | **PyTorch → ONNX Runtime** |
| AI Processing | **PyTorch** |
| Deployment | **Docker + NVIDIA CUDA** |
| Monitoring | **Prometheus + Grafana** |
| Testing | **pytest** |
| Core API/Service Cost | **₹0** |

> **Important:** ₹0 software/API cost does not mean unlimited compute. Processing speed and concurrency depend on the available CPU, RAM, GPU and VRAM.

---

# 3. Final Production Architecture

```text
                    ┌──────────────────────┐
                    │     Next.js Web      │
                    │   React Native App   │
                    └──────────┬───────────┘
                               │
                         WebSocket / REST
                               │
                               ▼
                    ┌──────────────────────┐
                    │       FastAPI        │
                    │   API + Auth + WS    │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        PostgreSQL           Redis             MinIO
        + pgvector           Queue          Audio Storage
              │                │
              │                ▼
              │          Celery Workers
              │                │
              │       ┌────────┴────────┐
              │       │                 │
              ▼       ▼                 ▼
        Transcript   Audio AI        LLM AI
                       │                 │
                       │                 │
              ┌────────┼───────┐         │
              ▼        ▼       ▼         ▼
           Silero   WhisperX  Pyannote  vLLM
             VAD    Large-v3   Diar.    Qwen
                      Turbo              │
                       │                 │
                       └────────┬────────┘
                                ▼
                       Intelligence Engine
                                │
                ┌───────────────┼────────────────┐
                ▼               ▼                ▼
             Topics          Business         Intent
                             Events
                │               │                │
                └───────────────┼────────────────┘
                                ▼
                         Evidence Engine
                                │
                                ▼
                         Timeline Engine
                                │
                                ▼
                       Summary + Actions
                                │
                                ▼
                         SSMI Dashboard
```

---

# 4. Why This Architecture

The system should not simply follow:

```text
Recording
    ↓
AI
    ↓
Summary
```

Instead, SSMI uses a multi-stage intelligence pipeline:

```text
Recording
    ↓
VAD
    ↓
ASR
    ↓
Diarization
    ↓
Semantic Segmentation
    ↓
Business Event Detection
    ↓
Importance Ranking
    ↓
Evidence Extraction
    ↓
LLM Reasoning
    ↓
Validation
    ↓
Timeline
    ↓
Summary
```

This architecture provides better accuracy, lower hallucination risk, faster processing, and precise timestamp navigation.

---

# 5. Speech-to-Text: Whisper Large-v3-Turbo + WhisperX

## Final choice

**Whisper Large-v3-Turbo + WhisperX**

Whisper Large-v3-Turbo is the preferred primary STT model because it provides an excellent speed/accuracy tradeoff.

WhisperX provides the pipeline capabilities required for SSMI, including:

- Voice activity detection
- Batched transcription
- Word-level timestamps
- Forced alignment
- Integration with speaker diarization

### Important clarification

Do not design the system around a fixed claim such as "Turbo is always 8× faster."

Actual performance depends on:

- GPU
- VRAM
- Batch size
- Audio duration
- Precision
- Beam size
- CPU/GPU transfers
- Concurrent requests
- VAD configuration

The correct architectural decision is:

> **Use Whisper Large-v3-Turbo as the high-speed default, and retain Whisper Large-v3 as an optional maximum-accuracy processing mode.**

---

# 6. STT Pipeline

```text
Audio
  │
  ▼
FFmpeg
  │
  ▼
Silero VAD
  │
  ▼
WhisperX
  │
  ▼
Whisper Large-v3-Turbo
  │
  ▼
Word-level Alignment
  │
  ▼
pyannote.audio
  │
  ▼
Speaker + Timestamp Alignment
```

Example output:

```json
{
  "speaker": "CUSTOMER",
  "start": 842.21,
  "end": 849.87,
  "words": [
    {
      "word": "We",
      "start": 842.21,
      "end": 842.41
    },
    {
      "word": "need",
      "start": 842.42,
      "end": 842.71
    }
  ],
  "text": "We need around 5000 licenses."
}
```

These timestamps are extremely important because the primary SSMI value proposition is:

> **Jump directly to the important part of a meeting.**

---

# 7. Live Mode vs Maximum Accuracy Mode

The system should support two processing modes.

## Live Meeting

Use:

```text
Whisper Large-v3-Turbo
+
fast event classifiers
```

Goal:

- Low latency
- Fast feedback
- Real-time timeline updates

## Uploaded Recording / Final Processing

Use:

```text
Whisper Large-v3-Turbo
+
pyannote.audio
+
deep event analysis
+
Qwen 14B
```

Optionally, provide a **Maximum Accuracy** mode using Whisper Large-v3 where hardware permits.

### Recommended user-facing options

```text
Processing Mode

⚡ Fast
🎯 Maximum Accuracy
```

This allows SSMI to balance speed and quality based on the user's needs.

---

# 8. Speaker Diarization

Use:

**pyannote.audio**

Pipeline:

```text
Whisper Transcript
        +
pyannote.audio
        ↓
Speaker-Aligned Transcript
```

Example:

```text
00:02:04 — CUSTOMER

"We need approximately five thousand licenses."

00:02:12 — SALESPERSON

"What is your expected deployment date?"
```

SSMI therefore knows:

- Who said the statement
- What was said
- Exactly when it was said

---

# 9. Business Intelligence Engine

The transcript should be processed by specialized business-event detectors.

```text
                  Transcript
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   Requirement     Pricing       Objection
        │             │             │
        ▼             ▼             ▼
     Budget        Decision       Competitor
        │             │             │
        └─────────────┼─────────────┘
                      ▼
               Action Items
```

The engine should detect:

- Customer requirements
- Pricing discussions
- Budget
- Negotiation
- Objections
- Competitors
- Decisions
- Action items
- Deadlines
- Purchase intent
- Customer sentiment
- Risks
- Commitments

---

# 10. Example Business Event

Suppose the customer says:

> "If you can give us 15% discount, we'll sign this month."

SSMI should produce:

```text
EVENT:
Negotiation

TYPE:
Discount Request

PURCHASE INTENT:
High

TIME:
18:32–18:46

IMPORTANCE:
Very High
```

This is more useful than simply including the sentence in a summary.

---

# 11. Rules + ML + LLM Architecture

Do not use the LLM for every operation.

Use a layered approach:

```text
Rules
  +
Small Classifiers
  +
Embeddings
  +
Qwen
```

## Rule Layer

Fast detection of terms such as:

```text
$
₹
budget
price
discount
quotation
contract
deadline
proposal
```

## ML Layer

Classify segments into:

```text
Pricing
Objection
Requirement
Decision
Action
Competitor
```

## Qwen Layer

Use Qwen for deeper reasoning:

```text
What exactly is the customer asking for?

What commitment did each person make?

What is the next action?

What is the customer's purchase intent?

What business risk was raised?
```

This is faster and generally more reliable than sending the entire meeting to an LLM.

---

# 12. LLM Serving: Qwen 14B + vLLM

## Final choice

**Qwen 14B Instruct served using vLLM**

vLLM is preferred for production-style inference because it is designed for:

- High-throughput inference
- Concurrent requests
- Continuous batching
- Efficient GPU utilization
- PagedAttention
- Low-latency serving

Ollama remains useful for local development and experimentation, but vLLM is the preferred production serving layer.

---

# 13. Quantization

A 14B model can require significant GPU memory.

Use quantization where appropriate:

```text
Qwen 14B
   ↓
4-bit quantization
   ↓
vLLM
```

Candidate formats:

```text
AWQ
GPTQ
```

Do not assume one format is universally best.

Benchmark the available options on the target GPU for:

- Tokens/sec
- Time to first token
- VRAM usage
- Extraction accuracy
- Concurrent request performance

Choose the configuration that provides the best real-world SSMI result.

---

# 14. Do Not Send the Entire Meeting to Qwen

A naive implementation would do:

```text
60-minute transcript
       ↓
Qwen 14B
       ↓
Everything
```

Instead:

```text
60-minute transcript
        ↓
Semantic Segmentation
        ↓
Fast Classifiers
        ↓
Important Candidate Segments
        ↓
Qwen 14B
        ↓
Verified Events
```

Example:

```text
60-minute meeting
      ↓
~400 transcript chunks
      ↓
Fast event filtering
      ↓
~65 candidate chunks
      ↓
Qwen analysis
      ↓
~20 verified business events
```

This can dramatically reduce LLM compute.

---

# 15. Final Intelligence Pipeline

```text
                 TRANSCRIPT
                     │
                     ▼
             Semantic Chunking
                     │
                     ▼
              Fast Classifiers
                     │
       ┌─────────────┼──────────────┐
       ▼             ▼              ▼
   Requirement     Pricing       Objection
       │             │              │
       └─────────────┼──────────────┘
                     ▼
              Candidate Events
                     │
                     ▼
                  Qwen
                  vLLM
                     │
                     ▼
              Structured JSON
                     │
                     ▼
              Evidence Validator
                     │
                     ▼
              Importance Ranking
                     │
                     ▼
               Timeline Engine
```

---

# 16. Qwen Should Not Generate Timestamps

Do not ask the LLM to guess timestamps.

Instead:

```text
Transcript
   ↓
Timestamped Segment
   ↓
Event Classification
```

Example:

```json
{
  "event": "PRICING",
  "segment_id": "seg_109",
  "confidence": 0.96
}
```

The backend already knows:

```text
seg_109
↓
15:20–16:10
```

Therefore:

> Pricing — 15:20–16:10

The timestamp comes from the transcript/audio pipeline, not from LLM estimation.

---

# 17. Evidence-Based Intelligence

Every important AI conclusion should be traceable to evidence.

Example:

```text
ACTION ITEM

Send technical proposal

Owner:
Salesperson

Deadline:
Friday

Confidence:
94%

Evidence:
21:42–21:55
```

The user should be able to click:

**▶ 21:42**

and immediately hear the supporting conversation.

This should be a core SSMI design principle:

> **Every important AI conclusion must have evidence.**

---

# 18. Evidence Validation

Do not trust LLM output directly.

Use:

```text
Qwen
  ↓
JSON Schema Validator
  ↓
Evidence Validator
  ↓
Confidence Validator
  ↓
Database
```

Example:

If Qwen produces:

```text
Budget = $100,000
```

the validator should check whether the transcript contains actual evidence for that claim.

If no supporting evidence exists:

```text
REJECT
```

or:

```text
FLAG FOR REVIEW
```

This significantly reduces hallucinated business information.

---

# 19. Three-Level Accuracy Validation

SSMI should use three validation levels.

## Level 1 — Model Confidence

Track:

```text
ASR confidence
Event confidence
Classifier confidence
```

## Level 2 — Evidence Validation

Verify that the transcript supports the predicted event.

## Level 3 — Cross-Check

Use a second lightweight validation model/rule system to determine:

> Does this transcript actually support the claimed event?

Final result:

```text
Prediction
+
Evidence
+
Validation
```

Only then should the event be promoted into the final timeline.

---

# 20. Final Event Schema

Recommended event structure:

```json
{
  "event_id": "evt_001",
  "meeting_id": "meeting_123",

  "type": "PRICING_OBJECTION",

  "title": "Customer objected to pricing",

  "start_time": 1122.31,
  "end_time": 1154.72,

  "speaker": "CUSTOMER",

  "importance_score": 0.96,
  "confidence": 0.94,

  "evidence": {
    "transcript_segment_ids": [
      "seg_109",
      "seg_110"
    ]
  },

  "entities": [
    "Product X",
    "Competitor Y"
  ]
}
```

This provides traceability across:

```text
Meeting
  ↓
Event
  ↓
Transcript
  ↓
Timestamp
  ↓
Audio
```

---

# 21. Intelligent Timeline

The timeline should combine:

```text
Semantic Relevance
+
Business Importance
+
Customer Intent
+
Decision Signals
+
Explicit Voice Bookmark
+
Actionability
```

Example:

```text
02:14 ───── 03:01
Customer Requirement       🔥🔥🔥

08:30 ───── 09:42
Budget Discussion          🔥🔥🔥🔥

15:20 ───── 16:10
Pricing                    🔥🔥🔥🔥🔥

20:15 ───── 21:05
Final Decision             🔥🔥🔥🔥🔥
```

---

# 22. Final Timeline UI

Instead of simply displaying:

```text
15:20 Pricing
```

display:

```text
🔥 HIGH IMPORTANCE

15:20 – 16:10
Pricing Objection

Customer:
"Your pricing is considerably higher
than our current vendor."

Purchase Intent:
HIGH

Confidence:
94%

[▶ Jump to conversation]
```

This is the core product experience.

---

# 23. Semantic Search

Use:

**BGE-M3 + PostgreSQL/pgvector**

for:

- Semantic search
- Similar meetings
- Similar objections
- Similar requirements
- Customer history
- Topic similarity

Example:

> Find meetings where customers had pricing objections.

SSMI performs:

```text
Keyword Search
      +
Vector Search
      +
Event Filtering
      +
Customer Filtering
      +
Date Filtering
```

Result:

```text
Meeting #104
Pricing objection
18:31–18:42
🔥 High importance

Meeting #087
Pricing objection
31:02–31:48
🔥 High importance
```

---

# 24. Future Search Enhancement

Later, add a lightweight cross-encoder reranker:

```text
User Query
    ↓
BGE-M3
    ↓
Top 50 candidates
    ↓
Cross Encoder
    ↓
Top 10 results
```

This can improve search relevance.

Do not make this mandatory for v1.

---

# 25. Voice Gesture Detection

Do not use an LLM for voice gestures.

Use a dedicated local audio classifier:

```text
Microphone
    ↓
20–50ms audio frames
    ↓
ONNX Gesture Model
    ↓
┌──────────────┐
│ BOOKMARK     │
│ STOP         │
│ NORMAL       │
└──────────────┘
```

The classifier can be trained using:

- Bookmark gesture samples
- Stop gesture samples
- Normal speech
- Background noise
- Keyboard sounds
- Coughs
- Door sounds
- Other accidental sounds

Export the trained model to ONNX for fast local inference.

---

# 26. Recommended Voice Gesture Design

For reliability:

```text
Single Whistle
      ↓
BOOKMARK
```

and:

```text
Double Whistle
      ↓
STOP
```

Use a high confidence threshold, for example:

```text
confidence > 0.95
```

This reduces accidental meeting termination.

You can additionally support spoken commands:

```text
"Bookmark"
"Mark this"
"Stop meeting"
```

using local speech recognition.

---

# 27. Live Meeting Pipeline

```text
Microphone
     ↓
Streaming Audio
     ↓
Silero VAD
     ↓
Streaming ASR
     ↓
Partial Transcript
     ↓
Fast Event Classifier
     ↓
Live Timeline
```

After the meeting:

```text
Live Transcript
       ↓
Final High-Quality Processing
       ↓
Corrected Transcript
       ↓
Final Timeline
       ↓
Final Summary
```

This provides both low latency and high final accuracy.

---

# 28. Uploaded Recording Pipeline

For uploaded recordings:

```text
Upload
 ↓
FFmpeg
 ↓
VAD
 ↓
WhisperX + Large-v3-Turbo
 ↓
pyannote.audio
 ↓
Semantic Segmentation
 ↓
Event Detection
 ↓
Qwen 14B / vLLM
 ↓
Evidence Validation
 ↓
Timeline
 ↓
Summary
 ↓
Action Items
```

---

# 29. Storage Architecture

Use:

**MinIO**

instead of AWS S3 for the self-hosted version.

Example:

```text
MinIO
│
├── meetings/
│   ├── meeting_001/
│   │   ├── original.m4a
│   │   ├── normalized.wav
│   │   └── analysis.json
```

PostgreSQL stores metadata and relationships.

---

# 30. Database

Use:

**PostgreSQL + pgvector**

Core tables:

```text
organizations
users
customers
meetings
audio_files
speakers
transcript_segments
topics
meeting_events
action_items
decisions
requirements
objections
embeddings
meeting_summaries
```

This is sufficient for the first serious production version.

---

# 31. Backend Architecture

FastAPI should provide:

```text
POST   /api/meetings
POST   /api/meetings/{id}/audio
POST   /api/meetings/{id}/start
POST   /api/meetings/{id}/stop

GET    /api/meetings
GET    /api/meetings/{id}
GET    /api/meetings/{id}/transcript
GET    /api/meetings/{id}/timeline
GET    /api/meetings/{id}/summary
GET    /api/meetings/{id}/actions

GET    /api/search
GET    /api/customers/{id}/meetings

WS     /ws/meetings/{id}
```

Celery handles long-running AI jobs.

---

# 32. Recommended Project Structure

```text
ssmi/
│
├── apps/
│   ├── web/
│   │   └── nextjs/
│   │
│   └── mobile/
│       └── react-native/
│
├── services/
│   ├── api/
│   │   └── fastapi/
│   │
│   ├── transcription/
│   │   └── whisperx/
│   │
│   ├── diarization/
│   │   └── pyannote/
│   │
│   ├── intelligence/
│   │   ├── topics/
│   │   ├── requirements/
│   │   ├── pricing/
│   │   ├── objections/
│   │   ├── decisions/
│   │   ├── actions/
│   │   ├── sentiment/
│   │   └── purchase_intent/
│   │
│   ├── summarization/
│   │   └── qwen/
│   │
│   └── gesture/
│       └── onnx/
│
├── infrastructure/
│   ├── docker-compose.yml
│   └── postgres/
│
├── models/
│   ├── whisper/
│   ├── diarization/
│   ├── embeddings/
│   └── gesture/
│
├── datasets/
│   ├── raw/
│   ├── annotated/
│   └── evaluation/
│
├── tests/
│
└── docs/
```

---

# 33. Production Deployment

## Development

```text
Windows/Linux
+
Docker Desktop
+
NVIDIA CUDA
```

## Production Pilot

```text
Linux Machine
       ↓
Docker Compose
       ↓
NVIDIA GPU
```

The same containers can later be moved to:

```text
GPU Server
Kubernetes
Managed Infrastructure
```

without rewriting the core AI pipeline.

---

# 34. Hardware Considerations

The architecture is fixed, but model configuration should depend on hardware.

Important variables:

```text
CPU
RAM
GPU
VRAM
Storage
CUDA version
```

For example, a 14B LLM and Whisper Large-v3 have very different VRAM requirements depending on:

- FP16/BF16
- 8-bit
- 4-bit quantization
- Batch size
- Context length
- Concurrent users

Therefore, benchmark the exact deployment hardware before locking the final quantization and batch configuration.

---

# 35. Accuracy Evaluation

Do not claim high accuracy without measuring it.

Create an SSMI evaluation dataset containing manually annotated meetings.

For example:

```text
100 meetings
```

Manually label:

```text
Speaker
Start time
End time
Topic
Requirement
Pricing
Objection
Decision
Action
Important Segment
```

Then evaluate:

```text
WER
DER
Precision
Recall
F1
Timeline IoU
Action-item accuracy
Hallucination rate
```

This allows SSMI to report real measured performance.

---

# 36. Final SSMI Pipeline

```text
                         USER
                           │
                           ▼
                  ┌────────────────┐
                  │ Next.js / RN   │
                  └───────┬────────┘
                          │
                          ▼
                       FastAPI
                          │
                          ▼
                      Audio Input
                          │
                          ▼
                       FFmpeg
                          │
                          ▼
                      Silero VAD
                          │
                          ▼
                WhisperX + Large-v3-Turbo
                          │
                          ▼
                    pyannote.audio
                          │
                          ▼
               Speaker + Word Timestamps
                          │
                          ▼
                  Semantic Segmentation
                          │
                          ▼
                 Fast Event Classifiers
                          │
                 ┌────────┼────────┐
                 ▼        ▼        ▼
             Pricing   Objection  Decision
                 │        │        │
                 └────────┼────────┘
                          ▼
                   Candidate Events
                          │
                          ▼
                  Qwen 14B / vLLM
                          │
                          ▼
                  Structured Output
                          │
                          ▼
                  Evidence Validation
                          │
                          ▼
                  Importance Ranking
                          │
                          ▼
                    Timeline Engine
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
          Summary      Actions       Insights
             │            │            │
             └────────────┼────────────┘
                          ▼
                  PostgreSQL/pgvector
                          │
                          ▼
                    SSMI Dashboard
```

---

# 37. Final Recommendation

For a production-oriented SSMI system with the highest practical accuracy and speed while keeping the core software/API cost at ₹0:

> **WhisperX + Whisper Large-v3-Turbo → pyannote.audio → specialized business-event detection → Qwen 14B served through vLLM → evidence validation → importance ranking → PostgreSQL/pgvector timeline and search.**

The most important design principle is:

> **Do not build SSMI as "audio → LLM → summary." Build it as an evidence-driven multi-stage AI pipeline.**

That gives SSMI:

- High-quality transcription
- Accurate speaker identification
- Precise timestamps
- Fast business-event detection
- Lower LLM workload
- Reduced hallucinations
- Evidence-backed insights
- Intelligent timelines
- Searchable meeting history
- Local/private processing
- A clean path to future commercial scaling

## Final locked stack

```text
Next.js + TypeScript
React Native
FastAPI
WebSocket
PostgreSQL
pgvector
Redis
Celery
MinIO
FFmpeg
Silero VAD
WhisperX
Whisper Large-v3-Turbo
Whisper Large-v3
pyannote.audio
BGE-M3
Qwen 14B Instruct
vLLM
PyTorch
ONNX Runtime
Docker
NVIDIA CUDA
Prometheus
Grafana
pytest
```

**Target cost: ₹0 in API/service fees, with compute limited by your own hardware.***
