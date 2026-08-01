# NoteLoom Consolidation Manifest

**Date:** 2026-08-01  
**Product:** NoteLoom v0.1.0  
**Role:** Single home for local-first Markdown *capture → organize* notes

## License

NoteLoom is a derivative of [codexu/note-gen](https://github.com/codexu/note-gen) and is released under the **GNU GPL-3.0**. Upstream attribution is required for redistribution.

## Sources absorbed

| Source | Path / remote | Absorbed as | Status |
|--------|---------------|-------------|--------|
| NoteGen | `upstream` → https://github.com/codexu/note-gen | Full application codebase | Active foundation |
| NoteWeave | `docs/prior-art/noteweave/` (from `06-private-knowledge-studio`) | Product DNA, capture-first requirements | Prior art |
| VoiceNotesAI | `docs/prior-art/voicenotesai/` · https://github.com/ksjpswaroop/VoiceNotesAI | Voice/STT patterns, export/search ideas | Frozen donor |
| voiceforge-ai | `docs/prior-art/voiceforge-ai/` · https://github.com/ksjpswaroop/voiceforge-ai | PRD bullets | Superseded |
| voiceweave-ai | `docs/prior-art/voiceweave-ai/` · https://github.com/ksjpswaroop/voiceweave-ai | PRD bullets | Superseded |

## Kept separate (different jobs)

deskvault, WhisperDeck, meetingmind-ai, Lecturn, documind-ai, PDFOracle, FileMind, FileWhisperer, autofiler-ai, InboxZeroAI, NarratorAI, privacyvault-ai, vaultbox-ai, dictation-tools, `06-private-knowledge-studio` (archive/studio host).

## Decisions

1. NoteLoom = NoteGen fork rebranded to **NoteLoom** / `com.swaroop.NoteLoom` / version **0.1.0**.
2. Do not merge 06 legacy source trees into this repo.
3. VoiceNotesAI remains a historical code donor; new voice-note product work happens here.
4. voiceforge-ai and voiceweave-ai are superseded by NoteLoom.
5. NoteWeave’s product successor is NoteLoom; archive copies stay under `06-private-knowledge-studio`.

## Provenance notes

- App UI strings and packaging use NoteLoom branding.
- Optional upstream NoteGen free model endpoints may still appear in model templates; they remain third-party services.
- Auto-updater endpoints for notegen.top are disabled in v0.1.
- Voice STT approach: see `docs/voice-stt.md`.
