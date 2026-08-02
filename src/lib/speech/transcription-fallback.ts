export const NO_TRANSCRIPTION_MESSAGE =
  'No transcription. Install Local Parakeet in Settings → Audio, or configure a remote speech-to-text model.'

export function getTranscriptionFallbackMessage(sttModel: string): string {
  return sttModel ? '' : NO_TRANSCRIPTION_MESSAGE
}
