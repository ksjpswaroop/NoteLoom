export type LocalServiceId = 'wigolo' | 'parakeet' | 'midscene'

export type LocalServiceState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'connected_external'
  | 'error'
  | 'unavailable'
  | 'ready'

export interface LocalServiceStatus {
  id: LocalServiceId | string
  label: string
  state: LocalServiceState
  managed: boolean
  owned: boolean
  baseUrl?: string | null
  pid?: number | null
  message: string
  detail?: string | null
  dataDir?: string | null
  packageReady: boolean
}

export interface LocalServiceEnsureOptions {
  baseUrl?: string
  apiToken?: string
  /** When false, skip npm install (search hot-path). Default true. */
  installIfNeeded?: boolean
  startIfNeeded?: boolean
}

export interface LocalServiceProgressEvent {
  serviceId: string
  stage: string
  message: string
}

export function formatLocalServiceState(state: LocalServiceState): string {
  switch (state) {
    case 'running':
      return 'Running'
    case 'starting':
      return 'Starting'
    case 'connected_external':
      return 'Connected external'
    case 'ready':
      return 'Ready'
    case 'error':
      return 'Error'
    case 'unavailable':
      return 'Unavailable'
    case 'stopped':
    default:
      return 'Stopped'
  }
}

/**
 * One actionable English tip when a managed service is missing Node/Python.
 * Returns null when the message is not a known toolchain gap.
 */
export function getLocalServiceFixTip(message?: string | null): string | null {
  if (!message) return null
  const lower = message.toLowerCase()
  if (
    lower.includes('node.js was not found')
    || lower.includes('node.js is required')
    || lower.includes('npm was not found')
  ) {
    return 'Install Node.js 20+ from nodejs.org (or Volta), then restart NoteLoom.'
  }
  if (lower.includes('python 3.10') || lower.includes('python is required') || lower.includes('python 3.10–3.13')) {
    return 'Install Python 3.10–3.13 from python.org or Homebrew, then try again.'
  }
  return null
}
