import { invoke } from '@tauri-apps/api/core'
import { blobToBytes } from '@/lib/ai/tauri-client'
import {
  DEFAULT_PARAKEET_MODEL_ID,
  type ParakeetModelOption,
} from '@/lib/speech/parakeet-models.ts'

export interface ParakeetStatus {
  supportedPlatform: boolean
  platform: string
  pythonAvailable: boolean
  pythonVersion?: string | null
  pythonPath?: string | null
  runtimeReady: boolean
  model: string
  modelCached: boolean
  cacheDir: string
  ffmpegAvailable: boolean
  message: string
  models: ParakeetModelOption[]
}

export interface ParakeetEnsureResult {
  success: boolean
  status: ParakeetStatus
  stdout: string
  stderr: string
}

export interface ParakeetTranscribeResult {
  text: string
  model: string
  language: string
}

function isDesktopTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function listParakeetModels(): Promise<ParakeetModelOption[]> {
  if (!isDesktopTauri()) {
    return []
  }
  return invoke<ParakeetModelOption[]>('list_parakeet_models')
}

export async function inspectParakeetStt(model = DEFAULT_PARAKEET_MODEL_ID): Promise<ParakeetStatus> {
  if (!isDesktopTauri()) {
    return {
      supportedPlatform: false,
      platform: 'web',
      pythonAvailable: false,
      runtimeReady: false,
      model,
      modelCached: false,
      cacheDir: '',
      ffmpegAvailable: false,
      message: 'Local Parakeet is only available in the NoteLoom desktop app on Apple Silicon.',
      models: [],
    }
  }
  return invoke<ParakeetStatus>('inspect_parakeet_stt', { model })
}

export async function ensureParakeetStt(model = DEFAULT_PARAKEET_MODEL_ID): Promise<ParakeetEnsureResult> {
  if (!isDesktopTauri()) {
    const status = await inspectParakeetStt(model)
    return { success: false, status, stdout: '', stderr: status.message }
  }
  return invoke<ParakeetEnsureResult>('ensure_parakeet_stt', { model })
}

export async function transcribeWithParakeet(options: {
  audioBlob: Blob
  fileName: string
  model: string
  language?: string
  localAttention?: boolean
  chunkDuration?: number | null
}): Promise<ParakeetTranscribeResult> {
  if (!isDesktopTauri()) {
    throw new Error('Local Parakeet is only available in the NoteLoom desktop app on Apple Silicon.')
  }

  return invoke<ParakeetTranscribeResult>('transcribe_with_parakeet', {
    request: {
      audioBytes: await blobToBytes(options.audioBlob),
      fileName: options.fileName,
      model: options.model,
      language: options.language || 'en',
      localAttention: Boolean(options.localAttention),
      chunkDuration: options.chunkDuration ?? null,
    },
  })
}
