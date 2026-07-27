/**
 * CCATFARM Robot — ROS 2 토픽 정의
 * rosbridge를 통해 웹 앱에서 구독/퍼블리시할 토픽 목록
 *
 * 로봇 실행 시 `ros2 topic list`로 확인된 토픽 기반 정리
 */

// ═══════════════════════════════════════════════
// 1. 주행 제어 (Navigation)
// ═══════════════════════════════════════════════
export const TOPICS = {
  // 충돌 보호 경로를 사용하는 기본 웹 수동 조종
  CMD_VEL_WEB_SAFE: {
    name: '/cmd_vel_web_safe',
    messageType: 'geometry_msgs/msg/Twist',
    direction: 'publish' as const,
    description: 'collision monitor를 통과하는 웹 수동 조종 명령',
  },

  // collision monitor를 우회하는 저속 탈출 전용 수동 조종
  CMD_VEL_WEB_FORCE: {
    name: '/cmd_vel_web_force',
    messageType: 'geometry_msgs/msg/Twist',
    direction: 'publish' as const,
    description: 'Nav2 PAUSE 확인 후 사용하는 저속 force 명령',
  },

  // 웹에서 drive_manager에 지속형 SAFE/FORCE 모드 전환을 명시적으로 요청
  WEB_TELEOP_MODE_REQUEST: {
    name: '/web_teleop/mode_request',
    messageType: 'std_msgs/msg/String',
    direction: 'publish' as const,
    description: '웹 수동 조종 모드 요청 (SAFE, FORCE)',
  },

  // 로봇 상위 명령 (퍼블리시) — START/HOME/ESTOP
  ROBOT_COMMAND: {
    name: '/robot_command',
    messageType: 'std_msgs/msg/String',
    direction: 'publish' as const,
    description: '로봇 상위 제어 명령',
  },

  // 오도메트리 (구독) — 로봇 이동 거리, 속도
  ODOM: {
    name: '/odom',
    messageType: 'nav_msgs/msg/Odometry',
    direction: 'subscribe' as const,
    description: '휠 엔코더 기반 위치/속도 추정',
  },

  // 지도 (구독) — SLAM/Navigation 맵 표시
  MAP: {
    name: '/map',
    messageType: 'nav_msgs/msg/OccupancyGrid',
    direction: 'subscribe' as const,
    description: '2D 점유 격자 지도',
  },

  // AMCL 위치 추정 (구독) — 현재 로봇 위치 표시
  AMCL_POSE: {
    name: '/amcl_pose',
    messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    direction: 'subscribe' as const,
    description: 'AMCL 기반 로봇 위치 추정',
  },

  // drive_manager가 제공하는 현재 위치의 단일 입력
  ROBOT_POSE: {
    name: '/robot_pose',
    messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    direction: 'subscribe' as const,
    description: 'AMCL 또는 도킹 고정 위치를 통합한 로봇 위치',
  },

  ROBOT_POSE_STATUS: {
    name: '/robot_pose_status',
    messageType: 'std_msgs/msg/String',
    direction: 'subscribe' as const,
    description: '로봇 위치 출처 (AMCL, DOCKED, DOCKED_ASSUMED)',
  },

  WEB_TELEOP_STATUS: {
    name: '/web_teleop/status',
    messageType: 'std_msgs/msg/String',
    direction: 'subscribe' as const,
    description: '웹 수동 조종 전환 및 오류 상태',
  },

  WEB_TELEOP_ACTIVE: {
    name: '/web_teleop/active',
    messageType: 'std_msgs/msg/Bool',
    direction: 'subscribe' as const,
    description: '수동 조종 또는 전환 진행 여부',
  },

  ROBOT_STATUS: {
    name: '/robot_status',
    messageType: 'std_msgs/msg/String',
    direction: 'subscribe' as const,
    description: '미션 상태 및 명령 처리 결과',
  },

  MISSION_ROUTE_POINTS: {
    name: '/mission_route_points',
    messageType: 'std_msgs/msg/String',
    direction: 'subscribe' as const,
    description: 'HOME/순회 좌표와 실제 주행 순서 JSON',
  },

  // 2D Pose Estimate (퍼블리시) — 초기 위치 지정
  INITIAL_POSE: {
    name: '/initialpose',
    messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped',
    direction: 'publish' as const,
    description: '지도 위에서 지정한 초기 위치와 방향',
  },

  // TF 변환 (구독) — 좌표계 변환 정보
  TF: {
    name: '/tf',
    messageType: 'tf2_msgs/msg/TFMessage',
    direction: 'subscribe' as const,
    description: '프레임 간 좌표 변환',
  },

  TF_STATIC: {
    name: '/tf_static',
    messageType: 'tf2_msgs/msg/TFMessage',
    direction: 'subscribe' as const,
    description: '정적 좌표 변환 (센서 마운트 등)',
  },

  // ═══════════════════════════════════════════════
  // 2. 센서 — LiDAR
  // ═══════════════════════════════════════════════
  SCAN: {
    name: '/scan',
    messageType: 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe' as const,
    description: '2D LiDAR 스캔 데이터 (SLAM, 장애물 감지)',
  },

  SCAN_2: {
    name: '/scan_2',
    messageType: 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe' as const,
    description: '보조 LiDAR 또는 필터링된 스캔',
  },

  SCAN_FILTERED: {
    name: '/scan_filtered',
    messageType: 'sensor_msgs/msg/LaserScan',
    direction: 'subscribe' as const,
    description: '노이즈 제거된 LiDAR 스캔',
  },

  // ═══════════════════════════════════════════════
  // 3. 센서 — IMU
  // ═══════════════════════════════════════════════
  IMU_DATA: {
    name: '/imu/data',
    messageType: 'sensor_msgs/msg/Imu',
    direction: 'subscribe' as const,
    description: 'IMU 융합 데이터 (가속도+자이로+자세)',
  },

  IMU_DATA_RAW: {
    name: '/imu/data_raw',
    messageType: 'sensor_msgs/msg/Imu',
    direction: 'subscribe' as const,
    description: 'IMU 원시 데이터',
  },

  IMU_MAG: {
    name: '/imu/mag',
    messageType: 'sensor_msgs/msg/MagneticField',
    direction: 'subscribe' as const,
    description: '지자기 센서 데이터',
  },

  IMU_YAW: {
    name: '/imu/yaw',
    messageType: 'std_msgs/msg/Float64',
    direction: 'subscribe' as const,
    description: '로봇 Yaw 각도 (방향)',
  },

  // ═══════════════════════════════════════════════
  // 4. 센서 — 카메라 (Intel RealSense D435)
  // ═══════════════════════════════════════════════
  CAMERA_COLOR: {
    name: '/camera/camera/color/image_raw',
    messageType: 'sensor_msgs/msg/Image',
    direction: 'subscribe' as const,
    description: 'RGB 컬러 이미지 (원본)',
  },

  CAMERA_COLOR_COMPRESSED: {
    name: '/camera/camera/color/image_raw/compressed',
    messageType: 'sensor_msgs/msg/CompressedImage',
    direction: 'subscribe' as const,
    description: 'RGB 이미지 (JPEG 압축) — 웹 스트리밍에 적합',
  },

  CAMERA_COLOR_INFO: {
    name: '/camera/camera/color/camera_info',
    messageType: 'sensor_msgs/msg/CameraInfo',
    direction: 'subscribe' as const,
    description: '컬러 카메라 내부 파라미터',
  },

  CAMERA_DEPTH: {
    name: '/camera/camera/depth/image_rect_raw',
    messageType: 'sensor_msgs/msg/Image',
    direction: 'subscribe' as const,
    description: '깊이(Depth) 이미지',
  },

  CAMERA_DEPTH_COMPRESSED: {
    name: '/camera/camera/depth/image_rect_raw/compressed',
    messageType: 'sensor_msgs/msg/CompressedImage',
    direction: 'subscribe' as const,
    description: '깊이 이미지 (압축)',
  },

  CAMERA_DEPTH_INFO: {
    name: '/camera/camera/depth/camera_info',
    messageType: 'sensor_msgs/msg/CameraInfo',
    direction: 'subscribe' as const,
    description: '깊이 카메라 내부 파라미터',
  },

  // ═══════════════════════════════════════════════
  // 5. 배터리 (SK120 BMS)
  // ═══════════════════════════════════════════════
  BATTERY_STATE: {
    name: '/battery_state',
    messageType: 'sensor_msgs/msg/BatteryState',
    direction: 'subscribe' as const,
    description: '배터리 종합 상태 (전압, 전류, SOC 등)',
  },

  SK120_VOLTAGE: {
    name: '/sk120/voltage_out',
    messageType: 'std_msgs/msg/Float32',
    direction: 'subscribe' as const,
    description: '배터리 출력 전압 (V)',
  },

  SK120_CURRENT: {
    name: '/sk120/current_out',
    messageType: 'std_msgs/msg/Float32',
    direction: 'subscribe' as const,
    description: '배터리 출력 전류 (A)',
  },

  SK120_CURRENT_SET: {
    name: '/sk120/current_set',
    messageType: 'std_msgs/msg/Float32',
    direction: 'subscribe' as const,
    description: '충전 전류 설정값',
  },

  SK120_OUTPUT_ON: {
    name: '/sk120/output_on',
    messageType: 'std_msgs/msg/Bool',
    direction: 'subscribe' as const,
    description: '전원 출력 ON/OFF 상태',
  },

  SK120_AVAILABLE: {
    name: '/sk120/available',
    messageType: 'std_msgs/msg/Bool',
    direction: 'subscribe' as const,
    description: 'BMS 통신 가능 여부',
  },

  SK120_CMD_OUTPUT: {
    name: '/sk120/cmd_output',
    messageType: 'std_msgs/msg/Bool',
    direction: 'publish' as const,
    description: '전원 출력 ON/OFF 명령',
  },

  // ═══════════════════════════════════════════════
  // 6. 기구부 — 리니어 액추에이터
  // ═══════════════════════════════════════════════
  LINEAR: {
    name: '/linear',
    messageType: 'std_msgs/msg/Float32',
    direction: 'publish' as const,
    description: '리니어 액추에이터 높이 제어 (Z축)',
  },

  JOINT_STATES: {
    name: '/joint_states',
    messageType: 'sensor_msgs/msg/JointState',
    direction: 'subscribe' as const,
    description: '관절 상태 (리니어 위치 등)',
  },

  // ═══════════════════════════════════════════════
  // 7. 시스템 진단
  // ═══════════════════════════════════════════════
  DIAGNOSTICS: {
    name: '/diagnostics',
    messageType: 'diagnostic_msgs/msg/DiagnosticArray',
    direction: 'subscribe' as const,
    description: '시스템 전체 진단 정보 (에러, 경고)',
  },
} as const

// ═══════════════════════════════════════════════
// 웹 앱에서 주로 사용할 토픽 요약
// ═══════════════════════════════════════════════
//
// ┌─────────────────┬──────────────────────────────────────────┬──────────┐
// │ 기능             │ 토픽                                      │ 용도      │
// ├─────────────────┼──────────────────────────────────────────┼──────────┤
// │ 로봇 위치        │ /robot_pose                              │ 지도/Zone │
// │ 기본 수동 제어   │ /cmd_vel_web_safe                        │ 조이스틱   │
// │ 탈출 수동 제어   │ /cmd_vel_web_force                       │ 저속 FORCE │
// │ 배터리 잔량      │ /battery_state                           │ SOC 표시  │
// │ 배터리 전압      │ /sk120/voltage_out                       │ 상세 모니터│
// │ 카메라 스트리밍   │ /camera/camera/color/image_raw/compressed│ 영상 표시  │
// │ LiDAR 맵        │ /scan_filtered                           │ 장애물 시각│
// │ 시스템 상태      │ /diagnostics                             │ 에러 알림  │
// │ 리니어 높이      │ /linear                                  │ 높이 제어  │
// └─────────────────┴──────────────────────────────────────────┴──────────┘
