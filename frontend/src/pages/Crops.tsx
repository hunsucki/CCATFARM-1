import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Bell, ChevronRight, CheckCircle, AlertTriangle } from 'lucide-react'

type Filter = 'All' | 'Normal' | 'Abnormal'
const ZONE_FILTERS = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E']
const API_BASE = 'http://localhost:8000'

export interface Alert {
  id: string
  zone: string
  status: 'Normal' | 'Abnormal'
  type: string
  confidence: number
  severity: number
  area_ratio: number
  location: string
  description: string
  timestamp: string
  recommendations?: {
    treatment: string[]
    monitoring: string[]
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  const days = Math.floor(hrs / 24)
  return `${days}일 전`
}

export default function Crops() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('All')
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAlerts = useCallback(async (showSpin = false) => {
    if (showSpin) setRefreshing(true)
    else setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/alerts`)
      if (res.ok) {
        const data: Alert[] = await res.json()
        setAlerts(data)
      }
    } catch {
      // 네트워크 오류 무시
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchAlerts() }, [fetchAlerts])

  const toggleZone = (z: string) =>
    setSelectedZones((prev) =>
      prev.includes(z) ? prev.filter((x) => x !== z) : [...prev, z]
    )

  const filtered = alerts.filter((a) => {
    const statusMatch = filter === 'All' || a.status === filter
    const zoneMatch = selectedZones.length === 0 || selectedZones.includes(a.zone)
    return statusMatch && zoneMatch
  })

  return (
    <div className="page">
      {/* Header */}
      <header className="page-header">
        <h1 className="page-title">Crops Status</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="crops-icon-btn"
            onClick={() => fetchAlerts(true)}
            aria-label="새로고침"
          >
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
          </button>
          <button className="crops-icon-btn" aria-label="알림">
            <Bell size={16} />
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="crops-filter-bar">
        <div className="status-tabs">
          {(['All', 'Normal', 'Abnormal'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`status-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="zone-checkboxes">
          {ZONE_FILTERS.map((z) => (
            <label key={z} className="zone-check">
              <input
                type="checkbox"
                checked={selectedZones.includes(z)}
                onChange={() => toggleZone(z)}
              />
              {z}
            </label>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="page-content">
        {loading ? (
          <div className="crops-empty">
            <RefreshCw size={32} className="spin" style={{ color: 'var(--accent)' }} />
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>불러오는 중...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="crops-empty">
            <CheckCircle size={48} style={{ color: 'var(--success)' }} strokeWidth={1.5} />
            <p className="crops-empty-title">이상 없음</p>
            <p className="crops-empty-sub">감지된 이상 없음</p>
          </div>
        ) : (
          filtered.map((alert) => (
            <div
              key={alert.id}
              className={`crop-card-new ${alert.status === 'Abnormal' ? 'abnormal' : 'normal'}`}
              onClick={() => navigate(`/crops/${alert.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/crops/${alert.id}`)}
            >
              {/* Thumbnail */}
              <div className="crop-thumb">
                <img
                  src={`${API_BASE}/api/alert/image/${alert.id}`}
                  alt={alert.zone}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none'
                    e.currentTarget.nextElementSibling?.classList.remove('hidden')
                  }}
                />
                <div className="crop-thumb-fallback hidden">
                  <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
                </div>
              </div>

              {/* Info */}
              <div className="crop-info-new">
                <div className="crop-zone-row">
                  {alert.status === 'Abnormal' && (
                    <AlertTriangle size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                  )}
                  <span className="crop-zone-name">{alert.zone}</span>
                </div>
                <p className="crop-status-label abnormal">이상 감지</p>
                <p className="crop-desc">{alert.description}</p>
                <p className="crop-time">{relativeTime(alert.timestamp)}</p>
              </div>

              <ChevronRight size={16} className="crop-arrow" />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
