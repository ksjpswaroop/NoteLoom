# Diagrams and mind maps in NoteLoom

## Recommendation

**Do not ship MindFusion.Diagramming in this GPL-3.0 tree.** Prefer the existing stack:

- **Native canvas** (`@xyflow/react` + ELK + agent canvas tools) for editable mind maps, flowcharts, org charts, architecture, and related graphs
- **Mermaid** (already in TipTap) for inline diagrams in notes, including `mindmap`

### Why not MindFusion

| Factor | MindFusion | NoteLoom stack |
| --- | --- | --- |
| License | Commercial EULA (`@mindfusion/diagramming`), from ~$450+ / developer | MIT/open stack already in-repo |
| GPL-3.0 | Closed SDK cannot be combined into a GPL distributed work without a paid license and careful legal review | Compatible |
| Bundle | ~1.6–2.0 MB ESM / ~8 MB unpacked | Already paid (React Flow + Mermaid + ELK) |
| SSR / Tauri | Browser DOM APIs; needs `ssr: false` / client-only | Canvas editor is already client-side |
| LLM drive | Proprietary JSON/XML model | Stable canvas JSON ops + Mermaid text |

## How LLM generation works

1. **Canvas AI panel** — open a canvas → sparkles **Generate with AI** → pick scope/preset → **Send to AI**. Chat Agent drafts `canvas_create_diagram` (approve the preview).
2. **Chat** — ask for a mind map / flowchart / org chart. If no canvas is open, the agent calls `canvas_create_project`, then `canvas_create_diagram` with `diagramKind`.
3. **Note selection** — select text in the editor → bubble menu AI → Generate mind map / flowchart / timeline / tasks.
4. **Inline Mermaid** — `/mindmap` slash command, or ask the agent to insert a Mermaid fenced block (`mindmap`, `flowchart`, etc.) in the note.

Diagrams persist as:

- Canvas documents in the canvases DB / sync files (nodes + edges JSON)
- Mermaid fenced blocks inside Markdown notes

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
- `src/lib/canvas/ai-prompt.ts` — canvas AI prompt builder
- `src/app/core/main/canvas/canvas-tools-sidebar.tsx` — Generate with AI panel
- `src/app/core/main/editor/markdown/mermaid-extension.tsx` — Mermaid (incl. mindmap)
- `src/lib/canvas/templates.ts` — mind map / flowchart templates
