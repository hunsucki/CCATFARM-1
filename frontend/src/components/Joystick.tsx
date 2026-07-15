import { useRef, useEffect, useCallback } from 'react'

interface JoystickProps {
  onMove: (linear: number, angular: number) => void
  onStop: () => void
  disabled?: boolean
}

const SIZE = 200        // 전체 조이스틱 크기
const OUTER_R = SIZE / 2
const INNER_R = SIZE * 0.22  // 가운데 스틱 반지름
const MAX_DIST = OUTER_R - INNER_R - 12  // 스틱 최대 이동 거리

export default function Joystick({ onMove, onStop, disabled = false }: JoystickProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stickPos = useRef({ x: 0, y: 0 })
  const dragging = useRef(false)

  const draw = useCallback((sx: number, sy: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const cx = SIZE / 2
    const cy = SIZE / 2

    ctx.clearRect(0, 0, SIZE, SIZE)

    // ── 외부 링 (어두운 배경 원) ──
    ctx.beginPath()
    ctx.arc(cx, cy, OUTER_R - 2, 0, Math.PI * 2)
    ctx.fillStyle = '#2d2d2d'
    ctx.fill()

    // ── 방향 섹터 4개 (위/아래/좌/우) ──
    const sectors = [
      { start: -Math.PI * 0.75, end: -Math.PI * 0.25, arrow: { x: cx, y: cy - OUTER_R * 0.68 }, dir: 'up' },
      { start: Math.PI * 0.25,  end: Math.PI * 0.75,  arrow: { x: cx, y: cy + OUTER_R * 0.68 }, dir: 'down' },
      { start: Math.PI * 0.75,  end: Math.PI * 1.25,  arrow: { x: cx - OUTER_R * 0.68, y: cy }, dir: 'left' },
      { start: -Math.PI * 0.25, end: Math.PI * 0.25,  arrow: { x: cx + OUTER_R * 0.68, y: cy }, dir: 'right' },
    ]

    const angle = Math.atan2(sy, sx)
    const dist = Math.sqrt(sx * sx + sy * sy)
    const activeThreshold = MAX_DIST * 0.25

    sectors.forEach(({ start, end, arrow, dir }) => {
      // 활성 섹터 판단
      let inSector = false
      if (dist > activeThreshold) {
        let a = angle
        let s = start, e = end
        if (dir === 'left') { s = Math.PI * 0.75; e = Math.PI * 1.25 }
        if (dir === 'left') inSector = (a >= s || a <= -s + Math.PI * 0.5) ? false : Math.abs(a) >= s - Math.PI
        else inSector = a >= s && a <= e
        if (dir === 'up')    inSector = a >= -Math.PI * 0.75 && a <= -Math.PI * 0.25
        if (dir === 'down')  inSector = a >= Math.PI * 0.25  && a <= Math.PI * 0.75
        if (dir === 'left')  inSector = a <= -Math.PI * 0.75 || a >= Math.PI * 0.75
        if (dir === 'right') inSector = a >= -Math.PI * 0.25 && a <= Math.PI * 0.25
      }

      // 섹터 호 그리기
      const innerGap = INNER_R + 18
      const outerEdge = OUTER_R - 8
      ctx.beginPath()
      ctx.arc(cx, cy, outerEdge, start, end)
      ctx.arc(cx, cy, innerGap, end, start, true)
      ctx.closePath()
      ctx.fillStyle = inSector ? '#555' : '#3a3a3a'
      ctx.fill()

      // 화살표 삼각형
      ctx.save()
      ctx.translate(arrow.x, arrow.y)
      if (dir === 'up')    ctx.rotate(0)
      if (dir === 'down')  ctx.rotate(Math.PI)
      if (dir === 'left')  ctx.rotate(-Math.PI / 2)
      if (dir === 'right') ctx.rotate(Math.PI / 2)
      ctx.beginPath()
      ctx.moveTo(0, -7)
      ctx.lineTo(6, 4)
      ctx.lineTo(-6, 4)
      ctx.closePath()
      ctx.fillStyle = inSector ? '#fff' : '#aaa'
      ctx.fill()
      ctx.restore()
    })

    // ── 중간 링 (그림자 효과) ──
    const grad = ctx.createRadialGradient(cx, cy, INNER_R, cx, cy, INNER_R + 16)
    grad.addColorStop(0, 'rgba(0,0,0,0.6)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, INNER_R + 16, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()

    // ── 가운데 스틱 ──
    const stickX = cx + sx
    const stickY = cy + sy
    const stickGrad = ctx.createRadialGradient(stickX - 4, stickY - 4, 2, stickX, stickY, INNER_R)
    stickGrad.addColorStop(0, '#c0c0c0')
    stickGrad.addColorStop(1, '#888')
    ctx.beginPath()
    ctx.arc(stickX, stickY, INNER_R, 0, Math.PI * 2)
    ctx.fillStyle = stickGrad
    ctx.fill()
    ctx.beginPath()
    ctx.arc(stickX, stickY, INNER_R, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 2
    ctx.stroke()
  }, [])

  // 초기 렌더
  useEffect(() => { draw(0, 0) }, [draw])

  const getPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left - SIZE / 2
    const y = e.clientY - rect.top - SIZE / 2
    const dist = Math.sqrt(x * x + y * y)
    if (dist > MAX_DIST) {
      const scale = MAX_DIST / dist
      return { x: x * scale, y: y * scale }
    }
    return { x, y }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const pos = getPos(e)
    stickPos.current = pos
    draw(pos.x, pos.y)
    const norm = Math.sqrt(pos.x * pos.x + pos.y * pos.y) / MAX_DIST
    onMove(-(pos.y / MAX_DIST) * norm, -(pos.x / MAX_DIST) * norm)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || disabled) return
    const pos = getPos(e)
    stickPos.current = pos
    draw(pos.x, pos.y)

    const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y)
    const norm = dist / MAX_DIST  // 0~1
    // y축 반전: 위로 드래그 = 전진
    const linear = -(pos.y / MAX_DIST) * norm
    const angular = -(pos.x / MAX_DIST) * norm
    onMove(linear, angular)
  }

  const handlePointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    stickPos.current = { x: 0, y: 0 }
    draw(0, 0)
    onStop()
  }

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{
        touchAction: 'none',
        cursor: disabled ? 'not-allowed' : 'grab',
        opacity: disabled ? 0.4 : 1,
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  )
}
