# Local services

NoteLoom manages optional local runtimes from **Settings** — you should not need a separate terminal for Wigolo or similar sidecars.

## Mental model

| Service | Where in Settings | Role | Default |
| --- | --- | --- | --- |
| **Wigolo** | Web Search | Local-first web search daemon | On (managed start on demand) |
| **Parakeet STT** | Audio / speech | On-demand local speech-to-text (macOS Apple Silicon) | Install when you use it |
| **Midscene** | Automations | Optional desktop computer-use / test / docs automation | **Off** until you opt in |

All three are exposed through `src/lib/local-services` (status / ensure / stop where applicable). Daemon-style services (Wigolo) live under Tauri `local_services.rs`. Parakeet and Midscene use their own ensure APIs but share the same status vocabulary and app-data install root.

## Status values

| Status | Meaning |
| --- | --- |
| **Running** | NoteLoom started the process and it is healthy |
| **Starting** | Install or launch in progress |
| **Connected external** | Something else already serves the URL; NoteLoom reuses it and will **not** kill it on exit |
| **Ready** | On-demand runtime is installed and usable (Parakeet / Midscene) |
| **Stopped** | Not running; NoteLoom can start it when needed |
| **Error** / **Unavailable** | Failed or unsupported on this platform |

## Toolchain tips

- **Node.js missing** (Wigolo / Midscene): Install Node.js 20+ from [nodejs.org](https://nodejs.org) or Volta, then restart NoteLoom.
- **Python missing** (Parakeet): Install Python 3.10–3.13 from python.org or Homebrew, then try again.

Settings surfaces a single **Fix:** line for these cases instead of a long error dump.

## Auto-ensure on use

- **Web search** ensures Wigolo before calling its HTTP API (with English progress toasts). First-time install is done from Settings → Web Search → Start so search stays fast.
- **Midscene** tools ensure the runtime only when Automations are enabled and opted in.
- NoteLoom only stops processes it **spawned** (`owned`). External daemons are left alone.

## Related docs

- [`docs/midscene.md`](./midscene.md) — Automations setup and privacy
- [`docs/voice-stt.md`](./voice-stt.md) — Speech / Parakeet
- [`docs/diagrams.md`](./diagrams.md) — Mermaid / canvas / Excalidraw (not local services)
