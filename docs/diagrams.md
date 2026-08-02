# Diagrams and mind maps in NoteLoom

See also: [Drawing board merge plan](./drawing-board-merge-plan.md).

## Recommendation

**Do not ship MindFusion.Diagramming in this GPL-3.0 tree.** Prefer the existing stack:

- **Native canvas** (`@xyflow/react` + ELK + agent canvas tools) for editable mind maps, flowcharts, org charts, architecture, sequence flows, timelines, state diagrams, ER/class diagrams, and related graphs
- **Mermaid** ([`mermaid` npm](https://www.npmjs.com/package/mermaid), currently `^11.16`) for inline diagrams in TipTap notes, including `mindmap`, `sequenceDiagram`, `timeline`, `stateDiagram-v2`, `erDiagram`, and the usual flowchart family. Each block can export **PNG** or **SVG** from the note UI (Tauri save dialog / browser download).
- **Excalidraw** ([`@excalidraw/excalidraw`](https://www.npmjs.com/package/@excalidraw/excalidraw), currently `^0.18`) for freehand/whiteboard sketches persisted as workspace `.excalidraw` JSON files. Complementary to the React Flow canvas—does not replace it. Open from the Files sidebar or create via **New Sketch** / agent tools. Export **PNG** or **SVG** from the sketch toolbar.

### Why not npm `diagrams` (francoislaberge/diagrams)

Evaluated [diagrams@0.11.0](https://www.npmjs.com/package/diagrams) as a candidate for “other diagram kinds.” **Do not install it.**

| Factor | `diagrams` npm | NoteLoom stack |
| --- | --- | --- |
| Role | Global CLI (`diagrams watch` / `build`) wrapping flowchart.js, js-sequence-diagrams, viz.js, railroad-diagrams | In-app editable canvas + Mermaid in notes + Excalidraw sketches |
| Runtime | Node + **Electron ^3** headless browser for several formats | Tauri / Next client already |
| Maintenance | Last publish **2020-01-07**; registry metadata only touched 2023 | Mermaid 11 + React Flow + Excalidraw maintained |
| LLM drive | File DSLs → SVG files on disk | `canvas_create_diagram` JSON + Mermaid text + Excalidraw element skeletons |

What that package offered maps as follows:

| `diagrams` CLI kind | NoteLoom path |
| --- | --- |
| flowchart | Canvas `flowchart` / Mermaid `flowchart`/`graph` / Excalidraw shapes |
| network sequence | Canvas `sequence` / Mermaid `sequenceDiagram` |
| Graphviz DOT | Mermaid flowchart/graph or canvas `architecture`/`flowchart` (raw DOT / `@viz-js/viz` not wired) |
| railroad | Not first-class; use Mermaid flowchart or `stateDiagram-v2` as a substitute |

### Why not MindFusion

| Factor | MindFusion | NoteLoom stack |
| --- | --- | --- |
| License | Commercial EULA (`@mindfusion/diagramming`), from ~$450+ / developer | MIT/open stack already in-repo |
| GPL-3.0 | Closed SDK cannot be combined into a GPL distributed work without a paid license and careful legal review | Compatible |
| Bundle | ~1.6–2.0 MB ESM / ~8 MB unpacked | Already paid (React Flow + Mermaid + ELK); Excalidraw is large and loaded client-only via `dynamic(..., { ssr: false })` |
| SSR / Tauri | Browser DOM APIs; needs `ssr: false` / client-only | Canvas and Excalidraw editors are already client-side |
| LLM drive | Proprietary JSON/XML model | Stable canvas JSON ops + Mermaid text + Excalidraw skeletons |

## How LLM generation works

1. **Canvas AI panel** — open a canvas → sparkles **Generate with AI** → pick scope/preset (mind map, flowchart, architecture, sequence, org chart, class, timeline, state, ER) → **Send to AI**. Chat Agent drafts `canvas_create_diagram` (approve the preview).
2. **Chat** — ask for a mind map / flowchart / org chart / sequence / timeline / state diagram / ER diagram. If no canvas is open, the agent calls `canvas_create_project`, then `canvas_create_diagram` with `diagramKind`.
3. **Excalidraw sketch** — ask for a whiteboard/sketch/`.excalidraw` drawing. The agent calls `excalidraw_create` (optional element skeletons) or `excalidraw_update_elements` on the open sketch.
4. **Note selection** — select text in the editor → bubble menu AI → Generate mind map / flowchart / timeline / tasks.
5. **Inline Mermaid** — slash commands (`/mindmap`, `/sequence`, `/timeline`, …), or ask the agent to insert a Mermaid fenced block in the note via editor tools (`editor_apply_transaction` / `editor_replace_lines` / `editor_insert_at_cursor`).

### Export Mermaid as PNG / SVG

1. Insert or open a Mermaid block in a note (slash menu or LLM).
2. Hover the diagram preview → **download** icon → **Export PNG** or **Export SVG**.
3. On desktop (Tauri), pick a path in the save dialog; in the browser, the file downloads directly.

### Export Excalidraw as PNG / SVG

1. Open a `.excalidraw` file from Files (or create one with **New Sketch** / chat).
2. Use the sketch toolbar **Export** → **Export PNG** or **Export SVG**.
3. On desktop (Tauri), pick a path in the save dialog; in the browser, the file downloads directly.

Canvas still has its own PNG/SVG/Mermaid (`.mmd`) export from the canvas footer.

Full-note **Export → Image (.png)** (and HTML/PDF render paths) rasterize inline ` ```mermaid ` blocks so the PNG matches what you see in the note. Per-block Export PNG/SVG remains available from the Mermaid preview toolbar.

**Excalidraw** sketches are separate workspace `.excalidraw` files — export PNG/SVG from the sketch toolbar (not from the note Export menu).

Diagrams persist as:

- Canvas documents in the canvases DB / sync files (nodes + edges JSON)
- Mermaid fenced blocks inside Markdown notes
- Excalidraw scenes as workspace `.excalidraw` JSON files (standard Excalidraw format)

## Optional: add MindFusion later (paid license only)

If you purchase a commercial license from [MindFusion](https://mindfusion.dev/javascript-diagram.html):

1. Buy a developer license and obtain the key (portal / confirmation email).
2. Install privately (do **not** commit the key):

   ```bash
   pnpm add @mindfusion/diagramming
   ```

3. Load only on the client (`dynamic(..., { ssr: false })` or a Tauri webview-only mount).
4. Set `DiagramView.licenseKey` (or `mindfusion_lic.txt` via `licenseLocation`) from a local/env secret.
5. Keep MindFusion behind an optional feature flag and document redistribution limits for GPL builds. Prefer treating it as a private fork / proprietary add-on, not a default dependency of the public GPL distribution.

Non-commercial evaluation requires a MindFusion link-back (`linkBackId`); that path is unsuitable for NoteLoom’s product UI.

## Related code

- `src/lib/agent/tools/canvas-tools.ts` — `canvas_create_project`, `canvas_create_diagram`, …
- `src/lib/agent/tools/excalidraw-tools.ts` — `excalidraw_create`, `excalidraw_update_elements`, `excalidraw_get_state`
- `src/lib/canvas/ai-prompt.ts` — canvas AI prompt builder / presets
- `src/app/core/main/canvas/canvas-tools-sidebar.tsx` — Generate with AI panel
- `src/app/core/main/excalidraw/excalidraw-editor.tsx` — Excalidraw editor (client-only) + PNG/SVG export
- `src/lib/excalidraw/` — file format, workspace I/O, skeleton conversion, export helpers
- `src/app/core/main/editor/markdown/mermaid-extension.tsx` — Mermaid TipTap node (incl. mindmap, timeline) + PNG/SVG export UI
- `src/lib/mermaid/export-diagram.ts` — render Mermaid → SVG/PNG and save via Tauri dialog
- `src/lib/canvas/templates.ts` — mind map / flowchart / timeline templates
- `src/lib/canvas/mermaid.ts` — Mermaid flowchart ↔ canvas document import/export
