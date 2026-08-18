import { useState, useRef, useEffect } from 'react'
import { Save, Trash2, Plus, X } from 'lucide-react'
import type { ZoneBounds } from '../utils/zoneMap'

const ZONE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6']

interface ZoneEditorProps {
  /** 맵 이미지 또는 캔버스의 width/height (pixel) */
  canvasWidth: number
  canvasHeight: number
  /** 맵 좌표 범위 (실제 SLAM 좌표) */
  mapBounds: { xMin: number; xMax: number; yMin: number; yMax: number }
  /** 기존 존 목록 */
  existingZones: ZoneBounds[]
  /** 저장 콜백 */
  onSave: (zones: ZoneBounds[]) => void
  /** 닫기 콜백 */
  onClose: () => void
}

interface DragRect {
  startX: number
  startY: number
  endX: number
  endY: number
}

export default function ZoneEditor({ canvasWidth, canvasHeight, mapBounds, existingZones, onSave, onClose }: ZoneEditorProps) {
  const [zones, setZones] = useState<ZoneBounds[]>(existingZones)
  const [dragging, setDragging] = useState(false)
  const [dragRect, setDragRect] = useState<DragRect | null>(null)
  const [editingName, setEditingName] = useState<number | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // 픽셀 좌표 → 맵 좌표 변환
  const pixelToMap = (px: number, py: number) => {
    const x = mapBounds.xMin + (px / canvasWidth) * (mapBounds.xMax - mapBounds.xMin)
    const y = mapBounds.yMax - (py / canvasHeight) * (mapBounds.yMax - mapBounds.yMin) // Y 반전
    return { x, y }
  }

  // 맵 좌표 → 픽셀 좌표 변환
  const mapToPixel = (mx: number, my: number) => {
    const px = ((mx - mapBounds.xMin) / (mapBounds.xMax - mapBounds.xMin)) * canvasWidth
    const py = ((mapBounds.yMax - my) / (mapBounds.yMax - mapBounds.yMin)) * canvasHeight
    return { px, py }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editingName !== null) return
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setDragging(true)
    setDragRect({ startX: x, startY: y, endX: x, endY: y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragRect) return
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(canvasWidth, e.clientX - rect.left))
    const y = Math.max(0, Math.min(canvasHeight, e.clientY - rect.top))
    setDragRect({ ...dragRect, endX: x, endY: y })
  }

  const handleMouseUp = () => {
    if (!dragging || !dragRect) return
    setDragging(false)

    const x1 = Math.min(dragRect.startX, dragRect.endX)
    const y1 = Math.min(dragRect.startY, dragRect.endY)
    const x2 = Math.max(dragRect.startX, dragRect.endX)
    const y2 = Math.max(dragRect.startY, dragRect.endY)

    // 최소 크기 체크
    if (x2 - x1 < 20 || y2 - y1 < 20) {
      setDragRect(null)
      return
    }

    const topLeft = pixelToMap(x1, y1)
    const bottomRight = pixelToMap(x2, y2)

    const newZone: ZoneBounds = {
      name: `Zone ${String.fromCharCode(65 + zones.length)}`,
      xMin: Math.min(topLeft.x, bottomRight.x),
      xMax: Math.max(topLeft.x, bottomRight.x),
      yMin: Math.min(topLeft.y, bottomRight.y),
      yMax: Math.max(topLeft.y, bottomRight.y),
      color: ZONE_COLORS[zones.length % ZONE_COLORS.length],
    }

    setZones([...zones, newZone])
    setDragRect(null)
  }

  const deleteZone = (index: number) => {
    setZones(zones.filter((_, i) => i !== index))
  }

  const renameZone = (index: number, name: string) => {
    const updated = [...zones]
    updated[index] = { ...updated[index], name }
    setZones(updated)
    setEditingName(null)
  }

  const handleSave = () => {
    onSave(zones)
    // 로컬스토리지에도 저장
    localStorage.setItem('ccatfarm_zones', JSON.stringify(zones))
    console.log('[ZoneEditor] 저장된 Zone 좌표:', JSON.stringify(zones, null, 2))
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#1a2332', borderRadius: '8px 8px 0 0' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa' }}>Zone 설정 모드</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 4, background: '#22c55e', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer' }}>
            <Save size={12} /> 저장
          </button>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 4, background: '#6b7280', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer' }}>
            <X size={12} /> 닫기
          </button>
        </div>
      </div>

      {/* 안내 */}
      <p style={{ fontSize: 11, color: '#9ca3af', padding: '6px 12px', margin: 0, background: '#0f1724' }}>
        지도 위에서 드래그하여 Zone 영역을 지정하세요.
      </p>

      {/* 드래그 오버레이 */}
      <div
        ref={overlayRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { if (dragging) handleMouseUp() }}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: canvasWidth, height: canvasHeight,
          cursor: 'crosshair', zIndex: 10,
        }}
      >
        {/* 기존 Zone 표시 */}
        {zones.map((zone, i) => {
          const tl = mapToPixel(zone.xMin, zone.yMax)
          const br = mapToPixel(zone.xMax, zone.yMin)
          return (
            <div key={i} style={{
              position: 'absolute',
              left: tl.px, top: tl.py,
              width: br.px - tl.px, height: br.py - tl.py,
              border: `2px solid ${zone.color}`,
              background: `${zone.color}20`,
              borderRadius: 4,
            }}>
              <span style={{
                position: 'absolute', top: 2, left: 4,
                fontSize: 10, color: zone.color, fontWeight: 600,
                background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: 2,
              }}>
                {zone.name}
              </span>
            </div>
          )
        })}

        {/* 현재 드래그 중인 사각형 */}
        {dragRect && (
          <div style={{
            position: 'absolute',
            left: Math.min(dragRect.startX, dragRect.endX),
            top: Math.min(dragRect.startY, dragRect.endY),
            width: Math.abs(dragRect.endX - dragRect.startX),
            height: Math.abs(dragRect.endY - dragRect.startY),
            border: '2px dashed #fff',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 4,
          }} />
        )}
      </div>

      {/* Zone 목록 */}
      <div style={{ padding: '8px 12px', background: '#1a2332', borderRadius: '0 0 8px 8px', maxHeight: 150, overflowY: 'auto' }}>
        {zones.length === 0 ? (
          <p style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', padding: 8 }}>
            아직 설정된 Zone이 없습니다.
          </p>
        ) : (
          zones.map((zone, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #2a3a4a' }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: zone.color, flexShrink: 0 }} />
              {editingName === i ? (
                <input
                  autoFocus
                  defaultValue={zone.name}
                  onBlur={(e) => renameZone(i, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') renameZone(i, (e.target as HTMLInputElement).value) }}
                  style={{ flex: 1, fontSize: 11, padding: '2px 4px', background: '#0f1724', border: '1px solid #3b82f6', borderRadius: 3, color: '#fff' }}
                />
              ) : (
                <span
                  onClick={() => setEditingName(i)}
                  style={{ flex: 1, fontSize: 11, color: '#e5e7eb', cursor: 'pointer' }}
                >
                  {zone.name}
                </span>
              )}
              <button onClick={() => deleteZone(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 2 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** 로컬스토리지에서 저장된 Zone 불러오기 */
export function loadSavedZones(): ZoneBounds[] {
  try {
    const saved = localStorage.getItem('ccatfarm_zones')
    if (saved) return JSON.parse(saved)
  } catch {}
  return []
}
