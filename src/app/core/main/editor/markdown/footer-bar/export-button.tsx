'use client'

import { Editor } from '@tiptap/react'
import {
  Download,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  Loader2,
  Type,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import useArticleStore from '@/stores/article'
import { toast } from '@/hooks/use-toast'
import {
  exportMarkdownSource,
  getMarkdownExportBaseName,
  type MarkdownExportFormat,
} from '../markdown-export'

interface ExportButtonProps {
  editor: Editor
  markdown?: string
}

const EXPORT_OPTIONS: Array<{
  format: MarkdownExportFormat
  label: string
  icon: typeof FileText
}> = [
  { format: 'markdown', label: 'Markdown (.md)', icon: FileText },
  { format: 'html', label: 'HTML (.html)', icon: FileCode },
  { format: 'text', label: 'Plain text (.txt)', icon: Type },
  { format: 'json', label: 'JSON (.json)', icon: FileJson },
  { format: 'docx', label: 'Word (.docx)', icon: FileType },
  { format: 'pdf', label: 'PDF (.pdf)', icon: FileText },
  { format: 'png', label: 'Image (.png)', icon: FileImage },
]

function successToastTitle(format: MarkdownExportFormat) {
  if (format === 'pdf') return 'Opened PDF print window'
  return 'Export succeeded'
}

export function ExportButton({ editor, markdown }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [exporting, setExporting] = useState<MarkdownExportFormat | null>(null)

  const showPdfExportStart = useCallback(() => {
    toast({
      title: 'Preparing PDF',
      description: 'In the system print dialog, choose “Save as PDF”.',
    })
  }, [])

  const runExport = useCallback(async (format: MarkdownExportFormat) => {
    try {
      setExporting(format)

      const activeFilePath = useArticleStore.getState().activeFilePath
      const exported = await exportMarkdownSource(
        format,
        {
          baseName: getMarkdownExportBaseName(activeFilePath),
          markdown: () => markdown ?? editor.getMarkdown(),
          json: () => editor.getJSON(),
          text: () => editor.getText(),
          sourcePath: activeFilePath,
        },
        { onPdfRenderStart: showPdfExportStart },
      )

      if (exported) {
        toast({ title: successToastTitle(format) })
      }
    } catch (error) {
      console.error(`${format} export failed:`, error)
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setExporting(null)
      setIsOpen(false)
    }
  }, [editor, markdown, showPdfExportStart])

  const handleExport = useCallback((format: MarkdownExportFormat) => {
    void runExport(format)
  }, [runExport])

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Export"
          aria-label="Export"
          className="p-1 rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-0 disabled:opacity-50"
          disabled={exporting !== null}
        >
          {exporting ? (
            <Loader2 className="size-3 animate-spin text-[#3b82f6]" />
          ) : (
            <Download className="size-3" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
      >
        {EXPORT_OPTIONS.flatMap((option, index) => {
          const Icon = option.icon
          const item = (
            <DropdownMenuItem
              key={option.format}
              disabled={exporting !== null}
              onSelect={(event) => {
                event.preventDefault()
                handleExport(option.format)
              }}
            >
              {exporting === option.format ? (
                <Loader2 size={12} className="animate-spin text-[#3b82f6]" />
              ) : (
                <Icon size={12} />
              )}
              <span>{option.label}</span>
            </DropdownMenuItem>
          )

          if (index === 4) {
            return [<DropdownMenuSeparator key="binary-formats" />, item]
          }

          return [item]
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ExportButton
