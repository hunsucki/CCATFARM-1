import { useState, useEffect, useRef } from 'react'
import { Bell, Upload, Camera, AlertTriangle, ChevronRight } from 'lucide-react'
import CropDetail from './CropDetail'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

type Filter = 'All' | 'Normal' | 'Abnormal' | 'Error'
const zoneFilters = ['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E']

interface Condition {
  type: string
  confidence: number
  severity: string
  description: string
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
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
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

  // 상세 페이지 표시 중이면 CropDetail 렌더링
  if (selectedCrop) {
    return (
      <CropDetail
        crop={selectedCrop}
        onBack={() => { setSelectedCrop(null); setSelectedIndex(-1) }}
      />
    )
  }

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

  const handleRetry = async (crop: CropResult, index: number) => {
    if (!crop.imageData) return
    setAnalyzing(true)
    try {
      // base64 → blob → FormData
      const response = await fetch(crop.imageData)
      const blob = await response.blob()
      const formData = new FormData()
      formData.append('file', blob, crop.filename || 'retry.jpg')

      const res = await fetch(`${API_BASE}/api/crops/analyze?zone=${crop.zone}`, {
        method: 'POST',
        body: formData,
      })
      const result = await res.json()
      result.imageData = crop.imageData
      // 기존 에러 항목 교체
      setCrops((prev) => {
        const updated = [...prev]
        const originalIndex = prev.indexOf(crop)
        if (originalIndex >= 0) updated[originalIndex] = result
        return updated
      })
      if (result.status !== 'Error') setSelectedCrop(result)
    } catch (e) {
      console.error('재분석 실패:', e)
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

      {/* 시각화 모달 — 상세 페이지로 대체됨 */}

      {/* Filter */}
      <div className="crops-filter-bar">
        <div className="status-tabs">
          {(['All', 'Normal', 'Abnormal', 'Error'] as Filter[]).map((f) => (
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
          <div key={i} className="crop-card" onClick={() => crop.status !== 'Error' && setSelectedCrop(crop)} style={{ cursor: crop.status === 'Error' ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, background: '#1a2332', border: crop.status === 'Abnormal' ? '1px solid #dc2626' : crop.status === 'Error' ? '1px solid #f59e0b' : '1px solid #2a3a4a', marginBottom: 8 }}>
            {/* 썸네일 */}
            <div style={{ width: 60, height: 60, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#2a3a4a' }}>
              {(crop.imageUrl || crop.imageData) && <img src={crop.imageUrl || crop.imageData} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            {/* 정보 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {crop.status === 'Abnormal' && <AlertTriangle size={14} color="#ef4444" />}
                {crop.status === 'Error' && <AlertTriangle size={14} color="#f59e0b" />}
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{crop.zone}</span>
              </div>
              <p style={{ fontSize: 12, color: crop.status === 'Normal' ? '#22c55e' : crop.status === 'Error' ? '#f59e0b' : '#ef4444', fontWeight: 600, margin: '2px 0' }}>
                {crop.status === 'Normal' ? '정상' : crop.status === 'Error' ? '분석 실패' : '이상 감지'}
              </p>
              <p style={{ fontSize: 11, color: '#9ca3af', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {crop.overall}
              </p>
              {crop.analyzed_at && <p style={{ fontSize: 10, color: '#6b7280', margin: '2px 0 0' }}>{crop.analyzed_at}</p>}
            </div>
            {crop.status === 'Error' ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleRetry(crop, i) }}
                disabled={analyzing}
                style={{ padding: '6px 10px', borderRadius: 6, background: '#f59e0b', color: '#000', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                재분석
              </button>
            ) : (
              <ChevronRight size={16} color="#6b7280" />
            )}
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
