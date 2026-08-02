'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TipTapEditor } from '@/app/core/main/editor/markdown/tiptap-editor'
import type { Editor } from '@tiptap/react'
import { Loader2 } from 'lucide-react'
import useArticleStore from '@/stores/article'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

interface MobileEditorProps {
  onEditorReady?: (editor: Editor | null) => void
}

export function MobileEditor({ onEditorReady }: MobileEditorProps) {
  const tEditor = useTranslations('editor')
  const { setCurrentArticle, activeFilePath } = useArticleStore()

  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isEditorReady, setIsEditorReady] = useState(false)

  const activePathRef = useRef<string>('')
  const contentRef = useRef<string>('')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isSavingRef = useRef(false)

  // activeFilePath
  useEffect(() => {
    if (activeFilePath && activeFilePath !== activePathRef.current) {
      activePathRef.current = activeFilePath
      loadFile(activeFilePath)
    } else if (!activeFilePath && activePathRef.current) {
      activePathRef.current = ''
      setContent('')
      contentRef.current = ''
      setIsLoading(false)
      setIsEditorReady(false)
    }
  }, [activeFilePath])

  //
  const loadFile = useCallback(async (path: string) => {
    if (!path) return

    setIsLoading(true)
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(path)
      let fileContent = ''

      if (workspace.isCustom) {
        const fileExists = await exists(pathOptions.path)
        if (fileExists) {
          fileContent = await readTextFile(pathOptions.path)
        }
      } else {
        const fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        if (fileExists) {
          fileContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
      }

      setContent(fileContent)
      contentRef.current = fileContent
      setCurrentArticle(fileContent)
    } catch {
      setContent('')
      contentRef.current = ''
      setCurrentArticle('')
    } finally {
      setIsLoading(false)
    }
  }, [setCurrentArticle])

  //
  const doSave = useCallback(async () => {
    const path = activePathRef.current
    const newContent = contentRef.current

    if (!path || isSavingRef.current || !isEditorReady) {
      return
    }

    isSavingRef.current = true
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(path)

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, newContent)
      } else {
        await writeTextFile(pathOptions.path, newContent, { baseDir: pathOptions.baseDir })
      }

      setCurrentArticle(newContent)
    } finally {
      isSavingRef.current = false
    }
  }, [setCurrentArticle, isEditorReady])

  //
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
    contentRef.current = newContent

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = setTimeout(() => {
      doSave()
    }, 500)
  }, [doSave])

  //
  const handleEditorReady = useCallback(() => {
    setIsEditorReady(true)
  }, [])

  //
  useEffect(() => {
    return () => {
      onEditorReady?.(null)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [onEditorReady])

  //
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col">
      <TipTapEditor
        initialContent={content}
        onChange={handleContentChange}
        placeholder={tEditor('placeholder')}
        activeFilePath={activeFilePath}
        onReady={handleEditorReady}
        onEditorReady={onEditorReady}
        mobileMode
        applyLayoutPreferences
      />
    </div>
  )
}

export default MobileEditor
