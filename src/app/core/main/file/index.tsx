'use client'

import React, { useEffect, useState, useCallback, useRef } from "react"
import { FileManager } from "./file-manager"
import { FileFooter } from "./file-footer"
import useArticleStore from "@/stores/article"
import useClipboardStore from "@/stores/clipboard"
import { isMobileDevice } from "@/lib/check"
import { platform } from "@tauri-apps/plugin-os"
import { isEditableKeyboardTarget } from "@/lib/is-editable-keyboard-target"
import { flattenFileTree, getFileSelectionEntries, toClipboardItems } from "./file-selection"
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceFileWatcher } from './use-workspace-file-watcher'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

/**
 * 
 * 
 */
function useFileManagerShortcuts() {
  const { activeFilePath, fileTree, selectedFilePaths } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    fileTree: state.fileTree,
    selectedFilePaths: state.selectedFilePaths,
  })))
  const { setClipboardItem, setClipboardItems } = useClipboardStore()
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isFocused, setIsFocused] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

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
  const isModKey = useCallback((e: KeyboardEvent): boolean => {
    if (currentPlatform === 'macos') {
      return e.metaKey && !e.ctrlKey
    } else {
      return e.ctrlKey && !e.metaKey
    }
  }, [currentPlatform])

  // item（）
  const getActiveItem = useCallback((): { path: string; isDirectory: boolean; isLocale: boolean; name: string; sha?: string } | null => {
    if (!activeFilePath) return null

    //
    function findInTree(tree: typeof fileTree, targetPath: string): ReturnType<typeof getActiveItem> {
      const entry = flattenFileTree(tree).find(item => item.path === targetPath)
      if (!entry) return null
      return {
        path: entry.path,
        isDirectory: entry.isDirectory,
        isLocale: entry.isLocale,
        name: entry.name,
        sha: entry.sha
      }
    }

    return findInTree(fileTree, activeFilePath)
  }, [activeFilePath, fileTree])

  //
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    //
    if (isMobileDevice()) {
      return
    }

    const editableTarget = isEditableKeyboardTarget(e.target)
    if (editableTarget) {
      return
    }

    //
    if (!isFocused) {
      return
    }

    const selectedEntries = getFileSelectionEntries(fileTree, selectedFilePaths)
    const allSelectedEntriesAreLocal = selectedEntries.every(entry => entry.isLocale)
    const activeItem = getActiveItem()
    if (selectedEntries.length === 0 && (!activeItem || !activeItem.isLocale)) {
      return
    }

    const modPressed = isModKey(e)

    // : Cmd+C / Ctrl+C
    if (modPressed && e.key === 'c') {
      e.preventDefault()
      e.stopPropagation()
      if (selectedEntries.length > 0) {
        if (allSelectedEntriesAreLocal) {
          setClipboardItems(toClipboardItems(selectedEntries), 'copy')
        }
      } else if (activeItem) {
        setClipboardItem({
          path: activeItem.path,
          name: activeItem.name,
          isDirectory: activeItem.isDirectory,
          sha: activeItem.sha,
          isLocale: activeItem.isLocale
        }, 'copy')
      }
      return
    }

    // : Cmd+X / Ctrl+X
    if (modPressed && e.key === 'x') {
      e.preventDefault()
      e.stopPropagation()
      if (selectedEntries.length > 0) {
        if (allSelectedEntriesAreLocal) {
          setClipboardItems(toClipboardItems(selectedEntries), 'cut')
        }
      } else if (activeItem) {
        setClipboardItem({
          path: activeItem.path,
          name: activeItem.name,
          isDirectory: activeItem.isDirectory,
          sha: activeItem.sha,
          isLocale: activeItem.isLocale
        }, 'cut')
      }
      return
    }

    // : Cmd+V / Ctrl+V
    if (modPressed && e.key === 'v') {
      e.preventDefault()
      e.stopPropagation()
      // （）
      const pasteTargetPath = selectedEntries.length === 1 ? selectedEntries[0].path : activeItem?.path
      if (pasteTargetPath) {
        const event = new CustomEvent('filemanager-paste', { detail: { targetPath: pasteTargetPath } })
        window.dispatchEvent(event)
      }
      return
    }

    // : macOS Backspace，Windows/Linux Delete
    const isDeleteKey = currentPlatform === 'macos'
      ? e.key === 'Backspace'
      : e.key === 'Delete'

    if (isDeleteKey) {
      e.preventDefault()
      e.stopPropagation()
      if (selectedEntries.length > 0) {
        window.dispatchEvent(new CustomEvent('filemanager-delete-selection'))
      } else if (activeItem) {
        const event = new CustomEvent('filemanager-delete', { detail: { item: activeItem } })
        window.dispatchEvent(event)
      }
      return
    }

    // : macOS Enter ，Windows/Linux F2
    const isRenameKey = currentPlatform === 'macos'
      ? e.key === 'Enter'
      : e.key === 'F2'

    if (isRenameKey) {
      e.preventDefault()
      e.stopPropagation()
      const renamePath = selectedEntries.length === 1 ? selectedEntries[0].path : activeItem?.path
      if (renamePath && selectedEntries.length <= 1) {
        const event = new CustomEvent('filemanager-rename', { detail: { path: renamePath } })
        window.dispatchEvent(event)
      }
      return
    }
  }, [isFocused, getActiveItem, isModKey, currentPlatform, fileTree, selectedFilePaths, setClipboardItem, setClipboardItems])

  //
  useEffect(() => {
    if (isMobileDevice() || currentPlatform === 'unknown') {
      return
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown, currentPlatform])

  //
  const handleFocusIn = useCallback((e: FocusEvent) => {
    //
    if (sidebarRef.current && sidebarRef.current.contains(e.target as Node)) {
      setIsFocused(true)
    }
  }, [])

  const handleFocusOut = useCallback((e: FocusEvent) => {
    // sidebar
    // relatedTarget
    const newFocusedElement = e.relatedTarget as Node

    if (sidebarRef.current && newFocusedElement) {
      // sidebar ， isFocused = false
      if (!sidebarRef.current.contains(newFocusedElement)) {
        setIsFocused(false)
      }
    } else if (!newFocusedElement) {
      // relatedTarget null（）， isFocused = false
      setIsFocused(false)
    }
    // ， sidebar ， isFocused = true
  }, [])

  useEffect(() => {
    if (sidebarRef.current) {
      sidebarRef.current.addEventListener('focusin', handleFocusIn)
      sidebarRef.current.addEventListener('focusout', handleFocusOut)

      return () => {
        sidebarRef.current?.removeEventListener('focusin', handleFocusIn)
        sidebarRef.current?.removeEventListener('focusout', handleFocusOut)
      }
    }
  }, [handleFocusIn, handleFocusOut])

  //
  const focusSidebar = useCallback(() => {
    setIsFocused(true)
    // requestAnimationFrame DOM
    requestAnimationFrame(() => {
      sidebarRef.current?.focus()
    })
  }, [])

  return { sidebarRef, isFocused, focusSidebar }
}

export function FileSidebar() {
  useWorkspaceFileWatcher()
  const {
    initCollapsibleList,
    initSortSettings,
    initShowCloudFiles,
    initSyncStaticAssets,
    initShowKnowledgeBaseStatus,
  } = useArticleStore(useShallow((state) => ({
    initCollapsibleList: state.initCollapsibleList,
    initSortSettings: state.initSortSettings,
    initShowCloudFiles: state.initShowCloudFiles,
    initSyncStaticAssets: state.initSyncStaticAssets,
    initShowKnowledgeBaseStatus: state.initShowKnowledgeBaseStatus,
  })))
  const { sidebarRef, focusSidebar } = useFileManagerShortcuts()

  useEffect(() => {
    initCollapsibleList()
    initSortSettings()
    initShowCloudFiles()
    initSyncStaticAssets()
    initShowKnowledgeBaseStatus()
  }, [])

  return (
    <div
      ref={sidebarRef}
      id="article-sidebar"
      className="flex h-full w-full flex-col bg-background text-foreground outline-none"
      tabIndex={-1}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileManager focusSidebar={focusSidebar} />
      </div>
      <FileFooter />
    </div>
  )
}
