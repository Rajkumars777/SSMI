import json
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from services.gesture.onnx_gesture import ONNXGestureDetector
from services.intelligence.classifiers import BusinessEventClassifier

router = APIRouter(tags=["websocket"])


class ConnectionManager:
    """Manages active live meeting WebSocket connections."""

    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, meeting_id: str, websocket: WebSocket):
        await websocket.accept()
        if meeting_id not in self.active_connections:
            self.active_connections[meeting_id] = []
        self.active_connections[meeting_id].append(websocket)

    def disconnect(self, meeting_id: str, websocket: WebSocket):
        if meeting_id in self.active_connections:
            self.active_connections[meeting_id].remove(websocket)
            if not self.active_connections[meeting_id]:
                del self.active_connections[meeting_id]

    async def broadcast(self, meeting_id: str, message: dict):
        if meeting_id in self.active_connections:
            for connection in self.active_connections[meeting_id]:
                await connection.send_json(message)


manager = ConnectionManager()
gesture_detector = ONNXGestureDetector()


@router.websocket("/ws/meetings/{meeting_id}")
async def meeting_websocket_endpoint(websocket: WebSocket, meeting_id: str):
    """Real-time WebSocket endpoint for streaming audio, detecting voice gestures, and live events."""
    await manager.connect(meeting_id, websocket)
    classifier = BusinessEventClassifier()

    try:
        while True:
            # Receive binary audio chunk or JSON text payload
            message = await websocket.receive()

            if "bytes" in message and message["bytes"]:
                audio_bytes = message["bytes"]
                gesture_result = gesture_detector.process_audio_frame(audio_bytes)

                if gesture_result["gesture"] in ("BOOKMARK", "STOP"):
                    await websocket.send_json({
                        "event_type": "GESTURE_DETECTED",
                        "gesture": gesture_result["gesture"],
                        "confidence": gesture_result["confidence"],
                        "timestamp_ms": gesture_result.get("timestamp_ms", 0),
                    })

            elif "text" in message and message["text"]:
                data = json.loads(message["text"])
                if data.get("type") == "PARTIAL_TRANSCRIPT":
                    text = data.get("text", "")
                    speaker = data.get("speaker", "CUSTOMER")
                    cls_result = classifier.classify_segment(text, speaker)

                    if cls_result:
                        await websocket.send_json({
                            "event_type": "LIVE_BUSINESS_EVENT",
                            "type": cls_result["type"],
                            "title": f"{cls_result['type'].value.title()} Detected",
                            "importance": cls_result["importance"],
                            "confidence": cls_result["confidence"],
                            "purchase_intent": cls_result["purchase_intent"],
                            "snippet": text,
                        })

    except WebSocketDisconnect:
        manager.disconnect(meeting_id, websocket)
    except Exception as e:
        manager.disconnect(meeting_id, websocket)
