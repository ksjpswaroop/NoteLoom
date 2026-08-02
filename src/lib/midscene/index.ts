import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { appDataDir } from '@tauri-apps/api/path'
import {
  getMidsceneSettingsSync,
  isMidsceneAutomationAvailableSync,
  isMidsceneModelConfigured,
  loadMidsceneSettings,
} from './settings'
import type {
  MidsceneEnsureResult,
  MidsceneModelEnv,
  MidsceneProgressEvent,
  MidsceneRunRequest,
  MidsceneRunResult,
  MidsceneStatus,
  MidsceneStep,
} from './types'
import { DEFAULT_MIDSCENE_MODEL } from './types'

export * from './types'
export {
  getMidsceneSettingsSync,
  isMidsceneAutomationAvailableSync,
  isMidsceneModelConfigured,
  loadMidsceneSettings,
  saveMidsceneSettings,
} from './settings'
export { importMidsceneNoteToWorkspace } from './workspace-import'

function isDesktopTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function unavailableStatus(message: string): MidsceneStatus {
  return {
    supportedPlatform: false,
    platform: 'web',
    nodeAvailable: false,
    npmAvailable: false,
    packageReady: false,
    runtimeDir: '',
    accessibilityOk: false,
    screenRecordingOk: false,
    modelConfigured: false,
    busy: false,
    state: 'unavailable',
    message,
    displays: [],
  }
}

async function resolveModel(model?: MidsceneModelEnv | null): Promise<MidsceneModelEnv> {
  if (model && isMidsceneModelConfigured(model)) {
    return model
  }
  const settings = await loadMidsceneSettings()
  return settings.model.apiKey || settings.model.modelName
    ? settings.model
    : { ...DEFAULT_MIDSCENE_MODEL }
}

export async function inspectMidscene(model?: MidsceneModelEnv | null): Promise<MidsceneStatus> {
  if (!isDesktopTauri()) {
    return unavailableStatus('Midscene Automations are only available in the NoteLoom desktop app.')
  }
  return invoke<MidsceneStatus>('inspect_midscene', {
    model: await resolveModel(model),
  })
}

export async function ensureMidscene(model?: MidsceneModelEnv | null): Promise<MidsceneEnsureResult> {
  if (!isDesktopTauri()) {
    const status = await inspectMidscene(model)
    return { success: false, status, stdout: '', stderr: status.message }
  }
  return invoke<MidsceneEnsureResult>('ensure_midscene', {
    model: await resolveModel(model),
  })
}

export async function runMidscene(
  request: Omit<MidsceneRunRequest, 'model'> & { model?: MidsceneModelEnv | null },
): Promise<MidsceneRunResult> {
  if (!isDesktopTauri()) {
    throw new Error('Midscene Automations are only available in the NoteLoom desktop app.')
  }

  const settings = await loadMidsceneSettings()
  if (!settings.enabled || !settings.optInAccepted) {
    throw new Error(
      'Midscene Automations are disabled. Enable them and accept the safety warning in Settings → Automations.',
    )
  }

  const model = await resolveModel(request.model ?? settings.model)
  return invoke<MidsceneRunResult>('run_midscene', {
    request: {
      ...request,
      model,
    },
  })
}

export async function cancelMidscene(executionId: string): Promise<boolean> {
  if (!isDesktopTauri()) return false
  return invoke<boolean>('cancel_midscene', { executionId })
}

export async function promptMidscenePermissions(): Promise<{ ok: boolean; message: string }> {
  if (!isDesktopTauri()) {
    return { ok: false, message: 'Permission prompts are only available in the desktop app.' }
  }
  return invoke('prompt_midscene_permissions')
}

export async function listenMidsceneProgress(
  handler: (event: MidsceneProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isDesktopTauri()) return () => {}
  return listen<MidsceneProgressEvent>('midscene-progress', (event) => {
    handler(event.payload)
  })
}

/** Default output folder under app data for test/doc artifacts. */
export async function getMidsceneOutputDir(kind: 'tests' | 'docs', slug: string): Promise<string> {
  const root = await appDataDir()
  const safe = slug.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'run'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${root}/midscene/${kind}/${safe}-${stamp}`
}

export async function midsceneAct(prompt: string, options: {
  displayId?: string
  aiActionContext?: string
  timeoutSecs?: number
} = {}): Promise<MidsceneRunResult> {
  return runMidscene({
    command: 'act',
    prompt,
    displayId: options.displayId,
    aiActionContext: options.aiActionContext,
    timeoutSecs: options.timeoutSecs,
  })
}

export async function midsceneQuery(prompt: string, options: {
  displayId?: string
  timeoutSecs?: number
} = {}): Promise<MidsceneRunResult> {
  return runMidscene({
    command: 'query',
    prompt,
    displayId: options.displayId,
    timeoutSecs: options.timeoutSecs,
  })
}

export async function midsceneAssert(prompt: string, options: {
  message?: string
  displayId?: string
  timeoutSecs?: number
} = {}): Promise<MidsceneRunResult> {
  return runMidscene({
    command: 'assert',
    prompt,
    message: options.message,
    displayId: options.displayId,
    timeoutSecs: options.timeoutSecs,
  })
}

export async function midsceneRunTest(options: {
  title: string
  steps: MidsceneStep[]
  outputDir?: string
  stopOnFailure?: boolean
  timeoutSecs?: number
}): Promise<MidsceneRunResult> {
  const outputDir = options.outputDir || await getMidsceneOutputDir('tests', options.title)
  return runMidscene({
    command: 'test',
    title: options.title,
    steps: options.steps,
    outputDir,
    stopOnFailure: options.stopOnFailure,
    timeoutSecs: options.timeoutSecs ?? 600,
  })
}

export async function midsceneDocumentFlow(options: {
  title: string
  steps: MidsceneStep[]
  outputDir?: string
  noteFileName?: string
  continueOnError?: boolean
  timeoutSecs?: number
}): Promise<MidsceneRunResult> {
  const outputDir = options.outputDir || await getMidsceneOutputDir('docs', options.title)
  return runMidscene({
    command: 'document',
    title: options.title,
    steps: options.steps,
    outputDir,
    noteFileName: options.noteFileName,
    continueOnError: options.continueOnError,
    timeoutSecs: options.timeoutSecs ?? 900,
  })
}

export function getCachedMidsceneAvailability() {
  return {
    available: isMidsceneAutomationAvailableSync(),
    settings: getMidsceneSettingsSync(),
  }
}
