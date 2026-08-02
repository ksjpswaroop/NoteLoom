export type MidsceneRuntimeState =
  | 'stopped'
  | 'ready'
  | 'running'
  | 'needs_accessibility'
  | 'needs_screen_recording'
  | 'error'
  | 'unavailable'

export interface MidsceneModelEnv {
  apiKey: string
  modelName: string
  baseUrl: string
  family: string
  reasoningEnabled?: boolean | null
}

export interface MidsceneSettings {
  enabled: boolean
  optInAccepted: boolean
  model: MidsceneModelEnv
}

export interface MidsceneStatus {
  supportedPlatform: boolean
  platform: string
  nodeAvailable: boolean
  nodePath?: string | null
  npmAvailable: boolean
  packageReady: boolean
  runtimeDir: string
  accessibilityOk: boolean
  screenRecordingOk: boolean
  modelConfigured: boolean
  busy: boolean
  state: MidsceneRuntimeState | string
  message: string
  detail?: string | null
  displays: unknown[]
}

export interface MidsceneEnsureResult {
  success: boolean
  status: MidsceneStatus
  stdout: string
  stderr: string
}

export interface MidsceneStep {
  type?: 'act' | 'assert' | 'query' | 'wait'
  prompt?: string
  action?: string
  assert?: string
  description?: string
  title?: string
  message?: string
  screenshot?: boolean
}

export interface MidsceneRunRequest {
  command: 'status' | 'act' | 'query' | 'assert' | 'test' | 'document'
  prompt?: string
  message?: string
  title?: string
  steps?: MidsceneStep[]
  outputDir?: string
  noteFileName?: string
  displayId?: string
  aiActionContext?: string
  stopOnFailure?: boolean
  continueOnError?: boolean
  timeoutSecs?: number
  model: MidsceneModelEnv
}

export interface MidsceneRunResult {
  ok: boolean
  executionId: string
  command: string
  data: Record<string, unknown>
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
}

export interface MidsceneProgressEvent {
  stage: string
  message: string
  executionId?: string | null
}

export const DEFAULT_MIDSCENE_MODEL: MidsceneModelEnv = {
  apiKey: '',
  modelName: '',
  baseUrl: '',
  family: '',
  reasoningEnabled: false,
}

export const DEFAULT_MIDSCENE_SETTINGS: MidsceneSettings = {
  enabled: false,
  optInAccepted: false,
  model: { ...DEFAULT_MIDSCENE_MODEL },
}

export function formatMidsceneState(state: string): string {
  switch (state) {
    case 'ready':
      return 'Ready'
    case 'running':
      return 'Running'
    case 'needs_accessibility':
      return 'Needs Accessibility'
    case 'needs_screen_recording':
      return 'Needs Screen Recording'
    case 'error':
      return 'Error'
    case 'unavailable':
      return 'Unavailable'
    case 'stopped':
    default:
      return 'Idle'
  }
}
