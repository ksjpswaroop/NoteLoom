'use client'

import { useState, useEffect, useMemo } from 'react'
import katex from 'katex'
import { Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/responsive-dialog'
import { normalizeLatexForKatex } from '@/lib/latex'

interface MathEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (latex: string, type: 'inline' | 'block') => void
  initialLatex?: string
  type: 'inline' | 'block'
  title?: string
}

export function MathEditorDialog({
  open,
  onOpenChange,
  onInsert,
  initialLatex = '',
  type = 'inline',
  title = 'Insert formula',
}: MathEditorDialogProps) {
  const [latex, setLatex] = useState(initialLatex)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLatex(initialLatex)
    }
  }, [open, initialLatex])

  const renderedHtml = useMemo(() => {
    try {
      setError(null)
      return katex.renderToString(normalizeLatexForKatex(latex), {
        throwOnError: false,
        displayMode: type === 'block',
      })
    } catch (e) {
      setError((e as Error).message)
      return `<span class="text-red-500">Invalid LaTeX</span>`
    }
  }, [latex, type])

  const handleInsert = () => {
    if (!latex.trim()) return
    onInsert(latex, type)
    onOpenChange(false)
    setLatex('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleInsert()
    }
    if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sigma className="w-5 h-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div>
            <label className="text-sm font-medium mb-2 block">LaTeX formula</label>
            <Input
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="LaTeX, e.g. \frac{a}{b}"
              className="font-mono"
            />
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Preview</label>
            <div
              className={`min-h-[80px] p-4 rounded-lg border bg-muted/30 overflow-x-auto ${
                type === 'block' ? 'text-center' : ''
              }`}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            <p>Common examples:</p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Fraction: <code>\frac&#123;a&#125;&#123;b&#125;</code></li>
              <li>Superscript: <code>x^2</code></li>
              <li>Subscript: <code>x_n</code></li>
              <li>Square root: <code>\sqrt&#123;x&#125;</code></li>
              <li>Sum: <code>\sum_&#123;i=1&#125;^n</code></li>
              <li>Integral: <code>\int_a^b f(x) dx</code></li>
              <li>Limit: <code>\lim_&#123;x \to \infty&#125;</code></li>
              <li>Greek letters: <code>\alpha, \beta, \pi</code></li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={!latex.trim()}>
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
