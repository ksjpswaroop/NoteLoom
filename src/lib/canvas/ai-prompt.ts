export type CanvasAiScope = 'append' | 'replace' | 'selection'

export type CanvasAiPreset =
  | 'flowchart'
  | 'architecture'
  | 'sequence'
  | 'mindmap'
  | 'orgChart'
  | 'classDiagram'
  | 'timeline'
  | 'stateDiagram'
  | 'erDiagram'

export const CANVAS_AI_PRESETS: readonly CanvasAiPreset[] = [
  'mindmap',
  'flowchart',
  'architecture',
  'sequence',
  'orgChart',
  'classDiagram',
  'timeline',
  'stateDiagram',
  'erDiagram',
] as const

const DIAGRAM_KIND_HINT: Record<CanvasAiPreset, string> = {
  mindmap: 'Use diagramKind="mindmap". One central root node, short branch labels, tree edges only (no cycles). Prefer process nodes.',
  flowchart: 'Use diagramKind="flowchart". Use terminator for start/end, decision only for branches, process for steps.',
  architecture: 'Use diagramKind="architecture". Group related services vertically or in layers with clear dependency edges.',
  sequence: 'Use diagramKind="sequence". Left-to-right participants or steps with labeled interaction edges.',
  orgChart: 'Use diagramKind="orgChart". Root at the top, reporting lines downward, one parent per role when possible.',
  classDiagram: 'Use diagramKind="classDiagram". Entities as process/text nodes; association edges with labels such as extends or uses.',
  timeline: 'Use diagramKind="timeline". Stages left-to-right with short labels; connect consecutive stages only.',
  stateDiagram: 'Use diagramKind="stateDiagram". States as process nodes, transitions as labeled edges; use terminator for start/end when helpful.',
  erDiagram: 'Use diagramKind="erDiagram". Entities as process or database nodes; relationship edges with cardinality labels (1, N, etc.).',
}

export function buildCanvasAiPrompt(options: {
  description: string
  scope: CanvasAiScope
  scopePrompt: string
  preset?: CanvasAiPreset | null
  presetPrompt?: string
  baseInstruction: string
}): string {
  const description = options.description.trim()
  const presetLine = options.preset && options.presetPrompt
    ? `${options.presetPrompt.trim()}.`
    : ''
  const kindHint = options.preset ? DIAGRAM_KIND_HINT[options.preset] : ''
  const body = [options.scopePrompt.trim(), presetLine, description]
    .filter(Boolean)
    .join(' ')

  return [
    options.baseInstruction.trim(),
    body,
    kindHint,
    'Call canvas_create_diagram (or canvas_apply_operations for selection edits). Show an operation preview and wait for confirmation before applying.',
  ].filter(Boolean).join('\n')
}
