'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, ReactNodeViewProps } from '@tiptap/react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import mermaid from 'mermaid'
import { Check, Code, Download, FileCode, FileImage, Loader2 } from 'lucide-react'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import {
  ensureMermaidInitialized,
  exportMermaidDiagram,
  type MermaidExportFormat,
} from '@/lib/mermaid/export-diagram'

ensureMermaidInitialized()

// Diagram type configuration with icons
const DIAGRAM_TYPES = [
  { type: 'flowchart', labelKey: 'flowchart', icon: 'GitBranch', alias: ['flowchart', 'flowchart-v2', 'graph', 'td', 'graph TD', 'graph BT', 'graph LR', 'graph RL'] },
  { type: 'mindmap', labelKey: 'mindmap', icon: 'BrainCircuit', alias: ['mindmap'] },
  { type: 'sequence', labelKey: 'sequence', icon: 'GitCommit', alias: ['sequence', 'sequenceDiagram'] },
  { type: 'classDiagram', labelKey: 'classDiagram', icon: 'Layers', alias: ['class', 'classDiagram'] },
  { type: 'stateDiagram', labelKey: 'stateDiagram', icon: 'Activity', alias: ['state', 'stateDiagram', 'stateDiagram-v2'] },
  { type: 'er', labelKey: 'erDiagram', icon: 'Database', alias: ['er', 'erDiagram'] },
  { type: 'timeline', labelKey: 'timeline', icon: 'Clock', alias: ['timeline'] },
  { type: 'gantt', labelKey: 'gantt', icon: 'Calendar', alias: ['gantt'] },
  { type: 'pie', labelKey: 'pie', icon: 'PieChart', alias: ['pie'] },
  { type: 'journey', labelKey: 'journey', icon: 'Map', alias: ['journey', 'gitGraph'] },
]

// Detect diagram type from code
function detectDiagramType(code: string): string {
  const trimmed = code.trim()
  for (const config of DIAGRAM_TYPES) {
    // Check first line for type specification
    const firstLine = trimmed.split('\n')[0]?.toLowerCase() || ''
    if (config.alias?.some((alias: string) => firstLine.startsWith(alias) || firstLine === alias)) {
      return config.type
    }
  }
  return 'flowchart'
}

// Mermaid Diagram View Component
function MermaidDiagramView({ node, updateAttributes }: ReactNodeViewProps) {
  const t = useTranslations('editor.mermaid')

  const [isEditing, setIsEditing] = useState(false)
  const [code, setCode] = useState(node.attrs.code || '')
  const [diagramType, setDiagramType] = useState(node.attrs.type || 'flowchart')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<MermaidExportFormat | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renderRequestRef = useRef(0)

  const renderDiagram = useCallback(async () => {
    if (!code.trim()) {
      setSvg('')
      setError(null)
      return
    }

    const requestId = ++renderRequestRef.current
    setError(null)
    ensureMermaidInitialized()

    try {
      await mermaid.parse(code)
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const { svg: renderedSvg } = await mermaid.render(id, code)
      if (requestId !== renderRequestRef.current) return
      setSvg(renderedSvg)
    } catch (err) {
      if (requestId !== renderRequestRef.current) return
      const message = err instanceof Error ? err.message : t('renderError')
      setError(message)
      setSvg('')
    }
  }, [code, t])

  useEffect(() => {
    void renderDiagram()
  }, [renderDiagram])

  useEffect(() => {
    const detected = detectDiagramType(code)
    if (detected !== diagramType) {
      setDiagramType(detected)
    }
  }, [code, diagramType])

  useEffect(() => {
    if (!isEditing) {
      void renderDiagram()
    }
  }, [isEditing, renderDiagram])

  const handleUpdate = () => {
    updateAttributes({ code, type: diagramType })
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleUpdate()
    }
    if (e.key === 'Escape') {
      setCode(node.attrs.code || '')
      setIsEditing(false)
    }
  }

  const handleExport = async (format: MermaidExportFormat) => {
    if (!code.trim() || exporting) return
    setExporting(format)
    try {
      const exported = await exportMermaidDiagram(code, format, `mermaid-${diagramType}`)
      if (exported) {
        toast({ title: t(format === 'png' ? 'exportPngSuccess' : 'exportSvgSuccess') })
      }
    } catch (err) {
      toast({
        title: t('exportFailed'),
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
    }
  }

  const getLabel = (key: string) => {
    return t(`diagramTypes.${key}`)
  }

  return (
    <NodeViewWrapper className="mermaid-diagram-wrapper my-4">
      {/* Preview Mode */}
      {!isEditing && (
        <div
          className="mermaid-preview relative rounded-lg border border-border bg-card overflow-x-auto cursor-pointer"
          onClick={() => setIsEditing(true)}
        >
          {error ? (
            <div className="p-4 text-red-500 text-sm">
              <p className="font-medium">{t('renderError')}</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-muted-foreground">{t('clickToEdit')}</p>
            </div>
          ) : svg ? (
            <div
              ref={containerRef}
              className="mermaid-svg p-4 flex justify-center [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              <span>{t('clickToAdd')}</span>
            </div>
          )}

          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100 [.mermaid-preview:hover_&]:opacity-100">
            {svg && !error && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="size-8 bg-background/90 shadow-sm"
                    disabled={exporting !== null}
                    onClick={(e) => e.stopPropagation()}
                    title={t('export')}
                  >
                    {exporting ? (
                      <Loader2 className="size-4 animate-spin text-[#3b82f6]" />
                    ) : (
                      <Download className="size-4 text-[#3b82f6]" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    disabled={exporting !== null}
                    onSelect={(event) => {
                      event.preventDefault()
                      void handleExport('png')
                    }}
                  >
                    {exporting === 'png' ? (
                      <Loader2 className="size-4 animate-spin text-[#3b82f6]" />
                    ) : (
                      <FileImage className="size-4 text-[#3b82f6]" />
                    )}
                    <span>{t('exportPng')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exporting !== null}
                    onSelect={(event) => {
                      event.preventDefault()
                      void handleExport('svg')
                    }}
                  >
                    {exporting === 'svg' ? (
                      <Loader2 className="size-4 animate-spin text-[#3b82f6]" />
                    ) : (
                      <FileCode className="size-4 text-[#3b82f6]" />
                    )}
                    <span>{t('exportSvg')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="secondary"
              size="icon"
              className="size-8 bg-background/90 shadow-sm"
              onClick={(e) => {
                e.stopPropagation()
                setIsEditing(true)
              }}
              title={t('clickToEdit')}
            >
              <Code className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Edit Mode */}
      {isEditing && (
        <div className="mermaid-editor rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 p-2 border-b bg-muted/50">
            <ResponsiveSelect
              title={t('title')}
              value={diagramType}
              onValueChange={setDiagramType}
              className="h-8 w-35 text-xs"
              options={DIAGRAM_TYPES.map(item => ({
                value: item.type,
                label: getLabel(item.type),
              }))}
            />

            <div className="flex-1" />

            {code.trim() && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={exporting !== null}
                    title={t('export')}
                  >
                    {exporting ? (
                      <Loader2 className="size-4 animate-spin text-[#3b82f6]" />
                    ) : (
                      <Download className="size-4 text-[#3b82f6]" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={exporting !== null}
                    onSelect={(event) => {
                      event.preventDefault()
                      void handleExport('png')
                    }}
                  >
                    <FileImage className="size-4 text-[#3b82f6]" />
                    <span>{t('exportPng')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exporting !== null}
                    onSelect={(event) => {
                      event.preventDefault()
                      void handleExport('svg')
                    }}
                  >
                    <FileCode className="size-4 text-[#3b82f6]" />
                    <span>{t('exportSvg')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={handleUpdate}
              title={t('done')}
            >
              <Check className="size-4" />
            </Button>
          </div>

          <Textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={8}
            maxRows={20}
            className="min-h-48 rounded-none border-0 font-mono shadow-none focus-visible:ring-0"
            placeholder={t('placeholder')}
            spellCheck={false}
          />

          {error && (
            <div className="px-3 py-2 text-xs text-red-500 bg-red-50 border-t">
              {error}
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  )
}

// Mermaid Code Block Extension
export const MermaidDiagram = Node.create({
  name: 'mermaidDiagram',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: '',
      },
      type: {
        default: 'flowchart',
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="mermaid-diagram"]' },
      { tag: 'pre[data-mermaid]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid-diagram' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidDiagramView)
  },

  markdownTokenName: 'mermaid',

  markdownTokenizer: {
    name: 'mermaid',
    level: 'block',
    start: (src: string) => {
      const match = src.match(/^```mermaid\r?\n/)
      return match ? (match.index ?? -1) : -1
    },
    tokenize: (src, tokens, lexer) => {
      const match = /^```mermaid\r?\n([\s\S]*?)\r?\n```/.exec(src)
      if (!match) return undefined

      const code = match[1]
      const type = detectDiagramType(code)

      return {
        type: 'mermaid',
        raw: match[0],
        content: code,
        attrs: { type },
        tokens: lexer.blockTokens(match[1]),
      }
    },
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return `\n\`\`\`mermaid\n${node.attrs?.code ?? ''}\n\`\`\`\n`
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    const code = token.content || ''
    const type = detectDiagramType(code)
    return {
      type: 'mermaidDiagram',
      attrs: { code, type },
    }
  },
})

export default MermaidDiagram
