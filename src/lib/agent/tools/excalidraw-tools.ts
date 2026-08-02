import emitter from '@/lib/emitter'
import {
  createEmptyExcalidrawScene,
  isExcalidrawPath,
  summarizeExcalidrawScene,
  type ExcalidrawSceneFile,
} from '@/lib/excalidraw/file-format'
import { convertSkeletonsToElements } from '@/lib/excalidraw/skeleton'
import {
  createExcalidrawWorkspaceFile,
  readExcalidrawScene,
  writeExcalidrawScene,
} from '@/lib/excalidraw/workspace'
import { ensureSafeWorkspaceRelativePath } from '@/lib/workspace'
import type { AgentTool, AgentToolResult } from '../types'

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function resolveTargetPath(inputPath: unknown, activeFilePath?: string | null): Promise<
  { filePath: string } | { error: string }
> {
  const explicit = asNonEmptyString(inputPath)
  if (explicit) {
    const normalized = await ensureSafeWorkspaceRelativePath(explicit)
    if (!isExcalidrawPath(normalized)) {
      return { error: 'filePath must end with .excalidraw' }
    }
    return { filePath: normalized }
  }

  const active = asNonEmptyString(activeFilePath)
  if (active && isExcalidrawPath(active)) {
    return { filePath: active }
  }

  return { error: 'No .excalidraw sketch is open. Pass filePath or create one with excalidraw_create first.' }
}

async function applyScene(
  filePath: string,
  scene: ExcalidrawSceneFile,
  open: boolean,
): Promise<void> {
  await writeExcalidrawScene(filePath, scene)
  emitter.emit('excalidraw-scene-replace', { filePath, scene })

  if (open) {
    const { default: useArticleStore } = await import('@/stores/article')
    const { useSidebarStore } = await import('@/stores/sidebar')
    await useArticleStore.getState().loadFileTree({ skipRemoteSync: true })
    await useSidebarStore.getState().setLeftSidebarTab('files')
    await useArticleStore.getState().setActiveFilePath(filePath)
  }
}

const getExcalidrawStateTool: AgentTool = {
  name: 'excalidraw_get_state',
  title: 'Read Excalidraw sketch',
  description: 'Read a workspace .excalidraw sketch (elements summary). Defaults to the currently open .excalidraw file when filePath is omitted.',
  category: 'excalidraw',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Workspace-relative .excalidraw path. Optional when a sketch is already open.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute: async (input, context): Promise<AgentToolResult> => {
    const resolved = await resolveTargetPath(input.filePath, context.context.activeFilePath)
    if ('error' in resolved) {
      return { ok: false, message: resolved.error, error: 'NO_EXCALIDRAW_TARGET' }
    }

    try {
      const scene = await readExcalidrawScene(resolved.filePath)
      const summary = summarizeExcalidrawScene(scene)
      return {
        ok: true,
        message: `Read sketch “${resolved.filePath}”: ${summary.elementCount} elements.`,
        data: { filePath: resolved.filePath, ...summary },
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to read sketch',
        error: 'EXCALIDRAW_READ_FAILED',
      }
    }
  },
}

const createExcalidrawTool: AgentTool = {
  name: 'excalidraw_create',
  title: 'Create Excalidraw sketch',
  description: 'Create a workspace .excalidraw whiteboard/sketch file, optionally populate it with Excalidraw JSON elements from natural language, and open it. Prefer this for freehand-style sketches, whiteboard layouts, and rough diagrams the user wants as an Excalidraw file. For structured mind maps/flowcharts prefer canvas tools; for inline note diagrams prefer Mermaid.',
  category: 'excalidraw',
  risk: 'file-create',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Sketch title used for the filename (without or with .excalidraw).',
      },
      folderPath: {
        type: 'string',
        description: 'Optional workspace-relative folder. Defaults to workspace root.',
      },
      elements: {
        type: 'array',
        description: 'Optional Excalidraw element skeletons. Supported types: rectangle, ellipse, diamond, text, arrow, line, frame. Shapes accept id, x, y, width, height, label/text, strokeColor, backgroundColor. Arrows accept start/end as { id } or coordinates.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            text: { type: 'string' },
            label: {},
            strokeColor: { type: 'string' },
            backgroundColor: { type: 'string' },
            start: { type: 'object' },
            end: { type: 'object' },
            children: { type: 'array', items: { type: 'string' } },
            name: { type: 'string' },
            points: { type: 'array' },
            fontSize: { type: 'number' },
          },
          required: ['type', 'x', 'y'],
          additionalProperties: true,
        },
      },
      open: {
        type: 'boolean',
        description: 'Open the sketch after creating it. Defaults to true.',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  execute: async (input): Promise<AgentToolResult> => {
    const title = asNonEmptyString(input.title) || 'Untitled sketch'
    const folderPath = asNonEmptyString(input.folderPath) || undefined
    const rawElements = Array.isArray(input.elements) ? input.elements : []
    let scene = createEmptyExcalidrawScene()

    if (rawElements.length > 0) {
      const converted = await convertSkeletonsToElements(rawElements)
      if (converted.error) {
        return {
          ok: false,
          message: `Invalid Excalidraw elements: ${converted.error}`,
          error: 'INVALID_EXCALIDRAW_ELEMENTS',
        }
      }
      scene = createEmptyExcalidrawScene({ elements: converted.elements })
    }

    try {
      const result = await createExcalidrawWorkspaceFile({
        fileName: title,
        folderPath,
        scene,
        open: input.open !== false,
      })
      const summary = summarizeExcalidrawScene(result.scene)
      return {
        ok: true,
        message: `Created and opened sketch “${result.filePath}” with ${summary.elementCount} elements.`,
        data: { filePath: result.filePath, ...summary },
        changes: [{
          id: crypto.randomUUID(),
          type: 'file',
          target: result.filePath,
          before: '',
          after: JSON.stringify(summary),
          reversible: false,
          summary: `Create Excalidraw sketch “${result.filePath}”`,
        }],
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to create sketch',
        error: 'EXCALIDRAW_CREATE_FAILED',
      }
    }
  },
}

const updateExcalidrawElementsTool: AgentTool = {
  name: 'excalidraw_update_elements',
  title: 'Update Excalidraw sketch',
  description: 'Create or replace elements on a workspace .excalidraw sketch using Excalidraw JSON element skeletons, then open/render the file. Defaults to the currently open .excalidraw file. Use replaceExisting=true for a full new scene.',
  category: 'excalidraw',
  risk: 'file-update',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Workspace-relative .excalidraw path. Optional when a sketch is already open.',
      },
      replaceExisting: {
        type: 'boolean',
        description: 'When true, replace all elements. When false, append converted elements to the existing scene.',
      },
      elements: {
        type: 'array',
        description: 'Excalidraw element skeletons (rectangle, ellipse, diamond, text, arrow, line, frame).',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            id: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            text: { type: 'string' },
            label: {},
            strokeColor: { type: 'string' },
            backgroundColor: { type: 'string' },
            start: { type: 'object' },
            end: { type: 'object' },
            children: { type: 'array', items: { type: 'string' } },
            name: { type: 'string' },
            points: { type: 'array' },
            fontSize: { type: 'number' },
          },
          required: ['type', 'x', 'y'],
          additionalProperties: true,
        },
      },
      open: {
        type: 'boolean',
        description: 'Open the sketch after updating. Defaults to true.',
      },
    },
    required: ['replaceExisting', 'elements'],
    additionalProperties: false,
  },
  execute: async (input, context): Promise<AgentToolResult> => {
    const resolved = await resolveTargetPath(input.filePath, context.context.activeFilePath)
    if ('error' in resolved) {
      return { ok: false, message: resolved.error, error: 'NO_EXCALIDRAW_TARGET' }
    }

    const rawElements = Array.isArray(input.elements) ? input.elements : []
    if (rawElements.length === 0) {
      return { ok: false, message: 'elements must be a non-empty array.', error: 'EMPTY_ELEMENTS' }
    }

    const converted = await convertSkeletonsToElements(rawElements)
    if (converted.error) {
      return {
        ok: false,
        message: `Invalid Excalidraw elements: ${converted.error}`,
        error: 'INVALID_EXCALIDRAW_ELEMENTS',
      }
    }

    try {
      const existing = await readExcalidrawScene(resolved.filePath)
      const before = JSON.stringify(summarizeExcalidrawScene(existing))
      const nextElements = input.replaceExisting === true
        ? converted.elements
        : [...existing.elements, ...converted.elements]
      const nextScene = createEmptyExcalidrawScene({
        elements: nextElements,
        appState: existing.appState,
        files: existing.files,
      })
      await applyScene(resolved.filePath, nextScene, input.open !== false)
      const summary = summarizeExcalidrawScene(nextScene)
      return {
        ok: true,
        message: `Updated sketch “${resolved.filePath}”: now ${summary.elementCount} elements.`,
        data: { filePath: resolved.filePath, ...summary },
        changes: [{
          id: crypto.randomUUID(),
          type: 'file',
          target: resolved.filePath,
          before,
          after: JSON.stringify(summary),
          reversible: true,
          summary: `Update Excalidraw sketch “${resolved.filePath}”`,
        }],
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to update sketch',
        error: 'EXCALIDRAW_UPDATE_FAILED',
      }
    }
  },
}

export const excalidrawTools: AgentTool[] = [
  getExcalidrawStateTool,
  createExcalidrawTool,
  updateExcalidrawElementsTool,
]
