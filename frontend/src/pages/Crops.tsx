import { useState, useEffect, useRef } from 'react'
import { Bell, Upload, Camera, X } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

type Filter = 'All' | 'Normal' | 'Abnormal'
const zoneFilters = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E']

interface Condition {
  type: string
  confidence: string
  description: string
}

interface CropResult {
  zone: string
  status: string
  conditions: Condition[]
  overall: string
  filename?: string
  analyzed_at?: string
  imageUrl?: string
}

const CONDITION_LABELS: Record<string, string> = {
  chlorosis: '황화',
  insect_hole: '충공',
  normal: '정상',
}

export default function Crops() {
  const [filter, setFilter] = useState<Filter>('All')
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [crops, setCrops] = useState<CropResult[]>([])
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedZone, setSelectedZone] = useState('Zone A')
  const [selectedCrop, setSelectedCrop] = useState<CropResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchCrops = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/crops`)
      const data = await res.json()
      setCrops(data.crops || [])
    } catch (e) {
      console.error('작물 데이터 조회 실패:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchCrops() }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setAnalyzing(true)
    const formData = new FormData()
    formData.append('file', file)

    // 이미지 미리보기 URL 생성
    const imageUrl = URL.createObjectURL(file)

    try {
      const res = await fetch(`${API_BASE}/api/crops/analyze?zone=${selectedZone}`, {
        method: 'POST',
        body: formData,
      })
      const result = await res.json()
      result.imageUrl = imageUrl
      setCrops((prev) => [result, ...prev])
      setSelectedCrop(result)
    } catch (e) {
      console.error('분석 실패:', e)
    } finally {
      setAnalyzing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleCameraAnalyze = async (camId: string) => {
    setAnalyzing(true)
    try {
      const res = await fetch(`${API_BASE}/api/crops/analyze-camera?cam_id=${camId}&zone=${selectedZone}`, {
        method: 'POST',
      })
      const result = await res.json()
      setCrops((prev) => [result, ...prev])
      setSelectedCrop(result)
    } catch (e) {
      console.error('카메라 분석 실패:', e)
    } finally {
      setAnalyzing(false)
    }
  }

  const toggleZone = (z: string) =>
    setSelectedZones((prev) => prev.includes(z) ? prev.filter((x) => x !== z) : [...prev, z])

  const filtered = crops.filter((c) => {
    const statusMatch = filter === 'All' || c.status === filter
    const zoneMatch = selectedZones.length === 0 || selectedZones.includes(c.zone)
    return statusMatch && zoneMatch
  })

  const getStatusColor = (status: string) => {
    if (status === 'Normal') return '#22c55e'
    if (status === 'Abnormal') return '#ef4444'
    return '#9ca3af'
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Crops Status</h1>
        <Bell size={20} className="header-icon" />
      </header>

      {/* 분석 버튼 영역 */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={selectedZone}
          onChange={(e) => setSelectedZone(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}
        >
          {zoneFilters.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={analyzing}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, background: '#3b82f6', color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer' }}
        >
          <Upload size={14} />
          {analyzing ? '분석 중...' : '이미지 분석'}
        </button>

        <button
          onClick={() => handleCameraAnalyze('1')}
          disabled={analyzing}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, background: '#10b981', color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer' }}
        >
          <Camera size={14} />
          카메라 분석
        </button>

        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
      </div>

      {/* 시각화 모달 */}
      {selectedCrop && selectedCrop.imageUrl && (
        <ImageOverlay crop={selectedCrop} onClose={() => setSelectedCrop(null)} />
      )}

      {/* Filter */}
      <div className="crops-filter-bar">
        <div className="status-tabs">
          {(['All', 'Normal', 'Abnormal'] as Filter[]).map((f) => (
            <button key={f} className={`status-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="zone-checkboxes">
          {zoneFilters.map((z) => (
            <label key={z} className="zone-check">
              <input type="checkbox" checked={selectedZones.includes(z)} onChange={() => toggleZone(z)} />
              {z}
            </label>
          ))}
        </div>
      </div>

      {/* 결과 목록 */}
      <div className="page-content">
        {loading && <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>로딩 중...</div>}

        {filtered.map((crop, i) => (
          <div key={i} className="crop-card" onClick={() => setSelectedCrop(crop)} style={{ cursor: 'pointer' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{crop.zone}</span>
                <span style={{ fontSize: 12, color: getStatusColor(crop.status), fontWeight: 600 }}>
                  {crop.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                {crop.conditions?.map((cond, j) => (
                  <span key={j} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#f3f4f6' }}>
                    {CONDITION_LABELS[cond.type] || cond.type} ({cond.confidence})
                  </span>
                ))}
              </div>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{crop.overall}</p>
              {crop.analyzed_at && <p style={{ fontSize: 11, color: '#9ca3af', margin: '4px 0 0' }}>{crop.analyzed_at}</p>}
            </div>
          </div>
        ))}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            분석된 데이터가 없습니다. 이미지를 업로드해서 분석해보세요.
          </div>
        )}
      </div>
    </div>
  )
}

/* 이미지 + 텍스트 결과 모달 */
function ImageOverlay({ crop, onClose }: { crop: CropResult; onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '60vh' }}>
        <button onClick={onClose} style={{
          position: 'absolute', top: -36, right: 0, background: 'none', border: 'none', color: '#fff', cursor: 'pointer'
        }}>
          <X size={24} />
        </button>

        <img
          src={crop.imageUrl}
          alt="분석 이미지"
          style={{ maxWidth: '90vw', maxHeight: '60vh', borderRadius: 8 }}
        />
      </div>

      {/* 분석 결과 텍스트 */}
      <div style={{ marginTop: 16, color: '#fff', textAlign: 'center', maxWidth: 500 }}>
        <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>
          {crop.zone} — <span style={{ color: crop.status === 'Normal' ? '#22c55e' : '#ef4444' }}>{crop.status}</span>
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          {crop.conditions?.map((cond, j) => (
            <span key={j} style={{
              fontSize: 13, padding: '4px 10px', borderRadius: 6,
              background: cond.type === 'chlorosis' ? '#facc15' : cond.type === 'insect_hole' ? '#92400e' : '#22c55e',
              color: cond.type === 'chlorosis' ? '#000' : '#fff'
            }}>
              {CONDITION_LABELS[cond.type] || cond.type} ({cond.confidence})
            </span>
          ))}
        </div>
        <p style={{ fontSize: 14, color: '#d1d5db', margin: 0 }}>{crop.overall}</p>
        {crop.conditions?.map((cond, j) => (
          <p key={j} style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>• {cond.description}</p>
        ))}
      </div>
    </div>
  )
}
