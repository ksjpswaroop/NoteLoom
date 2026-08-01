# Voice / STT in NoteLoom v0.1

## Approach

NoteLoom inherits NoteGen’s recording pipeline (`MediaRecorder` → WAV → STT model or local speech recognition).

From [VoiceNotesAI](https://github.com/ksjpswaroop/VoiceNotesAI):

- Keep audio assets alongside transcribed `content`
- Prefer on-device transcription when a local engine is available
- Surface clear setup guidance when no STT model is configured
- Treat voice records as first-class inbox material for later AI organize

## v0.1 wiring

- Global shortcut `CommandOrControl+Shift+V` → `quickRecordVoice`
- Global shortcut `CommandOrControl+Shift+T` → `quickRecordText`
- Organize templates: Meeting Notes, Voice Dump, Weekly Digest
- Transcription fallback message points users to Settings → Model / local STT mode

A full Whisper Python sidecar (as in VoiceNotesAI) is a post–v0.1 integration candidate; provenance will be recorded in `docs/CONSOLIDATION_MANIFEST.md` if/when imported.
