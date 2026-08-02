'use client'

import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus, FolderPlus, PencilRuler, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import useArticleStore from "@/stores/article"
import { createExcalidrawWorkspaceFile } from "@/lib/excalidraw/workspace"
import { debounce } from "lodash-es"
import { FileMoreMenu } from './file-more-menu'
import { useMarkdownImport } from './use-markdown-import'

export function FileActions() {
  const { newFolder, newFile, loadFileTree, loadRemoteSyncFiles, fileTreeLoading, activeFilePath } = useArticleStore()
  const t = useTranslations('article.file.toolbar')
  const { isImporting, importMarkdown, importNotionZip } = useMarkdownImport()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCreatingSketch, setIsCreatingSketch] = useState(false)

  const debounceNewFile = debounce(newFile, 200)
  const debounceNewFolder = debounce(newFolder, 200)

  async function handleRefresh() {
    if (isRefreshing) return

    setIsRefreshing(true)
    try {
      await loadFileTree({ skipRemoteSync: true })
      await loadRemoteSyncFiles()
    } finally {
      setIsRefreshing(false)
    }
  }

  async function handleNewSketch() {
    if (isCreatingSketch) return
    setIsCreatingSketch(true)
    try {
      const folderPath = activeFilePath.includes('/')
        ? activeFilePath.split('/').slice(0, -1).join('/')
        : undefined
      await createExcalidrawWorkspaceFile({
        fileName: `Untitled sketch-${Date.now()}`,
        folderPath,
        open: true,
      })
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Failed to create sketch')
    } finally {
      setIsCreatingSketch(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <TooltipButton 
        icon={<FilePlus className="h-4 w-4" />} 
        tooltipText={t('newArticle')} 
        onClick={debounceNewFile}
        side="bottom"
      />
      <TooltipButton
        icon={<PencilRuler className={`h-4 w-4 ${isCreatingSketch ? 'opacity-50' : ''}`} />}
        tooltipText={t('newSketch')}
        onClick={() => void handleNewSketch()}
        side="bottom"
        disabled={isCreatingSketch}
      />
      <TooltipButton 
        icon={<FolderPlus className="h-4 w-4" />} 
        tooltipText={t('newFolder')} 
        onClick={debounceNewFolder}
        side="bottom"
      />
      <TooltipButton
        icon={<RefreshCw className={`h-4 w-4 ${fileTreeLoading || isRefreshing ? 'animate-spin' : ''}`} />}
        tooltipText={t('refresh')}
        onClick={() => void handleRefresh()}
        disabled={fileTreeLoading || isRefreshing}
        side="bottom"
      />
      <FileMoreMenu
        isImporting={isImporting}
        onImportMarkdown={() => void importMarkdown()}
        onImportNotion={() => void importNotionZip()}
      />
    </div>
  )
}
