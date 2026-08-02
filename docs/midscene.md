# Midscene Automations

NoteLoom can optionally use [`@midscene/computer`](https://www.npmjs.com/package/@midscene/computer) for:

- **Computer use** — natural-language desktop control (`aiAct` / query / assert)
- **App testing** — multi-step act/assert flows with a saved pass/fail report
- **Step-by-step documentation** — run a workflow, capture a screenshot per step, write a Markdown note

Midscene is an **optional power-user Automations module**. It is **not** the default note agent and does **not** auto-start on launch. Runtime install uses the same **local-services** app-data manager as Wigolo — see [`docs/local-services.md`](./local-services.md).

## Architecture

`@midscene/computer` is Node-native and ships platform input binaries. NoteLoom therefore:

1. Installs the package under app data: `…/local-services/midscene/` (same local-services root as Wigolo)
2. Runs a bundled Node runner: `src-tauri/resources/midscene/runner.mjs`
3. Exposes Tauri commands (`inspect_midscene`, `ensure_midscene`, `run_midscene`, `cancel_midscene`)
4. Keeps Midscene **out** of the Next.js / WebView webpack graph

## Setup

1. Open **Settings → Automations**
2. Read the privacy warning and click **I understand — enable Automations**
3. Leave **Enable Automations** on
4. Click **Install Runtime** (requires Node.js 20+ and npm on PATH)
5. Configure a **vision-capable** model:
   - Model name → `MIDSCENE_MODEL_NAME`
   - Model family → `MIDSCENE_MODEL_FAMILY`
   - Base URL → `MIDSCENE_MODEL_BASE_URL`
   - API key → `MIDSCENE_MODEL_API_KEY`
6. On macOS, grant **Accessibility** and **Screen Recording** for NoteLoom (use **Open macOS Permissions**)

Example Gemini Flash-style config:

| Field | Example |
| --- | --- |
| Model name | `gemini-3-flash` |
| Family | `gemini` |
| Base URL | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| API key | your Google AI Studio key |

## Privacy warning

When Midscene runs:

- It can move the mouse and type on the keyboard
- It captures screenshots of the selected display
- Those screenshots are sent to **your configured model provider**

Do not enable Automations on a shared machine or while private content is visible.

## Generate step-by-step docs with screenshots

### From Settings

1. Enable Automations and install the runtime
2. In **Generate step-by-step docs**, enter one action per line
3. Click **Generate documentation**
4. Midscene executes each step, saves screenshots, and writes Markdown under app data (`midscene/docs/…`)
5. Agent tool `midscene_document_flow` can also import the note into workspace `automations/`

### From the agent

Ask the agent (with Automations enabled) to document a flow. It will request confirmation, then call `midscene_document_flow` with steps like:

```json
{
  "title": "Export a PDF",
  "steps": [
    { "description": "Open the note", "prompt": "Open the current note in NoteLoom" },
    { "description": "Open export", "prompt": "Open the export menu" },
    { "description": "Choose PDF", "prompt": "Choose Export as PDF" }
  ]
}
```

## Run a test flow

### From Settings

1. In **Run a test flow**, use lines such as:
   - `assert: NoteLoom window is visible`
   - `act: Open Settings`
   - `assert: a settings panel is visible`
2. Click **Run test**
3. A `report.md` / `report.json` pair is written under `midscene/tests/…`

### From the agent

Use `midscene_test_flow` after confirmation. Failed asserts mark the report as `failed`.

## Agent tools

Only offered after opt-in + enable:

| Tool | Purpose |
| --- | --- |
| `midscene_act` | One natural-language desktop action |
| `midscene_query` | Screen query |
| `midscene_assert` | Screen assertion |
| `midscene_test_flow` | Multi-step test + report |
| `midscene_document_flow` | Docs with screenshots + workspace note |

All of these use risk `script` and require confirmation before desktop control.

## Gaps and limits

- **Model**: Midscene needs a strong vision / grounding model. Chat-only models will fail.
- **macOS**: Accessibility + Screen Recording are mandatory.
- **Linux**: Supported by Midscene; headless/Xvfb paths exist in the upstream package but are not first-class in the NoteLoom UI.
- **Windows**: Supported by Midscene; packaging still expects a local Node.js toolchain for install.
- **Mobile**: Not available.
- **Packaging**: The runner script is bundled; `@midscene/computer` itself is downloaded into app data on Install Runtime (not vendored into the app binary).
- **Licensing**: Use only legitimate Midscene/npm packages and model provider accounts. NoteLoom does not bypass licenses.
