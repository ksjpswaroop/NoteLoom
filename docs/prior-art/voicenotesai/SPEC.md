# VoiceNotesAI — Specification (TDD Source of Truth)
**Version:** 1.0  
**Date:** 2026-06-06  
**Status:** Source of Truth for TDD

**Acceleration note:** The implementation should reuse existing document-editing foundations where possible. Tiptap is the baseline editor framework; DocFlow is a permissively licensed architecture reference for Tiptap + Next.js document UX; AiPoMind is a reference-only source for self-hosted voice/knowledge patterns because it is AGPL-3.0 licensed.

---

##1. Product Definition

**VoiceNotesAI** transforms voice recordings into structured, actionable notes — fully on-device. Record → Transcribe → Summarize → Search, all offline, zero cloud.

**Target users:** Professionals who record meetings, creatives capturing ideas, students transcribing lectures.

---

## 2. Core Features (MVP Scope)

| ID | Feature | Description |
|----|---------|-------------|
| F01 | Voice Recording | Record audio via microphone, real-time waveform, auto-save every 30s |
| F02 | AI Transcription | On-device Whisper transcription with timestamps |
| F03 | AI Summarization | Llama 3B summary generation (brief + detailed) |
| F04 | Action Item Extraction | Identify tasks, assignees, due dates from transcript |
| F05 | Natural Language Search | Semantic search across all notes via embeddings |
| F06 | Audio Playback | Play audio with transcript sync, speed control, skip ±15s |
| F07 | Note Management | Create, read, delete notes; tags; auto-titled |
| F08 | Export | Export as Markdown and JSON in MVP; Notion is the first external export after core export works |
| F09 | Keyboard Shortcuts | ⌘R record, ⌘F search, Space play/pause, etc. |
| F10 | Privacy Indicators | "Processing Locally" badge, airplane mode verified |
| F11 | Settings | Recording quality, language, model management, storage |
| F12 | Local Model Management | Download Whisper + Llama models on first run; update, delete, and switch active models in app |
| F13 | SQLite Persistence | All notes stored locally in SQLite |

---

## 3. Technical Architecture

### 3.1 Stack

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri 2.x (Rust) │
│  - App shell, window management │
│  - Audio capture fallback (cpal) │
│  - SQLite (rusqlite) │
│  - IPC with Python sidecar                               │
│  - File system management                                │
├─────────────────────────────────────────────────────────────┤
│  Next.js + React + Tiptap Frontend                         │
│  - Tiptap rich editor for transcript + structured notes     │
│  - ProseMirror JSON as canonical editable note document     │
│  - Browser MediaRecorder first; cpal fallback if needed     │
│  - Optional Tiptap AI Toolkit if licensing is approved      │
├─────────────────────────────────────────────────────────────┤
│  Python 3.9+ Sidecar (llama-cpp-python + whispercpp)   │
│  - Whisper transcription (whispercpp bindings)          │
│  - Llama 3B summarization (llama-cpp-python)            │
│  - Embeddings for search (sentence-transformers)        │
│  - Communicates with Tauri via stdin/stdout JSON RPC     │
└─────────────────────────────────────────────────────────────┘
```

### 3.1.1 Reuse Decisions

| Area | Decision | Development Effort Impact |
|------|----------|---------------------------|
| Rich note editor | Use Tiptap open-source editor core with React. Start with StarterKit, placeholder, task list, table, link, highlight, and markdown serialization extensions. | Avoids building custom rich-text editing, cursor behavior, selection handling, undo/redo, and structured note rendering. |
| AI document edits | Prefer simple deterministic workflows for MVP: insert transcript, generate summary blocks, insert action-item task list, and allow manual edit. Evaluate Tiptap AI Toolkit after confirming paid add-on/licensing and local-model compatibility. | Avoids building a full agent UI before the core record -> note flow works. |
| Document automation | Defer DOCX import/export, redlining, comments, and version history to post-MVP. Tiptap Pages/Conversion/Comments are candidates if the product expands into legal/document automation. | Keeps MVP focused on voice-note capture, not a Word replacement. |
| Reference repos | Use DocFlow (MIT) as a reference for Tiptap + Next.js editor structure. Use AiPoMind only as an architectural reference for voice memo ingestion, transcription, knowledge search, and self-hosted data boundaries. | Prevents license risk while still benefiting from proven product patterns. |
| Local AI | Keep the Python sidecar boundary. Add a provider adapter so development can use a local OpenAI-compatible server/Ollama while production can download packaged llama.cpp models on first run. | Lets the UI and persistence ship before model packaging is fully solved while preserving in-app model upgrades. |
| Search | MVP starts with SQLite FTS5 over title/transcript/summary/tags; semantic embeddings can be added behind the same search command. | Reduces Phase 0 complexity and still gives usable search early. |

### 3.2 Data Flow

```
User clicks Record
  → Tauri: start audio capture (cpal stream)
  → Audio chunks saved to temp .wav file every 30s
  → User clicks Stop
  → Tauri: save final audio file
  → Tauri: spawn Python sidecar, send JSON-RPC {"method": "transcribe", "params": {"audio_path": "..."}}
  → Python: loads Whisper GGUF, runs inference, returns transcript
  → Tauri: stores transcript in SQLite
  → Tauri: send JSON-RPC {"method": "summarize", "params": {"transcript": "..."}}
  → Python: loads Llama GGUF, generates summary + action items
  → Python: returns JSON {brief, detailed, action_items[], key_topics[]}
  → Tauri: stores summary in SQLite
  → UI: renders editable Tiptap document from transcript + summary + action items
  → Tauri: stores Tiptap document_json in SQLite
  → Tauri: send JSON-RPC {"method": "embed", "params": {"text": "..."}}
  → Python: generates embedding vector, returns
  → Tauri: stores embedding in SQLite
  → UI: displays Note Detail with transcript + summary
```

### 3.3 Models

| Task | Model | Size | Format | Quantization |
|------|-------|------|--------|--------------|
| Transcription | whisper-base | 149MB | GGUF | FP16 |
| Summarization | Meta-Llama-3-3B-Instruct | ~1.8GB | GGUF | Q4_K_M |
| Embeddings | all-MiniLM-L6-v2 | 80MB | PyTorch | FP16 |

**Model sources:**
```python
WHISPER_MODEL_ID = "ggml-org/whisper-base" # HuggingFace GGUF
LLAMA_MODEL_ID   = "lmstudio-community/Meta-Llama-3-3B-Instruct-GGUF"
EMBEDDINGS_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
```

### 3.4 Python Sidecar API (JSON-RPC over stdin/stdout)

**Request:**
```json
{"jsonrpc": "2.0", "id": 1, "method": "transcribe", "params": {"audio_path": "/path/to/audio.wav"}}
{"jsonrpc": "2.0", "id": 2, "method": "summarize", "params": {"transcript": "..."}}
{"jsonrpc": "2.0", "id": 3, "method": "extract_actions", "params": {"transcript": "..."}}
{"jsonrpc": "2.0", "id": 4, "method": "embed", "params": {"text": "..."}}
{"jsonrpc": "2.0", "id": 5, "method": "search", "params": {"query": "...", "limit": 10}}
{"jsonrpc": "2.0", "id": 6, "method": "health", "params": {}}
```

**Response:**
```json
{"jsonrpc": "2.0", "id": 1, "result": {"text": "...", "segments": [{"start": 0.0, "end": 5.0, "text": "..."}]}}
{"jsonrpc": "2.0", "id": 2, "result": {"brief": "...", "detailed": "...", "action_items": [...], "key_topics": [...]}}
{"jsonrpc": "2.0", "id": 3, "result": [{"description": "...", "assignee": null, "due_date": null, "confidence": 0.95}]}
{"jsonrpc": "2.0", "id": 4, "result": {"embedding": [0.1, -0.2, ...]}}
{"jsonrpc": "2.0", "id": 5, "result": [{"note_id": "...", "score": 0.87, "snippet": "..."}]}
{"jsonrpc": "2.0", "id": 6, "result": {"status": "ok", "models_loaded": ["whisper", "llama"]}}
```

**Error:**
```json
{"jsonrpc": "2.0", "id": 1, "error": {"code": -1, "message": "Audio file not found"}}
```

---

## 4. Data Model (SQLite)

###4.1 Schema

```sql
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    title TEXT,
    duration INTEGER NOT NULL,  -- seconds
    audio_path TEXT NOT NULL,
    transcript TEXT,
    summary_json TEXT,          -- JSON: {brief, detailed, action_items[], key_topics[]}
    document_json TEXT,         -- Tiptap/ProseMirror JSON document for editable note detail
    is_processed INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]'      -- JSON array
);

CREATE TABLE action_items (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    description TEXT NOT NULL,
    assignee TEXT,
    due_date TEXT,
    completed INTEGER DEFAULT 0,
    confidence REAL,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
    note_id UNINDEXED,
    title,
    transcript,
    tags,
    content='notes',
    content_rowid='rowid'
);

CREATE TABLE embeddings (
    note_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,    -- 384 floats (4 bytes each = 1536 bytes)
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER,
    downloaded_at TEXT
);
```

### 4.2 Indexes

```sql
CREATE INDEX idx_notes_created_at ON notes(created_at DESC);
CREATE INDEX idx_action_items_note_id ON action_items(note_id);
CREATE INDEX idx_notes_is_processed ON notes(is_processed);
```

---

## 5. File Structure

```
VoiceNotesAI/
├── src-tauri/ # Tauri Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs                 # Entry point
│   │   ├── lib.rs                  # Library exports
│   │   ├── commands/ # Tauri commands
│   │   │   ├── mod.rs
│   │   │   ├── recording.rs         # Audio recording commands
│   │   │   │   ├── mod.rs
│   │   │   │   └── recording.rs
│   │   │   ├── notes.rs # Note CRUD commands
│   │   │   ├── inference.rs         # Python sidecar IPC
│   │   │   ├── settings.rs          # Settings commands
│   │   │   └── models.rs            # Model management
│   │   ├── audio/                  # Audio processing
│   │   │   ├── mod.rs
│   │   │   └── buffer.rs
│   │   ├── db/ # SQLite
│   │   │   ├── mod.rs
│   │   │   └── schema.rs
│   │   └── types.rs                # Shared types
│   └── icons/
├── python/ # Python inference sidecar
│   ├── pyproject.toml
│   ├── voicenotes/
│   │   ├── __init__.py
│   │   ├── sidecar.py              # JSON-RPC server
│   │   ├── whisper_engine.py       # Whisper transcription
│   │   ├── llama_engine.py         # Llama summarization
│   │   ├── embed_engine.py         # Embeddings
│   │   ├── models.py              # Model download
│   │   └── prompts.py              # Prompt templates
│   └── tests/
│       ├── test_whisper.py
│       ├── test_llama.py
│       ├── test_embeddings.py
│       ├── test_sidecar.py
│       └── conftest.py
├── web/                           # Next.js + React + Tiptap frontend
│   ├── package.json
│   ├── next.config.ts
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── recorder/
│   │   │   ├── editor/
│   │   │   └── notes/
│   │   ├── editor/
│   │   │   ├── extensions.ts      # Tiptap extension kit
│   │   │   ├── noteDocument.ts    # transcript/summary -> Tiptap JSON
│   │   │   └── markdown.ts
│   │   ├── stores/
│   │   └── styles/
├── src/                           # Tauri frontend entry/build output wiring
│   ├── main.ts
│   ├── components/
│   ├── views/
│   ├── stores/
│   └── styles/
├── models/                        # Downloaded GGUF models
│   ├── whisper-base.gguf
│   └── llama-3-3b-instruct-q4_k_m.gguf
├── SPEC.md
├── README.md
└── tests/                         # Integration tests
    └── test_full_flow.py
```

---

## 6. API Commands (Tauri IPC)

### 6.1 Recording

```rust
#[tauri::command]
fn start_recording() -> Result<String, String>;  // returns temp audio path

#[tauri::command]
fn stop_recording(path: String) -> Result<RecordingResult, String>;

#[tauri::command]
fn get_recording_status() -> Result<RecordingStatus, String>;
```

### 6.2 Notes

```rust
#[tauri::command]
fn create_note(audio_path: String, duration: u32) -> Result<Note, String>;

#[tauri::command]
fn get_note(id: String) -> Result<Note, String>;

#[tauri::command]
fn list_notes(limit: u32, offset: u32) -> Result<Vec<Note>, String>;

#[tauri::command]
fn delete_note(id: String) -> Result<(), String>;

#[tauri::command]
fn update_note_tags(id: String, tags: Vec<String>) -> Result<Note, String>;

#[tauri::command]
fn search_notes(query: String, limit: u32) -> Result<Vec<SearchResult>, String>;
```

### 6.3 Inference

```rust
#[tauri::command]
fn transcribe_note(note_id: String) -> Result<Note, String>;

#[tauri::command]
fn summarize_note(note_id: String) -> Result<Note, String>;

#[tauri::command]
fn get_inference_status() -> Result<InferenceStatus, String>;
```

### 6.4 Settings

```rust
#[tauri::command]
fn get_settings() -> Result<Settings, String>;

#[tauri::command]
fn update_settings(settings: Settings) -> Result<Settings, String>;

#[tauri::command]
fn get_storage_info() -> Result<StorageInfo, String>;
```

### 6.5 Models

```rust
#[tauri::command]
fn get_models() -> Result<Vec<ModelInfo>, String>;

#[tauri::command]
fn download_model(model_id: String, progress_cb: Fn) -> Result<(), String>;

#[tauri::command]
fn delete_model(model_id: String) -> Result<(), String>;
```

---

## 7. Inference Behavior (TDD Tests First)

### 7.1 Transcription Tests

```python
def test_whisper_transcribe_returns_text():
    # Whisper must return non-empty text string
    # Segments must have start/end timestamps
    # Language must be detected or specified

def test_whisper_handles_clean_audio():
    #1-minute clean audio → transcript in <60s
    # Accuracy > 90% on clean single-speaker audio

def test_whisper_segments_have_timestamps():
    # Each segment has float start and end
    # Timestamps are monotonically increasing

def test_whisper_handles_multi_speaker():
    # Transcript includes speaker labels if possible
    # Or timestamps align with speaker changes
```

### 7.2 Summarization Tests

```python
def test_llama_summarize_returns_structured_json():
    # Returns {brief, detailed, action_items[], key_topics[]}
    # brief is3-5 sentences
    # action_items is a list (may be empty)

def test_llama_action_items_extracted():
    # Given transcript with clear action items
    # Returns non-empty action_items list
    # Each item has description, confidence score

def test_llama_summarize_respects_length_param():
    # brief summary< 500 chars
    # detailed summary > 200 chars for substantive content

def test_llama_summarize_is_factual():
    # Summary claims are derivable from transcript
    # No hallucinated facts introduced
```

### 7.3 Embedding Tests

```python
def test_embed_returns_384_dim_vector():
    # Output is list of 384 floats
    # Values are normalized (-1 to 1 range)

def test_embed_same_text_same_vector():
    # Identical text → identical embedding (within float tolerance)
def test_embed_semantic_similarity():
    # "budget discussion" and "Q3 finance talk" → high cosine similarity
    # "budget discussion" and "lunch menu" → low cosine similarity
```

### 7.4 Search Tests

```python
def test_search_returns_ranked_results():
    # Results have note_id, score, snippet
    # Results sorted by score descending

def test_search_respects_limit():
    # search(query, limit=5) returns at most 5 results

def test_search_no_results_returns_empty_list():
    # Query with no matches returns []
```

### 7.5 Sidecar Tests

```python
def test_sidecar_health_returns_ok():
    # health method returns {status: "ok", models_loaded: [...]}

def test_sidecar_invalid_method_returns_error():
    # Unknown method returns JSON-RPC error

def test_sidecar_concurrent_requests():
    # Multiple requests don't crash sidecar
    # Responses are correctly paired with request IDs
```

---

## 8. Recording Behavior

### 8.1 Audio Format

| Setting | Value |
|---------|-------|
| Sample rate | 44100 Hz |
| Bit depth | 16-bit |
| Channels | 1 (mono) |
| Format | WAV (temp) → AAC .m4a (final, standard) / WAV (high quality) |
| Auto-save interval | 30 seconds |

### 8.2 Recording States

```
IDLE → RECORDING → PROCESSING → COMPLETE
```

- **IDLE:** Record button visible, timer at 00:00:00
- **RECORDING:** Timer incrementing, waveform animating, auto-save every 30s
- **PROCESSING:** Spinner, "Transcribing…" then "Summarizing…"
- **COMPLETE:** Note Detail view displayed

### 8.3 Max Duration

Maximum recording length: **4 hours** (14400 seconds)  
Minimum:1 second (ignore recordings shorter than 1s)

---

## 9. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Recording start latency | < 1 second |
| Transcription speed | ≤ 1x recording duration |
| Summary generation | ≤ 30 seconds for 10-min recording |
| Search latency | < 500ms |
| Transcription accuracy | > 95% on clean audio |
| App startup (to usable) | < 3 seconds |
| Offline functionality | 100% |
| Local storage encryption | AES-256 (future) |
| Memory usage (idle) | < 200MB |
| Memory usage (transcribing) | < 4GB |

---

## 10. Acceptance Criteria (TDD Tests)

### 10.1 Recording
- [ ] `start_recording()` returns a file path within 1 second
- [ ] Audio chunks are saved every 30 seconds during recording
- [ ] `stop_recording()` returns a valid WAV file
- [ ] Recording works in background (app minimized)

### 10.2 Transcription
- [ ] `transcribe(audio_path)` returns transcript within 1x recording duration
- [ ] Transcript includes timestamps for each segment
- [ ] Transcription works completely offline
- [ ] Empty/invalid audio file returns error

### 10.3 Summarization
- [ ] `summarize(transcript)` returns JSON with brief, detailed, action_items, key_topics
- [ ] `brief` summary is 3-5 sentences
- [ ] Action items have confidence scores
- [ ] Empty transcript returns error

### 10.4 Search
- [ ] `embed(text)` returns 384-dimensional vector
- [ ] `search(query, limit)` returns ranked results in < 500ms
- [ ] Results include note_id, score, snippet
- [ ] Empty query returns error

### 10.5 Persistence
- [ ] Notes are persisted to SQLite and survive app restart
- [ ] Deleting a note removes it from database and file system
- [ ] Tags are stored and retrieved correctly

### 10.6 Full Flow
- [ ] Record → Stop → Transcribe → Summarize → Search works end-to-end
- [ ] Full flow completes without network connection
- [ ] App restarts without data loss

---

## 11. Out of Scope (MVP)

- Mobile companion apps (iOS/Android)
- Team collaboration
- Cloud sync
- Video transcription
- External exports in MVP beyond Markdown/JSON
- Todoist export before the Notion adapter is complete
- DOCX import/export, redlining, legal document automation, and collaborative comments
- Tiptap paid Cloud/AI Toolkit features unless licensing is explicitly approved
- Audio editing

---

## 12. Dependencies

### Python (pyproject.toml)

```toml
[project]
requires-python = ">=3.9"
dependencies = [
    "llama-cpp-python>=0.3.0",
    "whispercpp>=1.4.0",
    "sentence-transformers>=2.2.0",
    "numpy>=1.24.0",
    "pydantic>=2.0.0",
    "huggingface-hub>=0.20.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.21.0",
    "pytest-cov>=4.1.0",
    "ruff>=0.1.0",
]
```

### Rust (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
rusqlite = { version = "0.32", features = ["bundled"] }
cpal = "0.15"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["process", "io-util"] }
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
log = "0.4"
env_logger = "0.11"
thiserror = "2"
```

### Frontend (web/package.json)

```json
{
  "dependencies": {
    "@tiptap/react": "^3",
    "@tiptap/starter-kit": "^3",
    "@tiptap/extension-link": "^3",
    "@tiptap/extension-placeholder": "^3",
    "@tiptap/extension-task-item": "^3",
    "@tiptap/extension-task-list": "^3",
    "@tiptap/extension-table": "^3",
    "@tiptap/extension-table-cell": "^3",
    "@tiptap/extension-table-header": "^3",
    "@tiptap/extension-table-row": "^3",
    "next": "^16",
    "react": "^19",
    "react-dom": "^19",
    "lucide-react": "^0.468.0",
    "zustand": "^5"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```
