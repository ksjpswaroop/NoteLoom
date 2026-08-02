# NoteLoom Consolidation Manifest

**Date:** 2026-08-01  
**Product:** NoteLoom v0.1.0  
**Role:** Single home for local-first Markdown *capture → organize* notes

## License

NoteLoom is released under the **GNU GPL-3.0**. Copyright notices for original authors are preserved in [`LICENSE`](../LICENSE).

## Sources absorbed

| Source | Path / remote | Absorbed as | Status |
|--------|---------------|-------------|--------|
| NoteLoom foundation | this repository | Full application codebase | Active |
| NoteWeave | `docs/prior-art/noteweave/` (from `06-private-knowledge-studio`) | Product DNA, capture-first requirements | Prior art |
| VoiceNotesAI | `docs/prior-art/voicenotesai/` · https://github.com/ksjpswaroop/VoiceNotesAI | Voice/STT patterns, export/search ideas | Frozen donor |
| voiceforge-ai | `docs/prior-art/voiceforge-ai/` · https://github.com/ksjpswaroop/voiceforge-ai | PRD bullets | Superseded |
| voiceweave-ai | `docs/prior-art/voiceweave-ai/` · https://github.com/ksjpswaroop/voiceweave-ai | PRD bullets | Superseded |

## Kept separate (different jobs)

deskvault, WhisperDeck, meetingmind-ai, Lecturn, documind-ai, PDFOracle, FileMind, FileWhisperer, autofiler-ai, InboxZeroAI, NarratorAI, privacyvault-ai, vaultbox-ai, dictation-tools, `06-private-knowledge-studio` (archive/studio host).

## Decisions

1. Product identity is **NoteLoom** / `com.swaroop.NoteLoom` / version **0.1.0**.
2. Do not merge 06 legacy source trees into this repo.
3. VoiceNotesAI remains a historical code donor; new voice-note product work happens here.
4. voiceforge-ai and voiceweave-ai are superseded by NoteLoom.
5. NoteWeave’s product successor is NoteLoom; archive copies stay under `06-private-knowledge-studio`.

## Provenance notes

- App UI strings and packaging use NoteLoom branding.
- Built-in free model endpoints, when present, are third-party services and are not product branding.
- Voice STT approach: see `docs/voice-stt.md`.
