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

## update_0715

### drive_manager 웹 계약 반영

- 웹 앱의 주행 연동 기준을 `drive_manager`의 rosbridge 계약으로 변경했습니다.
- 지도와 Zone 판별 위치 입력을 `/amcl_pose`에서 `/robot_pose`로 변경했습니다. 위치 출처는 `/robot_pose_status`의 `AMCL`, `DOCKED`, `DOCKED_ASSUMED`를 화면에 함께 표시합니다.
- `/web_teleop/status`, `/web_teleop/active`, `/robot_status`, `/robot_pose_status`, `/mission_route_points`를 구독하는 공통 상태 훅을 추가했습니다.
- rosbridge 연결이 끊기면 2초 뒤 자동 재연결하고, 연결 복구 시 publisher와 subscriber를 다시 생성하도록 변경했습니다.

| 방향 | 토픽 | 타입 | 적용 내용 |
|------|------|------|----------|
| Web → ROS | `/robot_command` | `std_msgs/msg/String` | `START`, `HOME`, `STOP`, `ESTOP`, `RESET` 지원 |
| Web → ROS | `/cmd_vel_web_safe` | `geometry_msgs/msg/Twist` | 일반 수동 조종, 웹 제한 0.15 m/s·0.40 rad/s |
| Web → ROS | `/cmd_vel_web_force` | `geometry_msgs/msg/Twist` | 탈출용 저속 조종, 웹 제한 0.08 m/s·0.25 rad/s |
| Web → ROS | `/initialpose` | `geometry_msgs/msg/PoseWithCovarianceStamped` | 정지 확인 후 지도 위치와 yaw 재설정 |
| ROS → Web | `/web_teleop/status` | `std_msgs/msg/String` | `DISABLED`, `TRANSITIONING_*`, `SAFE`, `FORCE`, `ERROR ...` 표시 |
| ROS → Web | `/web_teleop/active` | `std_msgs/msg/Bool` | START/HOME 및 2D Pose 상호잠금 |
| ROS → Web | `/robot_status` | `std_msgs/msg/String` | 미션 상태와 명령 결과 표시 |
| ROS → Web | `/robot_pose` | `geometry_msgs/msg/PoseWithCovarianceStamped` | 지도 위치와 로봇 전방 방향 표시 |
| ROS → Web | `/robot_pose_status` | `std_msgs/msg/String` | 현재 위치 출처 표시 |
| ROS → Web | `/mission_route_points` | `std_msgs/msg/String` | 경로 JSON 구독 및 파싱 오류 표시 |

### SAFE 및 FORCE 수동 조종

- 기존 `EMERGENCY → /cmd_vel` 수동 조종 구조를 제거하고, 비상 정지와 수동 조종을 별도 기능으로 분리했습니다.
- `Manual Ctrl` 버튼을 짧게 누르면 SAFE 수동 조종 화면이 열립니다.
- `Manual Ctrl` 버튼을 약 3초 동안 길게 누르면 진행 표시줄과 함께 FORCE가 준비됩니다.
- FORCE는 상시 모드로 남지 않습니다. 준비 후 **다음 한 번의 조이스틱 조작만** `/cmd_vel_web_force`로 보내며, 손을 떼는 즉시 0 속도를 발행하고 SAFE로 자동 복귀합니다.
- 조이스틱을 누르는 동안 최신 Twist를 15 Hz로 반복 발행합니다. `pointerup`, `pointercancel`, `pointerleave`, 브라우저 blur, 탭 숨김, 연결 종료 시 송신을 중단하고 가능한 경우 0 속도를 한 번 발행합니다.
- 서버 상태가 `ERROR ...`이면 로컬 송신 루프를 즉시 중단하고 FORCE를 자동 재시도하지 않습니다.
- FORCE 화면은 붉은 경고 상태로 표시하며 카메라 확인과 저속 1회 조작을 안내합니다. 사람, 계단, 낙하 위험이 있는 곳에서는 사용하지 마십시오.

### 명령 상호잠금과 비상 정지

- `/web_teleop/active`를 아직 받지 못했거나 값이 `true`이면 START/HOME을 비활성화합니다.
- 조이스틱에서 손을 뗀 직후 바로 HOME을 보내지 말고, 서버 watchdog 처리 후 `active=false`가 표시될 때까지 기다려야 합니다.
- Map 화면의 `EMERGENCY`는 `ESTOP`을 발행하고 수동 송신을 즉시 중단합니다. 비상 정지 후 같은 버튼의 `RESET`을 눌러 latch 해제 명령을 보낼 수 있습니다.
- 수동 복구 뒤에는 START가 아니라 HOME을 사용합니다. 현재 START는 도킹 위치 출발 전용 시퀀스입니다.

### 2D Pose Estimate 변경

- `/web_teleop/active=false`인 경우에만 2D Pose 버튼과 `/initialpose` 발행을 허용합니다.
- 위치 출처가 `DOCKED` 또는 `DOCKED_ASSUMED`이면 2D Pose를 차단하고 다음 START의 자동 초기화를 사용하도록 안내합니다.
- 공분산은 x/y 표준편차 0.25 m, yaw 표준편차 15도 기준으로 설정했습니다.
- `/initialpose` 발행 이후에 실제로 새로 수신한 `/robot_pose`만 확인에 사용합니다. 기존 캐시 위치는 성공으로 처리하지 않습니다.
- 지도 마커에 `/robot_pose` quaternion으로 계산한 yaw 방향 화살표를 추가했습니다. Pose 전송 직후 HOME을 자동 실행하지 않으므로 운영자가 새 위치와 방향을 확인한 뒤 HOME을 눌러야 합니다.

### 주요 변경 파일

- `frontend/src/hooks/useWebTeleop.ts`: SAFE/FORCE publisher, 15 Hz 송신 루프, 정지 처리 및 웹 속도 제한
- `frontend/src/hooks/useDriveManagerStatus.ts`: drive_manager 상태·위치 출처·경로 subscriber
- `frontend/src/hooks/useRos.ts`: rosbridge 2초 자동 재연결
- `frontend/src/hooks/useRobotCommand.ts`: 명령 타입 확장과 START/HOME 상호잠금
- `frontend/src/pages/Map.tsx`: 3초 FORCE 준비, 1회 조작, 상태 UI, ESTOP/RESET, `/robot_pose` 적용
- `frontend/src/pages/Home.tsx`: `/robot_pose` 및 drive_manager 상태 적용, START/HOME 상호잠금
- `frontend/src/components/RosMap.tsx`: 2D Pose 제약, 새 위치 확인, 위치 출처 처리와 방향 표시
- `frontend/src/components/Joystick.tsx`: 누름 시작·해제·취소·이탈 이벤트 처리
- `frontend/src/config/rosTopics.ts`: drive_manager 웹 계약 토픽 정의

### 확인 방법

```bash
cd frontend
npm run build

# 서버 상태와 웹 송신 확인
ros2 topic echo /web_teleop/status
ros2 topic echo /web_teleop/active
ros2 topic hz /cmd_vel_web_safe
ros2 topic hz /cmd_vel_web_force
ros2 topic echo /robot_pose
ros2 topic echo /robot_pose_status
```

`npm run build`로 TypeScript 및 Vite 프로덕션 빌드를 확인했습니다. 현재 `npm run lint`는 프로젝트 devDependency에 `eslint-plugin-react-hooks`가 없어 ESLint 설정 로딩 단계에서 중단되므로, 린트를 사용하려면 해당 패키지를 먼저 추가해야 합니다.

### 웹 앱 통합 실행 스크립트

기존 사용자 systemd 서비스 `ccatfarm-backend.service`, `ccatfarm-frontend.service`는 수동 실행 스크립트와 포트가 충돌하지 않도록 중지하고 자동 시작을 해제했습니다. 프로젝트 루트에서 다음 명령 하나로 백엔드와 프런트엔드를 함께 실행할 수 있습니다.

```bash
./run_server.sh
```

스크립트는 프런트엔드 의존성이 없으면 `npm ci`를 실행하고, 최신 프로덕션 빌드를 생성한 뒤 다음 서버를 시작합니다.

- FastAPI 백엔드: `0.0.0.0:8001`
- Vite preview 프런트엔드: `0.0.0.0:5173`

실행 중인 터미널에서 `Ctrl+C`를 누르면 두 서버가 함께 종료됩니다. 포트와 Raspberry Pi 주소는 환경변수로 변경할 수 있습니다.

```bash
BACKEND_PORT=8001 FRONTEND_PORT=5173 RPI_IP=192.168.0.4 ./run_server.sh
```
