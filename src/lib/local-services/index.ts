import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from '@/hooks/use-toast'
import {
  ensureParakeetStt,
  inspectParakeetStt,
  type ParakeetStatus,
} from '@/lib/speech/parakeet.ts'
import { DEFAULT_PARAKEET_MODEL_ID } from '@/lib/speech/parakeet-models.ts'
import {
  ensureMidscene,
  inspectMidscene,
  listenMidsceneProgress,
  type MidsceneStatus,
} from '@/lib/midscene'
import type {
  LocalServiceEnsureOptions,
  LocalServiceId,
  LocalServiceProgressEvent,
  LocalServiceStatus,
} from './types'

export type {
  LocalServiceEnsureOptions,
  LocalServiceId,
  LocalServiceProgressEvent,
  LocalServiceState,
  LocalServiceStatus,
} from './types'
export { formatLocalServiceState, getLocalServiceFixTip } from './types'

function isDesktopTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function serviceLabel(id: LocalServiceId | string): string {
  if (id === 'wigolo') return 'Wigolo'
  if (id === 'parakeet') return 'Parakeet STT'
  if (id === 'midscene') return 'Midscene'
  return String(id)
}

function unavailableStatus(
  id: LocalServiceId | string,
  message: string,
): LocalServiceStatus {
  return {
    id,
    label: serviceLabel(id),
    state: 'unavailable',
    managed: false,
    owned: false,
    message,
    packageReady: false,
  }
}

function mapParakeetStatus(status: ParakeetStatus): LocalServiceStatus {
  if (!status.supportedPlatform) {
    return {
      id: 'parakeet',
      label: 'Parakeet STT',
      state: 'unavailable',
      managed: true,
      owned: false,
      message: status.message,
      dataDir: status.cacheDir || null,
      packageReady: false,
    }
  }

  if (status.runtimeReady) {
    return {
      id: 'parakeet',
      label: 'Parakeet STT',
      state: 'ready',
      managed: true,
      owned: false,
      message: status.message || 'Ready',
      dataDir: status.cacheDir || null,
      packageReady: true,
    }
  }

  return {
    id: 'parakeet',
    label: 'Parakeet STT',
    state: status.pythonAvailable ? 'stopped' : 'error',
    managed: true,
    owned: false,
    message: status.message || 'Parakeet runtime is not ready',
    dataDir: status.cacheDir || null,
    packageReady: status.pythonAvailable,
  }
}

async function statusParakeet(model = DEFAULT_PARAKEET_MODEL_ID): Promise<LocalServiceStatus> {
  return mapParakeetStatus(await inspectParakeetStt(model))
}

async function ensureParakeet(model = DEFAULT_PARAKEET_MODEL_ID): Promise<LocalServiceStatus> {
  const result = await ensureParakeetStt(model)
  const status = mapParakeetStatus(result.status)
  if (!result.success && status.state !== 'ready') {
    throw new Error(result.stderr || result.status.message || 'Failed to ensure Parakeet STT')
  }
  return status
}

function mapMidsceneState(state: string): LocalServiceStatus['state'] {
  switch (state) {
    case 'ready':
      return 'ready'
    case 'running':
      return 'running'
    case 'needs_accessibility':
    case 'needs_screen_recording':
    case 'error':
      return 'error'
    case 'unavailable':
      return 'unavailable'
    case 'stopped':
    default:
      return 'stopped'
  }
}

function mapMidsceneStatus(status: MidsceneStatus): LocalServiceStatus {
  return {
    id: 'midscene',
    label: 'Midscene',
    state: mapMidsceneState(status.state),
    managed: true,
    owned: false,
    message: status.message,
    detail: status.detail,
    dataDir: status.runtimeDir || null,
    packageReady: status.packageReady,
  }
}

async function statusMidscene(): Promise<LocalServiceStatus> {
  return mapMidsceneStatus(await inspectMidscene())
}

async function ensureMidsceneService(): Promise<LocalServiceStatus> {
  const result = await ensureMidscene()
  const status = mapMidsceneStatus(result.status)
  if (!result.success && status.state !== 'ready' && status.state !== 'error') {
    // Package install can succeed while OS permissions still need attention.
    if (!result.status.packageReady) {
      throw new Error(result.stderr || result.status.message || 'Failed to ensure Midscene')
    }
  }
  return status
}

/** Daemon-style services managed by the Tauri local_services module. */
export const MANAGED_DAEMON_SERVICES: LocalServiceId[] = ['wigolo']

/** All services exposed through this package (includes non-daemon adapters). */
export const LOCAL_SERVICES: LocalServiceId[] = ['wigolo', 'parakeet', 'midscene']

export async function listLocalServices(): Promise<LocalServiceId[]> {
  if (!isDesktopTauri()) return [...LOCAL_SERVICES]
  try {
    const daemons = await invoke<string[]>('local_service_list')
    const ids = new Set<LocalServiceId>(['parakeet', 'midscene'])
    for (const id of daemons) {
      if (id === 'wigolo' || id === 'parakeet' || id === 'midscene') ids.add(id)
    }
    return [...ids]
  } catch {
    return [...LOCAL_SERVICES]
  }
}

export async function getServiceStatus(
  serviceId: LocalServiceId | string,
  options: LocalServiceEnsureOptions = {},
): Promise<LocalServiceStatus> {
  if (serviceId === 'parakeet') {
    return statusParakeet()
  }
  if (serviceId === 'midscene') {
    return statusMidscene()
  }

  if (!isDesktopTauri()) {
    return unavailableStatus(serviceId, 'Local services are only available in the NoteLoom desktop app.')
  }

  return invoke<LocalServiceStatus>('local_service_status', {
    serviceId,
    options,
  })
}

/**
 * Health-check → reuse if healthy → otherwise start (and optionally install)
 * a secluded managed copy under app data.
 */
export async function ensureService(
  serviceId: LocalServiceId | string,
  options: LocalServiceEnsureOptions = {},
): Promise<LocalServiceStatus> {
  if (serviceId === 'parakeet') {
    return ensureParakeet()
  }
  if (serviceId === 'midscene') {
    return ensureMidsceneService()
  }

  if (!isDesktopTauri()) {
    throw new Error('Local services are only available in the NoteLoom desktop app.')
  }

  return invoke<LocalServiceStatus>('local_service_ensure', {
    serviceId,
    options,
  })
}

/** Stop a NoteLoom-owned process. Leaves user-started daemons alone. */
export async function stopService(
  serviceId: LocalServiceId | string,
  options: LocalServiceEnsureOptions = {},
): Promise<LocalServiceStatus> {
  if (serviceId === 'parakeet') {
    throw new Error('Parakeet STT is an on-demand runtime, not a long-running daemon to stop.')
  }
  if (serviceId === 'midscene') {
    throw new Error('Midscene is an on-demand runtime, not a long-running daemon to stop.')
  }

  if (!isDesktopTauri()) {
    throw new Error('Local services are only available in the NoteLoom desktop app.')
  }

  return invoke<LocalServiceStatus>('local_service_stop', {
    serviceId,
    options,
  })
}

export async function listenLocalServiceProgress(
  handler: (event: LocalServiceProgressEvent) => void,
): Promise<UnlistenFn> {
  if (!isDesktopTauri()) {
    return () => {}
  }
  return listen<LocalServiceProgressEvent>('local-service-progress', (event) => {
    handler(event.payload)
  })
}

async function withEnsureProgress<T>(
  serviceId: LocalServiceId,
  title: string,
  run: () => Promise<T>,
): Promise<T> {
  type EnsureToast = {
    dismiss: () => void
    update: (next: { title?: string; description?: string }) => void
  }
  const toastRef: { current: EnsureToast | null } = { current: null }
  let lastMessage = ''
  let allowToast = false
  const showAfterMs = 450
  const delayTimer = typeof window !== 'undefined'
    ? window.setTimeout(() => {
      allowToast = true
      if (lastMessage && !toastRef.current) {
        toastRef.current = toast({ title, description: lastMessage })
      }
    }, showAfterMs)
    : undefined

  const showOrUpdate = (message: string, stage?: string) => {
    const next = message.trim()
    if (!next) return
    // Installing / starting should surface immediately; quick health checks stay quiet.
    if (stage === 'installing' || stage === 'starting' || stage === 'preparing') {
      allowToast = true
      if (delayTimer !== undefined) window.clearTimeout(delayTimer)
    }
    if (next === lastMessage && toastRef.current) return
    lastMessage = next
    if (!allowToast) return
    if (!toastRef.current) {
      toastRef.current = toast({ title, description: next })
      return
    }
    toastRef.current.update({ title, description: next })
  }

  const unsubs: Array<() => void> = []
  try {
    unsubs.push(await listenLocalServiceProgress((event) => {
      if (event.serviceId !== serviceId) return
      showOrUpdate(event.message, event.stage)
    }))
    if (serviceId === 'midscene') {
      unsubs.push(await listenMidsceneProgress((event) => {
        if (event.message) showOrUpdate(event.message, event.stage)
      }))
    }
  } catch {
    // Progress events are best-effort; ensure still proceeds.
  }

  try {
    return await run()
  } finally {
    if (delayTimer !== undefined) window.clearTimeout(delayTimer)
    for (const unsub of unsubs) {
      try { unsub() } catch { /* ignore */ }
    }
    toastRef.current?.dismiss()
  }
}

/** Convenience helper used by web search before calling the wigolo HTTP API. */
export async function ensureWigoloForSearch(options: {
  baseUrl?: string
  apiToken?: string
} = {}): Promise<LocalServiceStatus> {
  return withEnsureProgress('wigolo', 'Starting local search…', () => ensureService('wigolo', {
    baseUrl: options.baseUrl,
    apiToken: options.apiToken,
    // Search must not block on a multi-minute first-time npm install.
    installIfNeeded: false,
    startIfNeeded: true,
  }))
}

/**
 * Ensure Midscene package/runtime when Automations are already enabled.
 * Does not enable Automations — callers must gate on settings first.
 */
export async function ensureMidsceneForAutomation(): Promise<LocalServiceStatus> {
  return withEnsureProgress('midscene', 'Preparing Midscene…', () => ensureMidsceneService())
}
