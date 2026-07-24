import { useRef, useEffect, useState, useCallback } from 'react'
import { Check, Crosshair, X, Grid3X3 } from 'lucide-react'
import type { UseRosReturn } from '../hooks/useRos'
import { TOPICS } from '../config/rosTopics'
import { ZONES, generateZonesFromMap, getZoneFromPose, type ZoneBounds } from '../utils/zoneMap'
import {
  buildInitialPoseMessage,
  canSetManualInitialPose,
  isNewManualNav2Ready,
  yawFromDrag,
  type PoseEstimate,
} from '../utils/initialPose'

declare const ROSLIB: typeof import('roslib')

interface MapMeta {
  width: number
  height: number
  resolution: number
  origin: { x: number; y: number }
}

interface RosMapProps {
  ros: UseRosReturn['ros']
  status: UseRosReturn['status']
  robotPose?: { x: number; y: number; yaw?: number; receivedAt?: number } | null
  /** true일 때만 2D Pose Estimate를 차단 */
  teleopActive?: boolean | null
  robotStatus?: string
  robotStatusSequence?: number
  onManualPosePendingChange?: (pending: boolean) => void
  /** 순회 경로 (Zone name 배열, 예: ['Zone A', 'Zone B']) */
  patrolRoute?: string[]
  /** 로봇이 Zone을 변경했을 때 콜백 */
  onZoneChange?: (zoneName: string) => void
}

type InitialPoseStatus =
  | { state: 'idle' }
  | { state: 'pending'; statusSequenceAtSend: number }
  | { state: 'ready' }

// 색상 팔레트 — 전술 관제 스타일 (맵은 어둡게)
const COLOR_FREE = [8, 18, 36]           // 배경 (이동 가능)
const COLOR_OCCUPIED = [0, 180, 200]     // 시안 계열 (벽/장애물)
const COLOR_UNKNOWN = [6, 12, 24]        // 더 어두운 (미탐색)
const MAP_THROTTLE_MS = Number(import.meta.env.VITE_MAP_THROTTLE_MS ?? 1000)

export default function RosMap({
  ros,
  status,
  robotPose,
  teleopActive = null,
  robotStatus = 'UNKNOWN',
  robotStatusSequence = 0,
  onManualPosePendingChange,
  patrolRoute,
  onZoneChange,
}: RosMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapDataRef = useRef<ImageData | null>(null)
  const [mapMeta, setMapMeta] = useState<MapMeta | null>(null)
  const [activeZones, setActiveZones] = useState<ZoneBounds[]>(ZONES)
  const [stationPos, setStationPos] = useState<{ x: number; y: number } | null>(null)
  const stationCaptured = useRef(false)
  const [hasMap, setHasMap] = useState(false)
  const [poseMode, setPoseMode] = useState(false)
  const [zoneEditMode, setZoneEditMode] = useState(false)
  const [zoneDraft, setZoneDraft] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [cursorCoord, setCursorCoord] = useState<{ x: number; y: number } | null>(null)
  const [poseDraft, setPoseDraft] = useState<PoseEstimate | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [initialPoseStatus, setInitialPoseStatus] = useState<InitialPoseStatus>({ state: 'idle' })

  const drawRobot = useCallback((ctx: CanvasRenderingContext2D, pose: { x: number; y: number; yaw?: number }, meta: MapMeta) => {
    const px = (pose.x - meta.origin.x) / meta.resolution
    const py = meta.height - (pose.y - meta.origin.y) / meta.resolution

    ctx.save()
    ctx.translate(px, py)

    // /robot_pose의 quaternion에서 계산한 전방 방향
    if (typeof pose.yaw === 'number') {
      ctx.save()
      ctx.rotate(-pose.yaw)
      ctx.beginPath()
      ctx.moveTo(5, 0)
      ctx.lineTo(23, 0)
      ctx.lineTo(17, -5)
      ctx.moveTo(23, 0)
      ctx.lineTo(17, 5)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }

    // 외부 펄스 링 (라임 글로우)
    ctx.beginPath()
    ctx.arc(0, 0, 16, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.2)'
    ctx.lineWidth = 1
    ctx.stroke()

    // 중간 링
    ctx.beginPath()
    ctx.arc(0, 0, 11, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.4)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // 코어 원 (라임 그린)
    ctx.beginPath()
    ctx.arc(0, 0, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#00e676'
    ctx.shadowColor = '#00e676'
    ctx.shadowBlur = 14
    ctx.fill()
    ctx.shadowBlur = 0

    // 내부 밝은 점
    ctx.beginPath()
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()

    // 십자선 (HUD 느낌)
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.5)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(-18, 0); ctx.lineTo(-8, 0)
    ctx.moveTo(8, 0); ctx.lineTo(18, 0)
    ctx.moveTo(0, -18); ctx.lineTo(0, -8)
    ctx.moveTo(0, 8); ctx.lineTo(0, 18)
    ctx.stroke()

    ctx.restore()
  }, [])

  const worldToCanvas = useCallback((pose: { x: number; y: number }, meta: MapMeta) => ({
    x: (pose.x - meta.origin.x) / meta.resolution,
    y: meta.height - (pose.y - meta.origin.y) / meta.resolution,
  }), [])

  const canvasToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas || !mapMeta) return null

    const rect = canvas.getBoundingClientRect()
    const px = (clientX - rect.left) * (canvas.width / rect.width)
    const py = (clientY - rect.top) * (canvas.height / rect.height)

    return {
      x: px * mapMeta.resolution + mapMeta.origin.x,
      y: (mapMeta.height - py) * mapMeta.resolution + mapMeta.origin.y,
    }
  }, [mapMeta])

  const drawPoseEstimate = useCallback((ctx: CanvasRenderingContext2D, pose: PoseEstimate, meta: MapMeta) => {
    const p = worldToCanvas(pose, meta)
    const arrowLength = 26
    const endX = p.x + Math.cos(pose.yaw) * arrowLength
    const endY = p.y - Math.sin(pose.yaw) * arrowLength

    ctx.beginPath()
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(34, 197, 94, 0.18)'
    ctx.fill()
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(endX, endY)
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.save()
    ctx.translate(endX, endY)
    ctx.rotate(-pose.yaw + Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.lineTo(5, 5)
    ctx.lineTo(-5, 5)
    ctx.closePath()
    ctx.fillStyle = '#16a34a'
    ctx.fill()
    ctx.restore()
  }, [worldToCanvas])

  const drawZoneOverlays = useCallback((ctx: CanvasRenderingContext2D, meta: MapMeta) => {
    for (const zone of activeZones) {
      const topLeft = worldToCanvas({ x: zone.xMin, y: zone.yMax }, meta)
      const bottomRight = worldToCanvas({ x: zone.xMax, y: zone.yMin }, meta)
      const w = bottomRight.x - topLeft.x
      const h = bottomRight.y - topLeft.y

      // 반투명 폴리곤 내부
      ctx.fillStyle = zone.color + '15'
      ctx.fillRect(topLeft.x, topLeft.y, w, h)

      // 외곽선 (글로우 효과)
      ctx.save()
      ctx.shadowColor = zone.color
      ctx.shadowBlur = 6
      ctx.strokeStyle = zone.color + 'aa'
      ctx.lineWidth = 1.5
      ctx.strokeRect(topLeft.x, topLeft.y, w, h)
      ctx.shadowBlur = 0
      ctx.restore()

      // 코너 마커 (전술 느낌)
      const cornerLen = 8
      ctx.strokeStyle = zone.color
      ctx.lineWidth = 2
      ctx.lineCap = 'square'
      // 좌상
      ctx.beginPath()
      ctx.moveTo(topLeft.x, topLeft.y + cornerLen); ctx.lineTo(topLeft.x, topLeft.y); ctx.lineTo(topLeft.x + cornerLen, topLeft.y)
      ctx.stroke()
      // 우상
      ctx.beginPath()
      ctx.moveTo(bottomRight.x - cornerLen, topLeft.y); ctx.lineTo(bottomRight.x, topLeft.y); ctx.lineTo(bottomRight.x, topLeft.y + cornerLen)
      ctx.stroke()
      // 좌하
      ctx.beginPath()
      ctx.moveTo(topLeft.x, bottomRight.y - cornerLen); ctx.lineTo(topLeft.x, bottomRight.y); ctx.lineTo(topLeft.x + cornerLen, bottomRight.y)
      ctx.stroke()
      // 우하
      ctx.beginPath()
      ctx.moveTo(bottomRight.x - cornerLen, bottomRight.y); ctx.lineTo(bottomRight.x, bottomRight.y); ctx.lineTo(bottomRight.x, bottomRight.y - cornerLen)
      ctx.stroke()

      // Zone 라벨 (미래형 HUD 스타일)
      const cx = topLeft.x + w / 2
      const cy = topLeft.y + h / 2
      const label = zone.name.toUpperCase()
      ctx.font = '600 12px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = zone.color
      ctx.shadowBlur = 8
      ctx.fillStyle = zone.color
      ctx.fillText(label, cx, cy)
      ctx.shadowBlur = 0
    }
  }, [activeZones, worldToCanvas])

  const drawPatrolRoute = useCallback((ctx: CanvasRenderingContext2D, meta: MapMeta, currentPose: { x: number; y: number } | null) => {
    if (!patrolRoute || patrolRoute.length === 0) return

    const getZoneCenter = (zoneName: string): { x: number; y: number } | null => {
      const zone = activeZones.find((z) => z.name === zoneName)
      if (!zone) return null
      return { x: (zone.xMin + zone.xMax) / 2, y: (zone.yMin + zone.yMax) / 2 }
    }

    const points: { x: number; y: number }[] = []
    if (currentPose) {
      points.push(worldToCanvas(currentPose, meta))
    }
    for (const zoneName of patrolRoute) {
      const center = getZoneCenter(zoneName)
      if (center) points.push(worldToCanvas(center, meta))
    }

    if (points.length < 2) return

    // 네온 경로 — 글로우 라인
    ctx.save()
    // 글로우 배경
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)'
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()

    // 메인 라인
    ctx.strokeStyle = '#00e5ff'
    ctx.lineWidth = 2.5
    ctx.shadowColor = '#00e5ff'
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.restore()

    // 방향 화살표
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i]
      const to = points[i + 1]
      const mx = (from.x + to.x) / 2
      const my = (from.y + to.y) / 2
      const angle = Math.atan2(to.y - from.y, to.x - from.x)

      ctx.save()
      ctx.translate(mx, my)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(5, 0)
      ctx.lineTo(-3, -3)
      ctx.lineTo(-3, 3)
      ctx.closePath()
      ctx.fillStyle = '#00e5ff'
      ctx.fill()
      ctx.restore()
    }

    // 출발점 (초록 네온)
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#00e676'
    ctx.shadowColor = '#00e676'
    ctx.shadowBlur = 8
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.font = '700 7px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#000'
    ctx.fillText('S', points[0].x, points[0].y)

    // 경유지 마커
    for (let i = 1; i < points.length; i++) {
      const isLast = i === points.length - 1
      ctx.beginPath()
      ctx.arc(points[i].x, points[i].y, 6, 0, Math.PI * 2)
      ctx.fillStyle = isLast ? '#ff3b30' : '#0066ff'
      ctx.shadowColor = isLast ? '#ff3b30' : '#0066ff'
      ctx.shadowBlur = 8
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.font = '700 7px -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'
      ctx.fillText(isLast ? 'E' : String(i), points[i].x, points[i].y)
    }

  }, [activeZones, patrolRoute, worldToCanvas])

  const redrawMap = useCallback(() => {
    if (!mapMeta || !canvasRef.current || !mapDataRef.current) return
    const ctx = canvasRef.current.getContext('2d')!
    ctx.putImageData(mapDataRef.current, 0, 0)

    // 맵 배경 — 투명도 낮춰서 존재감 최소화
    ctx.fillStyle = 'rgba(8, 18, 36, 0.75)'
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)

    // Grid 오버레이 (시안 계열 — 레이더 느낌)
    const gridSize = 20
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.06)'
    ctx.lineWidth = 0.5
    for (let x = 0; x < canvasRef.current.width; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasRef.current.height); ctx.stroke()
    }
    for (let y = 0; y < canvasRef.current.height; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasRef.current.width, y); ctx.stroke()
    }

    drawZoneOverlays(ctx, mapMeta)
    drawPatrolRoute(ctx, mapMeta, robotPose ?? null)

    // Home Zone 마커 (최초 연결 위치)
    if (stationPos) {
      const hp = worldToCanvas(stationPos, mapMeta)
      ctx.save()
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 10, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2)
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 2])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(hp.x, hp.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = '#22c55e'
      ctx.fill()
      ctx.font = 'bold 8px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#22c55e'
      ctx.fillText('HOME', hp.x, hp.y - 13)
      ctx.restore()
    }

    if (robotPose) drawRobot(ctx, robotPose, mapMeta)
    if (poseDraft) drawPoseEstimate(ctx, poseDraft, mapMeta)

    // Zone 편집 드래그 영역 표시
    if (zoneDraft && mapMeta) {
      const tl = worldToCanvas(
        { x: Math.min(zoneDraft.start.x, zoneDraft.end.x), y: Math.max(zoneDraft.start.y, zoneDraft.end.y) },
        mapMeta
      )
      const br = worldToCanvas(
        { x: Math.max(zoneDraft.start.x, zoneDraft.end.x), y: Math.min(zoneDraft.start.y, zoneDraft.end.y) },
        mapMeta
      )
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
      ctx.fillStyle = 'rgba(245, 158, 11, 0.1)'
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
      ctx.restore()

      // 좌표 라벨
      const xMin = Math.min(zoneDraft.start.x, zoneDraft.end.x).toFixed(2)
      const xMax = Math.max(zoneDraft.start.x, zoneDraft.end.x).toFixed(2)
      const yMin = Math.min(zoneDraft.start.y, zoneDraft.end.y).toFixed(2)
      const yMax = Math.max(zoneDraft.start.y, zoneDraft.end.y).toFixed(2)
      ctx.font = '9px monospace'
      ctx.fillStyle = '#f59e0b'
      ctx.textAlign = 'left'
      ctx.fillText(`(${xMin}, ${yMax})`, tl.x + 3, tl.y + 11)
      ctx.textAlign = 'right'
      ctx.fillText(`(${xMax}, ${yMin})`, br.x - 3, br.y - 3)
    }
  }, [drawPoseEstimate, drawRobot, drawZoneOverlays, drawPatrolRoute, mapMeta, poseDraft, robotPose, stationPos, zoneDraft, worldToCanvas])

  useEffect(() => {
    if (!ros || status !== 'connected') {
      // 연결 끊기면 Home Zone 초기화 (재연결 시 새로 캡처)
      stationCaptured.current = false
      setStationPos(null)
      return
    }

    const mapTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.MAP.name,
      messageType: TOPICS.MAP.messageType,
      throttle_rate: MAP_THROTTLE_MS,
      queue_length: 1,
    } as any)

    mapTopic.subscribe((message: any) => {
      const { info, data } = message
      const width: number = info.width
      const height: number = info.height
      const resolution: number = info.resolution
      const origin = { x: info.origin.position.x, y: info.origin.position.y }

      setMapMeta({ width, height, resolution, origin })

      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const imgData = ctx.createImageData(width, height)

      for (let i = 0; i < data.length; i++) {
        const val = data[i]
        const row = height - 1 - Math.floor(i / width)
        const col = i % width
        const idx = (row * width + col) * 4

        let r: number, g: number, b: number

        if (val === -1) {
          [r, g, b] = COLOR_UNKNOWN
        } else if (val === 0) {
          [r, g, b] = COLOR_FREE
        } else {
          // 장애물: 값이 클수록 진하게
          const t = val / 100
          r = Math.round(COLOR_FREE[0] + (COLOR_OCCUPIED[0] - COLOR_FREE[0]) * t)
          g = Math.round(COLOR_FREE[1] + (COLOR_OCCUPIED[1] - COLOR_FREE[1]) * t)
          b = Math.round(COLOR_FREE[2] + (COLOR_OCCUPIED[2] - COLOR_FREE[2]) * t)
        }

        imgData.data[idx] = r
        imgData.data[idx + 1] = g
        imgData.data[idx + 2] = b
        imgData.data[idx + 3] = 255
      }

      ctx.putImageData(imgData, 0, 0)
      mapDataRef.current = imgData
      setHasMap(true)
    })

    return () => mapTopic.unsubscribe()
  }, [ros, status])

  useEffect(() => {
    redrawMap()
  }, [redrawMap])

  // 맵 메타 수신 시 Zone 자동 생성 (수동 설정이 없을 때)
  useEffect(() => {
    if (!mapMeta) return
    if (ZONES.length > 0) {
      setActiveZones(ZONES)
    } else {
      const generated = generateZonesFromMap(
        mapMeta.origin.x,
        mapMeta.origin.y,
        mapMeta.width,
        mapMeta.height,
        mapMeta.resolution
      )
      setActiveZones(generated)
    }
  }, [mapMeta])

  // 처음 연결 시 로봇 위치를 Home Zone으로 캡처
  useEffect(() => {
    if (stationCaptured.current) return
    if (status === 'connected' && robotPose) {
      setStationPos({ x: robotPose.x, y: robotPose.y })
      stationCaptured.current = true
      console.log(`[Home Zone 캡처] X: ${robotPose.x.toFixed(2)}, Y: ${robotPose.y.toFixed(2)}`)
    }
  }, [status, robotPose])

  // 로봇 Zone 변경 감지 → 콜백 호출
  const lastZoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!robotPose || activeZones.length === 0 || !onZoneChange) return
    const zone = getZoneFromPose(robotPose.x, robotPose.y, activeZones)
    const zoneName = zone ? zone.name : null
    if (zoneName && zoneName !== lastZoneRef.current) {
      lastZoneRef.current = zoneName
      onZoneChange(zoneName)
    }
  }, [robotPose, activeZones, onZoneChange])

  const manualPosePending = initialPoseStatus.state === 'pending'
  const canSetInitialPose = canSetManualInitialPose(
    status === 'connected',
    teleopActive,
    manualPosePending,
  )
  const poseGuardMessage = manualPosePending
    ? '수동 초기화 준비 중입니다. MANUAL_NAV2_READY를 기다리세요.'
    : status !== 'connected'
      ? 'ROS 연결 후 2D Pose를 사용할 수 있습니다.'
      : teleopActive === true
        ? '수동 조종 해제(active=false)를 확인한 뒤 위치를 설정하세요.'
        : '수동 2D Pose는 테스트/복구용입니다. START를 누르면 도크 출발 위치로 다시 자동 초기화됩니다.'

  useEffect(() => {
    onManualPosePendingChange?.(manualPosePending)
  }, [manualPosePending, onManualPosePendingChange])

  useEffect(() => {
    setInitialPoseStatus((current) => {
      if (current.state !== 'pending') return current
      return isNewManualNav2Ready(
        robotStatus,
        robotStatusSequence,
        current.statusSequenceAtSend,
      ) ? { state: 'ready' } : current
    })
  }, [robotStatus, robotStatusSequence])

  useEffect(() => {
    if (canSetInitialPose) return
    setPoseMode(false)
    setPoseDraft(null)
    setDragStart(null)
  }, [canSetInitialPose])

  useEffect(() => {
    if (initialPoseStatus.state !== 'ready') return

    const timeout = window.setTimeout(() => {
      setInitialPoseStatus({ state: 'idle' })
    }, 3500)

    return () => window.clearTimeout(timeout)
  }, [initialPoseStatus])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Zone 편집 모드
    if (zoneEditMode) {
      const start = canvasToWorld(event.clientX, event.clientY)
      if (!start) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setZoneDraft({ start, end: start })
      return
    }
    if (!poseMode) return
    const start = canvasToWorld(event.clientX, event.clientY)
    if (!start) return

    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart(start)
    setPoseDraft({ ...start, yaw: 0 })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // 항상 커서 좌표 업데이트 (좌표 확인용)
    const coord = canvasToWorld(event.clientX, event.clientY)
    if (coord) setCursorCoord(coord)

    // Zone 편집 드래그
    if (zoneEditMode && zoneDraft) {
      const current = canvasToWorld(event.clientX, event.clientY)
      if (current) setZoneDraft({ start: zoneDraft.start, end: current })
      return
    }

    if (!poseMode || !dragStart) return
    const current = canvasToWorld(event.clientX, event.clientY)
    if (!current) return

    setPoseDraft({ ...dragStart, yaw: yawFromDrag(dragStart, current) })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // Zone 편집 완료
    if (zoneEditMode && zoneDraft) {
      event.currentTarget.releasePointerCapture(event.pointerId)
      const xMin = Math.min(zoneDraft.start.x, zoneDraft.end.x)
      const xMax = Math.max(zoneDraft.start.x, zoneDraft.end.x)
      const yMin = Math.min(zoneDraft.start.y, zoneDraft.end.y)
      const yMax = Math.max(zoneDraft.start.y, zoneDraft.end.y)
      // 너무 작은 영역은 무시
      if (Math.abs(xMax - xMin) > 0.1 && Math.abs(yMax - yMin) > 0.1) {
        console.log(`[Zone 설정] xMin: ${xMin.toFixed(2)}, xMax: ${xMax.toFixed(2)}, yMin: ${yMin.toFixed(2)}, yMax: ${yMax.toFixed(2)}`)
        console.log(`→ zoneMap.ts에 추가:`)
        console.log(`  { name: 'Zone ?', xMin: ${xMin.toFixed(1)}, xMax: ${xMax.toFixed(1)}, yMin: ${yMin.toFixed(1)}, yMax: ${yMax.toFixed(1)}, color: '#22c55e' },`)
      }
      setZoneDraft(null)
      return
    }

    if (!poseMode || !dragStart) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const end = canvasToWorld(event.clientX, event.clientY)
    if (end) setPoseDraft({ ...dragStart, yaw: yawFromDrag(dragStart, end) })
    setDragStart(null)
  }

  const publishInitialPose = () => {
    if (!ros || status !== 'connected' || !poseDraft || !canSetInitialPose) return

    const initialPoseTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.INITIAL_POSE.name,
      messageType: TOPICS.INITIAL_POSE.messageType,
    })

    initialPoseTopic.publish(buildInitialPoseMessage(poseDraft) as any)

    setPoseMode(false)
    setPoseDraft(null)
    setInitialPoseStatus({
      state: 'pending',
      statusSequenceAtSend: robotStatusSequence,
    })
  }

  const cancelPoseEstimate = () => {
    setPoseMode(false)
    setPoseDraft(null)
    setDragStart(null)
  }

  return (
    <div className="ros-map-container">
      {!hasMap && (
        <div className="ros-map-placeholder">
          <div className="ros-map-icon">MAP</div>
          <p>ROS 맵 대기 중</p>
          <p className="ros-map-hint">
            {status === 'connected'
              ? '/map 토픽을 구독하고 있습니다'
              : 'rosbridge 연결 후 /map 토픽을 자동 구독합니다'}
          </p>
        </div>
      )}
      {hasMap && (
        <div className="ros-map-toolbar">
          <button
            type="button"
            className={`ros-map-tool ${poseMode ? 'active' : ''}`}
            onClick={() => {
              setPoseMode((current) => !current)
              setZoneEditMode(false)
              setPoseDraft(null)
              setDragStart(null)
            }}
            disabled={!canSetInitialPose}
            title="2D Pose Estimate"
          >
            <Crosshair size={15} />
            <span>2D Pose</span>
          </button>
          <button
            type="button"
            className={`ros-map-tool ${zoneEditMode ? 'active' : ''}`}
            onClick={() => {
              setZoneEditMode((current) => !current)
              setPoseMode(false)
              setPoseDraft(null)
              setZoneDraft(null)
            }}
            title="Zone 영역 설정 (드래그로 영역 지정)"
          >
            <Grid3X3 size={15} />
            <span>Zone 설정</span>
          </button>
          {poseMode && (
            <>
              <button
                type="button"
                className="ros-map-icon-btn confirm"
                onClick={publishInitialPose}
                disabled={!poseDraft}
                title="Publish initial pose"
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                className="ros-map-icon-btn"
                onClick={cancelPoseEstimate}
                title="Cancel"
              >
                <X size={15} />
              </button>
            </>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`ros-map-canvas ${poseMode ? 'pose-mode' : ''} ${zoneEditMode ? 'zone-edit-mode' : ''}`}
        style={{ display: hasMap ? 'block' : 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {hasMap && poseMode && (
        <div className="ros-map-pose-hint">
          클릭은 기본 방향(yaw 0), 드래그는 드래그 방향으로 설정합니다
        </div>
      )}
      {hasMap && poseGuardMessage && !poseMode && (
        <div className="ros-map-pose-guard">{poseGuardMessage}</div>
      )}
      {hasMap && zoneEditMode && (
        <div className="ros-map-pose-hint zone-edit-hint">
          드래그로 Zone 영역을 지정하세요 (좌표는 콘솔에 출력됩니다)
          {cursorCoord && (
            <span className="cursor-coord">
              커서: X={cursorCoord.x.toFixed(2)}, Y={cursorCoord.y.toFixed(2)}
            </span>
          )}
        </div>
      )}
      {hasMap && initialPoseStatus.state !== 'idle' && !poseMode && (
        <div className={`ros-map-pose-status ${initialPoseStatus.state}`}>
          {initialPoseStatus.state === 'pending' && '2D Pose 전송됨. MANUAL_NAV2_READY 대기 중...'}
          {initialPoseStatus.state === 'ready' && 'MANUAL_NAV2_READY 확인됨. START와 2D Pose를 사용할 수 있습니다.'}
        </div>
      )}
      {hasMap && robotPose && (
        <div className="ros-map-coords">
          X: {robotPose.x.toFixed(2)} | Y: {robotPose.y.toFixed(2)}
        </div>
      )}
      {hasMap && stationPos && !zoneEditMode && (
        <div className="home-zone-badge">
          HOME: ({stationPos.x.toFixed(1)}, {stationPos.y.toFixed(1)})
        </div>
      )}
      {hasMap && mapMeta && zoneEditMode && (
        <div className="ros-map-meta">
          맵 범위: X[{mapMeta.origin.x.toFixed(1)} ~ {(mapMeta.origin.x + mapMeta.width * mapMeta.resolution).toFixed(1)}]
          Y[{mapMeta.origin.y.toFixed(1)} ~ {(mapMeta.origin.y + mapMeta.height * mapMeta.resolution).toFixed(1)}]
          | 해상도: {mapMeta.resolution}m/px
        </div>
      )}
    </div>
  )
}
