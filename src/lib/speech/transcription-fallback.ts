export const NO_TRANSCRIPTION_MESSAGE =
  'No transcription. Configure a speech-to-text model in Settings → Model, or set Speech-to-Text mode to Local if your system supports it.'

export function getTranscriptionFallbackMessage(sttModel: string): string {
  return sttModel ? '' : NO_TRANSCRIPTION_MESSAGE
}
