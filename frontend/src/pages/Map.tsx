import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, Wifi, WifiOff, Loader, ShieldAlert } from 'lucide-react'
import { useRos } from '../hooks/useRos'
import { useBattery } from '../hooks/useBattery'
import { useRobotCommand, type RobotCommand } from '../hooks/useRobotCommand'
import { useDriveManagerStatus } from '../hooks/useDriveManagerStatus'
import { useWebTeleop } from '../hooks/useWebTeleop'
import { useRobotMotion } from '../hooks/useRobotMotion'
import { TOPICS } from '../config/rosTopics'
import { recordZoneEntry, startNewSession, getCurrentSessionRoute } from '../utils/patrolStorage'
import CameraStream from '../components/CameraStream'
import Joystick from '../components/Joystick'
import RosMap from '../components/RosMap'
import { deriveServerTeleopState } from '../utils/forceMode'

declare const ROSLIB: typeof import('roslib')

interface RobotPose {
  x: number
  y: number
  z: number
  yaw: number
  receivedAt: number
}

const FORCE_HOLD_MS = 3000

function yawFromQuaternion(orientation: any) {
  const x = Number(orientation?.x ?? 0)
  const y = Number(orientation?.y ?? 0)
  const z = Number(orientation?.z ?? 0)
  const w = Number(orientation?.w ?? 1)
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
}

function robotStatusCode(status: string) {
  return status.trim().toUpperCase().split(/\s+/, 1)[0] ?? 'UNKNOWN'
}

export default function Map() {
  const [mode, setMode] = useState<'AUTO' | 'MANUAL'>('AUTO')
  const [emergency, setEmergency] = useState(false)
  const [forceHoldProgress, setForceHoldProgress] = useState(0)
  const [controlMessage, setControlMessage] = useState<string | null>(null)
  const [dockingInterlock, setDockingInterlock] = useState(false)
  const [manualStopRequested, setManualStopRequested] = useState(false)
  const [manualPosePending, setManualPosePending] = useState(false)
  const { ros, status } = useRos()
  const battery = useBattery(ros, status)
  const driveManager = useDriveManagerStatus(ros, status)
  const robotMotion = useRobotMotion(ros, status)
  const publishRobotCommand = useRobotCommand(ros, status, driveManager.teleopActive)
  const serverTeleop = deriveServerTeleopState(
    driveManager.teleopStatus,
    driveManager.teleopActive,
  )
  const currentRobotStatus = robotStatusCode(driveManager.robotStatus)
  const isDocking = currentRobotStatus === 'DOCKING'
  const manualInterlockActive = dockingInterlock || manualStopRequested
  const manualControlAllowed = status === 'connected'
    && !emergency
    && !manualInterlockActive
  const teleopCommandAllowed = manualControlAllowed
    && !serverTeleop.transitioningForce
    && !serverTeleop.transitioningSafe
    && !serverTeleop.error
  const teleop = useWebTeleop(ros, status, teleopCommandAllowed)
  const [pose, setPose] = useState<RobotPose | null>(null)
  const [visitedRoute, setVisitedRoute] = useState<string[]>(() => getCurrentSessionRoute())
  const sessionStartedRef = useRef(false)
  const forceTimeoutRef = useRef<number | null>(null)
  const forceProgressRef = useRef<number | null>(null)
  const forceTriggeredRef = useRef(false)

  useEffect(() => {
    if (status === 'connected' && !sessionStartedRef.current) {
      startNewSession()
      setVisitedRoute([])
      sessionStartedRef.current = true
    }
    if (status === 'disconnected' || status === 'error') {
      sessionStartedRef.current = false
      setPose(null)
    }
  }, [status])

  const handleZoneChange = useCallback((zoneName: string) => {
    recordZoneEntry(zoneName)
    setVisitedRoute(getCurrentSessionRoute())
  }, [])

  // drive_manager의 통합 위치 토픽만 지도와 Zone 판별에 사용합니다.
  useEffect(() => {
    if (!ros || status !== 'connected') return
    const poseTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.ROBOT_POSE.name,
      messageType: TOPICS.ROBOT_POSE.messageType,
      throttle_rate: 100,
      queue_length: 1,
    } as any)
    poseTopic.subscribe((message: any) => {
      const pos = message.pose?.pose?.position
      const orientation = message.pose?.pose?.orientation
      if (pos) {
        setPose({
          x: Number(pos.x),
          y: Number(pos.y),
          z: Number(pos.z),
          yaw: yawFromQuaternion(orientation),
          receivedAt: Date.now(),
        })
      }
    })
    return () => poseTopic.unsubscribe()
  }, [ros, status])

  useEffect(() => {
    if (!serverTeleop.error) return
    teleop.stop()
    setControlMessage(driveManager.teleopStatus)
  }, [driveManager.teleopStatus, serverTeleop.error, teleop.stop])

  useEffect(() => {
    if (serverTeleop.forceArmed) {
      setMode('MANUAL')
      setControlMessage('서버가 FORCE ARMED 상태를 확인했습니다.')
    }
  }, [serverTeleop.forceArmed])

  useEffect(() => () => {
    if (forceTimeoutRef.current !== null) window.clearTimeout(forceTimeoutRef.current)
    if (forceProgressRef.current !== null) window.clearInterval(forceProgressRef.current)
  }, [])

  const clearForceHoldTimers = useCallback(() => {
    if (forceTimeoutRef.current !== null) window.clearTimeout(forceTimeoutRef.current)
    if (forceProgressRef.current !== null) window.clearInterval(forceProgressRef.current)
    forceTimeoutRef.current = null
    forceProgressRef.current = null
  }, [])

  const resetManualUi = useCallback(() => {
    clearForceHoldTimers()
    forceTriggeredRef.current = false
    setForceHoldProgress(0)
    teleop.stop()
    teleop.requestMode('safe')
    setMode('AUTO')
  }, [clearForceHoldTimers, teleop.requestMode, teleop.stop])

  useEffect(() => {
    if (!isDocking) return
    setDockingInterlock(true)
    resetManualUi()
    setControlMessage('DOCKING 중에는 SAFE/FORCE 수동 조종이 잠깁니다.')
  }, [isDocking, resetManualUi])

  useEffect(() => {
    if (!dockingInterlock || manualStopRequested) return
    if (currentRobotStatus !== 'SUCCEEDED') return
    setDockingInterlock(false)
    setControlMessage('도킹이 정상 완료되어 수동 조종 잠금이 해제되었습니다.')
  }, [currentRobotStatus, dockingInterlock, manualStopRequested])

  useEffect(() => {
    if (!manualStopRequested) return
    if (currentRobotStatus !== 'STOPPED') return
    if (!robotMotion.fresh || !robotMotion.stationary) return

    setManualStopRequested(false)
    setDockingInterlock(false)
    setControlMessage('STOPPED와 실제 정지를 확인했습니다. 수동 조종을 사용할 수 있습니다.')
  }, [currentRobotStatus, manualStopRequested, robotMotion.fresh, robotMotion.stationary])

  const handleManualPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!manualControlAllowed) return
    event.currentTarget.setPointerCapture(event.pointerId)
    clearForceHoldTimers()
    forceTriggeredRef.current = false
    setForceHoldProgress(0)

    if (serverTeleop.forceArmed || serverTeleop.transitioningForce) {
      forceTriggeredRef.current = true
      teleop.stopForce()
      teleop.requestMode('safe')
      setControlMessage('SAFE 전환을 요청했습니다. 서버 확인을 기다립니다.')
      return
    }

    const startedAt = Date.now()

    forceProgressRef.current = window.setInterval(() => {
      setForceHoldProgress(Math.min(100, ((Date.now() - startedAt) / FORCE_HOLD_MS) * 100))
    }, 50)
    forceTimeoutRef.current = window.setTimeout(() => {
      forceTriggeredRef.current = true
      teleop.stop()
      if (!teleop.requestMode('force')) {
        setControlMessage('FORCE 요청을 전송하지 못했습니다. ROS 연결을 확인하세요.')
        clearForceHoldTimers()
        return
      }
      setMode('MANUAL')
      setForceHoldProgress(100)
      setControlMessage('FORCE 전환을 요청했습니다. 서버 확인 전에는 조작할 수 없습니다.')
      clearForceHoldTimers()
    }, FORCE_HOLD_MS)
  }

  const handleManualPointerUp = () => {
    clearForceHoldTimers()
    setForceHoldProgress(0)
    if (forceTriggeredRef.current) {
      forceTriggeredRef.current = false
      return
    }

    teleop.stop()
    teleop.requestMode('safe')
    setMode('MANUAL')
    setControlMessage('SAFE 수동 조종이 준비되었습니다.')
  }

  const handleManualPointerCancel = useCallback(() => {
    clearForceHoldTimers()
    setForceHoldProgress(0)
    if (forceTriggeredRef.current) {
      teleop.stop()
      teleop.requestMode('safe')
      setControlMessage('FORCE 준비가 취소되어 SAFE로 복귀했습니다.')
    }
    forceTriggeredRef.current = false
  }, [clearForceHoldTimers, teleop.requestMode, teleop.stop])

  useEffect(() => {
    const cancelForceHold = () => {
      if (document.hidden || forceTimeoutRef.current !== null) handleManualPointerCancel()
    }
    window.addEventListener('blur', handleManualPointerCancel)
    document.addEventListener('visibilitychange', cancelForceHold)
    return () => {
      window.removeEventListener('blur', handleManualPointerCancel)
      document.removeEventListener('visibilitychange', cancelForceHold)
    }
  }, [handleManualPointerCancel])

  const selectAutoMode = () => {
    teleop.stop()
    teleop.requestMode('safe')
    setMode('AUTO')
    setControlMessage('수동 입력을 해제했습니다. 서버의 active=false를 기다리세요.')
  }

  const handleJoystickMove = useCallback((linear: number, angular: number) => {
    if (mode !== 'MANUAL' || !teleopCommandAllowed) return
    teleop.move(serverTeleop.forceArmed ? 'force' : 'safe', linear, angular)
  }, [mode, serverTeleop.forceArmed, teleop.move, teleopCommandAllowed])

  const handleJoystickStop = useCallback(() => {
    teleop.stop()
    if (serverTeleop.forceArmed) {
      setControlMessage('로봇 정지. FORCE ARMED는 유지되며 버튼을 다시 누르면 해제됩니다.')
    }
  }, [serverTeleop.forceArmed, teleop.stop])

  const sendMissionCommand = (command: RobotCommand) => {
    setControlMessage(null)
    if (!publishRobotCommand(command)) {
      setControlMessage('수동 조종이 완전히 해제(active=false)된 뒤 실행할 수 있습니다.')
    }
  }

  const handleEmergency = () => {
    teleop.stop()
    teleop.requestMode('safe')
    setMode('AUTO')
    if (emergency) {
      publishRobotCommand('RESET')
      setEmergency(false)
      setControlMessage('ESTOP latch 해제 명령을 전송했습니다.')
    } else {
      publishRobotCommand('ESTOP')
      setEmergency(true)
      setControlMessage('비상 정지 명령을 전송했습니다. RESET 전까지 주행할 수 없습니다.')
    }
  }

  const requestManualIntervention = () => {
    resetManualUi()
    setDockingInterlock(true)
    if (!publishRobotCommand('STOP')) {
      setControlMessage('STOP 명령을 전송하지 못했습니다. ROS 연결을 확인하세요.')
      return
    }
    setManualStopRequested(true)
    setControlMessage('STOP 전송됨: STOPPED 상태와 /odom 정지를 확인하고 있습니다.')
  }

  const missionCommandEnabled = status === 'connected'
    && driveManager.teleopActive === false
    && serverTeleop.released
    && !serverTeleop.transitioningSafe
    && !emergency
    && !manualInterlockActive
  const startCommandEnabled = missionCommandEnabled && !manualPosePending

  const statusIcon = {
    connecting: <Loader size={14} className="spin" />,
    connected: <Wifi size={14} color="#22c55e" />,
    disconnected: <WifiOff size={14} color="#9ca3af" />,
    error: <WifiOff size={14} color="#ef4444" />,
  }[status]

  const statusLabel = {
    connecting: '연결 중...',
    connected: '연결됨',
    disconnected: '연결 끊김',
    error: '연결 오류',
  }[status]

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">MAP</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="ros-status-badge">{statusIcon}<span>{statusLabel}</span></div>
          <Bell size={20} className="header-icon" />
        </div>
      </header>

      <div className="page-content">
        <div className="camera-feed">
          <CameraStream ros={ros} status={status} />
          <div className="camera-overlay">
            <span className="camera-tag red">
              {pose ? `● X:${pose.x.toFixed(1)} Y:${pose.y.toFixed(1)}` : '● 위치 대기'}
            </span>
            <div className="camera-stats">
              <span>🔋 {battery ? `${battery.percentage}%` : '--'}</span>
              <span>{new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>

        <RosMap
          ros={ros}
          status={status}
          robotPose={pose}
          teleopActive={driveManager.teleopActive}
          robotStatus={driveManager.robotStatus}
          robotStatusSequence={driveManager.robotStatusSequence}
          onManualPosePendingChange={setManualPosePending}
          patrolRoute={visitedRoute}
          onZoneChange={handleZoneChange}
        />

        <div className="card">
          <p className="card-label">ROBOT POSITION (/robot_pose)</p>
          {status === 'connected' && pose ? (
            <>
              <div className="pose-grid">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <div key={axis} className="pose-item">
                    <span className="pose-axis">{axis.toUpperCase()}</span>
                    <span className="pose-val">{pose[axis].toFixed(3)}</span>
                  </div>
                ))}
              </div>
              <div className="pose-source">SOURCE: {driveManager.robotPoseSource} · YAW: {pose.yaw.toFixed(2)} rad</div>
            </>
          ) : (
            <div className="pose-empty">
              {status === 'connecting' && <><Loader size={14} className="spin" /> 로봇 연결 중...</>}
              {status === 'connected' && !pose && '위치 데이터 수신 대기 중...'}
              {status === 'disconnected' && '로봇과 연결되지 않았습니다.'}
              {status === 'error' && '연결 오류 — rosbridge_server를 확인하세요.'}
            </div>
          )}
        </div>

        <div className="mode-row">
          <div className="mode-box">
            <span className="mode-label">MODE</span>
            <div className="mode-toggle">
              <button className={mode === 'AUTO' ? 'active' : ''} onClick={selectAutoMode}>AUTO Patrol</button>
              <button
                className={`${mode === 'MANUAL' ? 'active' : ''} ${serverTeleop.forceArmed ? 'force' : ''}`}
                onPointerDown={handleManualPointerDown}
                onPointerUp={handleManualPointerUp}
                onPointerCancel={handleManualPointerCancel}
                disabled={!manualControlAllowed || serverTeleop.transitioningSafe}
                title="짧게 누르면 SAFE, 3초간 길게 누르면 지속형 FORCE, FORCE ARMED를 다시 누르면 해제"
              >
                {serverTeleop.forceArmed
                  ? '⚠ FORCE ARMED'
                  : serverTeleop.transitioningForce
                    ? 'FORCE 전환 중'
                    : serverTeleop.transitioningSafe
                      ? 'SAFE 전환 중'
                      : 'Manual Ctrl'}
                {forceHoldProgress > 0 && (
                  <span className="force-hold-progress" style={{ width: `${forceHoldProgress}%` }} />
                )}
              </button>
            </div>
          </div>
          <div className="progress-info">
            <span className="mode-label">TELEOP SERVER</span>
            <span className={`teleop-state ${serverTeleop.forceArmed ? 'force' : ''}`}>
              {driveManager.teleopStatus}
            </span>
            <span className="teleop-active">active: {String(driveManager.teleopActive ?? 'unknown')}</span>
          </div>
        </div>

        {controlMessage && <div className={`control-message ${serverTeleop.forceArmed || serverTeleop.transitioningForce ? 'danger' : ''}`}>{controlMessage}</div>}
        {driveManager.routeError && <div className="control-message danger">{driveManager.routeError}</div>}

        {manualInterlockActive && (
          <div className="card docking-interlock-card">
            <div className="docking-interlock-title"><ShieldAlert size={16} /> DOCKING MANUAL INTERLOCK</div>
            <p>
              {isDocking
                ? '도킹 프로세스가 /cmd_vel을 사용할 수 있어 SAFE/FORCE를 차단했습니다.'
                : 'STOPPED와 실제 로봇 정지를 확인할 때까지 수동 조종을 차단합니다.'}
            </p>
            <div className="docking-interlock-state">
              <span>ROBOT: {driveManager.robotStatus}</span>
              <span>
                ODOM: {robotMotion.fresh
                  ? `${robotMotion.stationary ? 'STOPPED' : 'MOVING'} · ${robotMotion.linearSpeed.toFixed(3)} m/s · ${robotMotion.angularSpeed.toFixed(3)} rad/s`
                  : 'WAITING / STALE'}
              </span>
            </div>
            <button
              type="button"
              className="docking-stop-button"
              onClick={requestManualIntervention}
              disabled={status !== 'connected'}
            >
              {manualStopRequested ? 'STOP 재전송' : 'STOP 후 수동 개입'}
            </button>
          </div>
        )}

        {mode === 'MANUAL' && manualControlAllowed && (
          <div className={`card dpad-card ${serverTeleop.forceArmed ? 'force-card' : ''}`}>
            <p className="card-label teleop-card-label">
              {serverTeleop.forceArmed
                ? <><ShieldAlert size={14} /> FORCE — CAMERA 확인 필수</>
                : serverTeleop.transitioningForce
                  ? 'FORCE 전환 확인 대기'
                  : serverTeleop.transitioningSafe
                    ? 'SAFE 전환 확인 대기'
                    : 'SAFE MANUAL CONTROL'}
            </p>
            <Joystick
              onMove={handleJoystickMove}
              onStop={handleJoystickStop}
              disabled={!teleopCommandAllowed}
            />
            <p className="teleop-help">
              {serverTeleop.forceArmed
                ? '조이스틱을 놓으면 정지하지만 FORCE ARMED는 유지됩니다. 버튼을 다시 눌러 해제하세요.'
                : serverTeleop.transitioningForce
                  ? '서버가 FORCE 상태를 발행할 때까지 조이스틱 입력이 차단됩니다.'
                  : serverTeleop.transitioningSafe
                    ? 'SAFE와 active=false 확인 전까지 조작과 START/HOME이 차단됩니다.'
                    : 'FORCE가 필요하면 Manual Ctrl을 3초간 길게 누르세요.'}
            </p>
          </div>
        )}

        <div className="robot-status-line">
          <span>ROBOT</span><strong>{driveManager.robotStatus}</strong>
        </div>

        <div className="robot-actions">
          <button className="action-btn start" onClick={() => sendMissionCommand('START')} disabled={!startCommandEnabled}>START</button>
          <button className="action-btn home" onClick={() => sendMissionCommand('HOME')} disabled={!missionCommandEnabled}>HOME</button>
          <button
            className={`action-btn emergency ${emergency ? 'emergency-active' : ''}`}
            onClick={handleEmergency}
            disabled={status !== 'connected'}
          >
            {emergency ? 'RESET' : 'EMERGENCY'}
          </button>
        </div>
      </div>
    </div>
  )
}
