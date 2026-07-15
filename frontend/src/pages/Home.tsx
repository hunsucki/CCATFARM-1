import { useEffect, useState } from 'react'
import { Bell, ChevronRight, BatteryCharging, Battery } from 'lucide-react'
import { useRos } from '../hooks/useRos'
import { useBattery } from '../hooks/useBattery'
import { useDiagnostics } from '../hooks/useDiagnostics'
import { useRobotCommand } from '../hooks/useRobotCommand'
import { useDriveManagerStatus } from '../hooks/useDriveManagerStatus'
import { TOPICS } from '../config/rosTopics'
import { getZoneName, ZONES } from '../utils/zoneMap'

declare const ROSLIB: typeof import('roslib')

interface RobotState {
  zone: string
  x: number
  y: number
  isRunning: boolean
}

export default function Home() {
  const { ros, status } = useRos()
  const battery = useBattery(ros, status)
  const diagnostics = useDiagnostics(ros, status, 5)
  const driveManager = useDriveManagerStatus(ros, status)
  const publishRobotCommand = useRobotCommand(ros, status, driveManager.teleopActive)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [robot, setRobot] = useState<RobotState>({
    zone: '---',
    x: 0,
    y: 0,
    isRunning: false,
  })

  // drive_manager의 통합 /robot_pose 구독 → Zone 판별
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
      if (pos) {
        const zone = getZoneName(pos.x, pos.y)
        setRobot({ x: pos.x, y: pos.y, zone, isRunning: true })
      }
    })

    return () => poseTopic.unsubscribe()
  }, [ros, status])

  const connected = status === 'connected'
  const missionCommandEnabled = connected && driveManager.teleopActive === false
  const batteryLow = battery && battery.percentage <= 20

  const sendMissionCommand = (command: 'START' | 'HOME') => {
    setCommandError(null)
    if (!publishRobotCommand(command)) {
      setCommandError('수동 조종 해제(active=false)를 확인한 뒤 실행할 수 있습니다.')
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">CCATFARM ROBOT</h1>
        <Bell size={20} className="header-icon" />
      </header>

      <div className="page-content">
        {/* Robot Control Card */}
        <div className="card">
          <p className="card-label">CCATFARM ROBOT</p>
          <div className="robot-controls">
            <button className="ctrl-btn zone" style={{ fontWeight: 700 }}>
              {robot.zone}
            </button>
            <button className={`ctrl-btn ${connected && robot.isRunning ? 'running' : ''}`}>
              {connected ? driveManager.robotStatus : 'OFFLINE'}
            </button>
            <button className={`ctrl-btn off ${batteryLow ? 'battery-low' : ''}`}>
              {battery ? (
                <>
                  {battery.isCharging ? <BatteryCharging size={14} /> : <Battery size={14} />}
                  {' '}{battery.percentage}%
                </>
              ) : (
                'OFF'
              )}
              <br /><span>{battery ? `${battery.voltage.toFixed(1)}V` : 'Battery Power'}</span>
            </button>
          </div>
          <div className="progress-bar-wrap">
            <div
              className="progress-bar"
              style={{
                width: battery ? `${battery.percentage}%` : '0%',
                background: batteryLow ? '#ef4444' : battery?.isCharging ? '#22c55e' : '#3b5bdb',
              }}
            />
          </div>
          <div className="robot-actions">
            <button
              className="action-btn start"
              onClick={() => sendMissionCommand('START')}
              disabled={!missionCommandEnabled}
            >
              START
            </button>
            <button
              className="action-btn home"
              onClick={() => sendMissionCommand('HOME')}
              disabled={!missionCommandEnabled}
            >
              HOME
            </button>
            <button
              className="action-btn emergency"
              onClick={() => publishRobotCommand('ESTOP')}
              disabled={!connected}
            >
              EMERGENCY
            </button>
          </div>
        </div>

        {/* Alerts Card */}
        <div className="card">
          <p className="card-label">ALERTS</p>
          <div className="alert-list">
            {!connected && (
              <div className="alert-item red">
                ⚠ 로봇 연결 끊김 — rosbridge 확인 필요
              </div>
            )}
            {commandError && <div className="alert-item warn">⚠ {commandError}</div>}
            {driveManager.teleopActive && (
              <div className="alert-item warn">⚠ 수동 조종 중 — START/HOME 잠금</div>
            )}
            {driveManager.teleopStatus.startsWith('ERROR') && (
              <div className="alert-item red">❌ {driveManager.teleopStatus}</div>
            )}
            {connected && (
              <div className="alert-item status-info">
                위치: {driveManager.robotPoseSource} · TELEOP: {driveManager.teleopStatus}
              </div>
            )}
            {batteryLow && (
              <div className="alert-item red">
                🔋 배터리 부족 ({battery!.percentage}%) — 충전 필요
              </div>
            )}
            {diagnostics.map((d, i) => (
              <div key={i} className={`alert-item ${d.level >= 2 ? 'red' : 'warn'}`}>
                {d.level >= 2 ? '❌' : '⚠'} [{d.name}] {d.message}
              </div>
            ))}
            {connected && !batteryLow && diagnostics.length === 0 && (
              <div style={{ padding: '8px', fontSize: 12, color: '#22c55e' }}>
                ✓ 시스템 정상
              </div>
            )}
          </div>
        </div>

        {/* Overall Crop Health Card */}
        <div className="card">
          <div className="card-header-row">
            <p className="card-label">OVERALL CROP HEALTH</p>
            <ChevronRight size={16} />
          </div>
          <div className="crop-health">
            <div className="donut-wrap">
              <svg viewBox="0 0 80 80" width="80" height="80">
                <circle cx="40" cy="40" r="30" fill="none" stroke="var(--border-light, #353b4f)" strokeWidth="10" />
              </svg>
              <div className="donut-label"><span className="donut-num">--</span><br />CROPS</div>
            </div>
            <div className="zone-list">
              {(ZONES.length > 0 ? ZONES : [
                { name: 'Zone A', color: '#22c55e' },
                { name: 'Zone B', color: '#3b82f6' },
                { name: 'Zone C', color: '#f59e0b' },
                { name: 'Zone D', color: '#8b5cf6' },
                { name: 'Zone E', color: '#ef4444' },
                { name: 'Zone F', color: '#06b6d4' },
              ]).map((z, i) => (
                <div key={i} className="zone-row">
                  <span className="zone-dot" style={{ background: z.color }} />
                  <span className="zone-name" style={{
                    fontWeight: robot.zone === z.name ? 700 : 400,
                    color: robot.zone === z.name ? z.color : undefined,
                  }}>
                    {z.name} {robot.zone === z.name && '← 로봇'}
                  </span>
                  <ChevronRight size={12} />
                </div>
              ))}
            </div>
          </div>
          <div className="legend">
            <span className="legend-dot green" /> NORMAL
            <span className="legend-dot red" style={{ marginLeft: 12 }} /> ABNORMAL
          </div>
        </div>

        {/* Scheduling Info */}
        <div className="card">
          <p className="card-label">SCHEDULING INFO.</p>
          <div className="schedule-box" />
        </div>
      </div>
    </div>
  )
}
