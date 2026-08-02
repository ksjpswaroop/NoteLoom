import { DEFAULT_CANVAS_DOCUMENT, type CanvasDocument, type CanvasProjectType } from '@/types/canvas'

const FLOWCHART_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'start', type: 'terminator', position: { x: 180, y: 0 }, data: { label: 'Start' } },
    { id: 'process', type: 'process', position: { x: 160, y: 140 }, data: { label: 'Process step' } },
    { id: 'decision', type: 'decision', position: { x: 180, y: 280 }, data: { label: 'Decision' } },
    { id: 'end', type: 'terminator', position: { x: 180, y: 480 }, data: { label: 'End' } },
  ],
  edges: [
    { id: 'start-process', source: 'start', target: 'process', type: 'smoothstep' },
    { id: 'process-decision', source: 'process', target: 'decision', type: 'smoothstep' },
    { id: 'decision-end', source: 'decision', target: 'end', label: 'Yes', type: 'smoothstep' },
  ],
  viewport: { x: 200, y: 40, zoom: 0.9 },
}

const MINDMAP_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  settings: { ...DEFAULT_CANVAS_DOCUMENT.settings, layoutDirection: 'LR' },
  nodes: [
    { id: 'topic', type: 'process', position: { x: 0, y: 160 }, data: { label: 'Central topic' } },
    { id: 'branch-1', type: 'process', position: { x: 280, y: 40 }, data: { label: 'Branch 1' } },
    { id: 'branch-2', type: 'process', position: { x: 280, y: 160 }, data: { label: 'Branch 2' } },
    { id: 'branch-3', type: 'process', position: { x: 280, y: 280 }, data: { label: 'Branch 3' } },
  ],
  edges: [
    { id: 'topic-branch-1', source: 'topic', target: 'branch-1', type: 'smoothstep' },
    { id: 'topic-branch-2', source: 'topic', target: 'branch-2', type: 'smoothstep' },
    { id: 'topic-branch-3', source: 'topic', target: 'branch-3', type: 'smoothstep' },
  ],
  viewport: { x: 120, y: 80, zoom: 0.9 },
}

const TIMELINE_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  settings: { ...DEFAULT_CANVAS_DOCUMENT.settings, layoutDirection: 'LR' },
  nodes: [
    { id: 'time-1', type: 'terminator', position: { x: 0, y: 160 }, data: { label: 'Stage 1', description: 'Goals and prep' } },
    { id: 'time-2', type: 'terminator', position: { x: 260, y: 160 }, data: { label: 'Stage 2', description: 'Execute and verify' } },
    { id: 'time-3', type: 'terminator', position: { x: 520, y: 160 }, data: { label: 'Stage 3', description: 'Review and deliver' } },
  ],
  edges: [
    { id: 'time-1-2', source: 'time-1', target: 'time-2', type: 'smoothstep' },
    { id: 'time-2-3', source: 'time-2', target: 'time-3', type: 'smoothstep' },
  ],
  viewport: { x: 80, y: 80, zoom: 0.9 },
}

const QUADRANT_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'q1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 220, zIndex: -1, data: { label: 'Important and urgent', color: '#ef4444', childIds: [] } },
    { id: 'q2', type: 'group', position: { x: 330, y: 0 }, width: 300, height: 220, zIndex: -1, data: { label: 'Important, not urgent', color: '#3b82f6', childIds: [] } },
    { id: 'q3', type: 'group', position: { x: 0, y: 250 }, width: 300, height: 220, zIndex: -1, data: { label: 'Urgent, not important', color: '#f59e0b', childIds: [] } },
    { id: 'q4', type: 'group', position: { x: 330, y: 250 }, width: 300, height: 220, zIndex: -1, data: { label: 'Not important, not urgent', color: '#64748b', childIds: [] } },
  ],
  edges: [],
  viewport: { x: 120, y: 60, zoom: 0.9 },
}

const KANBAN_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'todo-column', type: 'group', position: { x: 0, y: 0 }, width: 250, height: 480, zIndex: -1, data: { label: 'To do', color: '#64748b', childIds: ['todo-card'] } },
    { id: 'doing-column', type: 'group', position: { x: 280, y: 0 }, width: 250, height: 480, zIndex: -1, data: { label: 'In progress', color: '#3b82f6', childIds: ['doing-card'] } },
    { id: 'done-column', type: 'group', position: { x: 560, y: 0 }, width: 250, height: 480, zIndex: -1, data: { label: 'Completed', color: '#22c55e', childIds: ['done-card'] } },
    { id: 'todo-card', type: 'todo', position: { x: 30, y: 80 }, data: { label: 'Organize tasks', checked: false } },
    { id: 'doing-card', type: 'todo', position: { x: 310, y: 80 }, data: { label: 'Advance work', checked: false } },
    { id: 'done-card', type: 'todo', position: { x: 590, y: 80 }, data: { label: 'Completed items', checked: true } },
  ],
  edges: [],
  viewport: { x: 80, y: 40, zoom: 0.82 },
}

const SWOT_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'strengths', type: 'note', position: { x: 0, y: 0 }, width: 280, height: 190, data: { label: 'Strengths', description: 'What are we good at?', color: '#22c55e' } },
    { id: 'weaknesses', type: 'note', position: { x: 320, y: 0 }, width: 280, height: 190, data: { label: 'Weaknesses', description: 'What needs improvement?', color: '#f59e0b' } },
    { id: 'opportunities', type: 'note', position: { x: 0, y: 230 }, width: 280, height: 190, data: { label: 'Opportunities', description: 'What external opportunities exist?', color: '#3b82f6' } },
    { id: 'threats', type: 'note', position: { x: 320, y: 230 }, width: 280, height: 190, data: { label: 'Threats', description: 'What external risks exist?', color: '#ef4444' } },
  ],
  edges: [],
  viewport: { x: 160, y: 80, zoom: 0.9 },
}

export function createCanvasDocument(canvasType: CanvasProjectType): CanvasDocument {
  if (canvasType === 'flowchart') return structuredClone(FLOWCHART_TEMPLATE)
  if (canvasType === 'mindmap') return structuredClone(MINDMAP_TEMPLATE)
  if (canvasType === 'timeline') return structuredClone(TIMELINE_TEMPLATE)
  if (canvasType === 'quadrant') return structuredClone(QUADRANT_TEMPLATE)
  if (canvasType === 'kanban') return structuredClone(KANBAN_TEMPLATE)
  if (canvasType === 'swot') return structuredClone(SWOT_TEMPLATE)
  return structuredClone(DEFAULT_CANVAS_DOCUMENT)
}
