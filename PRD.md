# NoteLoom — Product Requirements Document (v0.1)

## 1. Summary

**NoteLoom** is a local-first Markdown app: *Capture first. Organize later.*  
Scattered records (text, voice, screenshots, images, links, files, todos) become structured notes with AI.

Version **0.1.0** ships as a Tauri v2 desktop app (macOS primary), derived from NoteGen (GPL-3.0), consolidating NoteWeave / VoiceNotesAI / voiceforge / voiceweave product intent.

## 2. Goals

- One portfolio home for Markdown capture → organize
- Equal first-class **text** and **voice** capture
- Preserve ordinary Markdown files in a user-chosen workspace
- AI organize, chat, RAG, agent, canvas, sync inherited from NoteGen
- Deployable macOS `.app` / `.dmg` with GitHub Release `v0.1.0`

## 3. Feature matrix

| Area | Capability | Origin |
|------|------------|--------|
| Capture | text, recording, scan, image, link, file, todo | NoteGen |
| Dual capture | ⌘⇧T text, ⌘⇧V voice global shortcuts | NoteLoom v0.1 |
| Organize | Multi-select → templates → Markdown | NoteGen + NoteWeave |
| Templates | Notes, Weekly Digest, Meeting Notes, Voice Dump | NoteLoom v0.1 |
| Editor | Tiptap MD (tables, tasks, code, math, Mermaid, outline, export) | NoteGen |
| AI | Multi-provider chat/write/embed/OCR/STT/TTS | NoteGen |
| Knowledge | Vector + hybrid RAG, memories, prompts | NoteGen |
| Agent | Tool-approved agent over notes/records/files | NoteGen |
| Extensibility | MCP servers, Skills | NoteGen |
| Canvas | Flowcharts, mind maps, timelines, freehand, charts | NoteGen |
| Sync | GitHub, GitLab, Gitee, Gitea, S3, WebDAV | NoteGen |
| Voice UX | Clear STT fallback; audio retained with transcript | VoiceNotesAI patterns |

## 4. Non-goals (v0.1)

- Ambient always-on recording (RecallBase)
- Meeting-specialist product (MeetingMind)
- OS-wide dictation (WhisperDeck)
- Mobile store submission
- Apple notarization if signing credentials unavailable

## 5. Personas

Busy professionals and creators who capture fragments under pressure and organize later into durable Markdown notes.

## 6. Success metrics (v0.1)

- App builds and installs on macOS
- Text + voice records creatable in one session
- Mixed records organize into an editable Markdown file
- Prior-art documented; duplicate products superseded/frozen
