# NoteWeave Specification

## Overview
NoteWeave is a voice-first AI note capture application with semantic recall and auto-structuring capabilities. It enables users to record voice notes, transcribe them in real-time, and search through a fully indexed corpus using both FTS5 keyword search and semantic embeddings.

## Features
1. **Voice Note Recording** — Microphone input capture with live waveform visualization
2. **Real-time Transcription** — Audio streamed to a local Whisper.cpp HTTP server for transcription
3. **Semantic Embedding** — Transcriptions embedded via Ollama for semantic similarity search
4. **FTS5 Full-text Search** — SQLite FTS5 virtual table for fast keyword/phrase search
5. **Auto-tagging** — AI-powered tag suggestions based on transcription content
6. **Folder Organization** — Hierarchical folder structure by project/episode

## Tech Stack
- **Frontend**: React + TypeScript (Vite)
- **Backend**: Tauri 2.x (Rust)
- **Database**: SQLite with FTS5 extension
- **STT Engine**: Whisper.cpp (HTTP server mode)
- **Embeddings**: Ollama (local LLM server)
- **Audio**: Web Audio API + MediaRecorder

## Architecture
```
┌─────────────────────────────────────────────────────────┐
│ React Frontend                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │RecordBtn │ │NotesList │ │SearchBar │ │FolderNav  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │ Tauri IPC (invoke)
┌──────────────────────▼──────────────────────────────────┐
│                   Rust Backend                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │db_commands │  │whisper_client│  │ollama_client  │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              SQLite + FTS5 │
│  notes(id, title, transcript, embedding, tags,           │
│        folder, created_at, updated_at)                   │
│  notes_fts (FTS5 virtual table)                          │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### notes table
| Column      | Type      | Description                                |
|-------------|-----------|-------------------------------------------|
| id          | INTEGER | Primary key, auto-increment                |
| title       | TEXT      | User-provided or AI-generated title        |
| transcript | TEXT      | Full transcription text |
| embedding | TEXT | JSON array of f32 embedding vectors        |
| tags        | TEXT      | JSON array of tag strings                  |
| folder      | TEXT      | Folder path (e.g. "project-a/episode-1")  |
| created_at  | TEXT      | ISO 8601 timestamp                         |
| updated_at  | TEXT      | ISO 8601 timestamp                         |

### FTS5 Virtual Table
```sql
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title,
  transcript,
  tags,
  content='notes',
  content_rowid='rowid'
);
```

## API Design (Rust Commands)

### `init_db`
Initializes the SQLite database and FTS5 virtual table.
```rust
#[tauri::command]
fn init_db(app: AppHandle) -> Result<(), String>
```

### `insert_note`
Inserts a new note with transcription and optional AI-generated fields.
```rust
#[tauri::command]
fn insert_note(
    title: String,
    transcript: String,
    tags: Vec<String>,
    folder: String,
) -> Result<i64, String>
// Returns the new note's rowid
```

### `search_notes`
Performs FTS5 search and returns ranked results.
```rust
#[tauri::command]
fn search_notes(query: String) -> Result<Vec<NoteResult>, String>

#[derive(Serialize)]
struct NoteResult {
    id: i64,
    title: String,
    transcript: String,
    tags: Vec<String>,
    folder: String,
    created_at: String,
    rank: f64,
}
```

### `get_all_notes`
Returns all notes ordered by `created_at` descending.
```rust
#[tauri::command]
fn get_all_notes() -> Result<Vec<Note>, String>

#[derive(Serialize)]
struct Note {
    id: i64,
    title: String,
    transcript: String,
    tags: Vec<String>,
    folder: String,
    created_at: String,
    updated_at: String,
}
```

### `delete_note`
Deletes a note by ID.
```rust
#[tauri::command]
fn delete_note(id: i64) -> Result<(), String>
```

### `update_note`
Updates title, tags, or folder of an existing note.
```rust
#[tauri::command]
fn update_note(
    id: i64,
    title: String,
    tags: Vec<String>,
    folder: String,
) -> Result<(), String>
```

## Build and Run

### Prerequisites
- Node.js 18+
- Rust 1.70+
- Whisper.cpp HTTP server running on `http://localhost:8080`
- Ollama server running on `http://localhost:11434`

### Development
```bash
# Install frontend dependencies
cd ~/projects/NoteWeave
npm install

# Run Tauri dev server
npm run tauri dev
```

### Production Build
```bash
npm run tauri build -- --release
```

### Database Location
`{APP_DATA}/noteweave.db` (platform-specific app data directory)
