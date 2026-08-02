"use client"
import * as React from "react"
import { useEffect, useRef, useState, useCallback } from "react"
import useSettingStore from "@/stores/setting"
import { Textarea } from "@/components/ui/textarea"
import useChatStore from "@/stores/chat"
import useArticleStore from "@/stores/article"
import useCanvasStore from "@/stores/canvas"
import { useTranslations } from 'next-intl'
import { useLocalStorage } from 'react-use';
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { ChatSend } from "./chat-send"
import { isLinkedFolder, LinkedResource, MarkdownFile, LinkedFolder } from "@/lib/files"
import emitter from "@/lib/emitter"
import { ChatToolsDrawer } from "@/app/mobile/chat/components/chat-tools-drawer"
import { useIsMobile } from '@/hooks/use-mobile'
import { ImageAttachments, ImageAttachment } from "./image-attachments"
import { ImageIcon } from "lucide-react"
import { isMobileDevice } from '@/lib/check'
import type { PendingQuote } from "@/stores/chat"
import { AgentApprovalPanel } from "./agent-approval-panel"
import { cancelPendingAgentAction, confirmPendingAgentAction } from "./agent-approval-actions"
import { AgentPermissionModeSelect } from "./agent-permission-mode"
import { ContextUsageIndicator } from "./context-usage-indicator"
import { convertFileSrc } from "@tauri-apps/api/core"
import { readTextFile, writeFile, BaseDirectory, exists, mkdir, stat } from "@tauri-apps/plugin-fs"
import { ShineBorder } from "@/components/ui/shine-border"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { buildTypingFrames } from './onboarding-typing'
import { ChatToolsPopover } from './chat-tools-popover'
import { AttachmentAddMenu } from './attachment-add-menu'
import { PendingFileAttachments } from './chat-file-attachments'
import {
  createFileAttachment,
  createFolderAttachment,
  type RuntimeChatAttachment,
} from '@/lib/chat-attachments'
import {
  ChatComposerMenu,
  type ChatComposerMenuHandle,
  type ComposerMenuMode,
} from './chat-composer-menu'
import {
  ChatContextStrip,
  getMentionedContextKey,
  type MentionedContext,
  type MentionedRecord,
} from './chat-context-strip'
import { getMarkListItemContent } from '@/app/core/main/mark/mark-list-item-content'
import { getRecordIdFromTabPath } from '@/app/core/main/mark/mark-record-tab'
import { getCanvasIdFromTabPath } from '@/app/core/main/canvas/canvas-tab'
import { getMarkById, type Mark } from '@/db/marks'
import type { CanvasProject, CanvasSelectionContext } from '@/types/canvas'
import type { SkillMetadata } from '@/lib/skills/types'

const MAX_IMAGE_ATTACHMENTS = 6
const MAX_IMAGE_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024
const IMAGE_ATTACHMENT_DIR = 'screenshot'
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

function getFileName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

function isSupportedImageName(fileName: string) {
  return IMAGE_EXTENSIONS.has(getExtension(fileName))
}

function isSupportedImageType(type: string) {
  return Object.prototype.hasOwnProperty.call(MIME_EXTENSION_MAP, type)
}

function getImageExtension(fileName: string, type: string) {
  const extension = getExtension(fileName)
  if (IMAGE_EXTENSIONS.has(extension)) {
    return extension
  }

  return MIME_EXTENSION_MAP[type] || 'png'
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`
  }

  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}

function createImageAttachmentId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const ChatInput = React.memo(function ChatInput() {
  const [text, setText] = useState("")
  const { primaryModel } = useSettingStore()
  const {
    loading,
    setLinkedResource: setChatLinkedResource,
    setLinkedResourcePreview,
    linkedResourcePreview,
    onboardingPromptDraft,
    setOnboardingPromptDraft,
    pendingQuote,
    setPendingQuote,
    clearPendingQuote,
    editorSelectionQuote,
    clearEditorSelectionQuote,
    agentState,
    isTemporaryConversation,
  } = useChatStore()
  const {
    activeFilePath,
    activeTabId,
    currentArticle,
    openTabs,
  } = useArticleStore()
  const activeTabPath = React.useMemo(
    () => openTabs.find(tab => tab.id === activeTabId)?.path || activeFilePath,
    [activeFilePath, activeTabId, openTabs]
  )
  const canvasSelectionContext = useCanvasStore(state => state.selectionContext)
  const setCanvasSelectionContext = useCanvasStore(state => state.setSelectionContext)
  const [isComposing, setIsComposing] = useState(false)
  const t = useTranslations()
  const defaultPlaceholder = t('record.chat.input.placeholder.default')
  const steeringPlaceholder = t('record.chat.input.placeholder.steering')
  const [inputHistory, setInputHistory] = useLocalStorage<string[]>('chat-input-history', [])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [tempInput, setTempInput] = useState('')
  const [linkedResource, setLinkedResource] = useState<LinkedResource | null>(null)
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([])
  const [fileAttachments, setFileAttachments] = useState<RuntimeChatAttachment[]>([])
  const [contextUsageLinkedContent, setContextUsageLinkedContent] = useState('')
  const [isImageDragOver, setIsImageDragOver] = useState(false)
  const [composerMenu, setComposerMenu] = useState<{
    mode: ComposerMenuMode
    start: number
    query: string
  } | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<SkillMetadata[]>([])
  const [activeTabContext, setActiveTabContext] = useState<MentionedContext | null>(null)
  const [mentionedContexts, setMentionedContexts] = useState<MentionedContext[]>([])
  const chatSendRef = useRef<{ sendChat: () => void } | null>(null)
  const composerMenuRef = useRef<ChatComposerMenuHandle>(null)
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const isMobileDevice_ = isMobileDevice()
  const imageDragDepthRef = useRef(0)
  const onboardingAgentPromptArmedRef = useRef(false)
  const onboardingTypingTimerRefs = useRef<number[]>([])
  const maxImageSizeLabel = formatFileSize(MAX_IMAGE_ATTACHMENT_SIZE_BYTES)
  const activeQuote = pendingQuote || editorSelectionQuote
  const visibleActiveTabContext = React.useMemo(() => {
    if (activeTabContext?.kind === 'record') {
      return activeQuote?.articlePath === activeTabContext.record.articlePath
        ? null
        : activeTabContext
    }
    return activeTabContext
  }, [activeQuote?.articlePath, activeTabContext])
  const visibleMentionedContexts = React.useMemo(
    () => mentionedContexts.filter(context => {
      if (
        visibleActiveTabContext
        && getMentionedContextKey(visibleActiveTabContext) === getMentionedContextKey(context)
      ) {
        return false
      }
      if (context.kind === 'file') {
        return !(
          linkedResource
          && !isLinkedFolder(linkedResource)
          && (
            linkedResource.path === context.file.path
            || linkedResource.relativePath === context.file.relativePath
          )
        )
      }
      if (context.kind === 'record') {
        return activeQuote?.articlePath !== context.record.articlePath
      }
      return canvasSelectionContext?.canvasId !== context.canvas.canvasId
    }),
    [
      activeQuote?.articlePath,
      canvasSelectionContext?.canvasId,
      linkedResource,
      mentionedContexts,
      visibleActiveTabContext,
    ]
  )
  const contextUsageLinkedResourceIsActiveFile = Boolean(
    linkedResource
    && !isLinkedFolder(linkedResource)
    && activeFilePath
    && (
      linkedResource.relativePath === activeFilePath
      || linkedResource.path === activeFilePath
      || linkedResource.name === activeFilePath.split('/').pop()
    )
  )
  const contextUsageAgentRuntime = React.useMemo(() => {
    if (!agentState.isRunning) {
      return ''
    }

    try {
      return JSON.stringify({
        currentThought: agentState.currentThought,
        completedSteps: agentState.completedSteps,
        toolCalls: agentState.toolCalls,
      })
    } catch {
      return ''
    }
  }, [
    agentState.completedSteps,
    agentState.currentThought,
    agentState.isRunning,
    agentState.toolCalls,
  ])
  const contextUsageAdditionalContext = React.useMemo(() => [
    activeFilePath ? currentArticle : '',
    contextUsageLinkedResourceIsActiveFile ? '' : linkedResourcePreview,
    contextUsageLinkedContent,
    linkedResource && !contextUsageLinkedResourceIsActiveFile
      ? `${linkedResource.name}\n${linkedResource.relativePath}`
      : '',
    activeQuote?.fullContent,
    contextUsageAgentRuntime,
    canvasSelectionContext ? JSON.stringify(canvasSelectionContext) : '',
    visibleActiveTabContext
      ? visibleActiveTabContext.kind === 'record'
        ? visibleActiveTabContext.record.fullContent
        : visibleActiveTabContext.kind === 'canvas'
          ? JSON.stringify(visibleActiveTabContext.canvas)
          : `${visibleActiveTabContext.file.name}\n${visibleActiveTabContext.file.relativePath}`
      : '',
    ...visibleMentionedContexts.map(context => {
      if (context.kind === 'file') {
        return `${context.file.name}\n${context.file.relativePath}`
      }
      if (context.kind === 'record') {
        return context.record.fullContent
      }
      return JSON.stringify(context.canvas)
    }),
    ...fileAttachments.map(attachment => attachment.preview || ''),
  ].filter(Boolean).join('\n\n'), [
    activeQuote?.fullContent,
    activeFilePath,
    currentArticle,
    contextUsageAgentRuntime,
    canvasSelectionContext,
    fileAttachments,
    contextUsageLinkedContent,
    linkedResource,
    contextUsageLinkedResourceIsActiveFile,
    linkedResourcePreview,
    visibleMentionedContexts,
    visibleActiveTabContext,
  ])

  useEffect(() => {
    let cancelled = false

    const loadLinkedContent = async () => {
      if (!linkedResource || isLinkedFolder(linkedResource)) {
        setContextUsageLinkedContent('')
        return
      }

      if (contextUsageLinkedResourceIsActiveFile) {
        setContextUsageLinkedContent('')
        return
      }

      try {
        const workspace = await getWorkspacePath()
        const content = workspace.isCustom
          ? await readTextFile(linkedResource.path)
          : await getFilePathOptions(linkedResource.path).then(({ path, baseDir }) =>
              readTextFile(path, { baseDir })
            )
        if (!cancelled) {
          setContextUsageLinkedContent(content)
        }
      } catch {
        if (!cancelled) {
          setContextUsageLinkedContent('')
        }
      }
    }

    void loadLinkedContent()
    return () => {
      cancelled = true
    }
  }, [contextUsageLinkedResourceIsActiveFile, linkedResource])

  const applyTypedText = useCallback((value: string) => {
    setText(value)

    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    window.requestAnimationFrame(() => {
      textarea.style.height = 'auto'
      const newHeight = Math.min(textarea.scrollHeight, 240)
      textarea.style.height = `${newHeight}px`
    })
  }, [])

  function handleComposerTextChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextText = event.target.value
    const cursor = event.target.selectionStart ?? nextText.length
    const trigger = nextText[cursor - 1]
    const previousCharacter = nextText[cursor - 2]
    const isTriggerBoundary = cursor === 1 || /\s/.test(previousCharacter || '')

    if ((trigger === '/' || trigger === '@') && isTriggerBoundary) {
      applyTypedText(nextText)
      setComposerMenu({
        mode: trigger === '/' ? 'command' : 'resource',
        start: cursor - 1,
        query: '',
      })
      return
    }

    if (composerMenu) {
      const menuTrigger = composerMenu.mode === 'command' ? '/' : '@'
      const triggerStillExists = nextText[composerMenu.start] === menuTrigger
      if (!triggerStillExists || cursor <= composerMenu.start) {
        setComposerMenu(null)
      } else {
        setComposerMenu({
          ...composerMenu,
          query: nextText.slice(composerMenu.start + 1, cursor),
        })
      }
    }

    setText(nextText)
    const textarea = event.target
    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, 240)
    textarea.style.height = `${newHeight}px`
  }

  function closeComposerMenu() {
    setComposerMenu(null)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function replaceComposerMenuToken(replacement = '') {
    if (!composerMenu) return

    const tokenEnd = composerMenu.start + composerMenu.query.length + 1
    const nextText = `${text.slice(0, composerMenu.start)}${replacement}${text.slice(tokenEnd)}`
    const nextCursor = composerMenu.start + replacement.length
    applyTypedText(nextText)
    setComposerMenu(null)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function createRecordQuote(mark: Mark): MentionedRecord {
    const display = getMarkListItemContent(mark)
    const fullContent = [mark.content, mark.desc, mark.url]
      .map(value => value?.trim())
      .filter(Boolean)
      .join('\n\n')
    const fileName = display.title || t('record.chat.input.composerMenu.resources.untitledRecord')

    return {
      quote: display.preview || fullContent,
      fullContent,
      fileName,
      startLine: -1,
      endLine: -1,
      from: -1,
      to: -1,
      articlePath: `record:${mark.id}`,
      markType: mark.type,
    }
  }

  function createCanvasContext(project: CanvasProject): CanvasSelectionContext {
    return {
      canvasId: project.id,
      canvasTitle: project.title,
      scope: 'canvas',
      nodes: project.document.nodes.map(node => ({
        id: node.id,
        type: node.type,
        label: String(node.data.label || node.data.description || node.type),
        description: node.data.description,
        filePath: node.data.filePath,
        recordId: node.data.recordId,
        url: node.data.url,
        checked: node.data.checked,
        chart: node.data.chart,
      })),
      edges: project.document.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
      })),
    }
  }

  //
  function addToHistory(input: string) {
    if (!input.trim() || isTemporaryConversation) return
    
    const newHistory = [input, ...(inputHistory || []).filter(item => item !== input)]
    // 50
    const limitedHistory = newHistory.slice(0, 50)
    setInputHistory(limitedHistory)
  }

  //
  function navigateHistory(direction: 'up' | 'down', currentText: string) {
    if (!inputHistory || inputHistory.length === 0) return

    let newIndex: number
    if (direction === 'up') {
      // （）
      if (historyIndex === -1) {
        setTempInput(currentText)
      }
      newIndex = historyIndex + 1
      if (newIndex >= inputHistory.length) {
        newIndex = inputHistory.length - 1
      }
    } else {
      newIndex = historyIndex - 1
      if (newIndex < -1) {
        newIndex = -1
      }
    }

    setHistoryIndex(newIndex)

    if (newIndex === -1) {
      //
      setText(tempInput)
    } else {
      setText(inputHistory[newIndex])
    }
  }

  //
  function removeLinkedFile() {
    setLinkedResource(null)
    setChatLinkedResource(null)
  }

  function removeImage(id: string) {
    setAttachedImages(prev => prev.filter(img => img.id !== id))
  }

  function removeFileAttachment(id: string) {
    setFileAttachments(prev => prev.filter(attachment => attachment.id !== id))
  }

  function appendFileAttachments(attachments: RuntimeChatAttachment[]) {
    setFileAttachments(prev => {
      const existingPaths = new Set(prev.map(attachment => attachment.path.replace(/\\/g, '/').toLowerCase()))
      const next = [...prev]
      for (const attachment of attachments) {
        const normalizedPath = attachment.path.replace(/\\/g, '/').toLowerCase()
        if (existingPaths.has(normalizedPath)) continue
        existingPaths.add(normalizedPath)
        next.push(attachment)
      }
      return next
    })
  }

  function removeQuote() {
    clearPendingQuote()
    clearEditorSelectionQuote()
  }

  function showImageSuccessToast(count: number, key: 'selectSuccess' | 'pasteSuccess' | 'dropSuccess') {
    toast({
      description: t(`record.chat.input.imageAttachment.${key}`, { count })
    })
  }

  function showImageFailureToast(description: string) {
    toast({
      variant: "destructive",
      description
    })
  }

  function showSkippedImageToasts(skipped: {
    unsupported: string[]
    oversized: string[]
    failed: number
  }) {
    if (skipped.unsupported.length === 1) {
      showImageFailureToast(t('record.chat.input.imageAttachment.unsupported', {
        name: skipped.unsupported[0],
      }))
    } else if (skipped.unsupported.length > 1) {
      showImageFailureToast(t('record.chat.input.imageAttachment.unsupportedMultiple', {
        count: skipped.unsupported.length,
      }))
    }

    if (skipped.oversized.length === 1) {
      showImageFailureToast(t('record.chat.input.imageAttachment.oversized', {
        name: skipped.oversized[0],
        size: maxImageSizeLabel,
      }))
    } else if (skipped.oversized.length > 1) {
      showImageFailureToast(t('record.chat.input.imageAttachment.oversizedMultiple', {
        count: skipped.oversized.length,
        size: maxImageSizeLabel,
      }))
    }

    if (skipped.failed === 1) {
      showImageFailureToast(t('record.chat.input.imageAttachment.saveFailed'))
    } else if (skipped.failed > 1) {
      showImageFailureToast(t('record.chat.input.imageAttachment.saveFailedMultiple', {
        count: skipped.failed,
      }))
    }
  }

  function appendImageAttachments(images: ImageAttachment[], successKey: 'selectSuccess' | 'pasteSuccess' | 'dropSuccess') {
    if (images.length === 0) {
      return 0
    }

    const remainingCount = MAX_IMAGE_ATTACHMENTS - attachedImages.length
    if (remainingCount <= 0) {
      showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
        count: MAX_IMAGE_ATTACHMENTS,
      }))
      return 0
    }

    const acceptedImages = images.slice(0, remainingCount)
    if (images.length > remainingCount) {
      showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
        count: MAX_IMAGE_ATTACHMENTS,
      }))
    }

    setAttachedImages(prev => [...prev, ...acceptedImages])
    showImageSuccessToast(acceptedImages.length, successKey)
    return acceptedImages.length
  }

  async function ensureImageAttachmentDir() {
    const dirExists = await exists(IMAGE_ATTACHMENT_DIR, { baseDir: BaseDirectory.AppData })
    if (!dirExists) {
      await mkdir(IMAGE_ATTACHMENT_DIR, { baseDir: BaseDirectory.AppData })
    }
  }

  async function resolveAppDataFilePath(filePath: string) {
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const appData = await appDataDir()
    return await join(appData, filePath)
  }

  async function createAttachmentFromBlob(blob: Blob, name: string, source: 'file' | 'paste') {
    const extension = getImageExtension(name, blob.type)
    const fileName = `${source}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`
    const filePath = `${IMAGE_ATTACHMENT_DIR}/${fileName}`
    const arrayBuffer = await blob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)

    await ensureImageAttachmentDir()
    await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })

    const fullPath = await resolveAppDataFilePath(filePath)
    return {
      id: createImageAttachmentId(source),
      url: convertFileSrc(fullPath),
      name: fileName,
      source
    } satisfies ImageAttachment
  }

  async function buildAttachmentsFromBrowserFiles(files: File[], source: 'file' | 'paste', maxCount: number) {
    const newImages: ImageAttachment[] = []
    const skipped = {
      unsupported: [] as string[],
      oversized: [] as string[],
      failed: 0,
    }

    for (const file of files) {
      if (newImages.length >= maxCount) {
        break
      }

      const fileName = file.name || `${source}-image`
      if (!isSupportedImageType(file.type) && !isSupportedImageName(fileName)) {
        skipped.unsupported.push(fileName)
        continue
      }

      if (file.size > MAX_IMAGE_ATTACHMENT_SIZE_BYTES) {
        skipped.oversized.push(fileName)
        continue
      }

      try {
        newImages.push(await createAttachmentFromBlob(file, fileName, source))
      } catch (error) {
        console.error('Failed to save image attachment:', error)
        skipped.failed += 1
      }
    }

    showSkippedImageToasts(skipped)
    return newImages
  }

  async function buildAttachmentsFromLocalPaths(paths: string[], maxCount: number) {
    const newImages: ImageAttachment[] = []
    const skipped = {
      unsupported: [] as string[],
      oversized: [] as string[],
      failed: 0,
    }

    for (const path of paths) {
      if (newImages.length >= maxCount) {
        break
      }

      const fileName = getFileName(path)
      if (!isSupportedImageName(fileName)) {
        skipped.unsupported.push(fileName)
        continue
      }

      try {
        const fileStat = await stat(path)
        if (typeof fileStat.size === 'number' && fileStat.size > MAX_IMAGE_ATTACHMENT_SIZE_BYTES) {
          skipped.oversized.push(fileName)
          continue
        }

        newImages.push({
          id: createImageAttachmentId('local'),
          url: convertFileSrc(path),
          name: fileName,
          source: 'file' as const
        })
      } catch (error) {
        console.error('Failed to read selected image:', error)
        skipped.failed += 1
      }
    }

    showSkippedImageToasts(skipped)
    return newImages
  }

  async function handleSelectLocalImages() {
    try {
      if (attachedImages.length >= MAX_IMAGE_ATTACHMENTS) {
        showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
          count: MAX_IMAGE_ATTACHMENTS,
        }))
        return
      }

      // HTML5 file input
      if (isMobileDevice_) {
        imageInputRef.current?.click()
        return
      }

      // PC Tauri dialog
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
        }]
      })

      if (selected && Array.isArray(selected)) {
        const remainingCount = MAX_IMAGE_ATTACHMENTS - attachedImages.length
        if (selected.length > remainingCount) {
          showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
            count: MAX_IMAGE_ATTACHMENTS,
          }))
        }

        const newImages = await buildAttachmentsFromLocalPaths(selected, remainingCount)
        appendImageAttachments(newImages, 'selectSuccess')
      }
    } catch (error) {
      console.error('Failed to select files:', error)
      showImageFailureToast(t('record.chat.input.imageAttachment.selectFailed'))
    }
  }

  async function handleSelectLocalFiles() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: true, directory: false })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      const results = await Promise.allSettled(paths.map(createFileAttachment))
      appendFileAttachments(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []))
      const failed = results.filter(result => result.status === 'rejected').length
      if (failed > 0) {
        showImageFailureToast(t('record.chat.input.addAttachment.readFailed', { count: failed }))
      }
    } catch (error) {
      console.error('Failed to select file attachments:', error)
      showImageFailureToast(t('record.chat.input.addAttachment.selectFailed'))
    }
  }

  async function handleSelectLocalFolders() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: true, directory: true })
      if (!selected) return
      const paths = Array.isArray(selected) ? selected : [selected]
      const results = await Promise.allSettled(paths.map(createFolderAttachment))
      appendFileAttachments(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []))
      const failed = results.filter(result => result.status === 'rejected').length
      if (failed > 0) {
        showImageFailureToast(t('record.chat.input.addAttachment.readFailed', { count: failed }))
      }
    } catch (error) {
      console.error('Failed to select folder attachments:', error)
      showImageFailureToast(t('record.chat.input.addAttachment.selectFailed'))
    }
  }

  // ，
  async function handleSelectFromGallery() {
    if (attachedImages.length >= MAX_IMAGE_ATTACHMENTS) {
      showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
        count: MAX_IMAGE_ATTACHMENTS,
      }))
      return
    }

    if (isMobileDevice_) {
      if (imageInputRef.current) {
        imageInputRef.current.removeAttribute('capture')
        imageInputRef.current.click()
      }
    }
  }

  //
  async function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      const files = event.target.files
      if (!files || files.length === 0) return

      const selectedFiles = Array.from(files)
      const remainingCount = MAX_IMAGE_ATTACHMENTS - attachedImages.length
      const imageCandidateCount = selectedFiles.filter(file => isSupportedImageType(file.type) || isSupportedImageName(file.name)).length
      if (imageCandidateCount > remainingCount) {
        showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
          count: MAX_IMAGE_ATTACHMENTS,
        }))
      }

      const newImages = await buildAttachmentsFromBrowserFiles(selectedFiles, 'file', remainingCount)
      appendImageAttachments(newImages, 'selectSuccess')
      
      // input
      event.target.value = ''
    } catch (error) {
      console.error('Error in handleImageInputChange:', error)
      showImageFailureToast(t('record.chat.input.imageAttachment.selectFailed'))
    }
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    e.preventDefault()

    const files = imageItems
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    const remainingCount = MAX_IMAGE_ATTACHMENTS - attachedImages.length
    const imageCandidateCount = files.filter(file => isSupportedImageType(file.type) || isSupportedImageName(file.name)).length
    if (imageCandidateCount > remainingCount) {
      showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
        count: MAX_IMAGE_ATTACHMENTS,
      }))
    }

    const newImages = await buildAttachmentsFromBrowserFiles(files, 'paste', remainingCount)
    appendImageAttachments(newImages, 'pasteSuccess')
  }

  function hasImageTransfer(dataTransfer: DataTransfer) {
    const items = Array.from(dataTransfer.items || [])
    if (items.some(item => item.kind === 'file' && isSupportedImageType(item.type))) {
      return true
    }

    return Array.from(dataTransfer.files || []).some(file => isSupportedImageType(file.type) || isSupportedImageName(file.name))
  }

  function hasFileTransfer(dataTransfer: DataTransfer) {
    const items = Array.from(dataTransfer.items || [])
    return items.some(item => item.kind === 'file') || Array.from(dataTransfer.files || []).length > 0
  }

  function handleImageDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!primaryModel || !hasFileTransfer(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    if (!hasImageTransfer(e.dataTransfer)) {
      return
    }

    imageDragDepthRef.current += 1
    setIsImageDragOver(true)
  }

  function handleImageDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!primaryModel || !hasFileTransfer(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (hasImageTransfer(e.dataTransfer)) {
      setIsImageDragOver(true)
    }
  }

  function handleImageDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!isImageDragOver && !hasImageTransfer(e.dataTransfer)) {
      return
    }

    imageDragDepthRef.current = Math.max(0, imageDragDepthRef.current - 1)
    if (imageDragDepthRef.current === 0) {
      setIsImageDragOver(false)
    }
  }

  async function handleImageDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileTransfer(e.dataTransfer)) {
      imageDragDepthRef.current = 0
      setIsImageDragOver(false)
      return
    }

    e.preventDefault()
    imageDragDepthRef.current = 0
    setIsImageDragOver(false)

    if (!primaryModel) {
      return
    }

    const files = Array.from(e.dataTransfer.files || [])
    const remainingCount = MAX_IMAGE_ATTACHMENTS - attachedImages.length
    const imageCandidateCount = files.filter(file => isSupportedImageType(file.type) || isSupportedImageName(file.name)).length
    if (imageCandidateCount > remainingCount) {
      showImageFailureToast(t('record.chat.input.imageAttachment.maxCount', {
        count: MAX_IMAGE_ATTACHMENTS,
      }))
    }

    const newImages = await buildAttachmentsFromBrowserFiles(files, 'file', remainingCount)
    appendImageAttachments(newImages, 'dropSuccess')
  }

  //
  function handleSent() {
    if (onboardingAgentPromptArmedRef.current) {
      onboardingAgentPromptArmedRef.current = false
      emitter.emit('onboarding-step-complete', { step: 'ai-polish' })
    }
    addToHistory(text)
    setText('')
    setComposerMenu(null)
    setHistoryIndex(-1)
    setAttachedImages([])
    setFileAttachments([])
    setSelectedSkills([])
    setMentionedContexts([])
    clearPendingQuote()
    if (isMobileDevice_) {
      clearEditorSelectionQuote()
    }
    const textarea = document.querySelector('textarea')
    if (textarea) {
      textarea.style.height = 'auto'
    }
  }

  useEffect(() => {
    emitter.on('revertChat', (event: unknown) => {
      setText(event as string)
    })
    emitter.on('fileSelected', (event: unknown) => {
      setLinkedResource(event as MarkdownFile)
      setChatLinkedResource(event as MarkdownFile)
    })
    emitter.on('folderSelected', (event: unknown) => {
      setLinkedResource(event as LinkedFolder)
      setChatLinkedResource(event as LinkedFolder)
    })
    emitter.on('insert-quote', (event: unknown) => {
      const data = event as PendingQuote
      setPendingQuote(data)
      //
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    })
    emitter.on('quick-prompt-insert', (prompt: string) => {
      setText(prompt)
      textareaRef.current?.focus()
    })
    return () => {
      onboardingTypingTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId))
      onboardingTypingTimerRefs.current = []
      emitter.off('revertChat')
      emitter.off('fileSelected')
      emitter.off('folderSelected')
      emitter.off('insert-quote')
      emitter.off('quick-prompt-insert')
    }
  }, [setPendingQuote])

  useEffect(() => {
    if (!onboardingPromptDraft) {
      return
    }

    onboardingAgentPromptArmedRef.current = true
    onboardingTypingTimerRefs.current.forEach((timerId) => window.clearTimeout(timerId))
    onboardingTypingTimerRefs.current = []
    setText('')
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 50)

    const frames = buildTypingFrames(onboardingPromptDraft, 2)
    frames.forEach((frame, index) => {
      const timerId = window.setTimeout(() => {
        applyTypedText(frame)
        if (index === frames.length - 1) {
          onboardingTypingTimerRefs.current = []
          setOnboardingPromptDraft(null)
        }
      }, 160 + index * 42)
      onboardingTypingTimerRefs.current.push(timerId)
    })
  }, [applyTypedText, onboardingPromptDraft, setOnboardingPromptDraft])

  // （ AI ）
  async function generateFilePreview(filePath: string, isCustom: boolean, preferEditorContent: boolean = false): Promise<string> {
    try {
      if (preferEditorContent) {
        const editorContent = await new Promise<{
          markdown: string
          totalLines?: number
          numberedLines?: string
          version: number
        } | null>((resolve) => {
          emitter.emit('editor-get-content', {
            resolve: (data: { markdown: string; totalLines?: number; numberedLines?: string; version: number }) => {
              resolve(data)
            },
          })

          window.setTimeout(() => resolve(null), 300)
        })

        if (editorContent?.numberedLines) {
          const numberedLines = editorContent.numberedLines.split('\n')
          const previewLines = numberedLines.slice(0, 100)
          const totalLines = editorContent.totalLines || numberedLines.length
          const truncatedNote = totalLines > 100 ? `\n... (${totalLines} lines total, last ${totalLines - 100} omitted)` : ''

          return `Linked current editor file: ${filePath.split('/').pop() || filePath}
You can use editor_replace_lines directly with the line numbers and version below.

Editor version: v${editorContent.version}
Line preview:
\`\`\`
${previewLines.join('\n')}
\`\`\`${truncatedNote}

Prefer:
- Edit a block/list: editor_replace_lines({startLine: 4, endLine: 5, replaceContent: "new content", version: ${editorContent.version}})
- Only use from/to when you have an exact selection range
`
        }
      }

      //
      const fileExists = isCustom
        ? await exists(filePath)
        : await exists(filePath, { baseDir: BaseDirectory.AppData })

      if (!fileExists) {
        return `File ${filePath.split('/').pop() || filePath}`
      }

      let content: string
      if (isCustom) {
        content = await readTextFile(filePath)
      } else {
        content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
      }

      const lines = content.split('\n')
      const previewLines = lines.slice(0, 100).map((line, index) => {
        const lineNum = index + 1
        const preview = line.length > 60 ? line.slice(0, 60) + '...' : line
        return `${String(lineNum).padStart(4)} | ${preview}`
      })

      const totalLines = lines.length
      const truncatedNote = totalLines > 100 ? `\n... (${totalLines} lines total, last ${totalLines - 100} omitted)` : ''

      return `Linked file: ${filePath.split('/').pop() || filePath}
To edit this non-active file, generate updated Markdown from the full content and write it with note_update_file.

Line preview:
\`\`\`
${previewLines.join('\n')}
\`\`\`${truncatedNote}

Examples:
- Update file: note_update_file({filePath: "${filePath}", content: "updated Markdown"})
`
    } catch (error) {
      console.error('File Failed', error)
      return `Linked file: ${filePath.split('/').pop() || filePath}
(Unable to read file content)`
    }
  }

  // markdown
  useEffect(() => {
    let cancelled = false

    async function linkCurrentResource() {
      if (!activeTabPath) {
        setActiveTabContext(null)
        setLinkedResource(null)
        setChatLinkedResource(null)
        setLinkedResourcePreview(null)
        return
      }

      const recordId = getRecordIdFromTabPath(activeTabPath)
      if (recordId !== null) {
        const mark = await getMarkById(recordId)
        if (cancelled) return
        setActiveTabContext(mark && mark.deleted === 0
          ? { kind: 'record', record: createRecordQuote(mark) }
          : null)
        setLinkedResource(null)
        setChatLinkedResource(null)
        setLinkedResourcePreview(null)
        return
      }

      const canvasId = getCanvasIdFromTabPath(activeTabPath)
      if (canvasId !== null) {
        const canvasStore = useCanvasStore.getState()
        const project = canvasStore.projects.find(item => item.id === canvasId)
          || await canvasStore.openProject(canvasId)
        if (cancelled) return
        const latestDocument = useCanvasStore.getState().documents[canvasId]
        setActiveTabContext(project
          ? {
              kind: 'canvas',
              canvas: createCanvasContext({
                ...project,
                document: latestDocument || project.document,
              }),
            }
          : null)
        setLinkedResource(null)
        setChatLinkedResource(null)
        setLinkedResourcePreview(null)
        return
      }

      const workspace = await getWorkspacePath()
      if (cancelled) return

      // （ markdown、）
      if (activeTabPath.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i)) {
        //
        const fileName = activeTabPath.split('/').pop() || activeTabPath

        //
        let fullPath: string
        if (workspace.isCustom) {
          const pathParts = activeTabPath.split('/')
          fullPath = workspace.path + '/' + pathParts.join('/')
        } else {
          fullPath = activeTabPath
        }

        const resource = {
          name: fileName,
          path: fullPath,
          relativePath: activeTabPath
        }
        setActiveTabContext(null)
        setLinkedResource(resource)
        setChatLinkedResource(resource)
        setLinkedResourcePreview(null)

        //
        const preview = await generateFilePreview(fullPath, workspace.isCustom, activeTabPath === resource.relativePath)
        if (cancelled) return
        setLinkedResourcePreview(preview)
      } else if (!activeTabPath.includes('.')) {
        // - .
        const folderName = activeTabPath.split('/').pop() || activeTabPath

        //
        let fullPath: string
        if (workspace.isCustom) {
          const pathParts = activeTabPath.split('/')
          fullPath = workspace.path + '/' + pathParts.join('/')
        } else {
          fullPath = activeTabPath
        }

        //
        const { collectMarkdownFiles } = await import('@/lib/files')
        const files = await collectMarkdownFiles(activeTabPath)
        if (cancelled) return
        const { vectorIndexedFiles } = useArticleStore.getState()
        const indexedCount = files.filter(f =>
          vectorIndexedFiles.has(f.path)
        ).length

        //
        if (indexedCount > 0) {
          const resource = {
            name: folderName,
            path: fullPath,
            relativePath: activeTabPath,
            fileCount: files.length,
            indexedCount: indexedCount
          }
          setActiveTabContext(null)
          setLinkedResource(resource)
          setChatLinkedResource(resource)
          //
          setLinkedResourcePreview(null)
        } else {
          // ，
          setActiveTabContext(null)
          setLinkedResource(null)
          setChatLinkedResource(null)
          setLinkedResourcePreview(null)
        }
      } else {
        // （ .docx, .pdf ），
        setActiveTabContext(null)
        setLinkedResource(null)
        setChatLinkedResource(null)
        setLinkedResourcePreview(null)
      }
    }

    void linkCurrentResource()
    return () => {
      cancelled = true
    }
  }, [activeTabPath])

  return (
    <footer
      id="onboarding-target-chat-input"
      className={cn(
        "relative flex w-full flex-col items-center justify-between",
        isMobile ? "px-2 pb-1 pt-0" : "p-1"
      )}
    >
      {/* */}
      {isMobileDevice_ && (
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleImageInputChange}
          className="hidden"
        />
      )}
      <AgentApprovalPanel
        pendingConfirmation={agentState.pendingConfirmation}
        onConfirm={confirmPendingAgentAction}
        onCancel={cancelPendingAgentAction}
      />
      <div
        className={cn(
          "group relative z-10 flex w-full flex-col overflow-hidden border",
          isMobile
            ? "mobile-dock-surface gap-1 rounded-[1.35rem] p-1.5 transition-[background-color,border-color,transform] duration-200 focus-within:border-border/80"
            : "gap-1 rounded-xl bg-background p-1 transition-colors focus-within:border-primary",
          isImageDragOver && (
            isMobile
              ? "border-primary/50 bg-[hsl(var(--component-active-bg))]"
              : "border-primary bg-primary/5"
          )
        )}
        onDragEnter={handleImageDragEnter}
        onDragOver={handleImageDragOver}
        onDragLeave={handleImageDragLeave}
        onDrop={handleImageDrop}
      >
        {loading && (
          <ShineBorder
            borderWidth={1}
            duration={5}
            shineColor={["#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A"]}
          />
        )}
        {isImageDragOver && (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-20 flex items-center justify-center",
              isMobile ? "bg-background/60 backdrop-blur-xl" : "bg-background/80 backdrop-blur-[1px]"
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2 border px-3 py-2 text-sm text-foreground",
                isMobile ? "mobile-dock-surface rounded-2xl" : "rounded-md bg-background shadow-sm"
              )}
            >
              <ImageIcon className="size-4 text-primary" />
              <span>{t('record.chat.input.imageAttachment.dropHint')}</span>
            </div>
          </div>
        )}
        <ChatContextStrip
          linkedResource={linkedResource}
          activeTabContext={visibleActiveTabContext}
          quoteData={activeQuote}
          canvasContext={canvasSelectionContext}
          selectedSkills={selectedSkills}
          mentionedContexts={visibleMentionedContexts}
          onRemoveLinkedResource={removeLinkedFile}
          onRemoveActiveTabContext={() => setActiveTabContext(null)}
          onRemoveQuote={removeQuote}
          onRemoveCanvas={() => setCanvasSelectionContext(null)}
          onRemoveSkill={skillId => {
            setSelectedSkills(current => current.filter(skill => skill.id !== skillId))
          }}
          onRemoveMentionedContext={key => {
            setMentionedContexts(current =>
              current.filter(context => getMentionedContextKey(context) !== key)
            )
          }}
        />
        <ImageAttachments images={attachedImages} onRemove={removeImage} />
        <PendingFileAttachments attachments={fileAttachments} onRemove={removeFileAttachment} />
        <div className="relative w-full flex items-start">
          <Textarea
            ref={textareaRef}
            className={cn(
              "relative flex-1 resize-none overflow-y-auto border-none p-2 shadow-none focus-visible:ring-0",
              isMobile
                ? "min-h-[40px] max-h-[220px] bg-transparent text-sm placeholder:text-sm"
                : "min-h-[36px] max-h-[240px] text-xs placeholder:text-sm md:placeholder:text-sm md:text-sm"
            )}
            rows={1}
            disabled={!primaryModel}
            value={text}
            onChange={handleComposerTextChange}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={Boolean(composerMenu)}
            aria-controls={composerMenu ? "chat-composer-menu-listbox" : undefined}
            aria-haspopup="listbox"
            aria-label={defaultPlaceholder}
            placeholder={loading ? steeringPlaceholder : defaultPlaceholder}
            onKeyDown={(e) => {
              const textarea = e.target as HTMLTextAreaElement
              const cursorPosition = textarea.selectionStart
              const isAtStart = cursorPosition === 0
              const isAtEnd = cursorPosition === text.length

              if (composerMenu && !isComposing) {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  composerMenuRef.current?.moveSelection(1)
                  return
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  composerMenuRef.current?.moveSelection(-1)
                  return
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault()
                  composerMenuRef.current?.selectCurrent()
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  closeComposerMenu()
                  return
                }
              }

              if (e.key === "Enter" && !isComposing && !e.shiftKey && e.keyCode === 13) {
                e.preventDefault()
                chatSendRef.current?.sendChat()
              }
              if (e.key === "ArrowUp" && !isComposing) {
                if (isAtStart) {
                  e.preventDefault()
                  navigateHistory('up', text)
                } else if (isAtEnd) {
                  e.preventDefault()
                  //
                  textarea.setSelectionRange(0, 0)
                }
              }
              if (e.key === "ArrowDown" && !isComposing) {
                if (isAtStart) {
                  e.preventDefault()
                  navigateHistory('down', text)
                } else if (isAtEnd) {
                  e.preventDefault()
                  //
                  textarea.setSelectionRange(0, 0)
                }
              }
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setTimeout(() => {
              setIsComposing(false)
            }, 0)}
            onBlur={() => {
              window.requestAnimationFrame(() => {
                if (document.activeElement !== textareaRef.current) {
                  setComposerMenu(null)
                }
              })
            }}
            onPaste={handlePaste}
          />
        </div>
        
        <div className="flex justify-between items-center w-full">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <AttachmentAddMenu
              mobile={isMobile}
              disabled={!primaryModel}
              onSelectImages={isMobile ? handleSelectFromGallery : handleSelectLocalImages}
              onSelectFiles={handleSelectLocalFiles}
              onSelectFolders={handleSelectLocalFolders}
            />
            {!isMobile ? (
              <ChatToolsPopover />
            ) : (
              <div className="flex overflow-x-auto scrollbar-hide md:overflow-visible gap-1">
                <ChatToolsDrawer />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 pr-1">
            <ContextUsageIndicator
              currentUserInput={text}
              additionalContext={contextUsageAdditionalContext}
              imageCount={attachedImages.length}
            />
            <AgentPermissionModeSelect />
            <ChatSend
              inputValue={text}
              onSent={handleSent}
              linkedResource={linkedResource}
              attachedImages={attachedImages}
              fileAttachments={fileAttachments}
              quoteData={activeQuote}
              canvasSelectionContext={canvasSelectionContext}
              selectedSkillIds={selectedSkills.map(skill => skill.id)}
              mentionedFiles={[
                ...(visibleActiveTabContext ? [visibleActiveTabContext] : []),
                ...visibleMentionedContexts,
              ].flatMap(context =>
                context.kind === 'file' ? [context.file] : []
              )}
              mentionedRecords={[
                ...(visibleActiveTabContext ? [visibleActiveTabContext] : []),
                ...visibleMentionedContexts,
              ].flatMap(context =>
                context.kind === 'record' ? [context.record] : []
              )}
              mentionedCanvases={[
                ...(visibleActiveTabContext ? [visibleActiveTabContext] : []),
                ...visibleMentionedContexts,
              ].flatMap(context =>
                context.kind === 'canvas' ? [context.canvas] : []
              )}
              dockStyle={isMobile}
              ref={chatSendRef}
            />
          </div>
        </div>

      </div>
      <ChatComposerMenu
        ref={composerMenuRef}
        mode={composerMenu?.mode ?? null}
        query={composerMenu?.query ?? ''}
        onClose={closeComposerMenu}
        onCommandSelect={prompt => replaceComposerMenuToken(prompt)}
        onFileSelect={file => {
          const duplicatesLinkedFile = Boolean(
            linkedResource
            && !isLinkedFolder(linkedResource)
            && linkedResource.path === file.path
          )
          if (!duplicatesLinkedFile) {
            const context: MentionedContext = { kind: 'file', file }
            const key = getMentionedContextKey(context)
            setMentionedContexts(current =>
              current.some(selected => getMentionedContextKey(selected) === key)
                ? current
                : [...current, context]
            )
          }
          replaceComposerMenuToken()
        }}
        onRecordSelect={mark => {
          const record = createRecordQuote(mark)
          if (activeQuote?.articlePath !== record.articlePath) {
            const context: MentionedContext = { kind: 'record', record }
            const key = getMentionedContextKey(context)
            setMentionedContexts(current =>
              current.some(selected => getMentionedContextKey(selected) === key)
                ? current
                : [...current, context]
            )
          }
          replaceComposerMenuToken()
        }}
        onCanvasSelect={project => {
          const canvas = createCanvasContext(project)
          if (canvasSelectionContext?.canvasId !== canvas.canvasId) {
            const context: MentionedContext = { kind: 'canvas', canvas }
            const key = getMentionedContextKey(context)
            setMentionedContexts(current =>
              current.some(selected => getMentionedContextKey(selected) === key)
                ? current
                : [...current, context]
            )
          }
          replaceComposerMenuToken()
        }}
        onSkillSelect={skill => {
          setSelectedSkills(current =>
            current.some(selected => selected.id === skill.id)
              ? current
              : [...current, skill]
          )
          replaceComposerMenuToken()
        }}
      />
    </footer>
  )
})
ChatInput.displayName = 'ChatInput'
