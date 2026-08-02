# NoteLoom

**Capture first. Organize later.**

A local-first Markdown app that turns scattered records into clear notes with AI.

## Features (v0.1)

- **Capture** text, voice, screenshots, images, links, files, and todos
- **Organize later** — select records, pick a template, generate a Markdown note
- **Dual capture shortcuts** — `⌘⇧T` text, `⌘⇧V` voice
- Editor, AI chat/agent, RAG, canvas, MCP, Skills, and sync

See [`PRD.md`](./PRD.md), [`docs/CONSOLIDATION_MANIFEST.md`](./docs/CONSOLIDATION_MANIFEST.md), and [`docs/mcp.md`](./docs/mcp.md) for MCP setup.

## Requirements

- macOS 10.13+ (Apple Silicon or Intel)
- [Node.js](https://nodejs.org/) 20+, [pnpm](https://pnpm.io/), [Rust](https://rustup.rs/) for building from source

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Build (macOS)

```bash
pnpm install
pnpm tauri build
```

Artifacts:

- `src-tauri/target/release/bundle/macos/NoteLoom.app`
- `src-tauri/target/release/bundle/dmg/*.dmg`

### Unsigned install (Gatekeeper)

If the DMG/app is not Apple-notarized:

1. Open **System Settings → Privacy & Security** and allow the app after first open, **or**
2. Right-click the app → **Open** → confirm

## License

GNU General Public License v3.0 — see [`LICENSE`](./LICENSE).  
Copyright notices for original authors are preserved in the license file. NoteLoom modifications © contributors.

## Source

- Repository: https://github.com/ksjpswaroop/NoteLoom
