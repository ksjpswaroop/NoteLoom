# Drawing board merge plan

**Recommendation:** One Drawing board hosted by Canvas; Excalidraw as Sketch mode (not a peer product); Mermaid stays inline in notes.

## Computer use limitations

Opened `/Applications/NoteLoom.app`. Screen Recording blocked screenshots; Accessibility could not drive the Tauri WebView reliably; Midscene had no vision model configured. The duplication map below is from product code and i18n.

## 1. Current state — duplication map

| Surface | Purpose | LLM entry | Export | Overlap |
| --- | --- | --- | --- | --- |
| Canvas (React Flow) | Left sidebar Canvases, templates, AI panel, shapes/pen/charts/embeds | Chat slash + `canvas_create_*` | PNG/SVG via html-to-image + static SVG thumbnails | Overlaps Mermaid + Excalidraw + freehand |
| Excalidraw | Files → New Sketch, `*.excalidraw` | Slash Sketch + `excalidraw_*` tools | Excalidraw PNG/SVG export | Overlaps canvas freehand and diagram intents |
| Mermaid in TipTap | Slash Mermaid types, fenced blocks | Editor tools + AI | Per-block + full-note PNG | Overlaps canvas for many kinds; flowchart import only |
| Canvas freehand (perfect-freehand) | Ink on structured canvas | None dedicated | In DOM/static export | Rivals Excalidraw |
| Mobile canvas | Same projects | Same tools | Thumbnails | Same stack |

**Persistence silos:** canvases DB + `.data/canvases` · workspace `.excalidraw` · Markdown fences.

## 2. Recommended target architecture

**Winner:** Canvas as host “Drawing board”; Excalidraw as Sketch mode; Mermaid remains note-inline.

| Concern | Outcome |
| --- | --- |
| Image quality | Excalidraw keeps sketch export quality; structured boards use Canvas static SVG/PNG |
| LLM editability | Canvas host wins for structured graphs |
| File format | Keep formats readable; Sketch stays Excalidraw-backed |
| Performance | Do not load Excalidraw on every structured board |

**Product concept**

- One left-rail **Drawing** entry.
- Create **Structured** vs **Sketch**.
- **New Sketch** becomes a shortcut into that flow.
- The agent refers to a drawing board plus mode.

Mermaid remains note-native. Offer **Open on board** for flowchart-class diagrams only.

## 3. Merge strategy (phased)

### P0 — Information architecture

- Rename Canvases → Drawing.
- One empty state / create menu.
- Move New Sketch under Drawing create.
- Collapse chat diagram commands.
- Agent prompt: one board.
- Non-destructive.

### P1 — Modes & formats

- Board mode `sketch` → Excalidraw in the Drawing manager.
- Demote canvas pen/highlighter UI.
- Keep formats readable.
- Do not mix freehand + graph scenes.

### P2 — Agent tools consolidation

- Facade: `drawing_create` / `get_state` / `update`.
- Deprecate raw `canvas_*` / `excalidraw_*` as user-facing.
- Keep aliases for one release.

### P3 — Single export pipeline

- **Structured:** `canvasDocumentToSvg` + PNG as source of truth; retire html-to-image for perfect export when parity allows.
- **Sketch:** keep Excalidraw helpers.
- **Mermaid:** stay note-local.
- Rewrite `docs/diagrams.md`.
- Later: migrate orphan `.excalidraw` files into the Drawing index.

#### What stays inline vs board-only

| Content | Home |
| --- | --- |
| Mermaid (all kinds in notes) | Inline in TipTap |
| Flowchart-class Mermaid → board | Optional “Open on board” only |
| Structured graphs / mind maps / templates | Drawing board (Structured) |
| Freehand / whiteboard sketches | Drawing board (Sketch / Excalidraw) |
| Mixed freehand + graph scene | Out of scope until fidelity suite exists |

## 4. Image quality risks

| Risk | Why | Perfect test |
| --- | --- | --- |
| Two canvas renderers | Editor vs export can diverge | Structured board: on-screen vs PNG/SVG pixel/geometry match |
| html-to-image Tauri quirks | DOM capture is flaky in WebView | Prefer static SVG path; golden PNG under Tauri |
| Mermaid SVG → PNG | Note preview vs export scaling/fonts | Block PNG matches preview |
| Excalidraw files | Sketch quality must stay high | Sketch PNG/SVG matches editor |
| LLM round-trip | Agent edits can corrupt geometry | Update preserves unrelated nodes/edges/elements |
| Mermaid ↔ canvas lossy | Import/export is incomplete | Flowchart round-trip documented limits |
| Naïve mixed layers | Freehand + graph in one scene | Forbidden until suite; no mixed export path |

**Definition of done**

- One export path per mode.
- PNG/SVG matches the editor.
- Agent edit preserves unrelated geometry.
- Note Mermaid matches preview.

## 5. Explicit non-goals

- Do not remove Mermaid from notes.
- Do not replace canvas with Excalidraw for structured graphs.
- Do not add MindFusion or the npm `diagrams` CLI.
- Do not force one JSON schema in P0–P2.
- Do not merge sketch + graph until a fidelity suite exists.
- Do not auto-convert all Mermaid to boards.

## 6. Effort & risks

| Phase | Size | Estimate |
| --- | --- | --- |
| P0 | S | 1–3 days |
| P1 | M | 1–2 weeks |
| P2 | M | Multi-release with P1/P3 |
| P3 | L | Multi-release |

Highest leverage: **P0** (IA) + **P3** structured export fidelity.

## Sharp call

One Drawing board = Canvas shell. Excalidraw = Sketch mode. Mermaid = in-note. Kill the third mental model. Protect images via static SVG structured export; never mix sketch + graph until a golden suite exists.
