import { useCallback, useEffect, useRef } from 'react'
import type { UseRosReturn } from './useRos'
import { TOPICS } from '../config/rosTopics'
import { modeRequestData } from '../utils/forceMode'

declare const ROSLIB: typeof import('roslib')

export type TeleopMode = 'safe' | 'force'

const TELEOP_PERIOD_MS = 1000 / 15
const LIMITS = {
  safe: { linear: 0.15, angular: 0.4 },
  force: { linear: 0.08, angular: 0.25 },
} as const

const zeroTwist = () => ({
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
})

export function useWebTeleop(
  ros: UseRosReturn['ros'],
  status: UseRosReturn['status'],
  enabled = true,
) {
  const safeTopicRef = useRef<InstanceType<typeof ROSLIB.Topic> | null>(null)
  const forceTopicRef = useRef<InstanceType<typeof ROSLIB.Topic> | null>(null)
  const modeRequestTopicRef = useRef<InstanceType<typeof ROSLIB.Topic> | null>(null)
  const timerRef = useRef<number | null>(null)
  const requestedModeRef = useRef<TeleopMode | null>(null)
  const latestTwistRef = useRef(zeroTwist())

  const topicForMode = useCallback((mode: TeleopMode) => (
    mode === 'force' ? forceTopicRef.current : safeTopicRef.current
  ), [])

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }

    const mode = requestedModeRef.current
    if (mode) topicForMode(mode)?.publish(zeroTwist() as any)
    requestedModeRef.current = null
    latestTwistRef.current = zeroTwist()
  }, [topicForMode])

  const stopForce = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }

    forceTopicRef.current?.publish(zeroTwist() as any)
    requestedModeRef.current = null
    latestTwistRef.current = zeroTwist()
  }, [])

  const requestMode = useCallback((mode: TeleopMode) => {
    if (!ros || status !== 'connected' || !modeRequestTopicRef.current) return false
    modeRequestTopicRef.current.publish({ data: modeRequestData(mode) } as any)
    return true
  }, [ros, status])

  const move = useCallback((mode: TeleopMode, linearInput: number, angularInput: number) => {
    if (!ros || status !== 'connected' || !enabled) return false

    if (requestedModeRef.current && requestedModeRef.current !== mode) stop()

    const limits = LIMITS[mode]
    latestTwistRef.current = {
      linear: { x: Math.max(-1, Math.min(1, linearInput)) * limits.linear, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: Math.max(-1, Math.min(1, angularInput)) * limits.angular },
    }
    requestedModeRef.current = mode

    topicForMode(mode)?.publish(latestTwistRef.current as any)
    if (timerRef.current === null) {
      timerRef.current = window.setInterval(() => {
        const requestedMode = requestedModeRef.current
        if (requestedMode) topicForMode(requestedMode)?.publish(latestTwistRef.current as any)
      }, TELEOP_PERIOD_MS)
    }
    return true
  }, [enabled, ros, status, stop, topicForMode])

  useEffect(() => {
    if (!enabled) {
      stop()
    }
  }, [enabled, stop])

  useEffect(() => {
    if (!ros || status !== 'connected') {
      stop()
      safeTopicRef.current = null
      forceTopicRef.current = null
      modeRequestTopicRef.current = null
      return
    }

    safeTopicRef.current = new ROSLIB.Topic({
      ros,
      name: TOPICS.CMD_VEL_WEB_SAFE.name,
      messageType: TOPICS.CMD_VEL_WEB_SAFE.messageType,
    })
    forceTopicRef.current = new ROSLIB.Topic({
      ros,
      name: TOPICS.CMD_VEL_WEB_FORCE.name,
      messageType: TOPICS.CMD_VEL_WEB_FORCE.messageType,
    })
    modeRequestTopicRef.current = new ROSLIB.Topic({
      ros,
      name: TOPICS.WEB_TELEOP_MODE_REQUEST.name,
      messageType: TOPICS.WEB_TELEOP_MODE_REQUEST.messageType,
    })

    return () => {
      stop()
      safeTopicRef.current?.unadvertise()
      forceTopicRef.current?.unadvertise()
      modeRequestTopicRef.current?.unadvertise()
      safeTopicRef.current = null
      forceTopicRef.current = null
      modeRequestTopicRef.current = null
    }
  }, [ros, status, stop])

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden) stop()
    }
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => {
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', stopWhenHidden)
    }
  }, [stop])

  return { move, stop, stopForce, requestMode }
}
