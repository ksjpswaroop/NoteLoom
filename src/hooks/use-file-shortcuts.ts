import { useEffect, useCallback, useState } from 'react'
import { isMobileDevice } from '@/lib/check'
import { platform } from '@tauri-apps/plugin-os'
import useArticleStore from '@/stores/article'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface FileShortcutsProps {
  path: string
  isEditing?: boolean
  onStartRename?: () => void
  onCopy?: () => void
  onPaste?: () => void
  onCut?: () => void
  onDelete?: () => void
}

/**
 * Hook
 * ：
 * - macOS: Enter ，Cmd+C ，Cmd+V ，Cmd+X ，Backspace 
 * - Windows/Linux: F2 ，Ctrl+C ，Ctrl+V ，Ctrl+X ，Delete 
 * ：
 */
export function useFileShortcuts({
  path,
  isEditing,
  onStartRename,
  onCopy,
  onPaste,
  onCut,
  onDelete
}: FileShortcutsProps) {
  const { activeFilePath } = useArticleStore()
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')

  //
  useEffect(() => {
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch {
      setCurrentPlatform('unknown')
    }
  }, [])

  //
  const isModKey = useCallback((e: KeyboardEvent | React.KeyboardEvent): boolean => {
    if (currentPlatform === 'macos') {
      return e.metaKey && !e.ctrlKey
    } else {
      return e.ctrlKey && !e.metaKey
    }
  }, [currentPlatform])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    //
    if (isMobileDevice()) {
      return
    }

    //
    if (isEditing === true) {
      return
    }

    // /
    if (path !== activeFilePath) {
      return
    }

    const modPressed = isModKey(e)

    // : macOS Enter ，Windows/Linux F2
    const isRenameKey = currentPlatform === 'macos'
      ? e.key === 'Enter'
      : e.key === 'F2'

    if (isRenameKey && onStartRename) {
      e.preventDefault()
      e.stopPropagation()
      onStartRename()
      return
    }

    // : Cmd+C / Ctrl+C
    if (modPressed && e.key === 'c' && onCopy) {
      e.preventDefault()
      e.stopPropagation()
      onCopy()
      return
    }

    // : Cmd+V / Ctrl+V
    if (modPressed && e.key === 'v' && onPaste) {
      e.preventDefault()
      e.stopPropagation()
      onPaste()
      return
    }

    // : Cmd+X / Ctrl+X
    if (modPressed && e.key === 'x' && onCut) {
      e.preventDefault()
      e.stopPropagation()
      onCut()
      return
    }

    // : macOS Backspace，Windows/Linux Delete
    const isDeleteKey = currentPlatform === 'macos'
      ? e.key === 'Backspace'
      : e.key === 'Delete'

    if (isDeleteKey && onDelete) {
      e.preventDefault()
      e.stopPropagation()
      onDelete()
      return
    }
  }, [activeFilePath, isEditing, onStartRename, onCopy, onPaste, onCut, onDelete, path, currentPlatform, isModKey])

  useEffect(() => {
    //
    if (isMobileDevice() || currentPlatform === 'unknown') {
      return
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown, currentPlatform])

  return { currentPlatform, isModKey }
}
