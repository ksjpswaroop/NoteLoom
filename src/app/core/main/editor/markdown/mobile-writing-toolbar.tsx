'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CheckSquare,
  ChevronLeft,
  Code2,
  Database,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  GitBranch,
  GitCommit,
  Calendar,
  Layers,
  List,
  ListOrdered,
  Map,
  Minus,
  Pilcrow,
  PieChart,
  Plus,
  Quote,
  Redo2,
  Sigma,
  Sparkles,
  Table2,
  Undo2,
  Workflow,
  BrainCircuit,
} from 'lucide-react'
import { useState, type MouseEvent, type PointerEvent } from 'react'

type MobileWritingToolbarMenu = 'root' | 'ai' | 'title' | 'list' | 'block' | 'math' | 'diagram'

type MobileWritingToolbarAction =
  | 'insert-heading-2'
  | 'insert-task-list'
  | 'insert-blockquote'
  | 'insert-bullet-list'
  | 'insert-ordered-list'
  | 'insert-code-block'
  | 'insert-horizontal-rule'
  | 'insert-image'
  | 'insert-table'
  | 'format-paragraph'
  | 'format-heading-1'
  | 'format-heading-2'
  | 'format-heading-3'
  | 'format-bold'
  | 'format-italic'
  | 'format-highlight'
  | 'ai-continue'
  | 'ai-generate-section'
  | 'ai-generate-summary'
  | 'open-ai-custom'
  | 'open-search-replace'
  | 'toggle-outline'
  | 'undo'
  | 'redo'
  | 'insert-inline-math'
  | 'insert-block-math'
  | 'insert-mermaid-flowchart'
  | 'insert-mermaid-mindmap'
  | 'insert-mermaid-sequence'
  | 'insert-mermaid-gantt'
  | 'insert-mermaid-class'
  | 'insert-mermaid-state'
  | 'insert-mermaid-pie'
  | 'insert-mermaid-er'
  | 'insert-mermaid-journey'
  | 'insert-mermaid-timeline'

interface MobileWritingToolbarProps {
  activeActions?: string[]
  showUndoRedo?: boolean
  onAction: (action: MobileWritingToolbarAction) => void
}

type ToolbarItem =
  | {
      kind: 'menu'
      menu: Exclude<MobileWritingToolbarMenu, 'root'>
      label: string
      icon: typeof Plus
    }
  | {
      kind: 'action'
      action: MobileWritingToolbarAction
      label: string
      icon: typeof Plus
    }

const ROOT_ITEMS: ToolbarItem[] = [
  { kind: 'menu', menu: 'ai', label: 'AI', icon: Sparkles },
  { kind: 'menu', menu: 'title', label: 'Title', icon: Heading2 },
  { kind: 'menu', menu: 'list', label: 'List', icon: List },
  { kind: 'menu', menu: 'block', label: 'Block', icon: Quote },
  { kind: 'menu', menu: 'math', label: 'Math', icon: Sigma },
  { kind: 'menu', menu: 'diagram', label: 'Diagram', icon: Workflow },
]

const MENU_LABELS: Record<Exclude<MobileWritingToolbarMenu, 'root'>, string> = {
  ai: 'AI',
  title: 'Title',
  list: 'List',
  block: 'Block',
  math: 'Math',
  diagram: 'Diagram',
}

const SECONDARY_ITEMS: Record<Exclude<MobileWritingToolbarMenu, 'root'>, ToolbarItem[]> = {
  ai: [
    { kind: 'action', action: 'ai-continue', label: 'Generate section', icon: Sparkles },
    { kind: 'action', action: 'ai-generate-section', label: 'Generate section', icon: Sparkles },
    { kind: 'action', action: 'ai-generate-summary', label: 'Summarize', icon: Sparkles },
    { kind: 'action', action: 'open-ai-custom', label: 'Custom', icon: Sparkles },
  ],
  title: [
    { kind: 'action', action: 'format-paragraph', label: 'Heading 1', icon: Pilcrow },
    { kind: 'action', action: 'format-heading-1', label: 'Heading 1', icon: Heading1 },
    { kind: 'action', action: 'format-heading-2', label: 'Heading 2', icon: Heading2 },
    { kind: 'action', action: 'format-heading-3', label: 'Heading 3', icon: Heading3 },
  ],
  list: [
    { kind: 'action', action: 'insert-bullet-list', label: 'Bullet list', icon: List },
    { kind: 'action', action: 'insert-ordered-list', label: 'Numbered list', icon: ListOrdered },
    { kind: 'action', action: 'insert-task-list', label: 'Task list', icon: CheckSquare },
  ],
  block: [
    { kind: 'action', action: 'insert-blockquote', label: 'Task list', icon: Quote },
    { kind: 'action', action: 'insert-code-block', label: 'Code block', icon: Code2 },
    { kind: 'action', action: 'insert-horizontal-rule', label: 'Divider', icon: Minus },
    { kind: 'action', action: 'insert-image', label: 'Image', icon: ImagePlus },
    { kind: 'action', action: 'insert-table', label: 'Inline math', icon: Table2 },
  ],
  math: [
    { kind: 'action', action: 'insert-inline-math', label: 'Inline math', icon: Sigma },
    { kind: 'action', action: 'insert-block-math', label: 'Block math', icon: Sigma },
  ],
  diagram: [
    { kind: 'action', action: 'insert-mermaid-flowchart', label: 'Flowchart', icon: GitBranch },
    { kind: 'action', action: 'insert-mermaid-mindmap', label: 'Mind map', icon: BrainCircuit },
    { kind: 'action', action: 'insert-mermaid-sequence', label: 'Sequence diagram', icon: GitCommit },
    { kind: 'action', action: 'insert-mermaid-gantt', label: 'Gantt chart', icon: Calendar },
    { kind: 'action', action: 'insert-mermaid-class', label: 'Class diagram', icon: Layers },
    { kind: 'action', action: 'insert-mermaid-state', label: 'State diagram', icon: Workflow },
    { kind: 'action', action: 'insert-mermaid-pie', label: 'Pie chart', icon: PieChart },
    { kind: 'action', action: 'insert-mermaid-er', label: 'ER diagram', icon: Database },
    { kind: 'action', action: 'insert-mermaid-journey', label: 'User journey', icon: Map },
    { kind: 'action', action: 'insert-mermaid-timeline', label: 'Timeline', icon: Calendar },
  ],
}

export function MobileWritingToolbar({
  activeActions = [],
  showUndoRedo = false,
  onAction,
}: MobileWritingToolbarProps) {
  const [activeMenu, setActiveMenu] = useState<MobileWritingToolbarMenu>('root')
  const items = activeMenu === 'root'
    ? [
        ...(showUndoRedo
          ? [
              { kind: 'action', action: 'undo', label: 'Undo', icon: Undo2 },
              { kind: 'action', action: 'redo', label: 'Back to menu', icon: Redo2 },
            ] satisfies ToolbarItem[]
          : []),
        ...ROOT_ITEMS,
      ]
    : SECONDARY_ITEMS[activeMenu]

  const preventFocusSteal = (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
  }

  return (
    <div className="mobile-writing-toolbar border-t border-border bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div key={activeMenu} className="mobile-writing-toolbar-track flex items-center gap-1 overflow-x-auto px-2 scrollbar-hide">
        {activeMenu !== 'root' && (
          <Button
            type="button"
            aria-label="Back to menu"
            title="Back to menu"
            variant="default"
            size="sm"
            className="h-10 min-w-10 shrink-0 rounded-full px-3 text-xs"
            onPointerDown={preventFocusSteal}
            onMouseDown={preventFocusSteal}
            onClick={() => setActiveMenu('root')}
          >
            <ChevronLeft className="size-4" />
            <span>{MENU_LABELS[activeMenu]}</span>
          </Button>
        )}

        {items.map((item) => {
          const Icon = item.icon
          const isActive = item.kind === 'action' && activeActions.includes(item.action)

          return (
            <Button
              key={item.kind === 'menu' ? item.menu : item.action}
              type="button"
              aria-label={item.label}
              title={item.label}
              variant="ghost"
              size="sm"
              className={cn(
                'h-10 min-w-10 shrink-0 rounded-full px-3 text-xs',
                'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                isActive && 'bg-muted text-foreground',
              )}
              onPointerDown={preventFocusSteal}
              onMouseDown={preventFocusSteal}
              onClick={() => {
                if (item.kind === 'menu') {
                  setActiveMenu(item.menu)
                  return
                }

                onAction(item.action)
                setActiveMenu('root')
              }}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export default MobileWritingToolbar
