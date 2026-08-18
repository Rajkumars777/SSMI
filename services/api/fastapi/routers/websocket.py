"""
WebSocket Router — SSMI
========================
Provides a real-time WebSocket endpoint for live meeting sessions.

Endpoint:
  WS /ws/meetings/{meeting_id}

Message types the server handles:
  - Binary (bytes) : Raw PCM audio frames — analyzed for whistle/sound gesture cues.
  - Text (JSON)    : Structured messages; currently supports:
      { "type": "PARTIAL_TRANSCRIPT", "text": "...", "speaker": "..." }

Events the server emits back to the client:
  - GESTURE_DETECTED    : A voice gesture (BOOKMARK or STOP) was triggered.
  - LIVE_BUSINESS_EVENT : A business keyword (pricing, objection, etc.) was classified
                          in the live transcript by the BusinessEventClassifier.
"""

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.gesture.onnx_gesture import ONNXGestureDetector
from services.intelligence.classifiers import BusinessEventClassifier

router = APIRouter(tags=["websocket"])


# ---------------------------------------------------------------------------
# Connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    """
    Tracks all active WebSocket connections grouped by meeting ID.

    Allows broadcasting messages to all clients watching the same meeting
    (e.g. multiple browser tabs or participants).
    """

    def __init__(self):
        # Maps meeting_id → list of connected WebSocket clients
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, meeting_id: str, websocket: WebSocket):
        """Accept and register a new WebSocket connection for a meeting."""
        await websocket.accept()
        if meeting_id not in self.active_connections:
            self.active_connections[meeting_id] = []
        self.active_connections[meeting_id].append(websocket)

    def disconnect(self, meeting_id: str, websocket: WebSocket):
        """Remove a WebSocket from the active connections list."""
        if meeting_id in self.active_connections:
            self.active_connections[meeting_id].remove(websocket)
            # Clean up the meeting key when no clients remain
            if not self.active_connections[meeting_id]:
                del self.active_connections[meeting_id]

    async def broadcast(self, meeting_id: str, message: dict):
        """Send a JSON message to every connected client for a meeting."""
        if meeting_id in self.active_connections:
            for connection in self.active_connections[meeting_id]:
                await connection.send_json(message)


# Singletons — created once per process
manager          = ConnectionManager()
gesture_detector = ONNXGestureDetector()


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@router.websocket("/ws/meetings/{meeting_id}")
async def meeting_websocket_endpoint(websocket: WebSocket, meeting_id: str):
    """
    Real-time WebSocket endpoint for a live meeting session.

    Handles two incoming message types:
      1. Binary PCM audio frames — checked for whistle/sound gesture cues.
      2. JSON text with PARTIAL_TRANSCRIPT — checked for voice keywords and
         business event classification.

    Emits JSON events back to the client when gestures or business events
    are detected.
    """
    await manager.connect(meeting_id, websocket)

    # One classifier instance per connection (stateless — safe to create here)
    classifier = BusinessEventClassifier()

    try:
        while True:
            # Receive either a binary audio chunk or a JSON text message
            message = await websocket.receive()

            # ── Binary path: raw PCM audio frame ────────────────────────────
            if "bytes" in message and message["bytes"]:
                audio_bytes    = message["bytes"]
                gesture_result = gesture_detector.process_audio_frame(audio_bytes)

                # Notify client if a gesture was detected in the audio signal
                if gesture_result["gesture"] in ("BOOKMARK", "STOP"):
                    await websocket.send_json({
                        "event_type":   "GESTURE_DETECTED",
                        "gesture":      gesture_result["gesture"],
                        "confidence":   gesture_result["confidence"],
                        "timestamp_ms": gesture_result.get("timestamp_ms", 0),
                    })

            # ── Text path: JSON message ──────────────────────────────────────
            elif "text" in message and message["text"]:
                data     = json.loads(message["text"])
                msg_type = data.get("type", "")

                if msg_type == "PARTIAL_TRANSCRIPT":
                    text    = data.get("text", "")
                    speaker = data.get("speaker", "CUSTOMER")

                    # Check for spoken voice keyword gestures (e.g. "Bookmark", "Stop Meeting")
                    gesture_result = gesture_detector.check_spoken_text(text)
                    if gesture_result["gesture"] in ("BOOKMARK", "STOP"):
                        await websocket.send_json({
                            "event_type": "GESTURE_DETECTED",
                            "gesture":    gesture_result["gesture"],
                            "confidence": gesture_result["confidence"],
                        })
                        # STOP gesture means the user wants to end the recording
                        if gesture_result["gesture"] == "STOP":
                            continue  # Let the frontend handle stopping

                    # Classify the transcript text for business events
                    cls_result = classifier.classify_segment(text, speaker)
                    if cls_result:
                        event_type_val      = cls_result["type"]
                        purchase_intent_val = cls_result["purchase_intent"]
                        await websocket.send_json({
                            "event_type":     "LIVE_BUSINESS_EVENT",
                            "type":           event_type_val.value if hasattr(event_type_val, "value") else str(event_type_val),
                            "title":          f"{event_type_val.value.title()} Detected" if hasattr(event_type_val, "value") else "Event Detected",
                            "importance":     cls_result["importance"],
                            "confidence":     cls_result["confidence"],
                            "purchase_intent": purchase_intent_val.value if hasattr(purchase_intent_val, "value") else str(purchase_intent_val),
                            "snippet":        text,
                        })

    except WebSocketDisconnect:
        # Normal client disconnection — clean up and exit silently
        manager.disconnect(meeting_id, websocket)

    except Exception as e:
        # Unexpected error — log and clean up
        print(f"[WebSocket] Unexpected error for meeting {meeting_id}: {e}")
        manager.disconnect(meeting_id, websocket)
