'use client'

import { Editor } from '@tiptap/react'
import { ArrowDownCircle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { compareFileVersions, pullRemoteFile, saveLocalFile, getRemoteFileInfo, setLocalRecordedSha } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import { ConflictDialog } from './conflict-dialog'

interface PullButtonProps {
  editor: Editor
}

//
type PullStatus = 'idle' | 'checking' | 'update-available' | 'pulling' | 'conflict' | 'error'

export function PullButton({ editor }: PullButtonProps) {
  const { activeFilePath } = useArticleStore()
  const { autoPullOnOpen } = useSettingStore()
  const [hasUpdate, setHasUpdate] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [pullStatus, setPullStatus] = useState<PullStatus>('idle')
  const [showConflictDialog, setShowConflictDialog] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastInputTimeRef = useRef<number>(Date.now())

  //
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)

  //
  const pendingFileRef = useRef<string | null>(null)
  const pullTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // （）
  const remoteContentRef = useRef<string | null>(null)

  const IDLE_PULL_INTERVAL = 30 * 1000 // 30s
  const IDLE_THRESHOLD = 10 * 1000 // Start after 10s idle

  //
  useEffect(() => {
    if (!editor) return

    const handleFocus = () => setIsEditorFocused(true)
    const handleBlur = () => setIsEditorFocused(false)
    const handleSelectionUpdate = () => {
      const selection = editor.state.selection
      const from = selection.from
      const to = selection.to
      setHasSelection(from !== to)
    }

    editor.on('focus', handleFocus)
    editor.on('blur', handleBlur)
    editor.on('selectionUpdate', handleSelectionUpdate)

    //
    setIsEditorFocused(editor.isFocused)
    const selection = editor.state.selection
    setHasSelection(selection.from !== selection.to)

    return () => {
      editor.off('focus', handleFocus)
      editor.off('blur', handleBlur)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  // Check if sync is configured
  useEffect(() => {
    isSyncConfigured().then(setIsConfigured)
  }, [])

  //
  const isUserActive = isEditorFocused || hasSelection
  const timeSinceInput = Date.now() - lastInputTimeRef.current

  //
  const executePull = useCallback(async (remoteContent: string) => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      await saveLocalFile(activeFilePath, remoteContent)
      // contentType: 'markdown' @tiptap/markdown Markdown
      editor.commands.setContent(remoteContent, { contentType: 'markdown' })
      // ，
      await updateFileSyncTime(activeFilePath)
      // SHA，
      const remoteInfo = await getRemoteFileInfo(activeFilePath)
      if (remoteInfo.sha) {
        await setLocalRecordedSha(activeFilePath, remoteInfo.sha)
      }
      // ，
      emitter.emit('sync-pulled', { path: activeFilePath })
      //
      remoteContentRef.current = null
      setPullStatus('idle')
      setHasUpdate(false)
    } catch (error) {
      console.error('Pull failed:', error)
      setPullStatus('error')
      toast({
        title: 'Pull failed',
        description: error instanceof Error ? error.message : 'Check your network connection and retry',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, editor])

  // Auto pull from remote (called by interval)
  const checkForUpdates = useCallback(async () => {
    if (!activeFilePath || isLoading) {
      return
    }

    // （ 10 ），
    if (timeSinceInput < IDLE_THRESHOLD) {
      setPullStatus('idle')
      return
    }

    try {
      setPullStatus('checking')
      const result = await compareFileVersions(activeFilePath)

      if (result.action === 'conflict') {
        setPullStatus('conflict')
        return
      }

      if (result.action === 'pull') {
        //
        try {
          const content = await pullRemoteFile(activeFilePath)
          remoteContentRef.current = content
          // ，，
          setPullStatus('update-available')
          setHasUpdate(true)
          return
        } catch {
          // ，
          setPullStatus('error')
          toast({
            title: 'UpdateFailed',
            description: 'Check your network connection and retry',
            variant: 'destructive',
          })
          return
        }
      }

      //
      setPullStatus('idle')
      setHasUpdate(false)
      remoteContentRef.current = null
    } catch (error) {
      console.error('Auto pull check failed:', error)
      setPullStatus('error')
      // ， toast
    }
  }, [activeFilePath, isLoading, isUserActive, timeSinceInput])

  // -
  const handleConflict = useCallback(() => {
    setShowConflictDialog(true)
  }, [])

  //
  const handleConflictResolved = useCallback(() => {
    setPullStatus('idle')
    setHasUpdate(false)
    remoteContentRef.current = null
  }, [])

  // Check for updates and auto pull when file changes
  useEffect(() => {
    // readArticle -> syncOnOpen ，。
    // ，，。
    if (!activeFilePath || !isConfigured || autoPullOnOpen) return

    //
    if (pullTimeoutRef.current) {
      clearTimeout(pullTimeoutRef.current)
      pullTimeoutRef.current = null
    }

    // ，，
    lastInputTimeRef.current = 0

    // ，
    const checkOnSwitch = async () => {
      // ：，
      if (pendingFileRef.current !== null && pendingFileRef.current !== activeFilePath) {
        return
      }

      pendingFileRef.current = activeFilePath

      //
      remoteContentRef.current = null

      try {
        // （，）
        //
        const result = await compareFileVersions(activeFilePath)

        // （）
        if (pendingFileRef.current !== activeFilePath) {
          return
        }

        if (result.action === 'conflict') {
          setPullStatus('conflict')
          setIsLoading(false)
        } else if (result.action === 'pull') {
          //
          setPullStatus('checking')
          setIsLoading(true)

          try {
            const content = await pullRemoteFile(activeFilePath)
            remoteContentRef.current = content
            setPullStatus('update-available')
            setHasUpdate(true)
            setIsLoading(false)
          } catch {
            setPullStatus('error')
            setIsLoading(false)
          }
        } else {
          setPullStatus('idle')
          setHasUpdate(false)
        }
      } catch {
        setHasUpdate(false)
      } finally {
        //
        if (pendingFileRef.current === activeFilePath) {
          pendingFileRef.current = null
        }
      }
    }

    // ： 500ms ，
    pullTimeoutRef.current = setTimeout(checkOnSwitch, 500)

    return () => {
      if (pullTimeoutRef.current) {
        clearTimeout(pullTimeoutRef.current)
        pullTimeoutRef.current = null
      }
    }
  }, [activeFilePath, isConfigured, autoPullOnOpen])

  // ，
  useEffect(() => {
    const handleInput = () => {
      lastInputTimeRef.current = Date.now()
    }
    emitter.on('editor-input', handleInput)
    return () => {
      emitter.off('editor-input', handleInput)
    }
  }, [])

  // Set up auto-pull interval (now only checks, doesn't auto-pull)
  useEffect(() => {
    if (!isConfigured || !activeFilePath) return

    const checkForUpdatesPeriodically = () => {
      // ref
      const now = Date.now()
      const timeSinceInput = now - lastInputTimeRef.current
      //
      if (timeSinceInput >= IDLE_THRESHOLD) {
        checkForUpdates()
      }
    }

    intervalRef.current = setInterval(checkForUpdatesPeriodically, IDLE_PULL_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isConfigured, activeFilePath, checkForUpdates])

  // Pull from remote (manual) -
  const handlePull = useCallback(async () => {
    if (!activeFilePath || isLoading) return

    // ，
    if (remoteContentRef.current) {
      await executePull(remoteContentRef.current)
      return
    }

    // ，
    setIsLoading(true)
    try {
      const content = await pullRemoteFile(activeFilePath)
      await executePull(content)
    } catch (error) {
      console.error('Pull failed:', error)
    }
  }, [activeFilePath, isLoading, executePull])

  // ，
  if (!isConfigured || !activeFilePath) return null

  return (
    <>
      <div className="flex items-center gap-1">
        {/* */}
        {isLoading ? (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            Pulling...
          </span>
        ) : pullStatus === 'conflict' ? (
          /* - */
          <button
            onClick={handleConflict}
            className="p-0.5 rounded transition-colors hover:bg-red-500/10 text-red-500 flex items-center gap-1"
            title="Resolve conflict"
          >
            <ArrowDownCircle size={14} />
            <span className="text-xs">Conflict</span>
          </button>
        ) : hasUpdate ? (
          /* */
          <button
            onClick={handlePull}
            className="p-0.5 rounded transition-colors hover:bg-amber-500/10 text-amber-500 flex items-center gap-1"
            title="Pull updates"
          >
            <ArrowDownCircle size={14} />
            <span className="text-xs">Update available</span>
          </button>
        ) : pullStatus === 'checking' ? (
          /* */
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            Checking
          </span>
        ) : (
          /* ， */
          <button
            onClick={handlePull}
            className="p-0.5 rounded transition-colors hover:bg-accent text-muted-foreground flex items-center gap-1"
            title="File"
          >
            <ArrowDownCircle size={14} />
          </button>
        )}
      </div>

      {/* */}
      <ConflictDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        activeFilePath={activeFilePath}
        editor={editor}
        onResolved={handleConflictResolved}
      />
    </>
  )
}

export default PullButton
