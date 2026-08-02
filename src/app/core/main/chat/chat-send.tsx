"use client"
import { Send, Square } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { TooltipButton } from "@/components/tooltip-button"
import { useImperativeHandle, forwardRef, useRef } from "react"
import { useTranslations } from "next-intl"
import { LinkedResource, isLinkedFolder, type MarkdownFile } from "@/lib/files"
import { readTextFile } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { AgentHandler } from "@/lib/agent/agent-handler"
import { isRequestAbortError } from "@/lib/agent/runtime"
import { agentDebugLog, previewText } from "@/lib/agent/debug-log"
import { getToolByName } from "@/lib/agent/tools"
import { getSessionApprovalScope, matchesSessionApproval } from "@/lib/agent/session-approval"
import { ImageAttachment } from "./image-attachments"
import { cn } from "@/lib/utils"
import type { AgentTraceEvent } from "@/lib/agent/types"
import type { AgentApprovalDecision, AgentSteeringPayload } from "@/lib/agent/types"
import { serializeChatAttachments, type RuntimeChatAttachment } from '@/lib/chat-attachments'
import { retainCompletedAgentTraceEvents } from '@/lib/agent/trace-retention'
import { getAISettings } from '@/lib/ai/utils'
import {
  buildChatImageContext,
  buildHistoricalImageContext,
  collectAgentImageAttachments,
  createPendingChatImageAnalyses,
  serializeChatImageAnalyses,
  type PersistedChatImageAnalysis,
} from '@/lib/chat-image-context'
import type { Chat } from '@/db/chats'
import {
  confirmEstimatedContextWindow,
  learnContextWindow,
  parseContextOverflowError,
  reduceLearnedContextWindow,
} from '@/lib/ai/model-capacity'
import type { CanvasSelectionContext } from '@/types/canvas'

function buildCanvasSelectionContext(context: CanvasSelectionContext | null) {
  if (!context) return ''
  const nodeLabels = new Map(context.nodes.map(node => [node.id, node.label]))
  const nodes = context.nodes.length > 0
    ? context.nodes.map(node => {
        const details = [
          `id=${node.id}`,
          `type=${node.type}`,
          `label=${JSON.stringify(node.label)}`,
          node.description ? `description=${JSON.stringify(node.description)}` : '',
          node.filePath ? `filePath=${JSON.stringify(node.filePath)}` : '',
          node.recordId !== undefined ? `recordId=${node.recordId}` : '',
          node.url ? `url=${JSON.stringify(node.url)}` : '',
          node.checked !== undefined ? `checked=${node.checked}` : '',
          node.chart ? `chartData=${JSON.stringify({
            title: node.chart.title,
            type: node.chart.type,
            categoryLabel: node.chart.categoryLabel,
            series: node.chart.series,
            data: node.chart.data,
            primarySeriesId: node.chart.primarySeriesId,
            sourceFormat: node.chart.sourceFormat,
          })}` : '',
        ].filter(Boolean)
        return `- ${details.join('; ')}`
      }).join('\n')
    : '- None'
  const edges = context.edges.length > 0
    ? context.edges.map(edge => (
        `- id=${edge.id}; source=${edge.source}${nodeLabels.has(edge.source) ? ` (${JSON.stringify(nodeLabels.get(edge.source))})` : ''}; target=${edge.target}${nodeLabels.has(edge.target) ? ` (${JSON.stringify(nodeLabels.get(edge.target))})` : ''}${edge.label ? `; label=${JSON.stringify(edge.label)}` : ''}`
      )).join('\n')
    : '- None'
  const selectionGuidance = context.scope === 'selection'
    ? 'These nodes are the objects the user explicitly selected for this conversation; edges include selected edges and existing links among selected nodes. Prefer these exact IDs when answering or calling canvas tools; do not modify unselected elements unless the user asks.'
    : 'Below is the full canvas the user linked. Use node content and edge relationships when answering; use the exact IDs provided here for canvas tools.'
  return [
    context.scope === 'selection' ? '## Selected canvas nodes and relationships' : '## Linked canvas',
    `Canvas: ${context.canvasTitle} (ID: ${context.canvasId})`,
    selectionGuidance,
    '',
    'Nodes:',
    nodes,
    '',
    'Edges:',
    edges,
    '',
  ].join('\n')
}

function getLastDisplayableAgentContent(
  liveContent: string | undefined,
  traceEvents: AgentTraceEvent[]
) {
  const currentContent = liveContent?.trim()
  if (currentContent) {
    return currentContent
  }

  for (let index = traceEvents.length - 1; index >= 0; index -= 1) {
    const event = traceEvents[index]
    if (
      (event.type === 'model_call' || event.type === 'model_response')
      && typeof event.output === 'string'
      && event.output.trim()
    ) {
      return event.output.trim()
    }

    if (event.type === 'final' && event.message?.trim()) {
      return event.message.trim()
    }
  }

  return ''
}

function isUnknownProviderError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return /500 Internal Server Error/i.test(text)
    && /"code"\s*:\s*60000/.test(text)
    && /Unknown error/i.test(text)
}

interface QuoteData {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

interface ChatSendProps {
  inputValue: string;
  onSent?: () => void;
  linkedResource?: LinkedResource | null;
  attachedImages?: ImageAttachment[];
  fileAttachments?: RuntimeChatAttachment[];
  quoteData?: QuoteData | null;
  canvasSelectionContext?: CanvasSelectionContext | null;
  selectedSkillIds?: string[];
  mentionedFiles?: MarkdownFile[];
  mentionedRecords?: QuoteData[];
  mentionedCanvases?: CanvasSelectionContext[];
  dockStyle?: boolean;
}

export const ChatSend = forwardRef<{ sendChat: () => void }, ChatSendProps>(({
  inputValue,
  onSent,
  linkedResource,
  attachedImages = [],
  fileAttachments = [],
  quoteData = null,
  canvasSelectionContext = null,
  selectedSkillIds = [],
  mentionedFiles = [],
  mentionedRecords = [],
  mentionedCanvases = [],
  dockStyle = false,
}, ref) => {
  const { primaryModel, agentPermissionMode } = useSettingStore()
  const { currentTagId } = useTagStore()
  const {
    insert,
    loading,
    setLoading,
    saveChat,
    setAgentState,
    linkedResourcePreview,
  } = useChatStore()
  const abortControllerRef = useRef<AbortController | null>(null)
  const imageAnalysisAbortControllerRef = useRef<AbortController | null>(null)
  const agentHandlerRef = useRef<AgentHandler | null>(null)
  const manualStopRequestedRef = useRef(false)
  const steeringSequenceRef = useRef(0)
  const steeringChainRef = useRef<Promise<void>>(Promise.resolve())
  const pendingSteeringRef = useRef<AgentSteeringPayload[]>([])
  const activeRunRef = useRef(false)
  const repeatedScriptApprovalRef = useRef<{ signature: string; count: number }>({ signature: '', count: 0 })
  const contextOverflowRetryRef = useRef(0)
  const t = useTranslations()
  const requestText = inputValue.trim() || t('record.chat.input.addAttachment.attachmentOnlyPrompt')

  const buildPartialSuccessContent = (result: string, toolCalls: { result?: { success?: boolean; data?: any; error?: string } }[]) => {
    const generatedOutputFiles = toolCalls.flatMap((toolCall) => {
      const outputFiles = toolCall.result?.data?.output_files
      return Array.isArray(outputFiles) ? outputFiles : []
    })

    const uniqueOutputFiles = Array.from(new Set(generatedOutputFiles.filter((file): file is string => typeof file === 'string' && file.trim().length > 0)))
    if (uniqueOutputFiles.length === 0) {
      return null
    }

    const failedToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.result?.success === false)
    const failureMessage = failedToolCall?.result?.error || result

    return [
      `Successfully generated file:`,
      uniqueOutputFiles.map((file) => `- ${file}`).join('\n'),
      '',
      `Follow-up validation or extra step failed: ${failureMessage}`,
    ].join('\n')
  }

  const sanitizeAgentFinalContent = (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) {
      return trimmed
    }

    const markers = ['\nThought:', '\nAction:', '\nAction Input:']
    let cutoff = trimmed.length

    for (const marker of markers) {
      const index = trimmed.indexOf(marker)
      if (index !== -1) {
        cutoff = Math.min(cutoff, index)
      }
    }

    const leadingActionIndex = trimmed.search(/^(Thought:|Action:|Action Input:)/)
    if (leadingActionIndex === 0) {
      const finalAnswerMatch = trimmed.match(/Final Answer[:：]\s*([\s\S]*)/i)
      if (finalAnswerMatch) {
        return finalAnswerMatch[1].trim()
      }
    }

    return trimmed.slice(0, cutoff).trim()
  }

  const buildSteeringContext = async () => {
    const useArticleStore = (await import('@/stores/article')).default
    const articleStore = useArticleStore.getState()
    let context = ''

    if (articleStore.activeFilePath && articleStore.currentArticle) {
      context += `## Currently open note\nFile path: ${articleStore.activeFilePath}\n\nContent:\n${articleStore.currentArticle}\n\n`
    }

    if (linkedResource && isLinkedFolder(linkedResource)) {
      context += `## Linked note folder\nThe user linked folder “${linkedResource.name}” (${linkedResource.relativePath}). When searching notes, prefer this folderPath.\n\n`
    }

    if (linkedResource && !isLinkedFolder(linkedResource)) {
      try {
        const workspace = await getWorkspacePath()
        const pathOptions = workspace.isCustom ? null : await getFilePathOptions(linkedResource.path)
        const linkedFileContent = workspace.isCustom
          ? await readTextFile(linkedResource.path)
          : await readTextFile(pathOptions!.path, {
              baseDir: pathOptions!.baseDir,
            })
        context += `${linkedResourcePreview ? `${linkedResourcePreview}\n` : ''}## Full linked file content\n${linkedResource.relativePath}\n\n${linkedFileContent}\n\n`
      } catch (error) {
        console.error('Failed to read linked file for steering:', error)
      }
    }

    if (quoteData) {
      context += `## User quote\nFile: ${quoteData.fileName}\nRange: ${quoteData.from}-${quoteData.to}\n\n${quoteData.fullContent}\n\n`
    }

    context += buildCanvasSelectionContext(canvasSelectionContext)
    context += await buildMentionedContext()

    return context
  }

  const buildMentionedContext = async () => {
    let context = ''

    for (const file of mentionedFiles) {
      try {
        const workspace = await getWorkspacePath()
        const content = workspace.isCustom
          ? await readTextFile(file.path)
          : await getFilePathOptions(file.path).then(({ path, baseDir }) =>
              readTextFile(path, { baseDir })
            )
        context += [
          '## Files linked via @',
          `File: ${file.relativePath}`,
          '',
          content,
          '',
        ].join('\n')
      } catch (error) {
        console.error('Failed to read @ mentioned file:', error)
      }
    }

    for (const record of mentionedRecords) {
      context += [
        '## Records linked via @',
        `Record: ${record.fileName}`,
        '',
        record.fullContent,
        '',
      ].join('\n')
    }

    for (const canvas of mentionedCanvases) {
      context += buildCanvasSelectionContext(canvas)
    }

    return context
  }

  const startProactiveCompaction = () => {
    const chatState = useChatStore.getState()
    if (
      chatState.isTemporaryConversation
      || !chatState.currentConversationId
    ) {
      return
    }

    const conversationId = chatState.currentConversationId
    void Promise.all([
      import('@/lib/ai/condense'),
      import('@/stores/article'),
    ])
      .then(([{ prepareConversationHistory }, { default: useArticleStore }]) => {
        const latestChatState = useChatStore.getState()
        if (latestChatState.currentConversationId !== conversationId) {
          return
        }

        const articleState = useArticleStore.getState()
        const additionalContext = articleState.activeFilePath
          ? articleState.currentArticle || ''
          : ''

        return prepareConversationHistory({
          conversationId,
          chats: latestChatState.chats,
          currentUserInput: '',
          additionalContext,
          imageCount: 0,
          proactive: true,
        })
      })
      .catch(error => {
        console.error('[ConversationCompaction] Background compaction failed:', error)
      })
  }

  useImperativeHandle(ref, () => ({
    sendChat: handleSubmit
  }))

  // Agent -
  const requestConfirmation = (
    toolName: string,
    params: Record<string, any>,
    context?: {
      previewParams?: Record<string, any>
      originalContent?: string
      modifiedContent?: string
      filePath?: string
      from?: number
      to?: number
    }
  ): Promise<AgentApprovalDecision> => {
    const tool = getToolByName(toolName)
    const sessionApprovalScope = getSessionApprovalScope(toolName, tool, params)
    const canApproveForSession = !!sessionApprovalScope
    const approvalSignature = sessionApprovalScope
      ? `${toolName}:${JSON.stringify(params)}`
      : ''
    if (approvalSignature) {
      repeatedScriptApprovalRef.current = repeatedScriptApprovalRef.current.signature === approvalSignature
        ? { signature: approvalSignature, count: repeatedScriptApprovalRef.current.count + 1 }
        : { signature: approvalSignature, count: 1 }
    }
    const requiresRepeatConfirmation = repeatedScriptApprovalRef.current.count >= 3
    if (requiresRepeatConfirmation) {
      repeatedScriptApprovalRef.current = { signature: '', count: 0 }
    }

    const currentChatState = useChatStore.getState()
    const activeConversationId = currentChatState.currentConversationId
    const autoApproveConversationId = currentChatState.agentAutoApproveConversationId
    const autoApproveRuntimeScriptKey = currentChatState.agentAutoApproveRuntimeScriptKey

    if (!requiresRepeatConfirmation && matchesSessionApproval(
      autoApproveConversationId,
      activeConversationId,
      autoApproveRuntimeScriptKey,
      sessionApprovalScope
    )) {
      agentDebugLog('approval_auto_approved', {
        toolName,
        params,
        activeConversationId,
        sessionApprovalScope,
      })
      return Promise.resolve('approved')
    }

    return new Promise((resolve) => {
      agentDebugLog('approval_pending_set', {
        toolName,
        params,
        context,
        canApproveForSession,
        sessionApprovalScope,
      })

      // store，
      setAgentState({
        pendingConfirmation: {
          toolName,
          params,
          previewParams: context?.previewParams,
          ...context,
          canApproveForSession,
          sessionApprovalType: sessionApprovalScope?.type,
          sessionApprovalKey: sessionApprovalScope?.permissionKey,
        }
      })
      
      //
      const checkInterval = setInterval(() => {
        const currentState = useChatStore.getState()
        
        // pendingConfirmation ，
        if (!currentState.agentState.pendingConfirmation) {
          clearInterval(checkInterval)
          const latestRecord = [...currentState.agentState.confirmationHistory]
            .reverse()
            .find((record) =>
              record.toolName === toolName &&
              JSON.stringify(record.params) === JSON.stringify(params)
            )

          agentDebugLog('approval_pending_resolved', {
            toolName,
            params,
            latestRecord,
            resolved: latestRecord?.status === 'confirmed',
          })

          resolve(latestRecord?.status === 'confirmed'
            ? 'approved'
            : latestRecord?.status === 'superseded'
              ? 'steered'
              : 'denied')
        }
      }, 100)
    })
  }

  // Agent
  async function handleAgentMode(images: ImageAttachment[], userMessage: Chat) {
    // AI
    const placeholderMessage = await insert({
      tagId: currentTagId,
      role: 'system',
      content: '',
      type: 'chat',
      inserted: false,
    })

    if (!placeholderMessage) return

    setAgentState({
      activeChatId: placeholderMessage.id,
    })

    const useArticleStore = (await import('@/stores/article')).default
    const articleStore = useArticleStore.getState()
    const useCanvasStore = (await import('@/stores/canvas')).default
    const canvasStore = useCanvasStore.getState()
    let pendingCapacityProbe: { contextWindow: number } | undefined
    let deferredOverflowError: string | undefined
    let contextCapacityProbeActive = false
    const agentImageAttachments = collectAgentImageAttachments(
      useChatStore.getState().chats.filter(chat => chat.id !== userMessage.id)
    )

    const persistAgentError = async (error: string) => {
      const currentState = useChatStore.getState()
      const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
      const resolvedRagSources = currentState.agentState.ragSources?.length
        ? JSON.stringify(currentState.agentState.ragSources)
        : currentMessage?.ragSources
      const resolvedRagSourceDetails = currentState.agentState.ragSourceDetails?.length
        ? JSON.stringify(currentState.agentState.ragSourceDetails)
        : currentMessage?.ragSourceDetails
      const aborted = manualStopRequestedRef.current || isRequestAbortError(error)
      const preservedContent = getLastDisplayableAgentContent(
        currentState.agentState.finalAnswerContent,
        currentState.agentState.traceEvents || []
      )
      const stoppedAt = Date.now()
      const completedTraceEvents = (currentState.agentState.traceEvents || []).map(event => {
        if (event.status !== 'running') {
          return event
        }

        return {
          ...event,
          status: aborted ? 'success' as const : 'error' as const,
          duration: event.duration ?? Math.max(0, stoppedAt - event.timestamp),
        }
      })
      const traceEvents = retainCompletedAgentTraceEvents(completedTraceEvents)
      const agentHistory = {
        steps: currentState.agentState.completedSteps || [],
        toolCalls: currentState.agentState.toolCalls,
        traceEvents,
        changes: currentState.agentState.changes || [],
        runId: currentState.agentState.runId,
        status: aborted ? 'stopped' : 'failed',
        loadedSkills: currentState.agentState.loadedSkills || [],
        selectedSkills: currentState.agentState.selectedSkills || [],
        iterations: currentState.agentState.currentIteration,
      }

      await saveChat({
        id: placeholderMessage.id,
        tagId: placeholderMessage.tagId,
        conversationId: placeholderMessage.conversationId,
        role: placeholderMessage.role,
        type: placeholderMessage.type,
        inserted: placeholderMessage.inserted,
        createdAt: placeholderMessage.createdAt,
        ragSources: resolvedRagSources,
        ragSourceDetails: resolvedRagSourceDetails,
        content: aborted
          ? preservedContent || t('record.chat.input.stopped')
          : `Error: ${error}`,
        agentHistory: JSON.stringify(agentHistory),
      }, true)

      setAgentState({
        activeChatId: undefined,
        isFinalAnswerMode: false,
        finalAnswerContent: undefined,
        status: aborted ? 'stopped' : 'failed',
        isRunning: false,
        isThinking: false,
        traceEvents,
      })
      agentHandlerRef.current = null
    }

    // AgentHandler， placeholderMessage
    const agentHandler = new AgentHandler({
      activeChatId: placeholderMessage.id,
      conversationId: placeholderMessage.conversationId,
      workspaceId: useSettingStore.getState().workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '') || 'default',
      useMemories: !useChatStore.getState().isTemporaryConversation,
      activeFilePath: articleStore.activeFilePath,
      activeCanvasId: canvasStore.activeCanvasId || undefined,
      permissionMode: agentPermissionMode,
      requestConfirmation,
      currentQuote: quoteData
        ? {
            fileName: quoteData.fileName,
            startLine: quoteData.startLine,
            endLine: quoteData.endLine,
            from: quoteData.from,
            to: quoteData.to,
            fullContent: quoteData.fullContent,
          }
        : undefined,
      attachments: fileAttachments,
      imageAttachments: agentImageAttachments,
      selectedSkills: selectedSkillIds,
      onFinalAnswerRender: (markdownContent) => {
        // Final Answer
        setAgentState({
          activeChatId: placeholderMessage.id,
          isFinalAnswerMode: true,
          finalAnswerContent: markdownContent
        })
      },
      formatAutoFinalAnswer: (key, values) => t(key as any, values),
      onComplete: async (result, steps, stopped) => {
        deferredOverflowError = undefined
        // Agent ，
        const { agentState } = useChatStore.getState()
        const effectivelyStopped = Boolean(stopped)
          || manualStopRequestedRef.current
          || isRequestAbortError(result)
        if (!effectivelyStopped && pendingCapacityProbe) {
          const aiConfig = await getAISettings('primaryModel')
          if (aiConfig) {
            await confirmEstimatedContextWindow(
              aiConfig,
              pendingCapacityProbe.contextWindow
            )
          }
          pendingCapacityProbe = undefined
        }
        const completedAt = Date.now()
        const completedTraceEvents = (agentState.traceEvents || []).map(event => {
          if (event.status !== 'running') {
            return event
          }

          return {
            ...event,
            status: effectivelyStopped ? 'success' as const : event.status,
            duration: event.duration ?? Math.max(0, completedAt - event.timestamp),
          }
        })
        const traceEvents = retainCompletedAgentTraceEvents(completedTraceEvents)
        // agentState.completedSteps steps ， completedSteps duration
        const agentHistory = {
          steps: agentState.completedSteps || [],
          toolCalls: agentState.toolCalls,
          traceEvents,
          changes: agentState.changes || [],
          runId: agentState.runId,
          status: effectivelyStopped ? 'stopped' : agentState.status,
          loadedSkills: agentState.loadedSkills || [],
          selectedSkills: agentState.selectedSkills || [],
          iterations: agentState.currentIteration,
        }

        let finalContent = result
        if (effectivelyStopped) {
          const lastDisplayableContent = getLastDisplayableAgentContent(
            agentState.finalAnswerContent,
            completedTraceEvents
          )
          if (lastDisplayableContent) {
            finalContent = lastDisplayableContent
          } else if (isRequestAbortError(finalContent)) {
            finalContent = ''
          }
        }
        if (effectivelyStopped && !finalContent.trim()) {
          // ；。
          finalContent = t('record.chat.input.stopped')
        }

        if (!effectivelyStopped) {
          const partialSuccessContent = buildPartialSuccessContent(result, agentState.toolCalls)
          if (partialSuccessContent && /^Tool .+ failed:|^Tool .+ error:|^Error:/.test(finalContent.trim())) {
            finalContent = partialSuccessContent
          }
        }

        finalContent = sanitizeAgentFinalContent(finalContent)

        const currentState = useChatStore.getState()
        const currentMessage = currentState.chats.find(c => c.id === placeholderMessage.id)
        const resolvedRagSources = agentState.ragSources?.length
          ? JSON.stringify(agentState.ragSources)
          : currentMessage?.ragSources
        const resolvedRagSourceDetails = agentState.ragSourceDetails?.length
          ? JSON.stringify(agentState.ragSourceDetails)
          : currentMessage?.ragSourceDetails

        // ， RAG
        await saveChat({
          id: placeholderMessage.id,
          tagId: placeholderMessage.tagId,
          conversationId: placeholderMessage.conversationId,
          role: placeholderMessage.role,
          type: placeholderMessage.type,
          inserted: placeholderMessage.inserted,
          createdAt: placeholderMessage.createdAt,
          ragSources: resolvedRagSources,
          ragSourceDetails: resolvedRagSourceDetails,
          //
          content: finalContent,
          agentHistory: JSON.stringify(agentHistory),
        }, true)

        // Final Answer
        setAgentState({
          activeChatId: undefined,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined,
          traceEvents,
        })

        if (!effectivelyStopped) {
          startProactiveCompaction()
          const { scheduleConversationMemoryExtraction } = await import('@/lib/memory/auto-memory')
          scheduleConversationMemoryExtraction(placeholderMessage.conversationId)
        }

        // ref
        agentHandlerRef.current = null
      },
      onError: async (error) => {
        const parsedOverflow = parseContextOverflowError(error)
        const inferredOverflow =
          !parsedOverflow.detected
          && contextCapacityProbeActive
          && isUnknownProviderError(error)
        const overflow = inferredOverflow
          ? { detected: true }
          : parsedOverflow
        if (inferredOverflow) {
          agentDebugLog('context_overflow_inferred_from_provider_error', {
            error,
            reason: 'unknown_provider_error_during_capacity_probe',
          })
        }
        if (overflow.detected) {
          const aiConfig = await getAISettings('primaryModel')
          if (aiConfig) {
            if (overflow.contextWindow) {
              await learnContextWindow(aiConfig, overflow.contextWindow)
            } else {
              await reduceLearnedContextWindow(aiConfig)
            }
          }
        }

        const currentState = useChatStore.getState()
        const canRecoverFromOverflow =
          overflow.detected
          && contextOverflowRetryRef.current === 0
          && currentState.agentState.toolCalls.length === 0
          && !currentState.isTemporaryConversation
          && Boolean(currentState.currentConversationId)
        if (canRecoverFromOverflow) {
          deferredOverflowError = error
          agentDebugLog('context_overflow_error_deferred', {
            conversationId: currentState.currentConversationId,
            contextWindow: overflow.contextWindow || null,
          })
          return
        }

        deferredOverflowError = undefined
        await persistAgentError(error)
      },
    })

    // ref
    agentHandlerRef.current = agentHandler
    for (const payload of pendingSteeringRef.current.splice(0)) {
      agentHandler.steer(payload)
    }

    try {
      //
      let context = ''

      // 1. ， OCR。
      // ，。
      if (images.length > 0) {
        imageAnalysisAbortControllerRef.current?.abort()
        const imageAnalysisAbortController = new AbortController()
        imageAnalysisAbortControllerRef.current = imageAnalysisAbortController
        let liveAnalyses = createPendingChatImageAnalyses(images, requestText)
        const updatePersistedAnalysis = (analyses: PersistedChatImageAnalysis[], persist: boolean) => {
          const updatedMessage = {
            ...userMessage,
            imageAnalyses: serializeChatImageAnalyses(analyses),
          }
          if (persist) {
            return saveChat(updatedMessage, true)
          } else {
            useChatStore.getState().updateChat(updatedMessage)
          }
        }

        setAgentState({
          status: 'analyzing_images',
          isRunning: true,
          isThinking: false,
        })
        const imageResult = await buildChatImageContext(images, requestText, {
          signal: imageAnalysisAbortController.signal,
          onProgress: (progress) => {
            liveAnalyses = liveAnalyses.map(analysis => (
              analysis.imageId === progress.imageId
                ? {
                    ...analysis,
                    status: progress.status,
                    method: progress.method ?? analysis.method,
                    errorCode: progress.errorCode,
                    updatedAt: Date.now(),
                  }
                : analysis
            ))
            updatePersistedAnalysis(liveAnalyses, false)
          },
        })
        imageAnalysisAbortControllerRef.current = null
        await updatePersistedAnalysis(imageResult.analyses, true)
        agentImageAttachments.push(...imageResult.analyses.map(analysis => ({
          ...analysis,
          chatId: userMessage.id,
        })))
        if (imageResult.context) {
          context += `${imageResult.context}\n`
        }

        agentDebugLog('chat_context_images_analyzed', {
          imageCount: images.length,
          contextLength: imageResult.context.length,
          preview: previewText(imageResult.context),
        })
      }

      const historicalImageContext = buildHistoricalImageContext(
        useChatStore.getState().chats.filter(chat => chat.id !== userMessage.id)
      )
      if (historicalImageContext) {
        context += `${historicalImageContext}\n`
      }

      // 2. AgentHandler 。
      // currentArticle，。

      agentDebugLog('chat_context_active_note', {
        activeFilePath: articleStore.activeFilePath || null,
        currentArticleLength: articleStore.currentArticle?.length || 0,
        injected: false,
        injectedByRuntimeSnapshot: Boolean(articleStore.activeFilePath),
        preview: previewText(articleStore.currentArticle || ''),
      })
      // 3. Agent ，。
      if (linkedResource && isLinkedFolder(linkedResource)) {
        context += [
          '## Linked note folder',
          `The user linked folder “${linkedResource.name}” (${linkedResource.relativePath}).`,
          'If this request needs to find user notes, prefer note_search_files and set folderPath to this relative path. Do not search unless needed.',
          '',
        ].join('\n')
      }

      // 4. （）， Agent
      const linkedResourceIsActiveFile = linkedResource && !isLinkedFolder(linkedResource) && (
        linkedResource.relativePath === articleStore.activeFilePath ||
        linkedResource.path === articleStore.activeFilePath ||
        linkedResource.name === articleStore.activeFilePath.split('/').pop()
      )

      if (linkedResource && !isLinkedFolder(linkedResource) && !linkedResourceIsActiveFile) {
        try {
          const workspace = await getWorkspacePath()
          let linkedFileContent = ''
          if (workspace.isCustom) {
            linkedFileContent = await readTextFile(linkedResource.path)
          } else {
            const { path, baseDir } = await getFilePathOptions(linkedResource.path)
            linkedFileContent = await readTextFile(path, { baseDir })
          }

          if (linkedResourcePreview) {
            context += `\n${linkedResourcePreview}\n`
          }

          if (linkedFileContent) {
            context += `\n## Full linked file content\n\nThe full content of the linked file "${linkedResource.name}" (${linkedResource.relativePath}) is already included below. Do not call tools to read or check this same file again unless the user explicitly asks to refresh it.\n\n---\n${linkedFileContent}\n---\n`
          }

          agentDebugLog('chat_context_linked_file', {
            name: linkedResource.name,
            relativePath: linkedResource.relativePath,
            contentLength: linkedFileContent.length,
            hasPreview: Boolean(linkedResourcePreview),
          })
        } catch (error) {
          console.error('Failed to read linked file in Agent mode:', error)
        }
      } else if (linkedResourceIsActiveFile) {
        agentDebugLog('chat_context_linked_file_skipped', {
          reason: 'linked file is already the active editor file',
          name: linkedResource.name,
          relativePath: linkedResource.relativePath,
        })
      }

      // 5. ，（）
      if (quoteData) {
        const { fileName, startLine, endLine, fullContent, from, to } = quoteData
        let lineInfo = ''
        const hasValidLineNumbers = startLine !== -1 && endLine !== -1
        const hasValidRange = from >= 0 && to >= from

        if (hasValidLineNumbers) {
          if (startLine === endLine) {
            lineInfo = `Line ${startLine}`
          } else {
            lineInfo = `Lines ${startLine}-${endLine}`
          }
        }

        context += `
## 📌 Quoted content

The user quoted the following from note "${fileName}" ${lineInfo}:

---
${fullContent}
---

${hasValidRange ? `**Only edit when the user explicitly asks to modify/rewrite/expand/insert.**

If the user is asking a question, or wants explanation, summary, analysis, translation advice, polish suggestions, or code explanation, answer from this quote and **do not call any editing tools**.

If the user clearly asks to translate this sentence/selection into a language, that is an edit request: use editor_replace_range directly. from/to are already enough; do not call editor_get_state or editor_get_selection again.

**Only when the user explicitly requests a change, precisely replace the selected range**: the quote comes from the editor selection — prefer editor_replace_range and replace only this selection:
- from: ${from}
- to: ${to}
- Pass the new text via content
- Replace only this selection; do not expand to the whole document or beyond the selection

**If the user asks to insert/add content before/after/above/below this passage**:
- Still use editor_replace_range
- Replace the entire current quote range
- Prefix: new content + original quote
- Suffix: original quote + new content
- Do not use editor_insert_at_cursor — chat focus makes the cursor position unreliable

**If the user asks to add content both before and after**:
- Still use editor_replace_range
- Pass the final replacement as content: prefix + original quote + suffix
- Do not use extra protocol markers; the tool writes content as-is

**Fallback line numbers**:
- Single line: startLine: ${startLine}, endLine: ${endLine}
- Multi-line: startLine: ${startLine}, endLine: ${endLine}

**Do not**:
- Call editing tools for explanation/analysis requests
- Change content outside the selection
- Fetch the whole document and rewrite it
- Change startLine/endLine to 1/1 on your own` : hasValidLineNumbers ? `**Only edit when the user explicitly asks to modify/rewrite/expand/insert.**

If the user is asking a question, or wants explanation, summary, analysis, translation advice, polish suggestions, or code explanation, answer from this quote and **do not call any editing tools**.

If the user clearly asks to translate this sentence/selection into a language, that is an edit request: use editor_replace_lines directly. Line numbers are already enough; do not call editor_get_state or editor_get_selection again.

**Only when the user explicitly requests a change, edit by line number**: when the user quotes content and asks to change it, you must use editor_replace_lines with exact line numbers:
- Single line: startLine: ${startLine}, endLine: ${endLine}
- Multi-line: startLine: ${startLine}, endLine: ${endLine}
- Pass the new text via replaceContent

**Do not**:
- Call editing tools for explanation/analysis requests
- Use from/to position parameters
- Use searchContent text-search mode
- Fetch the whole document before editing` : `**Note**: This quote has no valid line numbers. If you need to edit, first call editor_get_selection to get the current selection line numbers.`}

Answer the user's question based on this quoted content.

`


        agentDebugLog('chat_context_quote', {
          fileName,
          startLine,
          endLine,
          from,
          to,
          quoteLength: quoteData.quote.length,
          contentLength: fullContent.length,
          quotePreview: previewText(quoteData.quote),
          fullContentPreview: previewText(fullContent),
          hasValidRange,
        })
      }

      context += buildCanvasSelectionContext(canvasSelectionContext)
      context += await buildMentionedContext()

      // 6. 
      const compactionContext = [
        context,
        articleStore.activeFilePath ? articleStore.currentArticle || '' : '',
      ].filter(Boolean).join('\n\n')
      const chatState = useChatStore.getState()
      const { chats } = chatState
      const {
        buildMessagesWithHistory,
        prepareConversationHistory,
      } = await import('@/lib/ai/condense')
      let preparedHistory: Awaited<ReturnType<typeof prepareConversationHistory>> | null = null
      if (!chatState.isTemporaryConversation && chatState.currentConversationId) {
        try {
          preparedHistory = await prepareConversationHistory({
            conversationId: chatState.currentConversationId,
            chats,
            currentUserInput: requestText,
            additionalContext: compactionContext,
            imageCount: 0,
          })
          pendingCapacityProbe = preparedHistory.capacityProbe
          contextCapacityProbeActive = Boolean(
            preparedHistory.capacityProbe
            || preparedHistory.capacityLimitProbe
          )
        } catch (error) {
          console.error('[ConversationCompaction] Failed to prepare history:', error)
        }
      }

      // buildMessagesWithHistory
      // ：Agent ， systemPrompt（Agent ）
      // （、RAG、、） additionalContext
      let messages = buildMessagesWithHistory(
        chats,
        undefined, // systemPrompt - Agent builds this itself
        context,   // additionalContext - article, RAG, linked files, quotes, etc.
        undefined, // currentUserInput - AgentRuntime injects once
        {
          // Agent think() ，。
          // assistant ；。
          includeAssistantMessages: true,
          includeLatestUserMessage: false,
          conversationSummary: preparedHistory?.compaction?.summary,
          coveredThroughChatId: preparedHistory?.compaction?.coveredThroughChatId,
        }
      )

      agentDebugLog('chat_messages_built', {
        userInput: requestText,
        contextLength: context.length,
        compactionRevision: preparedHistory?.compaction?.revision || null,
        compactionSource: preparedHistory?.capacity.source || null,
        compactionWindow: preparedHistory?.capacity.contextWindow || null,
        messageCount: messages.length,
        messages: messages.map((message, index) => ({
          index,
          role: message.role,
          contentLength: message.content.length,
          preview: previewText(message.content),
        })),
      })

      try {
        await agentHandler.execute(requestText, messages)
      } catch (error) {
        const parsedOverflow = parseContextOverflowError(error)
        const overflow =
          !parsedOverflow.detected
          && contextCapacityProbeActive
          && isUnknownProviderError(error)
            ? { detected: true }
            : parsedOverflow
        const canRetry =
          overflow.detected
          && contextOverflowRetryRef.current === 0
          && useChatStore.getState().agentState.toolCalls.length === 0
          && !chatState.isTemporaryConversation
          && Boolean(chatState.currentConversationId)

        if (!canRetry || !chatState.currentConversationId) {
          throw error
        }

        contextOverflowRetryRef.current = 1
        const previousCompactionRevision = preparedHistory?.compaction?.revision
        preparedHistory = await prepareConversationHistory({
          conversationId: chatState.currentConversationId,
          chats: useChatStore.getState().chats,
          currentUserInput: requestText,
          additionalContext: compactionContext,
          imageCount: 0,
          force: true,
        })
        pendingCapacityProbe = preparedHistory.capacityProbe
        contextCapacityProbeActive = false
        if (
          !preparedHistory.compacted
          && preparedHistory.compaction?.revision === previousCompactionRevision
        ) {
          throw error
        }
        messages = buildMessagesWithHistory(
          useChatStore.getState().chats,
          undefined,
          context,
          undefined,
          {
            includeAssistantMessages: true,
            includeLatestUserMessage: false,
            conversationSummary: preparedHistory.compaction?.summary,
            coveredThroughChatId: preparedHistory.compaction?.coveredThroughChatId,
          }
        )
        await agentHandler.execute(requestText, messages)
      }
    } catch (error) {
      if (deferredOverflowError) {
        await persistAgentError(deferredOverflowError)
        deferredOverflowError = undefined
      }
      console.error('Agent execution error:', error)
    } finally {
      // ref
      agentHandlerRef.current = null
    }
  }

  // （Agent ）
  async function handleSubmit() {
    if (!inputValue.trim() && attachedImages.length === 0 && fileAttachments.length === 0) return

    if (activeRunRef.current) {
      const sequence = ++steeringSequenceRef.current
      const text = requestText
      const steeringQuote = quoteData ? {
        fileName: quoteData.fileName,
        startLine: quoteData.startLine,
        endLine: quoteData.endLine,
        from: quoteData.from,
        to: quoteData.to,
        fullContent: quoteData.fullContent,
      } : undefined

      agentHandlerRef.current?.beginSteering()
      onSent?.()

      steeringChainRef.current = steeringChainRef.current.then(async () => {
        if (manualStopRequestedRef.current) return
        let additionalContext = ''
        let steeringImageAttachments: PersistedChatImageAnalysis[] | undefined
        try {
          additionalContext = await buildSteeringContext()
        } catch (error) {
          console.error('Failed to build steering context:', error)
        }
        if (attachedImages.length > 0) {
          imageAnalysisAbortControllerRef.current?.abort()
          const controller = new AbortController()
          imageAnalysisAbortControllerRef.current = controller
          const imageResult = await buildChatImageContext(attachedImages, text, {
            signal: controller.signal,
          })
          imageAnalysisAbortControllerRef.current = null
          additionalContext = [additionalContext, imageResult.context].filter(Boolean).join('\n\n')
          steeringImageAttachments = imageResult.analyses
        }
        const payload: AgentSteeringPayload = {
          sequence,
          text,
          selectedSkills: selectedSkillIds,
          additionalContext,
          currentQuote: steeringQuote,
          attachments: fileAttachments,
          imageAttachments: steeringImageAttachments,
        }
        if (agentHandlerRef.current) {
          agentHandlerRef.current.steer(payload)
        } else {
          pendingSteeringRef.current.push(payload)
        }
      })
      return
    }

    manualStopRequestedRef.current = false
    contextOverflowRetryRef.current = 0
    activeRunRef.current = true
    repeatedScriptApprovalRef.current = { signature: '', count: 0 }
    onSent?.()

    setLoading(true)
    try {
      const imageUrls = attachedImages.map(img => img.url)
      const userMessage = await insert({
        tagId: currentTagId,
        role: 'user',
        content: inputValue,
        type: 'chat',
        inserted: false,
        images: imageUrls.length > 0 ? JSON.stringify(imageUrls) : undefined,
        imageAnalyses: attachedImages.length > 0
          ? serializeChatImageAnalyses(createPendingChatImageAnalyses(attachedImages, requestText))
          : undefined,
        attachments: fileAttachments.length > 0 ? serializeChatAttachments(fileAttachments) : undefined,
        quoteData: quoteData ? JSON.stringify(quoteData) : undefined,
      })
      if (userMessage) {
        await handleAgentMode(attachedImages, userMessage)
      }
    } finally {
      activeRunRef.current = false
      setLoading(false)
    }
  }

  const handleStop = async () => {
    manualStopRequestedRef.current = true
    activeRunRef.current = false
    pendingSteeringRef.current = []
    imageAnalysisAbortControllerRef.current?.abort()
    imageAnalysisAbortControllerRef.current = null

    //
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // Agent
    if (agentHandlerRef.current) {
      agentHandlerRef.current.stop()
      // ref， Agent onComplete
    }

    // loading
    setLoading(false)
  }

  const hasInput = Boolean(inputValue.trim() || attachedImages.length > 0 || fileAttachments.length > 0)
  const showStop = loading && !hasInput

  return <TooltipButton
    variant={dockStyle ? "ghost" : showStop ? "destructive" : "default"}
    size={dockStyle ? "icon" : "sm"}
    icon={showStop ? <Square /> : <Send />}
    disabled={!showStop && (!primaryModel || !hasInput)}
    tooltipText={showStop
      ? t('record.chat.input.stop')
      : loading
        ? t('record.chat.input.steer')
        : t('record.chat.input.send')}
    onClick={showStop ? handleStop : handleSubmit}
    buttonClassName={dockStyle ? cn(
      "size-8 rounded-full border border-border/50 bg-[hsl(var(--component-active-bg))] text-foreground shadow-none hover:bg-[hsl(var(--component-active-bg))] hover:text-foreground",
      showStop && "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/10"
    ) : undefined}
  />
})

ChatSend.displayName = 'ChatSend';
