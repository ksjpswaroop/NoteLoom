import { ContextMenu, ContextMenuContent, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, mkdir, rename } from "@tauri-apps/plugin-fs";
import { Folder, FolderDot, FolderOpen, FolderOpenDot, LoaderCircle, Database, Sparkles } from "lucide-react"
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { computedParentPath, getCurrentFolder, joinRelativePath } from "@/lib/path";
import useSettingStore from '@/stores/setting'
import { isSkillsFolder } from "@/lib/skills/utils"
import DownloadFolder from './sync-folder'
import { UploadFolder } from './upload-folder'
import { NewFile } from './new-file'
import { NewFolder } from './new-folder'
import { ViewDirectory } from './view-directory'
import { CutFolder } from './cut-folder'
import { CopyFolder } from './copy-folder'
import { DuplicateFolder } from './duplicate-folder'
import { PasteInFolder } from './paste-in-folder'
import { RenameFolder } from './rename-folder'
import { DeleteFolder } from './delete-folder'
import useClipboardStore from "@/stores/clipboard"
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "../mobile-action-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTranslations } from "next-intl"
import { FolderVectorMenu } from './folder-vector-menu'
import { pasteIntoFolder } from './paste-into-folder'
import emitter from '@/lib/emitter'
import { LinkedFolder } from '@/lib/files'
import {
  getFileManagerDragPaths,
  getPathAfterMove,
  hasFileManagerDragData,
  moveFileManagerEntries,
  setFileManagerDragData,
} from '../file-dnd'
import { debugSyncPath } from "@/lib/sync/remote-file";
import { appDataDir } from '@tauri-apps/api/path'
import { openPath } from '@tauri-apps/plugin-opener'
import { BatchSelectionContextMenu } from "../batch-selection-context-menu";
import { getTopLevelSelectionEntries, type FileSelectionEntry } from "../file-selection";
import { useShallow } from 'zustand/react/shallow';
import { FileTreeRow, type FileTreeItemProps } from "../file-tree-row";
import { Badge } from '@/components/ui/badge'
import { getFileTreeSyncStatus, validateFileTreeName, type FileTreeSyncStatus } from "../file-tree-action-policy";
import { FileTreeDecorations } from "../file-tree-decorations";
import { moveEntryToSystemTrash } from '../system-trash'
import { rewriteWorkspaceMarkdownMediaPaths } from '@/lib/markdown-media-path'

export function FolderItem({
  item,
  focusSidebar,
  selectedPathSet,
  selectionEntries,
  treeItemProps,
  level = 0,
  expanded,
  expandable = true,
  expansionLocked = false,
  syncStatus: providedSyncStatus,
}: {
  item: DirTree
  focusSidebar?: () => void
  selectedPathSet: Set<string>
  selectionEntries: FileSelectionEntry[]
  treeItemProps?: FileTreeItemProps
  level?: number
  expanded?: boolean
  expandable?: boolean
  expansionLocked?: boolean
  syncStatus?: FileTreeSyncStatus
}) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [, setIsComposing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [dragItemCount, setDragItemCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragExpandTimeoutRef = useRef<number | null>(null)

  const { assetsPath, fileManagerTextSize } = useSettingStore()
  const isMobile = useIsMobile()
  const t = useTranslations('article.file')

  // skills
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  //
  const getIconSize = (textSize: string) => {
    const sizeMap = {
      'xs': 'size-3',
      'sm': 'size-3.5', 
      'md': 'size-4',
      'lg': 'size-5',
      'xl': 'size-6'
    }
    return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
  }

  const iconSize = getIconSize(fileManagerTextSize)
  const syncStatus = providedSyncStatus ?? getFileTreeSyncStatus(item)
  const syncStatusTitle = item.syncError ?? t(`syncStatus.${syncStatus}`)

  const {
    activeFilePath,
    loadFileTree,
    setActiveFilePath,
    collapsibleList,
    setCollapsibleList,
    loadCollapsibleFiles,
    fileTree,
    setFileTree,
    vectorIndexedFiles,
    showKnowledgeBaseStatus,
    moveLocalEntry,
    syncOpenTabsForPathChange,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    setSelectedFilePaths,
  } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    loadFileTree: state.loadFileTree,
    setActiveFilePath: state.setActiveFilePath,
    collapsibleList: state.collapsibleList,
    setCollapsibleList: state.setCollapsibleList,
    loadCollapsibleFiles: state.loadCollapsibleFiles,
    fileTree: state.fileTree,
    setFileTree: state.setFileTree,
    vectorIndexedFiles: state.vectorIndexedFiles,
    showKnowledgeBaseStatus: state.showKnowledgeBaseStatus,
    moveLocalEntry: state.moveLocalEntry,
    syncOpenTabsForPathChange: state.syncOpenTabsForPathChange,
    cleanTabsByDeletedFile: state.cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder: state.cleanTabsByDeletedFolder,
    setSelectedFilePaths: state.setSelectedFilePaths,
  })))
  const { setClipboardItem, clipboardItem, clipboardItems, clipboardOperation } = useClipboardStore()

  const path = computedParentPath(item)
  const cacheTree = cloneDeep(fileTree)
  const currentFolder = getCurrentFolder(path, cacheTree)
  const parentFolder = currentFolder?.parent

  //
  const isCut = clipboardOperation === 'cut' && clipboardItems.some(entry => entry.path === path)
  const isSelected = selectedPathSet.has(path)
  const useSelectionMenu = isSelected && selectionEntries.length > 1

  //
  const folderVectorStatus = useMemo(() => {
    let totalCount = 0
    let loadedIndexedCount = 0

    function countFiles(node: DirTree) {
      if (!node.children) {
        // （ children）
        if (node.name.endsWith('.md')) {
          totalCount++
          if (vectorIndexedFiles.has(computedParentPath(node))) {
            loadedIndexedCount++
          }
        }
        return
      }

      //
      node.children.forEach(child => countFiles(child))
    }

    countFiles(item)
    const pathPrefix = `${path}/`
    const indexedCount = Array.from(vectorIndexedFiles.keys())
      .filter(filePath => filePath.startsWith(pathPrefix))
      .length

    return {
      totalCount,
      indexedCount: totalCount > 0 ? loadedIndexedCount : indexedCount,
      hasVector: indexedCount > 0 || loadedIndexedCount > 0,
      isComplete: totalCount > 0 && loadedIndexedCount === totalCount
    }
  }, [item, path, vectorIndexedFiles])

  //
  const renderFolderVectorIcon = () => {
    if (!showKnowledgeBaseStatus || isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus
    const vectorStatus = folderVectorStatus

    if (status === 'calculating') {
      return (
        <span
          className="inline-flex shrink-0 items-center"
          title={t('context.knowledgeBase')}
          aria-label={t('context.knowledgeBase')}
        >
          <LoaderCircle className={`${iconSize} shrink-0 animate-spin text-muted-foreground`} />
        </span>
      )
    } else if (status === 'completed' || vectorStatus.hasVector) {
      return (
        <span
          className="flex shrink-0 items-center"
          title={t('context.knowledgeBase')}
          aria-label={t('context.knowledgeBase')}
        >
          <span className={`text-xs text-muted-foreground ${vectorStatus.isComplete ? 'opacity-100' : 'opacity-60'}`}>
            {vectorStatus.totalCount > 0
              ? `${vectorStatus.indexedCount}/${vectorStatus.totalCount}`
              : vectorStatus.indexedCount}
          </span>
          <Database className={`${iconSize} ml-1 shrink-0 text-muted-foreground ${vectorStatus.isComplete ? 'opacity-100' : 'opacity-60'}`} />
        </span>
      )
    }
    return null
  }

  //
  function handleNewFile() {
    // ，
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // ，
    if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
      return;
    }
    
    //
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
    }
    
    if (currentFolder) {
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: currentFolder,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: [],
        childrenLoaded: true
      };
      currentFolder.children?.unshift(newFile);
      setFileTree(cacheTree);
    }
  }

  function handleNewFolder() {
    //
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // ，
    if (currentFolder?.children?.find(item => item.name === '' && item.isDirectory)) {
      return;
    }
    
    //
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
    }
    
    if (currentFolder) {
      const newFolder: DirTree = {
        name: '',
        isFile: false,
        isSymlink: false,
        parent: currentFolder,
        isEditing: true,
        isDirectory: true,
        isLocale: true,
        sha: '',
        children: []
      };
      currentFolder.children?.unshift(newFolder);
      setFileTree(cacheTree);
    }
  }

  function handleStartRename() {
    // ，
    setTimeout(() => {
      setIsEditing(true)
      setRenameError(null)
      setTimeout(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          // ，
          const lastDotIndex = item.name.lastIndexOf('.')
          if (lastDotIndex > 0) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
    }, 300)
  }

  //
  async function handlePasteInFolder() {
    await pasteIntoFolder({
      clipboardItem,
      clipboardItems,
      clipboardOperation,
      folderPath: path,
      emptyToastTitle: t('clipboard.empty'),
      pastedToastTitle: t('clipboard.pasted'),
      pasteFailedToastTitle: t('clipboard.pasteFailed'),
      loadFileTree,
      setClipboardItem,
      cleanTabsByDeletedFile,
      cleanTabsByDeletedFolder,
    })
  }

  async function handleViewDirectory() {
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    if (workspace.isCustom) {
      const pathOptions = await getFilePathOptions(path)
      await openPath(pathOptions.path)
      return
    }
    await openPath(`${await appDataDir()}/article/${path}`)
  }

  function handleCutFolder() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: true,
      isLocale: item.isLocale,
    }, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  function handleCopyFolder() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: true,
      isLocale: item.isLocale,
    }, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  //
  async function handleDeleteFolder() {
    if (!item.isLocale) return

    try {
      const { ask } = await import('@tauri-apps/plugin-dialog')

      //
      const confirmed = await ask(t('context.confirmDelete', { name: item.name }), {
        title: item.name,
        kind: 'warning',
      })

      if (!confirmed) return

      const trashed = await moveEntryToSystemTrash(path)
      const removedVectorEntries = new Map(
        Array.from(vectorIndexedFiles.entries())
          .filter(([vectorPath]) => vectorPath === path || vectorPath.startsWith(`${path}/`))
      )

      // ，
      if (activeFilePath && activeFilePath.startsWith(path)) {
        setActiveFilePath('')
      }

      await cleanTabsByDeletedFolder(path)
      if (removedVectorEntries.size > 0) {
        const nextVectorIndexedFiles = new Map(useArticleStore.getState().vectorIndexedFiles)
        removedVectorEntries.forEach((_, vectorPath) => nextVectorIndexedFiles.delete(vectorPath))
        useArticleStore.setState({ vectorIndexedFiles: nextVectorIndexedFiles })
      }
      await loadFileTree({ skipRemoteSync: true })

      toast({
        title: t('context.movedToTrash', { count: trashed ? 1 : 0 }),
      })
    } catch (error) {
      console.error('Delete folder failed:', error)
      toast({
        title: t('context.deleteFailed'),
        variant: 'destructive'
      })
    }
  }

  // ，
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
    setRenameError(null)
  }, [])

  //
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  //
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false)
    setName(e.currentTarget.value)
  }, [])

  //
  async function handleRename() {
    const nextName = name
    setName(nextName)
    if (nextName && validateFileTreeName(nextName)) {
      setRenameError(t('error.invalidName'))
      setTimeout(() => inputRef.current?.focus(), 0)
      return
    }

    //
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()

    //
    if (nextName && nextName !== item.name && item.name !== '') {
      //
      if (parentFolder && parentFolder.children) {
        const folderIndex = parentFolder?.children?.findIndex(folder => folder.name === item.name)
        if (folderIndex !== undefined && folderIndex !== -1) {
          parentFolder.children[folderIndex].name = nextName
          parentFolder.children[folderIndex].isEditing = false
        }
      } else {
        const folderIndex = cacheTree.findIndex(folder => folder.name === item.name)
        cacheTree[folderIndex].name = nextName
        cacheTree[folderIndex].isEditing = false
      }
      
      //
      const oldPathOptions = await getFilePathOptions(path)
      const parentPath = path.split('/').slice(0, -1).join('/')
      const targetRelativePath = joinRelativePath(parentPath, nextName)
      const newPathOptions = await getFilePathOptions(targetRelativePath)
      const targetExists = workspace.isCustom
        ? await exists(newPathOptions.path)
        : await exists(newPathOptions.path, { baseDir: newPathOptions.baseDir })
      if (targetExists) {
        setRenameError(t('error.fileExists'))
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }
      debugSyncPath('folder.renamePlan', {
        originalName: item.name,
        enteredName: nextName,
        sourcePath: path,
        targetRelativePath,
      })
      
      //
      try {
        if (workspace.isCustom) {
          await rename(oldPathOptions.path, newPathOptions.path)
        } else {
          await rename(oldPathOptions.path, newPathOptions.path, {
            newPathBaseDir: BaseDirectory.AppData,
            oldPathBaseDir: BaseDirectory.AppData
          })
        }
        try {
          await rewriteWorkspaceMarkdownMediaPaths([{
            sourcePath: path,
            targetPath: targetRelativePath,
          }])
        } catch (error) {
          if (workspace.isCustom) {
            await rename(newPathOptions.path, oldPathOptions.path)
          } else {
            await rename(newPathOptions.path, oldPathOptions.path, {
              newPathBaseDir: BaseDirectory.AppData,
              oldPathBaseDir: BaseDirectory.AppData,
            })
          }
          throw error
        }
      } catch (error) {
        setRenameError(error instanceof Error ? error.message : String(error))
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }
      const { renameVectorDocumentsByPrefix } = await import('@/db/vector')
      await renameVectorDocumentsByPrefix(path, targetRelativePath)
      const nextActiveFilePath = getPathAfterMove(activeFilePath, path, targetRelativePath)
      await syncOpenTabsForPathChange(path, targetRelativePath)
      if (nextActiveFilePath !== activeFilePath) {
        setActiveFilePath(nextActiveFilePath)
      }
    } else {
      // ，
      if (item.name !== '' && nextName === item.name) {
        setIsEditing(false)
        return
      }

      //
      if (nextName !== '') {
        //
        const newFolderPath = joinRelativePath(path, nextName)
        const pathOptions = await getFilePathOptions(newFolderPath)
        
        let isExists = false
        if (workspace.isCustom) {
          isExists = await exists(pathOptions.path)
        } else {
          isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (isExists) {
          setRenameError(t('error.fileExists'))
          setTimeout(() => inputRef.current?.focus(), 0)
          return
        } else {
          //
          if (workspace.isCustom) {
            await mkdir(pathOptions.path)
          } else {
            await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          
          //
          if (parentFolder && parentFolder.children) {
            const index = parentFolder.children?.findIndex(item => item.name === '')
            parentFolder.children[index].name = nextName
            parentFolder.children[index].isEditing = false
            parentFolder.children[index].childrenLoaded = true
          } else {
            const index = cacheTree?.findIndex(item => item.name === '')
            cacheTree[index].name = nextName
            cacheTree[index].isEditing = false
            cacheTree[index].childrenLoaded = true
          }
        }
      } else {
        // （）
        if (currentFolder?.parent) {
          const index = currentFolder?.parent?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.parent?.children) {
            currentFolder.parent?.children?.splice(index, 1)
          }
        } else {
          const index = cacheTree.findIndex(item => item.name === '')
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
        }
      }
    } 
    setIsEditing(false)
    setFileTree(cacheTree)
  }



  function clearDragExpandTimer() {
    if (dragExpandTimeoutRef.current !== null) {
      window.clearTimeout(dragExpandTimeoutRef.current)
      dragExpandTimeoutRef.current = null
    }
  }

  function scheduleDragExpand() {
    if (collapsibleList.includes(path) || dragExpandTimeoutRef.current !== null) {
      return
    }

    dragExpandTimeoutRef.current = window.setTimeout(async () => {
      dragExpandTimeoutRef.current = null
      await setCollapsibleList(path, true)
      await loadCollapsibleFiles(path)
    }, 450)
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileManagerDragData(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    clearDragExpandTimer()
    const renamePaths = getFileManagerDragPaths(e.dataTransfer)

    try {
      const batchResult = await moveFileManagerEntries(renamePaths, path)
      if (batchResult.failed.length > 0) {
        if (batchResult.failed.some(failure => failure.reason === 'rollback-failed')) {
          await loadFileTree({ skipRemoteSync: true })
        }
        toast({
          title: t('context.moveFailed'),
          description: t(`context.moveFailure.${batchResult.failed[0].reason}`),
          variant: 'destructive',
        })
        return
      }

      let requiresReload = false
      let nextActiveFilePath = activeFilePath
      for (const result of batchResult.moved) {
        requiresReload = !moveLocalEntry(result.sourcePath, result.targetPath) || requiresReload
        nextActiveFilePath = getPathAfterMove(nextActiveFilePath, result.sourcePath, result.targetPath)
        await syncOpenTabsForPathChange(result.sourcePath, result.targetPath)
      }
      if (requiresReload) await loadFileTree({ skipRemoteSync: true })
      if (!collapsibleList.includes(path)) await setCollapsibleList(path, true)
      if (nextActiveFilePath !== activeFilePath) setActiveFilePath(nextActiveFilePath)
      setSelectedFilePaths(batchResult.moved.map(result => result.targetPath))
      if (batchResult.moved.length > 1) {
        toast({
          title: t('context.moveComplete'),
          description: t('context.moveResult', {
            moved: batchResult.moved.length,
            failed: 0,
          }),
        })
      }
    } catch (error) {
      console.error('Move entry into folder failed:', error)
      toast({
        title: t('context.moveFailed'),
        variant: 'destructive',
      })
    } finally {
      clearDragExpandTimer()
      setIsDragging(false)
      setDragItemCount(0)
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileManagerDragData(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    const renamePaths = getFileManagerDragPaths(e.dataTransfer)
    if (renamePaths.some(sourcePath => sourcePath === path || path.startsWith(`${sourcePath}/`))) {
      e.dataTransfer.dropEffect = 'none'
      clearDragExpandTimer()
      setIsDragging(false)
      setDragItemCount(0)
      return
    }
    e.dataTransfer.dropEffect = 'move'
    setDragItemCount(renamePaths.length)
    scheduleDragExpand()
    setIsDragging(true)
  }

  function handleDragleave(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileManagerDragData(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    const nextTarget = e.relatedTarget as Node | null
    if (nextTarget && e.currentTarget.contains(nextTarget)) {
      return
    }

    clearDragExpandTimer()
    setIsDragging(false)
    setDragItemCount(0)
  }

  function handleDragStart(ev: React.DragEvent<HTMLDivElement>) {
    if (!item.isLocale || isEditing) {
      ev.preventDefault()
      return
    }

    ev.stopPropagation()
    const selectedPaths = selectedPathSet.has(path)
      ? getTopLevelSelectionEntries(selectionEntries).map(entry => entry.path)
      : [path]
    setFileManagerDragData(ev.dataTransfer, selectedPaths)
  }

  function handleDragEnd() {
    clearDragExpandTimer()
    setIsDragging(false)
    setDragItemCount(0)
  }

  async function handleSelectFolder() {
    // （）
    if (!item.isDirectory) {
      return
    }

    // ，
    focusSidebar?.()
    // ；
    // 。 activeFilePath，
    // 。
    if (item.isLocale) {
      await setActiveFilePath(path)
    } else {
      if (activeFilePath === path) {
        await setActiveFilePath('')
      }
      setSelectedFilePaths([path])
    }

    // （）
    if (!collapsibleList.includes(path)) {
      await setCollapsibleList(path, true)
    }

    //
    await loadCollapsibleFiles(path)

    // 。
    // loadCollapsibleFiles/loadFolderRemoteFiles ， readDir。
    if (!item.isLocale) {
      return
    }

    //
    const folderName = path.split('/').pop() || path
    let fullPath: string
    const { getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    if (workspace.isCustom) {
      const pathParts = path.split('/')
      fullPath = workspace.path + '/' + pathParts.join('/')
    } else {
      fullPath = path
    }

    //
    const { collectMarkdownFiles } = await import('@/lib/files')
    const files = await collectMarkdownFiles(path)

    //
    const indexedCount = files.filter(f =>
      vectorIndexedFiles.has(f.path)
    ).length

    //
    if (indexedCount > 0) {
      //
      emitter.emit('folderSelected', {
        name: folderName,
        path: fullPath,
        relativePath: path,
        fileCount: files.length,
        indexedCount: indexedCount
      } as LinkedFolder)
    }
  }

  function handleFolderClick(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    focusSidebar?.()
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      return
    }

    void handleSelectFolder()
  }

  function handleFolderContextMenu(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation()
    focusSidebar?.()
    if (!isSelected) {
      setSelectedFilePaths([path])
    }
  }



  function handleEditEnd() {
    if (currentFolder?.parent) {
      const index = currentFolder?.parent?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.parent?.children) {
        currentFolder.parent?.children?.splice(index, 1)
      }
    } else {
      const index = cacheTree.findIndex(item => item.name === '')
      if (index !== -1) {
        cacheTree.splice(index, 1)
      }
    }
    setFileTree(cacheTree)
    setIsEditing(false)
  }

  useEffect(() => {
    if (item.isEditing) {
      setIsEditing(true)
      setName(item.name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  useEffect(() => {
    return () => {
      if (dragExpandTimeoutRef.current !== null) {
        window.clearTimeout(dragExpandTimeoutRef.current)
      }
    }
  }, [])

  //
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail.path === path) {
        handleStartRename()
      }
    }

    const handleDeleteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: { path: string } }>
      if (customEvent.detail.item.path === path) {
        handleDeleteFolder()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      //
      if (customEvent.detail.targetPath === path) {
        handlePasteInFolder()
      }
    }

    window.addEventListener('filemanager-rename', handleRenameEvent)
    window.addEventListener('filemanager-delete', handleDeleteEvent)
    window.addEventListener('filemanager-paste', handlePasteEvent)

    return () => {
      window.removeEventListener('filemanager-rename', handleRenameEvent)
      window.removeEventListener('filemanager-delete', handleDeleteEvent)
      window.removeEventListener('filemanager-paste', handlePasteEvent)
    }
  }, [path, handleStartRename, handleDeleteFolder, handlePasteInFolder])

  // （）
  const [currentPlatform, setCurrentPlatform] = useState<'macos' | 'windows' | 'linux' | 'unknown'>('unknown')

  useEffect(() => {
    const detectPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os')
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
    }
    detectPlatform()
  }, [])

  //
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl'
  const deleteKey = currentPlatform === 'macos' ? '⌫' : 'Del'
  const renameKey = currentPlatform === 'macos' ? '↩' : 'F2'
  const isExpanded = expanded ?? collapsibleList.includes(path)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <FileTreeRow
          path={path}
          kind="folder"
          level={level}
          active={path === activeFilePath}
          selected={isSelected}
          dropTarget={isDragging}
          dropLabel={isDragging
            ? t('context.dropTarget', { name: item.name, count: dragItemCount })
            : undefined}
          expanded={isExpanded}
          expandable={expandable}
          expansionLocked={expansionLocked}
          expandLabel={t('expandFolder')}
          collapseLabel={t('collapseFolder')}
          treeItemProps={treeItemProps}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e)}
          onDragOver={e => handleDragOver(e)}
          onDragLeave={(e) => handleDragleave(e)}
          onActivate={handleFolderClick}
          onContextMenu={handleFolderContextMenu}
          onToggle={async (event) => {
            event.stopPropagation()
            if (expansionLocked) return
            const nextExpanded = !isExpanded
            await setCollapsibleList(path, nextExpanded)
            if (nextExpanded) {
              await loadCollapsibleFiles(path)
            }
          }}
        >
            {
              isEditing ?
                <>
                  {
                    item.isLocale ?
                      <Folder className={`${iconSize} shrink-0`} /> :
                      <Folder className={`${iconSize} shrink-0`} />
                  }
                  <Input
                    ref={inputRef}
                    className={`h-5 min-w-0 flex-1 rounded-sm text-${fileManagerTextSize} px-1 font-normal mr-1 ${renameError ? 'border-destructive focus-visible:ring-destructive/30' : ''}`}
                    value={name}
                    aria-invalid={Boolean(renameError)}
                    title={renameError ?? undefined}
                    onBlur={handleRename}
                    onChange={handleInputChange}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(e) => {
                      //
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        e.stopPropagation()
                      }
                      if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
                        handleRename()
                      } else if (e.code === 'Escape') {
                        handleEditEnd()
                      }
                    }}
                  />
                  {renameError ? (
                    <Badge variant="destructive" className="mr-1 max-w-28 shrink-0 truncate">
                      {renameError}
                    </Badge>
                  ) : null}
                </> :
                <div
                  className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 items-center justify-between gap-1 overflow-hidden select-none`}
                >
                  <div
                    data-file-manager-drag-handle
                    draggable={!isMobile && item.isLocale && !isEditing}
                    onDragStart={handleDragStart}
                    className="relative flex min-w-0 flex-1 cursor-default select-none items-center gap-1 overflow-hidden"
                  >
                    {isSkillsFolder(item.name) ? (
                      <Sparkles className={`${iconSize} shrink-0 text-primary`} />
                    ) : collapsibleList.includes(path) ? (
                      assetsPath === item.name
                        ? <FolderOpenDot className={`${iconSize} shrink-0`} />
                        : <FolderOpen className={`${iconSize} shrink-0`} />
                    ) : (
                      assetsPath === item.name
                        ? <FolderDot className={`${iconSize} shrink-0`} />
                        : <Folder className={`${iconSize} shrink-0`} />
                    )}
                    <span className={`text-${fileManagerTextSize} min-w-0 flex-1 truncate ${item.loading ? 'text-muted-foreground' : ''}`}>{item.name}</span>
                  </div>
                  <FileTreeDecorations
                    iconSize={iconSize}
                    knowledge={renderFolderVectorIcon()}
                    syncStatus={syncStatus}
                    syncTitle={syncStatusTitle}
                  />
                  {isMobile && (
                    <MobileActionMenu className="ml-1">
                      <MobileMenuItem onClick={handleNewFile} disabled={!!item.sha && !item.isLocale}>
                        {t('context.newFile')}
                      </MobileMenuItem>
                      <MobileMenuItem onClick={handleNewFolder} disabled={!!item.sha && !item.isLocale}>
                        {t('context.newFolder')}
                      </MobileMenuItem>
                      <MobileMenuItem onClick={() => void handleViewDirectory()}>
                        {t('context.viewDirectory')}
                      </MobileMenuItem>
                      <MobileSeparator />
                      <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFolder}>
                        {t('context.cut')}
                      </MobileMenuItem>
                      <MobileMenuItem onClick={handleCopyFolder}>
                        {t('context.copy')}
                      </MobileMenuItem>
                      <MobileMenuItem
                        disabled={!clipboardItem && clipboardItems.length === 0}
                        onClick={() => void handlePasteInFolder()}
                      >
                        {t('context.paste')}
                      </MobileMenuItem>
                      <MobileSeparator />
                      <UploadFolder item={item} mobile />
                      <DownloadFolder item={item} mobile />
                      <MobileSeparator />
                      <MobileMenuItem onClick={handleStartRename} disabled={!!item.sha && !item.isLocale}>
                        {t('context.rename')}
                      </MobileMenuItem>
                      <MobileMenuItem
                        disabled={!item.isLocale}
                        className="text-red-600"
                        onClick={() => void handleDeleteFolder()}
                      >
                        {t('context.delete')}
                      </MobileMenuItem>
                    </MobileActionMenu>
                  )}
                </div>
            }
        </FileTreeRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {useSelectionMenu ? (
          <BatchSelectionContextMenu entries={selectionEntries} modKey={modKey} deleteKey={deleteKey} />
        ) : (
          <>
            <NewFile item={item} />
            <NewFolder item={item} />
            <ViewDirectory item={item} />
            <ContextMenuSeparator />
            {/* skills */}
            {!isInSkillsFolder(path) && (
              <>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Database className="mr-2 h-4 w-4" />
                    {t('context.knowledgeBase')}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    <FolderVectorMenu item={item} />
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
              </>
            )}
            <CutFolder item={item} shortcut={`${modKey}X`} />
            <CopyFolder item={item} shortcut={`${modKey}C`} />
            <DuplicateFolder item={item} />
            <PasteInFolder item={item} shortcut={`${modKey}V`} />
            <ContextMenuSeparator />
            <UploadFolder item={item} />
            <DownloadFolder item={item} />
            <ContextMenuSeparator />
            <RenameFolder item={item} onStartRename={handleStartRename} shortcut={renameKey} />
            <DeleteFolder item={item} shortcut={deleteKey} />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
