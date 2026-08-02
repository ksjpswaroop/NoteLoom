'use client'

import { useState, useEffect } from 'react'
import { Editor } from '@tiptap/react'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
} from '@/components/responsive-dialog'
import { Button } from '@/components/ui/button'
import { pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import emitter from '@/lib/emitter'

interface ConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeFilePath: string | null
  editor: Editor
  onResolved: () => void
}

// diff
function computeDiff(oldText: string, newText: string): { type: 'equal' | 'add' | 'remove', text: string }[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: { type: 'equal' | 'add' | 'remove', text: string }[] = []

  //
  const maxLen = Math.max(oldLines.length, newLines.length)
  let oldIdx = 0
  let newIdx = 0

  while (oldIdx < maxLen || newIdx < maxLen) {
    const oldLine = oldLines[oldIdx]
    const newLine = newLines[newIdx]

    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        result.push({ type: 'equal', text: oldLine })
      }
      oldIdx++
      newIdx++
    } else if (oldLine === undefined) {
      //
      if (newLine !== undefined) {
        result.push({ type: 'add', text: newLine })
      }
      newIdx++
    } else if (newLine === undefined) {
      //
      result.push({ type: 'remove', text: oldLine })
      oldIdx++
    } else {
      // ，
      result.push({ type: 'remove', text: oldLine })
      result.push({ type: 'add', text: newLine })
      oldIdx++
      newIdx++
    }
  }

  return result
}

export function ConflictDialog({
  open,
  onOpenChange,
  activeFilePath,
  editor,
  onResolved,
}: ConflictDialogProps) {
  const [localContent, setLocalContent] = useState('')
  const [remoteContent, setRemoteContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [diff, setDiff] = useState<{ type: 'equal' | 'add' | 'remove', text: string }[]>([])

  // ，
  useEffect(() => {
    if (!open || !activeFilePath) return

    const fetchContents = async () => {
      try {
        //
        const remote = await pullRemoteFile(activeFilePath)
        setRemoteContent(remote)

        // （）
        const local = editor.getMarkdown()
        setLocalContent(local)

        // diff
        const diffResult = computeDiff(local, remote)
        setDiff(diffResult)
      } catch (error) {
        console.error('Failed to fetch contents for conflict:', error)
      }
    }

    fetchContents()
  }, [open, activeFilePath, editor])

  const handleKeepLocal = async () => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      // ，
      await updateFileSyncTime(activeFilePath)
      //
      emitter.emit('sync-pulled', { path: activeFilePath })
      onResolved()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to keep local:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeepRemote = async () => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      //
      await saveLocalFile(activeFilePath, remoteContent)
      editor.commands.setContent(remoteContent, { contentType: 'markdown' })
      await updateFileSyncTime(activeFilePath)
      emitter.emit('sync-pulled', { path: activeFilePath })
      onResolved()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to keep remote:', error)
    } finally {
      setIsLoading(false)
    }
  }

  //
  const addCount = diff.filter(d => d.type === 'add').length
  const removeCount = diff.filter(d => d.type === 'remove').length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>File conflict</DialogTitle>
          <DialogDescription>
            Remote and local files conflict. Choose which version to keep.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex gap-4 min-h-[300px]">
          {/* */}
          <div className="flex-1 flex flex-col overflow-hidden border rounded-md">
            <div className="bg-muted px-3 py-2 text-sm font-medium border-b">
              Local version
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {localContent || 'Loading...'}
            </div>
          </div>

          {/* */}
          <div className="flex-1 flex flex-col overflow-hidden border rounded-md">
            <div className="bg-muted px-3 py-2 text-sm font-medium border-b">
              Remote version
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
              {remoteContent || 'Loading...'}
            </div>
          </div>
        </div>

        {/* */}
        <div className="text-sm text-muted-foreground">
          <span className="text-green-500">+{addCount} added</span>
          {' / '}
          <span className="text-red-500">-{removeCount} removed</span>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleKeepLocal}
            disabled={isLoading}
          >
            Keep local
          </Button>
          <Button
            onClick={handleKeepRemote}
            disabled={isLoading}
          >
            Keep remote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
