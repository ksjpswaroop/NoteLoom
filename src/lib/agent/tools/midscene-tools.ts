import type { AgentTool, AgentToolResult } from '../types'
import { ensureMidsceneForAutomation, getLocalServiceFixTip } from '@/lib/local-services'
import {
  isMidsceneAutomationAvailableSync,
  isMidsceneModelConfigured,
  loadMidsceneSettings,
  midsceneAct,
  midsceneAssert,
  midsceneDocumentFlow,
  midsceneQuery,
  midsceneRunTest,
  type MidsceneStep,
} from '@/lib/midscene'
import { importMidsceneNoteToWorkspace } from '@/lib/midscene/workspace-import'

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asSteps(value: unknown): MidsceneStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const step = item as Record<string, unknown>
    const prompt = asString(step.prompt) || asString(step.action) || asString(step.assert)
    if (!prompt && !asString(step.description)) return []
    const type = asString(step.type).toLowerCase()
    return [{
      type: (['act', 'assert', 'query', 'wait'].includes(type)
        ? type
        : 'act') as MidsceneStep['type'],
      prompt,
      action: asString(step.action) || undefined,
      assert: asString(step.assert) || undefined,
      description: asString(step.description) || asString(step.title) || undefined,
      title: asString(step.title) || undefined,
      message: asString(step.message) || undefined,
    }]
  })
}

async function requireMidsceneReady(): Promise<AgentToolResult | null> {
  const settings = await loadMidsceneSettings()
  if (!settings.enabled || !settings.optInAccepted) {
    return {
      ok: false,
      message: 'Midscene Automations are disabled. Enable them and accept the safety warning in Settings → Automations first.',
      error: 'MIDSCENE_DISABLED',
    }
  }
  if (!isMidsceneModelConfigured(settings.model)) {
    return {
      ok: false,
      message: 'Configure a vision-capable Midscene model (API key, name, base URL, family) in Settings → Automations.',
      error: 'MIDSCENE_MODEL_MISSING',
    }
  }
  if (!isMidsceneAutomationAvailableSync()) {
    // Cache may be stale before load; settings already checked above.
  }

  try {
    const status = await ensureMidsceneForAutomation()
    if (!status.packageReady && status.state !== 'ready' && status.state !== 'running') {
      const tip = getLocalServiceFixTip(status.message) || getLocalServiceFixTip(status.detail)
      return {
        ok: false,
        message: tip
          ? `${status.message} ${tip}`
          : status.message || 'Midscene runtime is not ready. Install it from Settings → Automations.',
        error: 'MIDSCENE_RUNTIME_MISSING',
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const tip = getLocalServiceFixTip(message)
    return {
      ok: false,
      message: tip ? `${message} ${tip}` : message,
      error: 'MIDSCENE_ENSURE_FAILED',
    }
  }

  return null
}

function resultFromRun(run: Awaited<ReturnType<typeof midsceneAct>>, successMessage: string): AgentToolResult {
  const data = run.data || {}
  if (!run.ok) {
    return {
      ok: false,
      message: asString(data.error) || run.stderr || 'Midscene command failed',
      error: asString(data.error) || 'MIDSCENE_FAILED',
      data: {
        executionId: run.executionId,
        timedOut: run.timedOut,
        cancelled: run.cancelled,
        ...data,
      },
    }
  }
  return {
    ok: true,
    message: successMessage,
    data: {
      executionId: run.executionId,
      timedOut: run.timedOut,
      cancelled: run.cancelled,
      ...data,
    },
  }
}

export const midsceneActTool: AgentTool = {
  name: 'midscene_act',
  title: 'Desktop computer action',
  description: 'Optional Automations: use Midscene to control the local desktop with a natural-language action (mouse/keyboard). Requires Settings → Automations enabled, opt-in, runtime install, macOS Accessibility/Screen Recording when applicable, and a vision model. Always confirm with the user before running.',
  category: 'system',
  risk: 'script',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Natural-language desktop action, e.g. "Open Calculator and type 123".',
      },
      displayId: {
        type: 'string',
        description: 'Optional display id from Midscene status.',
      },
      aiActionContext: {
        type: 'string',
        description: 'Optional extra context for the Midscene planner.',
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const gate = await requireMidsceneReady()
    if (gate) return gate
    const prompt = asString(input.prompt)
    if (!prompt) {
      return { ok: false, message: 'prompt is required', error: 'INVALID_INPUT' }
    }
    const run = await midsceneAct(prompt, {
      displayId: asString(input.displayId) || undefined,
      aiActionContext: asString(input.aiActionContext) || undefined,
    })
    return resultFromRun(run, 'Desktop action completed via Midscene.')
  },
}

export const midsceneQueryTool: AgentTool = {
  name: 'midscene_query',
  title: 'Desktop computer query',
  description: 'Optional Automations: capture the desktop via Midscene and answer a structured natural-language query. Requires Automations opt-in and a vision model. Confirm before capturing the screen.',
  category: 'system',
  risk: 'script',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Query, e.g. "{title: string}, get the active window title".',
      },
      displayId: { type: 'string' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const gate = await requireMidsceneReady()
    if (gate) return gate
    const prompt = asString(input.prompt)
    if (!prompt) {
      return { ok: false, message: 'prompt is required', error: 'INVALID_INPUT' }
    }
    const run = await midsceneQuery(prompt, {
      displayId: asString(input.displayId) || undefined,
    })
    return resultFromRun(run, 'Desktop query completed via Midscene.')
  },
}

export const midsceneAssertTool: AgentTool = {
  name: 'midscene_assert',
  title: 'Desktop computer assert',
  description: 'Optional Automations: assert a visible desktop condition with Midscene. Useful for app testing. Requires Automations opt-in.',
  category: 'system',
  risk: 'script',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Assertion in natural language.' },
      message: { type: 'string', description: 'Optional custom failure message.' },
      displayId: { type: 'string' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const gate = await requireMidsceneReady()
    if (gate) return gate
    const prompt = asString(input.prompt)
    if (!prompt) {
      return { ok: false, message: 'prompt is required', error: 'INVALID_INPUT' }
    }
    const run = await midsceneAssert(prompt, {
      message: asString(input.message) || undefined,
      displayId: asString(input.displayId) || undefined,
    })
    const passed = run.data?.passed !== false && run.ok
    return {
      ok: passed,
      message: passed ? 'Assertion passed.' : asString(run.data?.error) || 'Assertion failed.',
      error: passed ? undefined : 'MIDSCENE_ASSERT_FAILED',
      data: run.data,
    }
  },
}

export const midsceneTestFlowTool: AgentTool = {
  name: 'midscene_test_flow',
  title: 'Run Midscene test flow',
  description: 'Optional Automations: run a multi-step Midscene act/assert script against the desktop (NoteLoom or an external app) and save a pass/fail report under app data. Requires Automations opt-in. Always confirm first.',
  category: 'system',
  risk: 'script',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Test report title.' },
      steps: {
        type: 'array',
        description: 'Ordered steps with type act|assert|query|wait and prompt.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            prompt: { type: 'string' },
            description: { type: 'string' },
            message: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      stopOnFailure: { type: 'boolean' },
    },
    required: ['title', 'steps'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const gate = await requireMidsceneReady()
    if (gate) return gate
    const title = asString(input.title) || 'Midscene test'
    const steps = asSteps(input.steps)
    if (steps.length === 0) {
      return { ok: false, message: 'steps must be a non-empty array', error: 'INVALID_INPUT' }
    }
    const run = await midsceneRunTest({
      title,
      steps,
      stopOnFailure: input.stopOnFailure !== false,
    })
    const report = (run.data?.report && typeof run.data.report === 'object')
      ? run.data.report as Record<string, unknown>
      : null
    const status = asString(report?.status)
    return {
      ok: run.ok && status !== 'failed',
      message: status === 'passed'
        ? `Test passed. Report: ${asString(report?.reportMarkdownPath) || 'saved'}`
        : `Test finished with status ${status || 'failed'}.`,
      error: status === 'failed' ? 'MIDSCENE_TEST_FAILED' : undefined,
      data: run.data,
    }
  },
}

export const midsceneDocumentFlowTool: AgentTool = {
  name: 'midscene_document_flow',
  title: 'Document flow with screenshots',
  description: 'Optional Automations: execute a step-by-step desktop workflow with Midscene, capture a screenshot after each step, and write a Markdown how-to note (with images) into the workspace automations/ folder. Requires Automations opt-in. Always confirm first — this controls the mouse/keyboard and sends screenshots to the configured model provider.',
  category: 'system',
  risk: 'script',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Document title.' },
      noteFileName: {
        type: 'string',
        description: 'Optional markdown filename without path, e.g. "export-pdf-guide".',
      },
      steps: {
        type: 'array',
        description: 'Ordered documentation steps with prompt/action and optional description.',
        items: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            action: { type: 'string' },
            description: { type: 'string' },
            title: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      continueOnError: { type: 'boolean' },
      importToWorkspace: {
        type: 'boolean',
        description: 'When true (default), copy the generated note into workspace automations/.',
      },
    },
    required: ['title', 'steps'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const gate = await requireMidsceneReady()
    if (gate) return gate
    const title = asString(input.title) || 'Step-by-step guide'
    const steps = asSteps(input.steps)
    if (steps.length === 0) {
      return { ok: false, message: 'steps must be a non-empty array', error: 'INVALID_INPUT' }
    }

    const run = await midsceneDocumentFlow({
      title,
      steps,
      noteFileName: asString(input.noteFileName) || undefined,
      continueOnError: input.continueOnError !== false,
    })

    if (!run.ok) {
      return resultFromRun(run, 'Documentation flow failed.')
    }

    const notePath = asString(run.data.notePath)
    const noteFileName = asString(run.data.noteFileName) || 'guide.md'
    let workspaceNotePath: string | undefined

    if (input.importToWorkspace !== false && notePath) {
      try {
        const imported = await importMidsceneNoteToWorkspace({
          notePath,
          noteFileName,
          steps: Array.isArray(run.data.steps)
            ? run.data.steps as Array<{ screenshotPath?: string; screenshotRelativePath?: string }>
            : [],
        })
        workspaceNotePath = imported.workspaceNotePath
      } catch (error) {
        return {
          ok: true,
          message: `Documentation generated at ${notePath}, but importing into the workspace failed: ${error instanceof Error ? error.message : String(error)}`,
          data: { ...run.data, workspaceNotePath: null },
        }
      }
    }

    return {
      ok: true,
      message: workspaceNotePath
        ? `Step-by-step documentation saved to ${workspaceNotePath}`
        : `Step-by-step documentation saved to ${notePath}`,
      data: {
        ...run.data,
        workspaceNotePath,
      },
      changes: workspaceNotePath
        ? [{
            id: `midscene-doc-${Date.now()}`,
            type: 'file',
            target: workspaceNotePath,
            after: workspaceNotePath,
            reversible: false,
            summary: `Create documentation note ${workspaceNotePath}`,
          }]
        : undefined,
    }
  },
}

export const midsceneTools: AgentTool[] = [
  midsceneActTool,
  midsceneQueryTool,
  midsceneAssertTool,
  midsceneTestFlowTool,
  midsceneDocumentFlowTool,
]
