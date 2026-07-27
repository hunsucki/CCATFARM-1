import { useEffect, useRef, useState, useCallback } from 'react'

// CDN으로 로드된 ROSLIB은 window.ROSLIB으로 접근
// npm 패키지 import 대신 전역 객체 사용
declare const ROSLIB: typeof import('roslib')

export type RosStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface UseRosReturn {
  ros: InstanceType<typeof ROSLIB.Ros> | null
  status: RosStatus
  connect: () => void
  disconnect: () => void
}

const ROS_URL = import.meta.env.VITE_ROS_URL?.trim()

export function useRos(): UseRosReturn {
  const rosRef = useRef<InstanceType<typeof ROSLIB.Ros> | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(true)
  const [status, setStatus] = useState<RosStatus>('disconnected')

  const connect = useCallback(() => {
    if (!ROS_URL) {
      console.error('[ROS] VITE_ROS_URL is not configured')
      setStatus('error')
      return
    }

    shouldReconnectRef.current = true
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (rosRef.current) {
      rosRef.current.close()
    }

    setStatus('connecting')

    const ros = new ROSLIB.Ros({ url: ROS_URL })
    rosRef.current = ros

    ros.on('connection', () => {
      console.log('[ROS] Connected to', ROS_URL)
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      setStatus('connected')
    })

    ros.on('error', (error: unknown) => {
      console.error('[ROS] Connection error:', error)
      setStatus('error')
    })

    ros.on('close', () => {
      console.log('[ROS] Connection closed')
      setStatus('disconnected')
      if (!shouldReconnectRef.current || rosRef.current !== ros) return
      reconnectTimerRef.current = window.setTimeout(() => {
        if (!shouldReconnectRef.current || rosRef.current !== ros) return
        console.log('[ROS] Reconnecting to', ROS_URL)
        setStatus('connecting')
        ros.connect(ROS_URL)
      }, 2000)
    })
  }, [])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    rosRef.current?.close()
    rosRef.current = null
    setStatus('disconnected')
  }, [])

  useEffect(() => {
    connect()
    return () => {
      shouldReconnectRef.current = false
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      rosRef.current?.close()
      rosRef.current = null
    }
  }, [connect])

  return { ros: rosRef.current, status, connect, disconnect }
}
