import emitter from '@/lib/emitter'
import { applyCanvasOperations } from '@/lib/canvas/operations'
import type { CanvasDocument } from '@/types/canvas'
import type { AgentTool, AgentToolExecutionContext, AgentToolResult } from '../types'
import { FLOWCHART_NODE_TYPES } from '@/lib/canvas/shapes'

const CANVAS_NODE_TYPES = [
  ...FLOWCHART_NODE_TYPES,
  'text',
] as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateCanvasOperations(document: CanvasDocument, rawOperations: unknown[]) {
  const nodeIds = new Set(document.nodes.map(node => node.id))
  const edgeIds = new Set(document.edges.map(edge => edge.id))

  for (const [index, rawOperation] of rawOperations.entries()) {
    const operation = asRecord(rawOperation)
    const type = asNonEmptyString(operation.type)
    const item = `operations[${index}]`

    if (type === 'clear') {
      nodeIds.clear()
      edgeIds.clear()
      continue
    }

    if (type === 'add_node') {
      const id = asNonEmptyString(operation.id)
      const nodeType = asNonEmptyString(operation.nodeType)
      const label = asNonEmptyString(operation.label)
      if (!id || !nodeType || !label || !isFiniteNumber(operation.x) || !isFiniteNumber(operation.y)) {
        return `${item} add_node requires non-empty id, nodeType, label, and finite x, y.`
      }
      if (!CANVAS_NODE_TYPES.includes(nodeType as typeof CANVAS_NODE_TYPES[number])) {
        return `${item}.nodeType must be one of ${CANVAS_NODE_TYPES.join(', ')}.`
      }
      if (nodeIds.has(id)) {
        return `${item}.id="${id}" already exists; new nodes must use unique, stable IDs.`
      }
      nodeIds.add(id)
      continue
    }

    if (type === 'update_node') {
      const id = asNonEmptyString(operation.id)
      if (!id || !nodeIds.has(id)) {
        return `${item} must provide a node id that actually exists on the current canvas.`
      }
      const hasUpdate = typeof operation.label === 'string'
        || typeof operation.description === 'string'
        || isFiniteNumber(operation.x)
        || isFiniteNumber(operation.y)
      if (!hasUpdate) {
        return `${item} must provide at least one of label, description, x, y to update.`
      }
      continue
    }

    if (type === 'delete_node') {
      const id = asNonEmptyString(operation.id)
      if (!id || !nodeIds.has(id)) {
        return `${item} must provide a node id that actually exists on the current canvas.`
      }
      nodeIds.delete(id)
      continue
    }

    if (type === 'add_edge') {
      const id = asNonEmptyString(operation.id)
      const source = asNonEmptyString(operation.source)
      const target = asNonEmptyString(operation.target)
      if (!id || !source || !target) {
        return `${item} add_edge requires non-empty id, source, and target.`
      }
      if (!nodeIds.has(source) || !nodeIds.has(target)) {
        return `${item} source and target must reference node IDs that exist on the current canvas or were added earlier in this batch.`
      }
      if (source === target) {
        return `${item} cannot connect a node to itself.`
      }
      if (edgeIds.has(id)) {
        return `${item}.id="${id}" already exists; new edges must use unique, stable IDs.`
      }
      edgeIds.add(id)
      continue
    }

    if (type === 'delete_edge') {
      const id = asNonEmptyString(operation.id)
      if (!id || !edgeIds.has(id)) {
        return `${item} must provide an edge id that actually exists on the current canvas.`
      }
      edgeIds.delete(id)
      continue
    }

    return `${item}.type is not a supported canvas operation.`
  }

  return null
}

async function getActiveCanvas(contextCanvasId?: string) {
  const { default: useCanvasStore } = await import('@/stores/canvas')
  const store = useCanvasStore.getState()
  const canvasId = contextCanvasId || store.activeCanvasId || ''
  const document = canvasId ? store.documents[canvasId] : undefined
  const project = store.projects.find(item => item.id === canvasId)
  return { store, canvasId, document, project }
}

function summarizeDocument(document: CanvasDocument) {
  return {
    settings: document.settings,
    viewport: document.viewport,
    nodes: document.nodes.map(node => ({
      id: node.id,
      type: node.type,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      label: node.data.label || '',
      description: node.data.description || '',
    })),
    edges: document.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label || '',
    })),
  }
}

async function executeCanvasOperations(
  operations: unknown[],
  context: AgentToolExecutionContext
): Promise<AgentToolResult> {
  const { store, canvasId, document, project } = await getActiveCanvas(context.context.activeCanvasId)
  if (!canvasId || !document) {
    return { ok: false, message: 'No canvas is currently open.', error: 'NO_ACTIVE_CANVAS' }
  }
  if (operations.length === 0) {
    return { ok: false, message: 'No executable canvas operations provided.', error: 'EMPTY_OPERATIONS' }
  }
  const validationError = validateCanvasOperations(document, operations)
  if (validationError) {
    return {
      ok: false,
      message: `Invalid canvas operation arguments; batch not applied: ${validationError}`,
      error: 'INVALID_CANVAS_OPERATIONS',
    }
  }

  const before = JSON.stringify(summarizeDocument(document))
  const result = applyCanvasOperations(document, operations)
  if (result.applied !== operations.length) {
    return {
      ok: false,
      message: 'Canvas operations could not be fully applied; nothing was written.',
      error: 'INCOMPLETE_CANVAS_OPERATIONS',
    }
  }
  store.updateDocument(canvasId, result.document)
  emitter.emit('canvas-document-replace', { canvasId, document: result.document })
  requestAnimationFrame(() => {
    emitter.emit('canvas-auto-layout', { recordHistory: false })
  })

  return {
    ok: true,
    message: `Applied ${result.applied} changes on canvas “${project?.title || canvasId}”.`,
    data: summarizeDocument(result.document),
    changes: [{
      id: crypto.randomUUID(),
      type: 'canvas',
      target: canvasId,
      before,
      after: JSON.stringify(summarizeDocument(result.document)),
      reversible: true,
      summary: `Edit canvas “${project?.title || canvasId}”`,
    }],
  }
}

const getCanvasStateTool: AgentTool = {
  name: 'canvas_get_state',
  title: 'Read current canvas',
  description: 'Read the native visual canvas currently open in NoteGen, including nodes, edges, positions, and settings. Use only when the user wants to inspect or operate on the current canvas; general questions about diagrams, nodes, or edges do not require reading the canvas.',
  category: 'canvas',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  execute: async (_input, context): Promise<AgentToolResult> => {
    const { canvasId, document, project } = await getActiveCanvas(context.context.activeCanvasId)
    if (!canvasId || !document) {
      return { ok: false, message: 'No canvas is currently open.', error: 'NO_ACTIVE_CANVAS' }
    }
    return {
      ok: true,
      message: `Read canvas “${project?.title || canvasId}”: ${document.nodes.length} nodes, ${document.edges.length} edges.`,
      data: { canvasId, title: project?.title || '', ...summarizeDocument(document) },
    }
  },
}

const createCanvasDiagramTool: AgentTool = {
  name: 'canvas_create_diagram',
  title: 'Create a complete canvas diagram',
  description: 'Create a complete diagram of named nodes and edges on the current native canvas in one call. Prefer this when building a new flowchart, mind map, or relationship diagram; do not split into operations that omit names or endpoints. Each node needs a unique ID, type, visible name, and coordinates; each edge must reference those node IDs exactly via source and target.',
  category: 'canvas',
  risk: 'editor-write',
  inputSchema: {
    type: 'object',
    properties: {
      replaceExisting: {
        type: 'boolean',
        description: 'When true, clear the current canvas first; when false, keep existing content and append the diagram.',
      },
      nodes: {
        type: 'array',
        description: 'All nodes in the diagram. IDs must be unique in this call and referenced exactly by edges.',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique, stable node ID.' },
            nodeType: {
              type: 'string',
              enum: [...CANVAS_NODE_TYPES],
              description: 'Node shape. Pick a standard flowchart shape by meaning, for example process for steps, decision for branching, terminator for start/end, input-output for I/O, document/multi-document for documents, predefined-process for subprocesses, manual-input for manual input, preparation for preparation, delay for delay, display for display, connector/off-page-connector for connectors, internal-storage/database/stored-data for data storage, text for plain text.',
            },
            label: { type: 'string', description: 'Non-empty name shown on the node.' },
            description: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['id', 'nodeType', 'label', 'x', 'y'],
          additionalProperties: false,
        },
      },
      edges: {
        type: 'array',
        description: 'All edges in the diagram. source and target must reference IDs from nodes exactly as given.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique, stable edge ID.' },
            source: { type: 'string', description: 'Start node ID.' },
            target: { type: 'string', description: 'End node ID.' },
            label: { type: 'string', description: 'Visible edge label such as a branch condition.' },
          },
          required: ['id', 'source', 'target'],
          additionalProperties: false,
        },
      },
    },
    required: ['replaceExisting', 'nodes', 'edges'],
    additionalProperties: false,
  },
  execute: async (input, context): Promise<AgentToolResult> => {
    const nodes = Array.isArray(input.nodes) ? input.nodes : []
    const edges = Array.isArray(input.edges) ? input.edges : []
    const operations: unknown[] = [
      ...(input.replaceExisting === true ? [{ type: 'clear' }] : []),
      ...nodes.map(node => ({ type: 'add_node', ...asRecord(node) })),
      ...edges.map(edge => ({ type: 'add_edge', ...asRecord(edge) })),
    ]
    return executeCanvasOperations(operations, context)
  },
}

const applyCanvasOperationsTool: AgentTool = {
  name: 'canvas_apply_operations',
  title: 'Edit current canvas',
  description: 'Incrementally edit the native visual canvas currently open in NoteGen—for example update, move, or delete existing nodes and edges. To create a full diagram with many new nodes and edges, use canvas_create_diagram instead. All operations are validated as a batch first; nothing is written if any argument is missing.',
  category: 'canvas',
  risk: 'editor-write',
  inputSchema: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description: 'Atomic canvas edits applied in order. Add nodes first, then edges using the same stable node IDs; if any item is invalid the whole batch is skipped.',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge', 'clear'],
              description: 'Operation type. Required fields per type come from the tool description and runtime validation.',
            },
            id: { type: 'string', description: 'Stable ID for a node or edge. Required except for clear.' },
            nodeType: {
              type: 'string',
              enum: [...CANVAS_NODE_TYPES],
              description: 'Node shape for add_node.',
            },
            label: { type: 'string' },
            description: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            source: { type: 'string', description: 'Start node ID for add_edge.' },
            target: { type: 'string', description: 'End node ID for add_edge.' },
          },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    required: ['operations'],
    additionalProperties: false,
  },
  execute: async (input, context): Promise<AgentToolResult> => {
    const operations = Array.isArray(input.operations) ? input.operations : []
    return executeCanvasOperations(operations, context)
  },
}

export const canvasTools: AgentTool[] = [
  getCanvasStateTool,
  createCanvasDiagramTool,
  applyCanvasOperationsTool,
]
