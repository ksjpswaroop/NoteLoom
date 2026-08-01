# VoiceNotesAI

VoiceNotesAI is a **local-first desktop app** for recording voice notes, transcribing them on-device with Whisper, summarizing them with a local LLM, extracting action items, and turning everything into editable, searchable notes.

This repo is the surviving implementation after consolidating four related voice memo projects. See [`docs/merged-prds/MANIFEST.md`](docs/merged-prds/MANIFEST.md) for the full consolidation audit trail.

## What It Does

- **Record** — one-click or global-hotkey voice capture, menu bar access
- **Transcribe** — local Whisper, no cloud, no upload
- **Summarize** — local LLM generates brief and detailed summaries
- **Extract** — AI finds action items, dates, and commitments
- **Organize** — auto-tags + user-defined tags, library view
- **Search** — full-text search in Free; semantic search in Pro
- **Export** — Markdown, JSON, Notion, Obsidian; Pro adds Todoist/Things/Linear sync
- **Sync** — optional end-to-end encrypted cross-device relay (Pro/Team)

## Current Implementation Status

Implementation is tracked in:

- `docs/07-MODULE-TRACKER.md`
- `docs/06-MODULE-BREAKDOWN-AND-IMPLEMENTATION-ORDER.md`

**M01** (repo/tooling scaffold) is complete.

The scaffold provides:

- Root `npm` workspace scripts
- Next.js + React + Tiptap frontend in `web/`
- Tauri v2 desktop shell in `src-tauri/`
- Python sidecar health scaffold in `python/`
- Web, Tauri, and Python check commands

## Product Definition

The authoritative product spec is [`PRD.md`](PRD.md).

High-level tiering:

| Tier | Price | Key Features |
|------|-------|--------------|
| **Free** | Free | 100 min/mo recording, local transcription, basic search, Markdown/JSON export |
| **Plus** | $9–12/mo | Unlimited recording, AI summaries, action extraction, auto-tags, Notion/Obsidian |
| **Pro** | $19–29/mo | Plus + speaker diarization, semantic search, task manager sync, 60-min recordings |
| **Team** | $99/mo | Shared workspaces, encrypted sync, admin dashboard |

## Tech Stack

- **Desktop shell**: Tauri 2 (Rust)
- **Frontend**: Next.js + React + Tiptap
- **Persistence**: SQLite (rusqlite)
- **AI sidecar**: Python (whisper.cpp / whispercpp, llama-cpp-python, sentence-transformers)
- **Communication**: JSON-RPC over stdin/stdout between Tauri and Python

## Prerequisites

- Node.js 22+
- npm 10+
- Rust 1.80+
- Python 3.9+

The local development machine currently uses the Python virtual environment at `python/.venv`.

## Install

```bash
npm install
```

Python model dependencies are intentionally not installed by the M01 check path. Later modules add model-specific setup for Whisper, Llama, and embeddings.

## Development

Run the frontend only:

```bash
npm run dev:web
```

Run the Tauri desktop app:

```bash
npm run tauri:dev
```

## Checks

```bash
npm run check
```

Individual checks:

```bash
npm run check:web
npm run check:tauri
npm run check:python
```

## Build

```bash
npm run build:web   # static frontend export
npm run tauri:build # desktop app
```

## Next Module

Implement **M02 — Shared contracts and type schemas**.

After M02, implement in parallel:

- M03 SQLite persistence
- M04 Tauri shell and IPC
- M05 Next.js/Tiptap frontend
- M07 Python sidecar RPC

## Consolidation History

The following redundant projects were consolidated into this repo on 2026-07-23:

- `voicevault`
- `voicememo-pro`
- `voicevault-pro`
- `voicevault-ai`

Their PRDs, architectures, roadmaps, backlogs, research notes, and idea scores were preserved under `docs/merged-prds/`.

## License

TBD
