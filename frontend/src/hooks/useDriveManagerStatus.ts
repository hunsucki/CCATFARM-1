import { useEffect, useState } from 'react'
import type { UseRosReturn } from './useRos'
import { TOPICS } from '../config/rosTopics'

declare const ROSLIB: typeof import('roslib')

export interface DriveManagerStatus {
  teleopActive: boolean | null
  teleopStatus: string
  robotStatus: string
  robotPoseSource: string
  missionRoute: Record<string, unknown> | null
  routeError: string | null
}

const INITIAL_STATUS: DriveManagerStatus = {
  teleopActive: null,
  teleopStatus: 'UNKNOWN',
  robotStatus: 'UNKNOWN',
  robotPoseSource: 'UNKNOWN',
  missionRoute: null,
  routeError: null,
}

export function useDriveManagerStatus(
  ros: UseRosReturn['ros'],
  status: UseRosReturn['status'],
): DriveManagerStatus {
  const [driveStatus, setDriveStatus] = useState<DriveManagerStatus>(INITIAL_STATUS)

  useEffect(() => {
    if (!ros || status !== 'connected') {
      setDriveStatus(INITIAL_STATUS)
      return
    }

    const subscriptions = [
      {
        topic: TOPICS.WEB_TELEOP_STATUS,
        onMessage: (message: any) => setDriveStatus((current) => ({
          ...current,
          teleopStatus: String(message.data ?? 'UNKNOWN'),
        })),
      },
      {
        topic: TOPICS.WEB_TELEOP_ACTIVE,
        onMessage: (message: any) => setDriveStatus((current) => ({
          ...current,
          teleopActive: Boolean(message.data),
        })),
      },
      {
        topic: TOPICS.ROBOT_STATUS,
        onMessage: (message: any) => setDriveStatus((current) => ({
          ...current,
          robotStatus: String(message.data ?? 'UNKNOWN'),
        })),
      },
      {
        topic: TOPICS.ROBOT_POSE_STATUS,
        onMessage: (message: any) => setDriveStatus((current) => ({
          ...current,
          robotPoseSource: String(message.data ?? 'UNKNOWN'),
        })),
      },
      {
        topic: TOPICS.MISSION_ROUTE_POINTS,
        onMessage: (message: any) => {
          try {
            const parsed = JSON.parse(String(message.data)) as Record<string, unknown>
            setDriveStatus((current) => ({ ...current, missionRoute: parsed, routeError: null }))
          } catch {
            setDriveStatus((current) => ({
              ...current,
              routeError: '미션 경로 JSON을 해석할 수 없습니다.',
            }))
          }
        },
      },
    ].map(({ topic, onMessage }) => {
      const subscription = new ROSLIB.Topic({
        ros,
        name: topic.name,
        messageType: topic.messageType,
        throttle_rate: 100,
        queue_length: 1,
      } as any)
      subscription.subscribe(onMessage)
      return subscription
    })

    return () => subscriptions.forEach((subscription) => subscription.unsubscribe())
  }, [ros, status])

  return driveStatus
}
