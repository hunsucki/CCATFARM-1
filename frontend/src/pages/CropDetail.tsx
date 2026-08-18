import { useState } from 'react'
import { ArrowLeft, ZoomIn, ChevronDown, ChevronUp, AlertTriangle, CheckCircle } from 'lucide-react'

interface Condition {
  type: string
  confidence: number
  severity: string
  description: string
  bbox?: { x: number; y: number; w: number; h: number }
}

interface CropResult {
  zone: string
  status: string
  conditions: Condition[]
  overall: string
  recommendation?: string
  filename?: string
  analyzed_at?: string
  imageUrl?: string
  imageData?: string
}

interface CropDetailProps {
  crop: CropResult
  onBack: () => void
}

const CONDITION_LABELS: Record<string, string> = {
  chlorosis: '황화 현상',
  insect_hole: '해충 피해(구멍)',
  normal: '정상',
}

const SEVERITY_LABELS: Record<string, { text: string; color: string; bg: string }> = {
  high: { text: '높은 위험', color: '#fff', bg: '#dc2626' },
  medium: { text: '주의', color: '#000', bg: '#f59e0b' },
  low: { text: '경미', color: '#000', bg: '#86efac' },
}

const BBOX_COLORS: Record<string, string> = {
  chlorosis: '#facc15',
  insect_hole: '#ef4444',
  normal: '#22c55e',
}

export default function CropDetail({ crop, onBack }: CropDetailProps) {
  const [showRecommendation, setShowRecommendation] = useState(false)
  const [imageZoom, setImageZoom] = useState(false)

  const isAbnormal = crop.status === 'Abnormal'
  const imgSrc = crop.imageUrl || crop.imageData

  return (
    <div className="page" style={{ background: '#0f1724' }}>
      {/* 헤더 */}
      <header style={{ display: 'flex', alignItems: 'center', padding: '16px', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: 16, fontWeight: 600, color: '#fff', margin: 0 }}>이상 감지 결과</h1>
      </header>

      {/* 상단 요약 카드 */}
      <div style={{ margin: '0 16px 16px', padding: 16, background: '#1a2332', borderRadius: 12, border: '1px solid #2a3a4a' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isAbnormal ? <AlertTriangle size={18} color="#ef4444" /> : <CheckCircle size={18} color="#22c55e" />}
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
              {crop.zone} {isAbnormal ? '이상 감지' : '정상'}
            </span>
          </div>
          {crop.analyzed_at && (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{crop.analyzed_at}</span>
          )}
        </div>
        <p style={{ fontSize: 12, color: '#9ca3af', margin: '6px 0 0' }}>
          {crop.overall}
        </p>
      </div>

      {/* 분석 이미지 + bbox 오버레이 */}
      <div style={{ margin: '0 16px 16px', padding: 16, background: '#1a2332', borderRadius: 12, border: '1px solid #2a3a4a' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa', margin: '0 0 12px' }}>분석 이미지</p>
        <div style={{ position: 'relative' }}>
          {imgSrc ? (
            <>
              <img
                src={imgSrc}
                alt="분석 이미지"
                onClick={() => setImageZoom(true)}
                style={{ width: '100%', borderRadius: 8, cursor: 'pointer', display: 'block' }}
              />
              {/* bbox 오버레이 */}
              {crop.conditions?.map((cond, i) => {
                if (!cond.bbox || cond.type === 'normal') return null
                const color = BBOX_COLORS[cond.type] || '#fff'
                return (
                  <div key={i} style={{
                    position: 'absolute',
                    left: `${cond.bbox.x * 100}%`,
                    top: `${cond.bbox.y * 100}%`,
                    width: `${cond.bbox.w * 100}%`,
                    height: `${cond.bbox.h * 100}%`,
                    border: `3px solid ${color}`,
                    borderRadius: 4,
                    pointerEvents: 'none',
                    boxShadow: `0 0 6px ${color}40`,
                  }}>
                    <span style={{
                      position: 'absolute', top: -22, left: 0,
                      background: color, color: '#000',
                      fontSize: 10, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap', fontWeight: 600
                    }}>
                      {CONDITION_LABELS[cond.type] || cond.type}
                    </span>
                  </div>
                )
              })}
            </>
          ) : (
            <div style={{ width: '100%', height: 200, background: '#2a3a4a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
              이미지 없음
            </div>
          )}
          <button
            onClick={() => setImageZoom(true)}
            style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <ZoomIn size={12} /> 확대
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          {crop.analyzed_at && <span style={{ fontSize: 11, color: '#6b7280' }}>촬영 시간: {crop.analyzed_at}</span>}
          <span style={{ fontSize: 11, color: '#6b7280' }}>구역: {crop.zone}</span>
        </div>
      </div>

      {/* 분석 결과 요약 */}
      <div style={{ margin: '0 16px 16px', padding: 16, background: '#1a2332', borderRadius: 12, border: '1px solid #2a3a4a' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa', margin: '0 0 12px' }}>분석 결과 요약</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {isAbnormal ? <AlertTriangle size={16} color="#ef4444" /> : <CheckCircle size={16} color="#22c55e" />}
          <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
            {isAbnormal ? '비정상 작물 감지' : '정상 작물'}
          </span>
        </div>

        {isAbnormal && (
          <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 12px' }}>이상 영역이 발견되었습니다.</p>
        )}

        {/* 증상 카드들 */}
        {crop.conditions?.map((cond, i) => {
          const severity = SEVERITY_LABELS[cond.severity] || SEVERITY_LABELS.low
          const borderColor = cond.type === 'normal' ? '#22c55e' : cond.type === 'chlorosis' ? '#facc15' : '#ef4444'
          return (
            <div key={i} style={{ padding: 12, background: '#0f1724', borderRadius: 8, marginBottom: 8, borderLeft: `3px solid ${borderColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                  {CONDITION_LABELS[cond.type] || cond.type}
                </span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: severity.bg, color: severity.color, fontWeight: 600 }}>
                  {severity.text}
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>
                신뢰도 {typeof cond.confidence === 'number' ? cond.confidence.toFixed(2) : cond.confidence}
              </p>
              <p style={{ fontSize: 12, color: '#d1d5db', margin: '4px 0 0' }}>{cond.description}</p>
            </div>
          )
        })}

        {/* 종합 소견 */}
        <div style={{ marginTop: 12, padding: 10, background: '#0f1724', borderRadius: 8 }}>
          <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>종합 소견</p>
          <p style={{ fontSize: 13, color: '#e5e7eb', margin: '4px 0 0' }}>{crop.overall}</p>
        </div>
      </div>

      {/* 조치 권장사항 */}
      {crop.recommendation && (
        <div style={{ margin: '0 16px 16px', background: '#1a2332', borderRadius: 12, border: '1px solid #2a3a4a', overflow: 'hidden' }}>
          <button
            onClick={() => setShowRecommendation(!showRecommendation)}
            style={{ width: '100%', padding: 16, background: 'none', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa' }}>조치 권장사항</span>
            {showRecommendation ? <ChevronUp size={16} color="#9ca3af" /> : <ChevronDown size={16} color="#9ca3af" />}
          </button>
          {showRecommendation && (
            <div style={{ padding: '0 16px 16px' }}>
              <p style={{ fontSize: 13, color: '#d1d5db', margin: 0, lineHeight: 1.6 }}>{crop.recommendation}</p>
            </div>
          )}
        </div>
      )}

      {/* 이미지 확대 모달 */}
      {imageZoom && imgSrc && (
        <div
          onClick={() => setImageZoom(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <img src={imgSrc} style={{ maxWidth: '95vw', maxHeight: '90vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}
