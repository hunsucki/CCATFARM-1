export interface Point2D {
  x: number
  y: number
}

export interface PoseEstimate extends Point2D {
  yaw: number
}

export const MANUAL_NAV2_READY = 'MANUAL_NAV2_READY'

export const INITIAL_POSE_COVARIANCE = [
  0.0625, 0, 0, 0, 0, 0,
  0, 0.0625, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0.06853892326654787,
]

export function yawFromDrag(start: Point2D, end: Point2D): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return Math.hypot(dx, dy) > 0.02 ? Math.atan2(dy, dx) : 0
}

export function buildInitialPoseMessage(pose: PoseEstimate, nowMs = Date.now()) {
  const halfYaw = pose.yaw / 2

  return {
    header: {
      stamp: {
        sec: Math.floor(nowMs / 1000),
        nanosec: (nowMs % 1000) * 1_000_000,
      },
      frame_id: 'map',
    },
    pose: {
      pose: {
        position: { x: pose.x, y: pose.y, z: 0 },
        orientation: {
          x: 0,
          y: 0,
          z: Math.sin(halfYaw),
          w: Math.cos(halfYaw),
        },
      },
      covariance: INITIAL_POSE_COVARIANCE,
    },
  }
}

export function robotStatusCode(status: string): string {
  return status.trim().toUpperCase().split(/\s+/, 1)[0] ?? 'UNKNOWN'
}

export function isManualNav2Ready(status: string): boolean {
  return robotStatusCode(status) === MANUAL_NAV2_READY
}

export function isNewManualNav2Ready(
  status: string,
  statusSequence: number,
  statusSequenceAtSend: number,
): boolean {
  return statusSequence > statusSequenceAtSend && isManualNav2Ready(status)
}

export function canSetManualInitialPose(
  rosConnected: boolean,
  teleopActive: boolean | null,
  manualPosePending: boolean,
): boolean {
  return rosConnected && teleopActive !== true && !manualPosePending
}
