import type { SpeechMode } from '@/lib/speech/types'
import type { LocalSttEngine } from '@/lib/speech/parakeet-models'

export const NO_TRANSCRIPTION_MESSAGE =
  'No transcription. Install Local Parakeet in Settings → Audio, or configure a remote speech-to-text model.'

export function getTranscriptionFallbackMessage(options?: {
  sttModel?: string
  speechToTextMode?: SpeechMode
  localSttEngine?: LocalSttEngine
}): string {
  const sttModel = options?.sttModel ?? ''
  const mode = options?.speechToTextMode
  const engine = options?.localSttEngine

  if (engine === 'parakeet' && (mode === 'local' || mode === 'auto')) {
    return NO_TRANSCRIPTION_MESSAGE
  }

  if (!sttModel) {
    return NO_TRANSCRIPTION_MESSAGE
  }

  return ''
}

/** True when NoteLoom can attempt transcription without a remote STT model. */
export function canTranscribeWithoutRemoteModel(options: {
  speechToTextMode: SpeechMode
  localSttEngine: LocalSttEngine
}): boolean {
  return (
    options.localSttEngine === 'parakeet' &&
    (options.speechToTextMode === 'local' || options.speechToTextMode === 'auto')
  )
}
