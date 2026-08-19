# CCATFARM

실내 자율주행 모바일 로봇 기반 작물 생장 모니터링 및 자동 충전 시스템

## 실행 방법

### 1. 백엔드

```bash
cd backend
pip install -r requirements.txt
```

`.env` 파일 생성 (backend/ 안에):
```
GEMINI_API_KEY=your_gemini_api_key_here
```

실행:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

→ http://localhost:5173

### 3. 환경변수

| 변수 | 위치 | 설명 |
|------|------|------|
| `GEMINI_API_KEY` | backend/.env | Gemini API 키 (aistudio.google.com에서 발급) |
| `VITE_API_URL` | frontend/.env.local | 백엔드 주소 (기본: http://localhost:8000) |
| `RPI_IP` | 환경변수 | 라즈베리파이 카메라 IP (기본: 192.168.0.4) |

## 주요 기능

- **작물 분석 (Crops)**: Gemini Vision API로 깻잎 이미지 분석 → 황화/충공/정상 판별
- **지도 (Map)**: ROS2 연동 실시간 로봇 위치 + Zone 표시
- **카메라**: RTSP 듀얼 짐벌 카메라 스트리밍
- **PWA**: 모바일에서 홈 화면에 추가하여 앱처럼 사용 가능

## API 엔드포인트

| 경로 | 메소드 | 설명 |
|------|--------|------|
| `/api/crops/analyze` | POST | 이미지 업로드 → Gemini 분석 |
| `/api/crops/analyze-camera` | POST | 카메라 프레임 캡처 → 분석 |
| `/api/crops` | GET | 분석 결과 목록 조회 |
| `/api/camera/{id}` | GET | MJPEG 카메라 스트리밍 |
| `/api/camera/{id}/snapshot` | GET | 단일 프레임 스냅샷 |

## 기술 스택

- Frontend: React, TypeScript, Vite, roslib
- Backend: FastAPI, Gemini API, OpenCV
- Robot: ROS2 Jazzy, Nav2, STELLA N5
- AI: Gemini 3.5 Flash (Vision), YOLOv11 (추후 연동)
