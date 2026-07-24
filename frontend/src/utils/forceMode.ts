export interface ServerTeleopState {
  status: string
  forceArmed: boolean
  transitioningForce: boolean
  transitioningSafe: boolean
  released: boolean
  error: boolean
}

export function modeRequestData(mode: 'safe' | 'force'): 'SAFE' | 'FORCE' {
  return mode === 'force' ? 'FORCE' : 'SAFE'
}

function statusCode(status: string): string {
  return status.trim().toUpperCase().split(/\s+/, 1)[0] ?? 'UNKNOWN'
}

export function deriveServerTeleopState(
  status: string,
  active: boolean | null,
): ServerTeleopState {
  const code = statusCode(status)

  return {
    status: code,
    forceArmed: code === 'FORCE' && active === true,
    transitioningForce: code === 'TRANSITIONING_FORCE',
    transitioningSafe: code === 'TRANSITIONING_SAFE',
    released: (code === 'SAFE' || code === 'DISABLED') && active === false,
    error: code === 'ERROR' || code.startsWith('ERROR_'),
  }
}
