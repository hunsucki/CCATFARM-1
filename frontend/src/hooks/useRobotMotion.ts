import { useEffect, useRef, useState } from 'react'
import type { UseRosReturn } from './useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

const LINEAR_STOP_THRESHOLD = 0.02
const ANGULAR_STOP_THRESHOLD = 0.05
const STATIONARY_CONFIRM_MS = 750
const ODOM_STALE_MS = 1200

export interface RobotMotionStatus {
  fresh: boolean
  stationary: boolean
  linearSpeed: number
  angularSpeed: number
}

const INITIAL_MOTION: RobotMotionStatus = {
  fresh: false,
  stationary: false,
  linearSpeed: 0,
  angularSpeed: 0,
}

export function useRobotMotion(
  ros: UseRosReturn['ros'],
  status: UseRosReturn['status'],
): RobotMotionStatus {
  const [motion, setMotion] = useState(INITIAL_MOTION)
  const stationarySinceRef = useRef<number | null>(null)
  const lastOdomAtRef = useRef(0)

  useEffect(() => {
    if (!ros || status !== 'connected') {
      stationarySinceRef.current = null
      lastOdomAtRef.current = 0
      setMotion(INITIAL_MOTION)
      return
    }

    const odomTopic = new ROSLIB.Topic({
      ros,
      name: TOPICS.ODOM.name,
      messageType: TOPICS.ODOM.messageType,
      throttle_rate: 50,
      queue_length: 1,
    } as any)

    odomTopic.subscribe((message: any) => {
      const linearX = Number(message.twist?.twist?.linear?.x ?? 0)
      const linearY = Number(message.twist?.twist?.linear?.y ?? 0)
      const angularZ = Number(message.twist?.twist?.angular?.z ?? 0)
      const linearSpeed = Math.hypot(linearX, linearY)
      const angularSpeed = Math.abs(angularZ)
      const now = Date.now()
      const belowStopThreshold = linearSpeed <= LINEAR_STOP_THRESHOLD
        && angularSpeed <= ANGULAR_STOP_THRESHOLD

      lastOdomAtRef.current = now
      if (belowStopThreshold) {
        stationarySinceRef.current ??= now
      } else {
        stationarySinceRef.current = null
      }

      setMotion({
        fresh: true,
        stationary: belowStopThreshold
          && stationarySinceRef.current !== null
          && now - stationarySinceRef.current >= STATIONARY_CONFIRM_MS,
        linearSpeed,
        angularSpeed,
      })
    })

    const staleTimer = window.setInterval(() => {
      if (Date.now() - lastOdomAtRef.current <= ODOM_STALE_MS) return
      stationarySinceRef.current = null
      setMotion((current) => current.fresh || current.stationary
        ? { ...current, fresh: false, stationary: false }
        : current)
    }, 250)

    return () => {
      window.clearInterval(staleTimer)
      odomTopic.unsubscribe()
      stationarySinceRef.current = null
      lastOdomAtRef.current = 0
    }
  }, [ros, status])

  return motion
}
