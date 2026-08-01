# Voice Memo Consolidation Manifest

## Date: 2026-07-23

## Rationale

Multiple voice memo projects were created with nearly identical goals. To reduce duplication and focus engineering effort, four variants were consolidated into a single surviving project.

## Surviving Project

- **VoiceNotesAI** (`~/projects/VoiceNotesAI`)
  - Already has the most implementation progress (Tauri 2 + Next.js + Rust + Python sidecar).
  - Existing docs: `PRD.md`, `README.md`, `SPEC.md`.

## Merged Into VoiceNotesAI

| Source Folder | Files Moved | Unique Value Preserved |
|---------------|-------------|------------------------|
| `voicevault` | 7 files | Tauri v2 architecture; basic roadmap; initial pricing/score |
| `voicememo-pro` | 7 files | Task-manager integrations (Todoist, Things, Linear); SwiftUI architecture |
| `voicevault-pro` | 7 files | Speaker diarization feature; Electron + React architecture |
| `voicevault-ai` | 7 files | Optional encrypted cloud sync; semantic search; native SwiftUI idea |

### Copied Files (all under `VoiceNotesAI/docs/merged-prds/`)

- voicevault-PRD.md
- voicevault-README.md
- voicevault-ARCHITECTURE.md
- voicevault-ROADMAP.md
- voicevault-research-notes.md
- voicevault-backlog.md
- voicevault-idea-score.json
- voicememo-pro-PRD.md
- voicememo-pro-README.md
- voicememo-pro-architecture.md
- voicememo-pro-roadmap.md
- voicememo-pro-backlog.md
- voicememo-pro-research-notes.md
- voicememo-pro-idea-score.json
- voicevault-pro-PRD.md
- voicevault-pro-README.md
- voicevault-pro-ARCHITECTURE.md
- voicevault-pro-BACKLOG.md
- voicevault-pro-IDEA-SCORE.json
- voicevault-pro-RESEARCH-NOTES.md
- voicevault-pro-ROADMAP.md
- voicevault-ai-PRD.md
- voicevault-ai-README.md
- voicevault-ai-ARCHITECTURE.md
- voicevault-ai-ROADMAP.md
- voicevault-ai-BACKLOG.md
- voicevault-ai-research-notes.md
- voicevault-ai-idea-score.json

## Source Folders Deleted After Copy

- `~/projects/voicevault`
- `~/projects/voicememo-pro`
- `~/projects/voicevault-pro`
- `~/projects/voicevault-ai`
- `~/projects/voicevault-x` (empty placeholder)

## Recommended Tier Structure for VoiceNotesAI

| Tier | Price | Features |
|------|-------|----------|
| Free | Free | Local recording, transcription, basic search |
| Plus | $9–12/mo | AI summaries, action extraction, export to Notion/Obsidian |
| Pro | $19–29/mo | Speaker diarization, semantic search, encrypted cloud sync, team workspaces |

## Next Actions

1. Update `VoiceNotesAI/PRD.md` with the consolidated features from the merged docs.
2. Decide whether to keep Tauri 2 stack or migrate to native SwiftUI (per voicevault-ai architecture).
3. Fix the current `voicevault-ai` source code: the `src/` directory contains unrelated AgentGuard Platform code and should not be used as-is.

## Notes

- `voicevault-ai/src/` was **not** merged because it contains code for an unrelated project (AgentGuard Platform / FastAPI auth and scanner modules).
- This manifest is the audit trail for the consolidation.
