import { describe, expect, it } from 'vitest'
import {
  INITIAL_POSE_COVARIANCE,
  buildInitialPoseMessage,
  canSetManualInitialPose,
  isManualNav2Ready,
  isNewManualNav2Ready,
  yawFromDrag,
} from './initialPose'

describe('manual 2D Pose helpers', () => {
  it('uses yaw 0 for a click or very short drag', () => {
    expect(yawFromDrag({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0)
    expect(yawFromDrag({ x: 1, y: 2 }, { x: 1.01, y: 2.01 })).toBe(0)
  })

  it('uses the drag direction for yaw', () => {
    expect(yawFromDrag({ x: 1, y: 2 }, { x: 1, y: 3 })).toBeCloseTo(Math.PI / 2)
    expect(yawFromDrag({ x: 1, y: 2 }, { x: 0, y: 2 })).toBeCloseTo(Math.PI)
  })

  it('builds one ROS 2 initial-pose payload with the existing covariance', () => {
    const message = buildInitialPoseMessage(
      { x: 1.25, y: -2.5, yaw: Math.PI / 2 },
      1_712_345_678_901,
    )

    expect(message.header).toEqual({
      stamp: { sec: 1_712_345_678, nanosec: 901_000_000 },
      frame_id: 'map',
    })
    expect(message.pose.pose.position).toEqual({ x: 1.25, y: -2.5, z: 0 })
    expect(message.pose.pose.orientation.x).toBe(0)
    expect(message.pose.pose.orientation.y).toBe(0)
    expect(message.pose.pose.orientation.z).toBeCloseTo(Math.SQRT1_2)
    expect(message.pose.pose.orientation.w).toBeCloseTo(Math.SQRT1_2)
    expect(message.pose.covariance).toEqual(INITIAL_POSE_COVARIANCE)
  })

  it('allows initial input before teleop status arrives and blocks only an active teleop', () => {
    expect(canSetManualInitialPose(true, false, false)).toBe(true)
    expect(canSetManualInitialPose(true, null, false)).toBe(true)
    expect(canSetManualInitialPose(false, false, false)).toBe(false)
    expect(canSetManualInitialPose(true, true, false)).toBe(false)
    expect(canSetManualInitialPose(true, false, true)).toBe(false)
  })

  it('recognizes a newly reported MANUAL_NAV2_READY state', () => {
    expect(isManualNav2Ready('MANUAL_NAV2_READY')).toBe(true)
    expect(isManualNav2Ready('manual_nav2_ready localization complete')).toBe(true)
    expect(isManualNav2Ready('SUCCEEDED')).toBe(false)
    expect(isNewManualNav2Ready('MANUAL_NAV2_READY', 7, 7)).toBe(false)
    expect(isNewManualNav2Ready('MANUAL_NAV2_READY', 8, 7)).toBe(true)
  })
})
