# Voice / STT in NoteLoom v0.1

## Approach

NoteLoom uses a recording pipeline of `MediaRecorder` → audio blob → STT.

From [VoiceNotesAI](https://github.com/ksjpswaroop/VoiceNotesAI):

- Keep audio assets alongside transcribed `content`
- Prefer on-device transcription when a local engine is available
- Surface clear setup guidance when no STT model is configured
- Treat voice records as first-class inbox material for later AI organize

## Local Parakeet (current)

On **macOS Apple Silicon (arm64)**, NoteLoom can transcribe recordings with NVIDIA **Parakeet** via a managed Python sidecar using [`parakeet-mlx`](https://github.com/senstella/parakeet-mlx) (MLX).

| Setting | Store key | Notes |
|---------|-----------|--------|
| STT mode | `speechToTextMode` | `auto` (default), `local`, `model` |
| Local engine | `localSttEngine` | `parakeet` (default) or `browser` |
| Parakeet model | `parakeetModelId` | Default `mlx-community/parakeet-tdt-0.6b-v2` (English). Also: TDT v3 (multilingual), CTC 0.6B (English) |
| Language | `parakeetLanguage` | Default `en` |
| Attention | `parakeetAttentionMode` | `full` (default) or `local` (long audio) |

**Auto mode:** try Local Parakeet when the runtime is ready, otherwise fall back to a configured remote STT model. If neither is ready, transcription fails with English guidance (no silent empty result).  
**Local mode:** Parakeet only (browser SpeechRecognition cannot transcribe saved blobs).  
**Model mode:** remote OpenAI-compatible `/audio/transcriptions` only.

Settings UI: **Settings → Audio → Speech-to-Text**.

### Setup (desktop)

1. Install **Python 3.10–3.13** and **ffmpeg** (`brew install ffmpeg`).
2. Open **Settings → Audio**.
3. Set **Mode** to Auto or Local, **Local Engine** to Local Parakeet.
4. Pick a Parakeet model (Install and Record both use the selected `parakeetModelId`).
5. Click **Install Local Parakeet** — the UI shows English progress (creating env → installing packages → verifying).
6. Record a voice note from the empty state (**Capture Voice** / `⌘⇧V`) or the toolbar mic; the first run downloads model weights into the app data cache.

Sidecar files live under `src-tauri/resources/parakeet-stt/`. Runtime + HF cache live under the app data `parakeet-stt/` directory.

Install progress is emitted on the Tauri event `parakeet-stt-progress` (`preparing` / `installing` / `verifying` / `completed` / `failed`).

### Manual smoke test (CLI)

```bash
cd /Users/swaroop/Projects/NoteLoom
python3.12 -m venv /tmp/parakeet-smoke
source /tmp/parakeet-smoke/bin/activate
pip install -r src-tauri/resources/parakeet-stt/requirements.txt
say -o /tmp/hello.aiff "Hello from Note Loom"
ffmpeg -y -i /tmp/hello.aiff -ar 16000 -ac 1 /tmp/hello.wav
python src-tauri/resources/parakeet-stt/transcribe.py transcribe \
  --audio /tmp/hello.wav \
  --model mlx-community/parakeet-tdt-0.6b-v2 \
  --cache-dir "$HOME/Library/Application Support/com.swaroop.NoteLoom/parakeet-stt/hf-cache/hub"
```

## v0.1 wiring

- Empty state primary CTAs: **Capture Text** (`CommandOrControl+Shift+T`) and **Capture Voice** (`CommandOrControl+Shift+V`)
- Organize templates: Meeting Notes, Voice Dump, Weekly Digest
- Failed transcription still saves audio; toast explains Install Local Parakeet / remote STT; retry works with Parakeet even without a remote `sttModel`

Remote / Web Speech paths remain available; Parakeet is the preferred local path for recorded audio on Apple Silicon.
