from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import cv2
import os
import json
import threading
import time
from pathlib import Path

from database import create_user, verify_user, init_db
from auth import create_token, verify_token

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DB 초기화
init_db()


# ── Auth Models ──
class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    name: str = ""


# ── Auth Endpoints ──
@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = verify_user(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    token = create_token(user["id"], user["username"])
    return {"token": token, "user": user}


@app.post("/api/auth/register")
def register(req: RegisterRequest):
    user = create_user(req.username, req.password, req.name)
    if not user:
        raise HTTPException(status_code=409, detail="이미 존재하는 아이디입니다.")
    token = create_token(user["id"], user["username"])
    return {"token": token, "user": user}


@app.get("/api/auth/me")
def get_me(authorization: str = ""):
    """토큰 검증 → 사용자 정보 반환"""
    token = authorization.replace("Bearer ", "") if authorization else ""
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    return {"user_id": payload["user_id"], "username": payload["username"]}

# RTSP 설정
os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'rtsp_transport;udp'

RPi_IP = os.environ.get("RPI_IP", "192.168.0.4")
CAMERA_URLS = {
    "1": f"rtsp://{RPi_IP}:8554/main.264",  # Left 짐벌
    "2": f"rtsp://{RPi_IP}:8555/main.264",  # Right 짐벌
}


class CameraStream:
    """RTSP 스트림을 백그라운드에서 읽어 최신 프레임을 유지"""

    def __init__(self, url: str):
        self.url = url
        self.frame = None
        self.lock = threading.Lock()
        self.running = False
        self.cap = None

    def start(self):
        if self.running:
            return
        self.running = True
        t = threading.Thread(target=self._read_loop, daemon=True)
        t.start()

    def _read_loop(self):
        self.cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        while self.running:
            if not self.cap.isOpened():
                time.sleep(1)
                self.cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
                continue
            ret, frame = self.cap.read()
            if ret:
                with self.lock:
                    self.frame = frame
            else:
                time.sleep(0.1)
        if self.cap:
            self.cap.release()

    def get_frame(self):
        with self.lock:
            return self.frame

    def stop(self):
        self.running = False


# 카메라 스트림 인스턴스 생성
streams: dict[str, CameraStream] = {}
for cam_id, url in CAMERA_URLS.items():
    streams[cam_id] = CameraStream(url)
    streams[cam_id].start()


def generate_mjpeg(cam_id: str):
    """MJPEG 스트리밍 제너레이터"""
    stream = streams.get(cam_id)
    if not stream:
        return

    while True:
        frame = stream.get_frame()
        if frame is not None:
            # JPEG 인코딩
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' +
                buffer.tobytes() +
                b'\r\n'
            )
        time.sleep(0.033)  # ~30fps


# ── Alerts (사이드카 JSON 방식) ──
ALERTS_DIR = Path(__file__).parent / "alerts"
ALERTS_DIR.mkdir(exist_ok=True)


@app.get("/api/alerts")
def get_alerts():
    """alerts/ 폴더의 JSON 파일을 스캔하여 목록 반환 (최신순)"""
    items = []
    for json_file in sorted(ALERTS_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            items.append(data)
        except Exception:
            continue
    return items


@app.get("/api/alerts/{alert_id}")
def get_alert(alert_id: str):
    """단일 알림 상세 조회"""
    json_file = ALERTS_DIR / f"{alert_id}.json"
    if not json_file.exists():
        raise HTTPException(status_code=404, detail="Alert not found")
    with open(json_file, "r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/alert/image/{alert_id}")
def get_alert_image(alert_id: str):
    """알림 이미지 서빙"""
    for ext in ["jpg", "jpeg", "png"]:
        img_file = ALERTS_DIR / f"{alert_id}.{ext}"
        if img_file.exists():
            return FileResponse(str(img_file), media_type=f"image/{ext}")
    raise HTTPException(status_code=404, detail="Image not found")


@app.get("/")
def root():
    return {"message": "CCATFARM API가 정상 작동 중입니다!"}


@app.get("/api/data")
def get_data():
    return {"items": ["Perilla Leaf A", "Perilla Leaf B", "Sensor Data 01"]}


@app.get("/api/camera/{cam_id}")
def camera_stream(cam_id: str):
    """MJPEG 스트리밍 엔드포인트 — 프론트에서 <img src>로 사용"""
    if cam_id not in streams:
        return {"error": f"Camera {cam_id} not found. Available: {list(streams.keys())}"}
    return StreamingResponse(
        generate_mjpeg(cam_id),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.get("/api/camera/{cam_id}/snapshot")
def camera_snapshot(cam_id: str):
    """단일 프레임 스냅샷"""
    stream = streams.get(cam_id)
    if not stream:
        return {"error": f"Camera {cam_id} not found"}
    frame = stream.get_frame()
    if frame is None:
        return {"error": "No frame available"}
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return StreamingResponse(
        iter([buffer.tobytes()]),
        media_type="image/jpeg"
    )
