import { describe, expect, it } from 'vitest'
import { deriveServerTeleopState, modeRequestData } from './forceMode'

describe('persistent FORCE mode', () => {
  it('uses the server mode-request contract values', () => {
    expect(modeRequestData('force')).toBe('FORCE')
    expect(modeRequestData('safe')).toBe('SAFE')
  })

  it('shows FORCE ARMED only after the server confirms FORCE and active=true', () => {
    expect(deriveServerTeleopState('FORCE', true).forceArmed).toBe(true)
    expect(deriveServerTeleopState('FORCE', false).forceArmed).toBe(false)
    expect(deriveServerTeleopState('TRANSITIONING_FORCE', true).forceArmed).toBe(false)
  })

  it('identifies server transitions and a fully released SAFE state', () => {
    expect(deriveServerTeleopState('TRANSITIONING_FORCE', true).transitioningForce).toBe(true)
    expect(deriveServerTeleopState('TRANSITIONING_SAFE', true).transitioningSafe).toBe(true)
    expect(deriveServerTeleopState('SAFE', false).released).toBe(true)
    expect(deriveServerTeleopState('DISABLED', false).released).toBe(true)
    expect(deriveServerTeleopState('SAFE', true).released).toBe(false)
  })
})
