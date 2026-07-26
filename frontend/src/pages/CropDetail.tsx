import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, Leaf, Clock, ZoomIn, Star, X } from 'lucide-react'
import type { Alert } from './Crops'

const API_BASE = 'http://localhost:8000'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ampm = d.getHours() < 12 ? '오전' : '오후'
  const h12 = d.getHours() % 12 || 12
  return `${yy}. ${mm}. ${dd}. ${ampm} ${String(h12).padStart(2, '0')}:${min}:${ss}`
}

function formatShort(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = d.getHours() % 12 || 12
  const min = String(d.getMinutes()).padStart(2, '0')
  const ampm = d.getHours() < 12 ? '오전' : '오후'
  return `${mm}. ${dd}. ${ampm} ${hh}:${min}`
}

function getRiskLabel(confidence: number): { label: string; color: string } {
  if (confidence >= 0.9) return { label: '높은 위험', color: '#ff3b30' }
  if (confidence >= 0.7) return { label: '중간 위험', color: '#ff9800' }
  return { label: '낮은 위험', color: '#00e676' }
}

/** 반원 게이지 SVG */
function ConfidenceGauge({ value }: { value: number }) {
  const r = 44
  const cx = 60
  const cy = 60
  const circumference = Math.PI * r  // 반원이므로
  const offset = circumference * (1 - value)

  return (
    <svg width="120" height="70" viewBox="0 0 120 70">
      {/* 배경 호 */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="8"
        strokeLinecap="round"
      />
      {/* 채워진 호 */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="url(#gaugeGrad)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
      />
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00e676" />
          <stop offset="100%" stopColor="#00e5ff" />
        </linearGradient>
      </defs>
      {/* 값 텍스트 */}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#00e676" fontSize="18" fontWeight="700">
        {value.toFixed(2)}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="#00e676" fontSize="9">
        높음
      </text>
    </svg>
  )
}

export default function CropDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [alert, setAlert] = useState<Alert | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgZoom, setImgZoom] = useState(false)
  const [history, setHistory] = useState<Alert[]>([])

  useEffect(() => {
    if (!id) return
    // 상세 조회
    fetch(`${API_BASE}/api/alerts/${id}`)
      .then((r) => r.json())
      .then((data) => { setAlert(data); setLoading(false) })
      .catch(() => setLoading(false))

    // 전체 목록에서 이력용 로드
    fetch(`${API_BASE}/api/alerts`)
      .then((r) => r.json())
      .then((list: Alert[]) => {
        // 현재 항목 제외, 최근 3건
        setHistory(list.filter((a) => a.id !== id).slice(0, 3))
      })
      .catch(() => {})
  }, [id])

  if (loading) {
    return (
      <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="spin" style={{ color: 'var(--accent)', fontSize: 24 }}>⟳</div>
      </div>
    )
  }

  if (!alert) {
    return (
      <div className="page">
        <header className="page-header">
          <button className="detail-back-btn" onClick={() => navigate('/crops')}>
            <ArrowLeft size={18} />
          </button>
          <span className="detail-header-title">이상 감지 결과</span>
          <div style={{ width: 32 }} />
        </header>
        <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>
          데이터를 불러올 수 없습니다.
        </div>
      </div>
    )
  }

  const risk = getRiskLabel(alert.confidence)

  return (
    <div className="page">
      {/* Header */}
      <header className="page-header">
        <button className="detail-back-btn" onClick={() => navigate('/crops')}>
          <ArrowLeft size={18} />
        </button>
        <span className="detail-header-title">이상 감지 결과</span>
        <div style={{ width: 32 }} />
      </header>

      <div className="page-content">

        {/* ── 상단 요약 카드 ── */}
        <div className="detail-summary-card">
          <div className="detail-summary-top">
            <div className="detail-summary-icon">
              <AlertTriangle size={18} />
            </div>
            <div className="detail-summary-info">
              <p className="detail-summary-title">{alert.zone} 이상 감지</p>
              <p className="detail-summary-desc">{alert.description}</p>
            </div>
            <div className="detail-summary-time">
              <Clock size={10} style={{ marginRight: 3 }} />
              {formatDateTime(alert.timestamp)}
            </div>
          </div>
        </div>

        {/* ── 분석 이미지 ── */}
        <div className="detail-section">
          <p className="detail-section-label">분석 이미지</p>
          <div className="detail-img-wrap">
            <img
              src={`${API_BASE}/api/alert/image/${alert.id}`}
              alt="분석 이미지"
              className="detail-img"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = ''
                e.currentTarget.style.display = 'none'
              }}
            />
            <button
              className="detail-img-zoom-btn"
              onClick={() => setImgZoom(true)}
              aria-label="이미지 확대"
            >
              <ZoomIn size={12} style={{ marginRight: 4 }} />
              확대
            </button>
            <div className="detail-img-meta">
              <span>촬영 시간: {formatDateTime(alert.timestamp)}</span>
              <span>구역: {alert.zone}</span>
            </div>
          </div>
        </div>

        {/* ── 분석 결과 요약 ── */}
        <div className="detail-section">
          <p className="detail-section-label">분석 결과 요약</p>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                비정상 작물 감지
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              이상 영역이 발견되었습니다.
            </p>

            {/* 감지 항목 */}
            <div className="detail-finding-card">
              <div className="detail-finding-header">
                <Leaf size={13} style={{ color: 'var(--accent)' }} />
                <span>{alert.type}</span>
              </div>
              <p className="detail-finding-confidence">신뢰도 {alert.confidence.toFixed(2)}</p>
              <span
                className="detail-risk-badge"
                style={{ background: risk.color }}
              >
                {risk.label}
              </span>
            </div>
          </div>
        </div>

        {/* ── 상세 정보 ── */}
        <div className="detail-section">
          <p className="detail-section-label">상세 정보</p>
          <div className="card" style={{ padding: 14 }}>
            <div className="detail-finding-header" style={{ marginBottom: 12 }}>
              <Leaf size={13} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{alert.type}</span>
            </div>
            <div className="detail-info-row">
              <span className="detail-info-key">발생 위치</span>
              <span className="detail-info-val">{alert.location}</span>
            </div>
            <div className="detail-info-row">
              <span className="detail-info-key">심각도</span>
              <span className="detail-info-val">
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    size={13}
                    style={{
                      color: i < alert.severity ? '#ffb74d' : 'rgba(255,255,255,0.15)',
                      fill: i < alert.severity ? '#ffb74d' : 'none',
                    }}
                  />
                ))}
              </span>
            </div>
            <div className="detail-info-row">
              <span className="detail-info-key">면적 비율</span>
              <span className="detail-info-val">잎 면적의 {alert.area_ratio}%</span>
            </div>
          </div>
        </div>

        {/* ── 전체 신뢰도 ── */}
        <div className="detail-section">
          <p className="detail-section-label">전체 신뢰도</p>
          <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
            <ConfidenceGauge value={alert.confidence} />
            <div>
              <p className="detail-section-label" style={{ marginBottom: 6 }}>참고</p>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                신뢰도는 모델의 예측 확률을 나타내며, 0.7 이상일 경우 신뢰할 수 있는 결과입니다.
              </p>
            </div>
          </div>
        </div>

        {/* ── 권장 조치 사항 ── */}
        {alert.recommendations && (
          <div className="detail-section">
            <p className="detail-section-label">권장 조치 사항</p>
            <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 대응 조치 */}
              <div className="detail-rec-block">
                <div className="detail-rec-header">
                  <Leaf size={13} style={{ color: 'var(--accent)' }} />
                  <span>{alert.type} 대응</span>
                </div>
                <ul className="detail-rec-list">
                  {alert.recommendations.treatment.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              {/* 모니터링 */}
              <div className="detail-rec-block">
                <div className="detail-rec-header">
                  <Clock size={13} style={{ color: 'var(--accent)' }} />
                  <span>모니터링 권장</span>
                </div>
                <ul className="detail-rec-list">
                  {alert.recommendations.monitoring.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ── 이상 이력 ── */}
        {history.length > 0 && (
          <div className="detail-section">
            <p className="detail-section-label">이상 이력 (최근 {history.length}건)</p>
            <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map((h) => (
                <div
                  key={h.id}
                  className="detail-history-item"
                  onClick={() => navigate(`/crops/${h.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/crops/${h.id}`)}
                >
                  <div className="detail-history-thumb">
                    <img
                      src={`${API_BASE}/api/alert/image/${h.id}`}
                      alt={h.zone}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  </div>
                  <div className="detail-history-info">
                    <p className="detail-history-type">{h.type}</p>
                    <p className="detail-history-time">{formatShort(h.timestamp)}</p>
                    <p className="detail-history-zone">{h.zone}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ── 이미지 확대 모달 ── */}
      {imgZoom && (
        <div className="detail-zoom-overlay" onClick={() => setImgZoom(false)}>
          <button className="detail-zoom-close" onClick={() => setImgZoom(false)}>
            <X size={20} />
          </button>
          <img
            src={`${API_BASE}/api/alert/image/${alert.id}`}
            alt="확대 이미지"
            className="detail-zoom-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
