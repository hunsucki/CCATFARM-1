# 🌿 CCATFARM — 스마트팜 자율주행 로봇 관제 시스템

실내 자율주행 모바일 로봇 기반 작물 생장 모니터링 및 자동 충전 시스템의 웹 대시보드입니다.

## 시스템 구성

```
┌─────────────────────────────────────────────────────────┐
│  모바일 웹 대시보드 (React + TypeScript + Vite)           │
│  작물 모니터링 · 원격 제어 · Emergency Stop               │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket ws://9090
                         │ MJPEG http://8000
┌────────────────────────┴────────────────────────────────┐
│  Raspberry Pi 5 — rosbridge_server · 카메라 RTSP 중계     │
│  /cmd_vel · /odom · /scan · /battery_state               │
└────────────────────────┬────────────────────────────────┘
                         │ ROS2 DDS (내부망)
┌────────────────────────┴────────────────────────────────┐
│  Jetson Orin Nano — SLAM · Nav2 · YOLOv11 추론           │
│  Cartographer · 경로 계획 · 작물 탐지                     │
└─────────────────────────────────────────────────────────┘
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 19, TypeScript, Vite, react-router-dom, lucide-react |
| 로봇 통신 | roslib (CDN), WebSocket, ROS 2 Jazzy |
| 백엔드 | FastAPI, OpenCV (RTSP→MJPEG 변환) |
| 로봇 | STELLA N5, Nav2, Cartographer, AprilTag 도킹 |
| AI | YOLOv11 (작물 병해 탐지) |

## 프로젝트 구조

```
CCATFARM/
├── backend/
│   └── main.py                  # FastAPI + 카메라 MJPEG 스트리밍
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Joystick.tsx     # 아날로그 조이스틱 (터치/마우스)
│   │   │   └── RosMap.tsx       # OccupancyGrid 맵 시각화
│   │   ├── hooks/
│   │   │   ├── useRos.ts        # ROS WebSocket 연결 관리
│   │   │   ├── useBattery.ts    # /battery_state 구독
│   │   │   ├── useCamera.ts     # compressed image 구독
│   │   │   └── useDiagnostics.ts# /diagnostics 구독
│   │   ├── pages/
│   │   │   ├── Home.tsx         # 대시보드 (Zone, 배터리, 알림)
│   │   │   ├── Map.tsx          # 맵 + 카메라 + 조이스틱 제어
│   │   │   ├── Crops.tsx        # 작물 상태 모니터링
│   │   │   └── Settings.tsx     # 사용자 설정
│   │   ├── config/
│   │   │   └── rosTopics.ts     # ROS 2 토픽 정의 문서
│   │   └── utils/
│   │       └── zoneMap.ts       # 좌표 기반 Zone 판별
│   └── index.html
└── README.md
```

## 실행 방법

### 1. 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

→ http://localhost:5173

### 2. 백엔드 (카메라 스트리밍)

```bash
cd backend
pip install fastapi uvicorn opencv-python
uvicorn main:app --reload --host 0.0.0.0
```

→ http://localhost:8000

카메라 IP 변경: `RPI_IP=192.168.0.4 uvicorn main:app --reload`

### 3. 로봇 측 (ROS 2)

```bash
# rosbridge 실행 (웹 앱 연동)
ros2 launch rosbridge_server rosbridge_websocket_launch.xml

# Nav2 + 맵 서버 (자율주행 + /map 토픽)
ros2 launch nav2_bringup bringup_launch.py map:=/path/to/map.yaml
```

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `VITE_ROS_URL` | `ws://192.168.0.141:9090` | rosbridge WebSocket 주소 |
| `RPI_IP` | `192.168.0.4` | 라즈베리파이 RTSP 카메라 IP |

## 주요 기능

- 실시간 로봇 위치 모니터링 (`/amcl_pose`) + 좌표 기반 Zone 판별
- 배터리 상태 실시간 표시 (`/battery_state`) + 저전압 경고
- RTSP 카메라 MJPEG 스트리밍 (듀얼 짐벌 카메라)
- OccupancyGrid 맵 시각화 (`/map`)
- EMERGENCY → 아날로그 조이스틱 수동 제어 (`/cmd_vel`)
- 시스템 진단 알림 (`/diagnostics`)

## API 엔드포인트

| 경로 | 설명 |
|------|------|
| `GET /api/camera/1` | 1번 카메라 MJPEG 스트리밍 |
| `GET /api/camera/2` | 2번 카메라 MJPEG 스트리밍 |
| `GET /api/camera/{id}/snapshot` | 단일 프레임 스냅샷 |

## 팀

깻팜 (한밭대학교 컴퓨터공학과 캡스톤디자인)

| 이름 | 역할 |
|------|------|
| 최현석 | Nav Lead — ROS2 환경 구축, Nav2, SLAM |
| 태성우 | HW Architect — 프레임 제작, 액추에이터 |
| 이시우 | Vision/Docking — AprilTag 인식, 정밀 정렬 |
| 사민경 | AI/App Dev — YOLOv11, 모바일 앱 UI/UX |

## 0522 Update

### 카메라 스트리밍 구조 변경

- 기존 백엔드 MJPEG 스트리밍(`http://localhost:8000/api/camera/1`) 대신 ROS 2 토픽을 직접 구독하도록 변경함
- rosbridge를 통해 `/camera/camera/color/image_raw/compressed`를 수신
- 메시지 타입은 `sensor_msgs/msg/CompressedImage`이며, `data` 필드를 `data:image/jpeg;base64,...` 형태로 `<img>`에 표시함
- 실제 카메라 렌더링은 `frontend/src/components/CameraStream.tsx`에서 처리합니다.
- 카메라 프레임마다 React 화면 전체가 다시 렌더링되지 않도록 `<img>`의 `src`를 직접 갱신하는 방식으로 변경
- 카메라 구독에는 `queue_length: 1`, 기본 `throttle_rate: 66ms`를 적용해 오래된 프레임이 쌓이지 않도록 변경함

### ROS 토픽 정리
- 현재 Map 화면에서 실제로 구독하는 주요 토픽:
  - `/camera/camera/color/image_raw/compressed`
  - `/map`
  - `/amcl_pose`
  - `/battery_state`
- 현재 Map 화면에서 publish하는 주요 토픽:
  - `/cmd_vel`
  - `/initialpose`
- `rosTopics.ts`에 정의된 모든 토픽을 수신하는 것은 아니며, 화면에서 `ROSLIB.Topic(...).subscribe()`를 호출한 토픽만 rosbridge를 통해 수신함

### 지도 및 2D Pose Estimate

- `frontend/src/components/RosMap.tsx`에서 `/map` (`nav_msgs/msg/OccupancyGrid`)을 받아 지도 캔버스를 표시
- Map 화면에 `2D Pose` 버튼을 추가
- 앱에서 지도 위 위치를 누르고 진행 방향으로 드래그한 뒤 체크 버튼을 누르면 `/initialpose`로 `geometry_msgs/msg/PoseWithCovarianceStamped`를 publish하도록 기능 추가
- `/amcl_pose`가 지정한 좌표 근처로 갱신되면 앱에서 위치 추정 반영 여부를 표시
- `/map` 구독에는 `queue_length: 1`, 기본 `throttle_rate: 1000ms`를 적용해 카메라 스트리밍과 지도 수신이 서로 과하게 밀리지 않도록 변경함

### ROS 연결 최적화

- `useBattery`, `useDiagnostics`, `RosMap`, `CameraStream`이 각각 별도 rosbridge 연결을 만들지 않고, 화면에서 생성한 `useRos()` 연결을 공유하도록 수정함
- 네비게이션 노드 실행 시 카메라 스트리밍이 끊기거나 느려지는 문제를 줄이기 위해 카메라와 지도 토픽 모두 queue/throttle 설정 적용

### 관련 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `VITE_ROS_URL` | `ws://192.168.0.141:9090` | rosbridge WebSocket 주소 |
| `VITE_CAMERA_THROTTLE_MS` | `66` | 카메라 CompressedImage 수신 간격(ms), 약 15fps |
| `VITE_MAP_THROTTLE_MS` | `1000` | `/map` 수신 간격(ms) |

### 확인용 ROS 명령

```bash
# 카메라 토픽 수신율/대역폭 확인
ros2 topic hz /camera/camera/color/image_raw/compressed
ros2 topic bw /camera/camera/color/image_raw/compressed

# 지도와 위치 추정 확인
ros2 topic hz /map
ros2 topic hz /amcl_pose

# 앱에서 보낸 2D Pose 확인
ros2 topic echo /initialpose --once

# rosbridge가 실제로 구독 중인 토픽 확인
ros2 node info /rosbridge_websocket
```

## 0531 Update

### 순회 포인트 지도 표시

- Map 화면의 `RosMap` 툴바에 `Route` 버튼을 추가함
- rosbridge를 통해 `/mission_route_points` 토픽을 구독함
- 토픽 타입은 `std_msgs/String`이며, `data` 필드의 JSON 문자열을 파싱해 지도 위에 순회 경로를 표시함
- `navigation_sequence`가 있으면 해당 배열을 우선 사용해 순서를 그대로 표시함
- 표시 순서는 `HOME_TO_PATROL` -> `patrol_points` -> `HOME_TO_DOCK`
- 지도 위에는 순서대로 숫자 마커를 표시하고, 시작점은 `HOME(P)`, 종료점은 `HOME(D)` 라벨로 구분함
- `navigation_sequence`가 없는 경우에는 `home_to_patrol_pose`, `patrol_points`, `home_to_dock_pose`를 조합해 표시함

예상 메시지 형식:

```json
{
  "frame_id": "map",
  "home_to_patrol_pose": {
    "x": -0.265,
    "y": 4.405,
    "yaw": -1.5708
  },
  "home_to_dock_pose": {
    "x": -0.265,
    "y": 4.405,
    "yaw": 1.0472
  },
  "patrol_points": [
    { "name": "point_1", "x": -0.165, "y": -0.145 },
    { "name": "point_2", "x": 3.735, "y": -0.045 }
  ],
  "navigation_sequence": [
    { "name": "HOME_TO_PATROL", "type": "home", "x": -0.265, "y": 4.405, "yaw": -1.5708 },
    { "name": "point_1", "type": "patrol", "x": -0.165, "y": -0.145, "yaw": 0.0256 },
    { "name": "point_2", "type": "patrol", "x": 3.735, "y": -0.045, "yaw": 3.1159 },
    { "name": "HOME_TO_DOCK", "type": "home", "x": -0.265, "y": 4.405, "yaw": 1.0472 }
  ]
}
```

확인용 ROS 명령:

```bash
ros2 topic echo /mission_route_points --once
```

### Vite 개발 서버 프록시

- `frontend/vite.config.ts`에 Vite 개발 서버 프록시 설정을 추가함
- 프론트엔드에서 `/api`로 시작하는 요청을 `http://localhost:8000` 백엔드로 전달함
- 개발 중 프론트 주소가 달라도 API 호출 경로를 `/api/...` 형태로 유지할 수 있음

```ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true,
    },
  },
}
```
