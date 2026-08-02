'use client'

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type MobileSheetMode =
  | 'insert'
  | 'format'
  | 'ai'
  | 'ai-write'
  | 'ai-custom'
  | 'mobile-more'
  | 'image-src'
  | 'image-alt'
  | 'table-align'
  | 'table-more'
  | null

interface MobileEditorMoreSheetProps {
  open: boolean
  mode: MobileSheetMode
  imageSrc: string
  imageAlt: string
  customAiInstruction: string
  onOpenChange: (open: boolean) => void
  onImageSrcChange: (value: string) => void
  onImageAltChange: (value: string) => void
  onCustomAiInstructionChange: (value: string) => void
  onSubmitImageSrc: () => void
  onSubmitImageAlt: () => void
  onSubmitCustomAiInstruction: () => void
  onAction: (action: string) => void
}

function ActionButton({
  label,
  description,
  onClick,
  destructive = false,
}: {
  label: string
  description?: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      className={`w-full rounded-xl border px-3 py-3 text-left ${destructive ? 'border-destructive/30 text-destructive' : 'border-border text-foreground'}`}
      onClick={onClick}
    >
      <span className="block text-sm font-medium">{label}</span>
      {description ? <span className="mt-1 block text-xs text-muted-foreground">{description}</span> : null}
    </button>
  )
}

export function MobileEditorMoreSheet({
  open,
  mode,
  imageSrc,
  imageAlt,
  customAiInstruction,
  onOpenChange,
  onImageSrcChange,
  onImageAltChange,
  onCustomAiInstructionChange,
  onSubmitImageSrc,
  onSubmitImageAlt,
  onSubmitCustomAiInstruction,
  onAction,
}: MobileEditorMoreSheetProps) {
  const titleMap: Record<Exclude<MobileSheetMode, null>, string> = {
    insert: 'Insert',
    format: 'Text formatting',
    ai: 'AI actions',
    'ai-write': 'AI writing',
    'ai-custom': 'Custom AI',
    'mobile-more': 'Tool',
    'image-src': 'Image',
    'image-alt': 'Image',
    'table-align': 'Table alignment',
    'table-more': 'Table',
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80vh]">
        <DrawerHeader>
          <DrawerTitle>{mode ? titleMap[mode] : 'More actions'}</DrawerTitle>
        </DrawerHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-6">
          {mode === 'insert' && (
            <>
              <ActionButton label="Title" description="Heading 2" onClick={() => onAction('insert-heading-2')} />
              <ActionButton label="Bullet list" onClick={() => onAction('insert-bullet-list')} />
              <ActionButton label="Numbered list" onClick={() => onAction('insert-ordered-list')} />
              <ActionButton label="Task list" onClick={() => onAction('insert-task-list')} />
              <ActionButton label="Quote" onClick={() => onAction('insert-blockquote')} />
              <ActionButton label="Code block" onClick={() => onAction('insert-code-block')} />
              <ActionButton label="Divider" onClick={() => onAction('insert-horizontal-rule')} />
              <ActionButton label="Image" description="Local Image" onClick={() => onAction('insert-image')} />
              <ActionButton label="Table" onClick={() => onAction('insert-table')} />
            </>
          )}

          {mode === 'format' && (
            <>
              <ActionButton label="Paragraph" onClick={() => onAction('format-paragraph')} />
              <ActionButton label="Heading 1" onClick={() => onAction('format-heading-1')} />
              <ActionButton label="Heading 2" onClick={() => onAction('format-heading-2')} />
              <ActionButton label="Heading 3" onClick={() => onAction('format-heading-3')} />
              <ActionButton label="Bold" onClick={() => onAction('format-bold')} />
              <ActionButton label="Italic" onClick={() => onAction('format-italic')} />
              <ActionButton label="Highlight" onClick={() => onAction('format-highlight')} />
            </>
          )}

          {mode === 'ai' && (
            <>
              <ActionButton label="Chinese" onClick={() => onAction('ai-polish')} />
              <ActionButton label="Chinese" onClick={() => onAction('ai-concise')} />
              <ActionButton label="Chinese" onClick={() => onAction('ai-expand')} />
            </>
          )}

          {mode === 'ai-write' && (
            <>
              <ActionButton label="Continue writing" description="Continue writing from surrounding context" onClick={() => onAction('ai-continue')} />
              <ActionButton label="Generate section" description="Add a full paragraph at the cursor" onClick={() => onAction('ai-generate-section')} />
              <ActionButton label="Summarize" description="Generate a summary from this note" onClick={() => onAction('ai-generate-summary')} />
              <Textarea
                value={customAiInstruction}
                onChange={(event) => onCustomAiInstructionChange(event.target.value)}
                placeholder="AI ， ："
                rows={3}
                maxRows={8}
              />
              <Button onClick={onSubmitCustomAiInstruction}>Run custom instruction</Button>
            </>
          )}

          {mode === 'ai-custom' && (
            <>
              <Textarea
                value={customAiInstruction}
                onChange={(event) => onCustomAiInstructionChange(event.target.value)}
                placeholder="AI ， ："
                rows={3}
                maxRows={8}
              />
              <Button onClick={onSubmitCustomAiInstruction}>Run custom instruction</Button>
            </>
          )}

          {mode === 'mobile-more' && (
            <>
              <ActionButton label="Text formatting" onClick={() => onAction('open-format-sheet')} />
              <ActionButton label="Find and replace" onClick={() => onAction('open-search-replace')} />
              <ActionButton label="Outline" onClick={() => onAction('toggle-outline')} />
              <ActionButton label="Inline math" onClick={() => onAction('insert-inline-math')} />
              <ActionButton label="Block math" onClick={() => onAction('insert-block-math')} />
              <ActionButton label="Mermaid Diagram" onClick={() => onAction('insert-mermaid')} />
            </>
          )}

          {mode === 'image-src' && (
            <>
              <Input value={imageSrc} onChange={(event) => onImageSrcChange(event.target.value)} placeholder="Image" />
              <Button onClick={onSubmitImageSrc}>Save URL</Button>
            </>
          )}

          {mode === 'image-alt' && (
            <>
              <Input value={imageAlt} onChange={(event) => onImageAltChange(event.target.value)} placeholder="Image" />
              <Button onClick={onSubmitImageAlt}>Save caption</Button>
            </>
          )}

          {mode === 'table-align' && (
            <>
              <ActionButton label="Align left" onClick={() => onAction('align-left')} />
              <ActionButton label="Align center" onClick={() => onAction('align-center')} />
              <ActionButton label="Align right" onClick={() => onAction('align-right')} />
            </>
          )}

          {mode === 'table-more' && (
            <>
              <ActionButton label="Insert row above" onClick={() => onAction('add-row-before')} />
              <ActionButton label="Insert row below" onClick={() => onAction('add-row-after')} />
              <ActionButton label="Insert column left" onClick={() => onAction('add-column-before')} />
              <ActionButton label="Insert column right" onClick={() => onAction('add-column-after')} />
              <ActionButton label="Delete current row" onClick={() => onAction('delete-row')} destructive />
              <ActionButton label="Delete current column" onClick={() => onAction('delete-column')} destructive />
              <ActionButton label="Table" onClick={() => onAction('delete-table')} destructive />
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default MobileEditorMoreSheet
