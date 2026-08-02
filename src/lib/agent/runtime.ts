import type OpenAI from 'openai'
import { createChatCompletionStreamWithToolChoiceFallback, createOpenAIClient, getAISettings, getChatTokenLimitParams, getSystemPromptContent, handleAIError, validateAIService, withFastAiRequestOptions } from '@/lib/ai/utils'
import { estimateTokens } from '@/lib/ai/token-counter'
import { AgentContextManager } from './context-manager'
import { agentEventBus } from './event-bus'
import { AgentPermissionEngine } from './permission-engine'
import { AgentPromptAssembler, hasInlineCurrentEditorSelection, hasInlineCurrentEditorState } from './prompt-assembler'
import { memoryContextService } from '@/lib/context/loader'
import { AgentRecoveryManager } from './recovery-manager'
import { createAgentId, AgentTraceRecorder } from './trace-recorder'
import { agentToolRegistry, buildEditorApprovalPreview } from './tool-registry'
import { skillManager } from '@/lib/skills'
import { buildMcpAgentToolCatalog } from '@/lib/mcp/agent-tools'
import { agentDebugLog, previewText } from './debug-log'
import { getRagAgentPolicy } from '@/lib/rag-agent-policy'
import type {
  AgentChange,
  AgentContextSnapshot,
  AgentPermissionMode,
  AgentRuntimeCallbacks,
  AgentRuntimeInput,
  AgentRuntimeResult,
  AgentSteeringPayload,
  AgentStep,
  AgentTool,
  AgentToolResult,
  ToolCall,
  ToolResult,
} from './types'

const ABSOLUTE_MAX_MODEL_ROUNDS = 30
const MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS = 2
const MAX_IDENTICAL_READ_RESULT_REPEATS = 2
const MUTATING_TOOL_RISKS = new Set(['editor-write', 'file-create', 'file-update', 'delete', 'medium'])

export function isRequestAbortError(error: unknown) {
  if (typeof error === 'string') {
    return /(?:request (?:was )?aborted|operation (?:was )?aborted|aborterror)/i.test(error)
  }

  if (!error || typeof error !== 'object') {
    return false
  }

  const errorWithCode = error as { name?: string; code?: string; message?: string }
  return errorWithCode.name === 'AbortError'
    || errorWithCode.code === 'ABORT_ERR'
    || /(?:request (?:was )?aborted|operation (?:was )?aborted|aborterror)/i.test(errorWithCode.message || '')
}

async function executeAgentTool(
  tool: AgentTool,
  args: Record<string, unknown>,
  runId: string,
  signal: AbortSignal | undefined,
  context: AgentContextSnapshot
): Promise<AgentToolResult> {
  try {
    return await tool.execute(args, { runId, signal, context })
  } catch (error) {
    if (isRequestAbortError(error)) {
      throw error
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message: `Exception while running ${tool.title}: ${message}`,
      error: message,
    }
  }
}

function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments || !rawArguments.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawArguments)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch (error) {
    throw new Error(`Invalid tool arguments JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function toolResultToLegacy(result: AgentToolResult): ToolResult {
  return {
    success: result.ok,
    message: result.message,
    data: result.data,
    error: result.error,
    changes: result.changes,
  }
}

function stringifyToolResult(result: AgentToolResult) {
  const payload = {
    ok: result.ok,
    message: result.message,
    data: result.data,
    error: result.error,
    changes: result.changes,
  }

  return JSON.stringify(payload)
}

function stringifyMessageContent(content: unknown) {
  if (typeof content === 'string') {
    return content
  }

  if (content === null || content === undefined) {
    return ''
  }

  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function normalizeBaseMessage(message: OpenAI.Chat.ChatCompletionMessageParam): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role !== 'system') {
    return message
  }

  return {
    role: 'user',
    content: `## App Context\n${stringifyMessageContent(message.content)}`,
  }
}

interface StreamingToolCallAccumulator {
  id?: string
  index: number
  type?: 'function'
  function: {
    name: string
    arguments: string
  }
}

function toToolCallList(
  toolCalls: Map<number, StreamingToolCallAccumulator>
): OpenAI.Chat.ChatCompletionMessageToolCall[] {
  return [...toolCalls.values()]
    .sort((a, b) => a.index - b.index)
    .filter((toolCall) => toolCall.function.name)
    .map((toolCall) => ({
      id: toolCall.id || createAgentId('tool-call'),
      type: 'function' as const,
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    }))
}

function summarizeMessage(message: OpenAI.Chat.ChatCompletionMessageParam, index: number) {
  const content = 'content' in message ? message.content : undefined
  const text = stringifyMessageContent(content)

  return {
    index,
    role: message.role,
    contentLength: text.length,
    preview: previewText(text),
  }
}

function estimateMessageTextTokens(message: OpenAI.Chat.ChatCompletionMessageParam) {
  if (!('content' in message)) {
    return 0
  }

  if (typeof message.content === 'string') {
    return estimateTokens(message.content)
  }

  if (!Array.isArray(message.content)) {
    return 0
  }

  return message.content.reduce((sum, item) => {
    if (
      typeof item === 'object'
      && item !== null
      && 'type' in item
      && item.type === 'text'
      && 'text' in item
      && typeof item.text === 'string'
    ) {
      return sum + estimateTokens(item.text)
    }
    return sum
  }, 0)
}

function normalizeFilePathForCompare(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()
}

function rewriteWorkspaceReadAsAttachmentRead(
  toolCall: OpenAI.Chat.ChatCompletionMessageToolCall,
  context: AgentContextSnapshot
) {
  const folderAttachments = (context.attachments || []).filter((attachment) => attachment.kind === 'folder')
  if (toolCall.function.name === 'note_list_files' && folderAttachments.length === 1) {
    return {
      ...toolCall,
      function: {
        name: 'attachment_list',
        arguments: JSON.stringify({ attachmentId: folderAttachments[0].id }),
      },
    } satisfies OpenAI.Chat.ChatCompletionMessageToolCall
  }

  if (toolCall.function.name !== 'note_open_file' && toolCall.function.name !== 'note_read_file') {
    return toolCall
  }

  let args: Record<string, unknown>
  try {
    args = parseToolArguments(toolCall.function.arguments)
  } catch {
    return toolCall
  }

  const requestedPath = typeof args.filePath === 'string'
    ? normalizeFilePathForCompare(args.filePath)
    : ''
  const requestedName = requestedPath.split('/').pop()?.toLocaleLowerCase() || ''
  if (!requestedName) return toolCall

  const matches = (context.attachments || []).filter((attachment) =>
    attachment.kind === 'file'
    && attachment.name.toLocaleLowerCase() === requestedName
  )
  if (matches.length === 1) {
    return {
      ...toolCall,
      function: {
        name: 'attachment_read',
        arguments: JSON.stringify({ attachmentId: matches[0].id }),
      },
    } satisfies OpenAI.Chat.ChatCompletionMessageToolCall
  }

  if (folderAttachments.length === 1) {
    const folder = folderAttachments[0]
    const folderPrefix = `${folder.name.toLocaleLowerCase()}/`
    const relativePath = requestedPath.toLocaleLowerCase().startsWith(folderPrefix)
      ? requestedPath.slice(folder.name.length + 1)
      : requestedPath
    return {
      ...toolCall,
      function: {
        name: 'attachment_read',
        arguments: JSON.stringify({ attachmentId: folder.id, relativePath }),
      },
    } satisfies OpenAI.Chat.ChatCompletionMessageToolCall
  }

  return toolCall
}

function repairAttachmentToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentContextSnapshot
) {
  if (toolName !== 'attachment_list' && toolName !== 'attachment_read') {
    return args
  }

  const attachments = context.attachments || []
  const requestedAttachmentId = typeof args.attachmentId === 'string' ? args.attachmentId : ''
  if (attachments.some((attachment) => attachment.id === requestedAttachmentId)) {
    return args
  }

  const relativePath = typeof args.relativePath === 'string' ? args.relativePath : ''
  const hasRelativePaths = Array.isArray(args.relativePaths) && args.relativePaths.length > 0
  const candidates = toolName === 'attachment_list' || relativePath || hasRelativePaths
    ? attachments.filter((attachment) => attachment.kind === 'folder')
    : attachments.filter((attachment) => attachment.kind === 'file')

  if (candidates.length !== 1) {
    return args
  }

  return {
    ...args,
    attachmentId: candidates[0].id,
  }
}

function getNumberArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}

function claimsUserNoteEvidence(content: string) {
  return /根据(?:您|你).{0,12}(?:笔记|记录)|(?:according to|based on).{0,24}(?:your|the user's).{0,16}(?:notes?|records?)|(?:あなた|ユーザー).{0,16}(?:ノート|記録)|segundo.{0,24}(?:suas?|os seus).{0,16}(?:notas?|registros?)/i.test(content)
}

function validateQuotedEditorWrite(
  context: AgentContextSnapshot,
  toolName: string,
  args: Record<string, unknown>
): AgentToolResult | null {
  const quote = context.currentQuote
  if (!quote) {
    return null
  }

  if (toolName === 'editor_replace_range' && quote.from >= 0 && quote.to >= quote.from) {
    const from = getNumberArg(args, 'from')
    const to = getNumberArg(args, 'to')
    if (from !== quote.from || to !== quote.to) {
      return {
        ok: false,
        message: `Tool arguments out of range: this request may only replace the user selection from=${quote.from}, to=${quote.to}. Retry with that exact range.`,
        error: 'INVALID_QUOTED_RANGE',
      }
    }
  }

  return null
}

function validateEditorTargetFile(
  context: AgentContextSnapshot,
  tool: AgentTool,
  args: Record<string, unknown>
): AgentToolResult | null {
  if (tool.category !== 'editor' || tool.risk === 'read') {
    return null
  }

  const activeFilePath = context.activeFilePath
  const targetFilePath = typeof args.filePath === 'string' ? args.filePath : ''

  if (!activeFilePath) {
    return {
      ok: false,
      message: 'No editor file is open, so editor_* write tools cannot run. Use note_* tools with an explicit filePath instead.',
      error: 'EDITOR_TOOL_WITHOUT_ACTIVE_FILE',
    }
  }

  if (!targetFilePath) {
    return {
      ok: false,
      message: `editor_* write tools must declare the target file in the structured filePath argument. The current editor file is ${activeFilePath}; retry with that full path.`,
      error: 'EDITOR_TOOL_MISSING_TARGET_FILE',
    }
  }

  if (normalizeFilePathForCompare(targetFilePath) === normalizeFilePathForCompare(activeFilePath)) {
    return null
  }

  return {
    ok: false,
    message: `Tool argument target file is ${targetFilePath}, but the current editor file is ${activeFilePath}. Do not use editor_* tools; use note_read_file and note_update_file on the target file instead.`,
    error: 'EDITOR_TOOL_WRONG_TARGET_FILE',
  }
}

function validateToolInputShape(tool: AgentTool, args: Record<string, unknown>): AgentToolResult | null {
  const properties = tool.inputSchema.properties || {}
  const allowedKeys = new Set(Object.keys(properties))
  const unknownKeys = Object.keys(args).filter((key) => !allowedKeys.has(key))
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      message: `Tool arguments contain undeclared fields: ${unknownKeys.join(', ')}. Use only parameters from the structured tool definition.`,
      error: 'UNKNOWN_TOOL_ARGUMENTS',
    }
  }

  const missingKeys = (tool.inputSchema.required || []).filter((key) =>
    args[key] === undefined || args[key] === null
  )
  if (missingKeys.length > 0) {
    return {
      ok: false,
      message: `Tool is missing required parameters: ${missingKeys.join(', ')}。`,
      error: 'MISSING_TOOL_ARGUMENTS',
    }
  }

  return null
}

function preserveOriginalMarkdownPrefix(
  context: AgentContextSnapshot,
  lineNumber: number,
  content: string
) {
  if (content.includes('\n')) {
    return content
  }

  const numberedLine = context.currentEditorState?.numberedLines
    .split('\n')
    .find((line) => new RegExp(`^\\s*${lineNumber}\\s*\\|`).test(line))
  const originalLine = numberedLine?.replace(/^\s*\d+\s*\|\s?/, '') || ''
  const originalPrefix = originalLine.match(/^(\s*#{1,6}\s+)/)?.[1]
  const replacementHasPrefix = /^\s*#{1,6}\s+/.test(content)
  const requestsPlainText = /(?:改为|改成|转换为|变成).*(?:正文|普通文本|段落|plain\s+text|paragraph)/i
    .test(context.userInput)

  return originalPrefix && !replacementHasPrefix && !requestsPlainText
    ? `${originalPrefix}${content}`
    : content
}

function repairEditorWriteArgs(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentContextSnapshot
): Record<string, unknown> {
  const editorToolsWithTarget = new Set([
    'editor_insert_at_cursor',
    'editor_replace_range',
    'editor_replace_lines',
    'editor_apply_transaction',
  ])
  const editorToolsWithVersion = new Set([
    'editor_replace_range',
    'editor_replace_lines',
    'editor_apply_transaction',
  ])
  let repairedArgs = args

  if (
    editorToolsWithTarget.has(toolName) &&
    (typeof repairedArgs.filePath !== 'string' || !repairedArgs.filePath.trim()) &&
    context.activeFilePath
  ) {
    repairedArgs = {
      ...repairedArgs,
      filePath: context.activeFilePath,
    }
  }

  if (
    editorToolsWithVersion.has(toolName) &&
    typeof repairedArgs.version !== 'number' &&
    typeof context.currentEditorState?.version === 'number'
  ) {
    repairedArgs = {
      ...repairedArgs,
      version: context.currentEditorState.version,
    }
  }

  if (
    toolName === 'editor_replace_lines' &&
    Number.isInteger(repairedArgs.startLine) &&
    repairedArgs.startLine === repairedArgs.endLine &&
    typeof repairedArgs.replaceContent === 'string'
  ) {
    const replaceContent = preserveOriginalMarkdownPrefix(
      context,
      repairedArgs.startLine as number,
      repairedArgs.replaceContent
    )
    if (replaceContent !== repairedArgs.replaceContent) {
      repairedArgs = { ...repairedArgs, replaceContent }
    }
  }

  if (toolName !== 'editor_apply_transaction' || !Array.isArray(repairedArgs.operations)) {
    return repairedArgs
  }

  let repaired = false
  const operations = repairedArgs.operations.map((rawOperation) => {
    if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) {
      return rawOperation
    }

    const operation = rawOperation as Record<string, unknown>
    if (
      operation.type === 'insert_after_line' &&
      !Number.isInteger(operation.line) &&
      Number.isInteger(context.currentEditorState?.totalLines)
    ) {
      repaired = true
      return {
        ...operation,
        line: context.currentEditorState?.totalLines,
      }
    }

    if (
      operation.type === 'insert_before_line' &&
      !Number.isInteger(operation.line)
    ) {
      repaired = true
      return {
        ...operation,
        line: 1,
      }
    }

    if (
      operation.type === 'replace_lines' &&
      Number.isInteger(operation.startLine) &&
      operation.startLine === operation.endLine &&
      typeof operation.content === 'string'
    ) {
      const content = preserveOriginalMarkdownPrefix(
        context,
        operation.startLine as number,
        operation.content
      )
      if (content !== operation.content) {
        repaired = true
        return { ...operation, content }
      }
      return rawOperation
    }

    if (operation.type !== 'replace_range') {
      return rawOperation
    }

    const startLine = Number.isInteger(operation.startLine)
      ? operation.startLine
      : operation.from
    const endLine = Number.isInteger(operation.endLine)
      ? operation.endLine
      : operation.to
    let content = typeof operation.content === 'string'
      ? operation.content
      : operation.replaceContent

    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || typeof content !== 'string') {
      return rawOperation
    }

    if (startLine === endLine) {
      content = preserveOriginalMarkdownPrefix(context, startLine as number, content)
    }

    repaired = true
    return {
      type: 'replace_lines',
      startLine,
      endLine,
      content,
    }
  })

  return repaired ? { ...repairedArgs, operations } : repairedArgs
}

function selectToolsForContext(
  context: AgentContextSnapshot,
  tools: AgentTool[],
  permissionMode: AgentPermissionMode = 'ask'
) {
  let selectedTools = tools

  if (permissionMode === 'read-only') {
    selectedTools = selectedTools.filter((tool) =>
      tool.risk === 'read' || tool.risk === 'external'
    )
  }

  if (!context.activeFilePath) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'editor')
  }

  if (!context.activeCanvasId) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'canvas')
  }

  if (!context.attachments?.length) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'attachment')
  }

  if (!context.imageAttachments?.length) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'image')
  }

  return selectedTools
}

function buildStep(tool: AgentTool, input: Record<string, unknown>, result: AgentToolResult, duration: number): AgentStep {
  return {
    thought: `${tool.title}`,
    action: {
      tool: tool.name,
      params: input,
    },
    observation: result.message,
    duration,
  }
}

function isMutatingTool(tool: AgentTool) {
  return MUTATING_TOOL_RISKS.has(tool.risk)
}

function getReadToolCallSignature(tool: AgentTool, args: Record<string, unknown>) {
  if (tool.risk !== 'read') {
    return undefined
  }

  return `${tool.name}:${JSON.stringify(args)}`
}

function isEditorStateStaleResult(tool: AgentTool, result: AgentToolResult) {
  if (result.ok || !isMutatingTool(tool)) {
    return false
  }

  return /content has changed|editor content.*changed|内容已变化|版本.*(?:变化|不匹配)/i.test(
    `${result.error || ''}\n${result.message || ''}`
  )
}

export class AgentRuntime {
  private readonly contextManager = new AgentContextManager()
  private readonly promptAssembler = new AgentPromptAssembler()
  private readonly permissionEngine = new AgentPermissionEngine()
  private readonly recoveryManager = new AgentRecoveryManager()
  private abortController: AbortController | null = null
  private stopped = false
  private steeringRequested = false
  private steeringQueue: AgentSteeringPayload[] = []
  private steeringReadyResolver: (() => void) | null = null

  stop() {
    this.stopped = true
    this.steeringQueue = []
    this.steeringRequested = false
    this.steeringReadyResolver?.()
    this.steeringReadyResolver = null
    this.abortController?.abort()
  }

  beginSteering() {
    if (!this.stopped) {
      this.steeringRequested = true
    }
  }

  steer(payload: AgentSteeringPayload) {
    if (this.stopped) return
    this.steeringRequested = true
    this.steeringQueue.push(payload)
    this.steeringQueue.sort((a, b) => a.sequence - b.sequence)
    this.steeringReadyResolver?.()
    this.steeringReadyResolver = null
  }

  async run(input: AgentRuntimeInput, callbacks: AgentRuntimeCallbacks = {}): Promise<AgentRuntimeResult> {
    this.stopped = false
    this.abortController = new AbortController()

    const recorder = new AgentTraceRecorder()
    const runId = recorder.getRunId()
    const steps: AgentStep[] = []
    const toolCalls: ToolCall[] = []
    const changes: AgentChange[] = []

    const context: AgentContextSnapshot = {
      activeChatId: input.activeChatId,
      activeFilePath: input.activeFilePath,
      activeCanvasId: input.activeCanvasId,
      currentEditorState: input.currentEditorState,
      userInput: input.userInput,
      currentQuote: input.currentQuote,
      availableSkills: input.availableSkills,
      selectedSkills: input.selectedSkills,
      selectedMcpServerIds: input.selectedMcpServerIds,
      attachments: input.attachments,
      imageAttachments: input.imageAttachments,
    }

    const aiConfig = await getAISettings()
    const validatedBaseURL = await validateAIService(aiConfig?.baseURL)
    if (!aiConfig || validatedBaseURL === null) {
      agentDebugLog('ai_service_invalid', { runId })
      return {
        runId,
        content: '',
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    }

    const mcpToolCatalog = buildMcpAgentToolCatalog(input.selectedMcpServerIds)

    agentDebugLog('run_start', {
      runId,
      activeChatId: input.activeChatId,
      activeFilePath: input.activeFilePath || null,
      activeCanvasId: input.activeCanvasId || null,
      userInput: input.userInput,
      imageCount: input.imageUrls?.length || 0,
      hasQuote: Boolean(input.currentQuote),
      hasEditorState: Boolean(input.currentEditorState),
      availableSkillCount: input.availableSkills?.length || 0,
      selectedSkills: input.selectedSkills || [],
      directMcpToolCount: mcpToolCatalog.directTools.length,
      deferredMcpToolCount: mcpToolCatalog.deferredEntries.length,
      mcpSchemaTokens: mcpToolCatalog.schemaTokens,
    })

    const ragAgentPolicy = await getRagAgentPolicy()
    const allTools = [...agentToolRegistry.listTools(), ...mcpToolCatalog.directTools]
      .filter(tool =>
        (ragAgentPolicy.automaticSearchEnabled || tool.name !== 'note_search_files')
        && (aiConfig.enableWebSearch === true || tool.category !== 'web')
      )
    const toolMap = new Map(allTools.map((tool) => [tool.name, tool]))
    let tools = selectToolsForContext(context, allTools, input.permissionMode)
    const customSystemPrompt = await getSystemPromptContent()
    let memoryContext = input.useMemories === false
      ? {
          memories: [],
          usedTokens: 0,
          policyEnabled: false,
          workspaceId: input.workspaceId || 'default',
        }
      : await memoryContextService.getMemoryContext({
          query: input.userInput,
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
        })
    let systemPrompt = this.promptAssembler.assemble(
      context,
      tools,
      customSystemPrompt,
      memoryContextService.formatMemoryContext(memoryContext)
    )
    const baseMessages = this.contextManager.prepareMessages(input.messages || [])
      .map(normalizeBaseMessage)

    const currentUserMessage = await this.contextManager.buildCurrentUserMessage(
      input.userInput,
      input.imageUrls
    )

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...baseMessages,
      currentUserMessage,
    ]

    agentDebugLog('context_prepared', {
      runId,
      systemPromptLength: systemPrompt.length,
      systemPromptTokens: estimateTokens(systemPrompt),
      toolCount: tools.length,
      rawMessageCount: input.messages?.length || 0,
      preparedMessageCount: messages.length,
      preparedMessageTextTokens: messages.reduce(
        (sum, message) => sum + estimateMessageTextTokens(message),
        0
      ),
      currentImageCount: input.imageUrls?.length || 0,
      appContextMessageCount: baseMessages.filter((message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith('## App Context')
      ).length,
      messages: messages.map(summarizeMessage),
    })
    callbacks.onStatus?.('preparing_context')

    const client = await createOpenAIClient(aiConfig)
    let editorStateReadLocked = hasInlineCurrentEditorState(context)
    let editorSelectionReadLocked = hasInlineCurrentEditorSelection(context)
    let finalContent = ''
    let writeActionCompleted = false
    const readToolResultHistory = new Map<string, {
      result: string
      repeatCount: number
    }>()
    const failedToolResultHistory = new Map<string, {
      result: string
      repeatCount: number
    }>()
    const successfulMutationCalls = new Set<string>()
    const toolResultEvidence = new Set<string>()
    let noteSearchCount = 0
    let directAnswerEvidenceChecked = false
    const executeToolWithBudget = async (
      tool: AgentTool,
      args: Record<string, unknown>
    ): Promise<AgentToolResult> => {
      if (tool.name === 'note_search_files') {
        if (noteSearchCount >= ragAgentPolicy.maxSearchRounds) {
          return {
            ok: false,
            message: `This task reached the ${ragAgentPolicy.maxSearchRounds}-round note search limit for the "${ragAgentPolicy.strategy}" strategy. Answer based on the evidence you already have.`,
            error: 'NOTE_SEARCH_BUDGET_EXHAUSTED',
          }
        }
        noteSearchCount += 1
      }

      return executeAgentTool(
        tool,
        args,
        runId,
        this.abortController?.signal,
        context
      )
    }
    const appendToolResult = (
      toolCallId: string,
      toolName: string,
      args: Record<string, unknown>,
      result: AgentToolResult
    ) => {
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: stringifyToolResult(result),
      })
      toolResultEvidence.add([
        toolName,
        JSON.stringify(args),
        stringifyToolResult(result),
      ].join(':'))
    }
    const loadedSkillIds = new Set<string>()
    let consecutiveNoProgressRounds = 0
    let forceFinalResponseReason: string | undefined
    let latestEditorStateResult: AgentToolResult | undefined
    let activeModelTraceId: string | undefined
    let activeModelStartedAt = 0
    let activeModelReasoning = ''
    let activeModelContent = ''
    let activeModelStreamedTokenCount = 0
    const discoveredFolderFiles = new Map<string, Set<string>>()
    const readFolderFiles = new Map<string, Set<string>>()

    const getFolderAttachmentProgress = (
      toolName: string,
      args: Record<string, unknown>,
      result: AgentToolResult
    ) => {
      if (!result.ok || (toolName !== 'attachment_list' && toolName !== 'attachment_read')) {
        return undefined
      }

      const attachmentId = typeof args.attachmentId === 'string' ? args.attachmentId : ''
      const attachment = context.attachments?.find((item) => item.id === attachmentId)
      if (!attachment || attachment.kind !== 'folder') {
        return undefined
      }

      if (toolName === 'attachment_list') {
        const data = result.data && typeof result.data === 'object'
          ? result.data as { relativePath?: unknown; entries?: unknown }
          : undefined
        const relativePath = typeof data?.relativePath === 'string' ? data.relativePath : ''
        const entries = Array.isArray(data?.entries) ? data.entries : []
        const discovered = discoveredFolderFiles.get(attachmentId) || new Set<string>()

        for (const value of entries) {
          if (!value || typeof value !== 'object') continue
          const entry = value as { name?: unknown; kind?: unknown; readable?: unknown }
          if (entry.kind !== 'file' || entry.readable !== true || typeof entry.name !== 'string') continue
          discovered.add(relativePath ? `${relativePath}/${entry.name}` : entry.name)
        }

        discoveredFolderFiles.set(attachmentId, discovered)
        return `Listed ${entries.length} items; currently discovered ${discovered.size} readable files.`
      }

      const relativePath = typeof args.relativePath === 'string' ? args.relativePath : ''
      const relativePaths = Array.isArray(args.relativePaths)
        ? args.relativePaths.filter((path): path is string => typeof path === 'string')
        : []
      const resultData = result.data && typeof result.data === 'object'
        ? result.data as { files?: unknown }
        : undefined
      const successfulBatchPaths = Array.isArray(resultData?.files)
        ? resultData.files.flatMap((value) => {
            if (!value || typeof value !== 'object') return []
            const file = value as { path?: unknown; ok?: unknown }
            return file.ok === true && typeof file.path === 'string' ? [file.path] : []
          })
        : []
      const readPaths = successfulBatchPaths.length > 0
        ? successfulBatchPaths
        : relativePaths.length === 0 && relativePath
          ? [relativePath]
          : []
      if (readPaths.length === 0) return undefined
      const read = readFolderFiles.get(attachmentId) || new Set<string>()
      for (const path of readPaths) {
        read.add(path)
      }
      readFolderFiles.set(attachmentId, read)

      const discovered = discoveredFolderFiles.get(attachmentId)
      if (!discovered || discovered.size === 0) {
        return undefined
      }

      const readCount = [...discovered].filter((path) => read.has(path)).length
      const unread = [...discovered].filter((path) => !read.has(path))
      const unreadPreview = unread.slice(0, 20).join('、')
      const omittedCount = Math.max(0, unread.length - 20)
      return [
        `Currently read ${readCount}/${discovered.size} discovered readable files.`,
        unread.length > 0
          ? `Not yet read: ${unreadPreview}${omittedCount > 0 ? `, and ${omittedCount} more` : ''}. Decide from the user request whether to keep reading.`
          : 'All discovered readable files have already been read.',
      ].join('\n')
    }

    const getSafeStoppedContent = () => {
      if (toolCalls.length > 0 && !finalContent) {
        return [
          'Stopped generating the final explanation; treat tool results and the change log as the source of truth for completed work.',
          changes.length > 0 ? `Recorded ${changes.length} successful changes this turn.` : '',
        ].filter(Boolean).join('\n')
      }

      return activeModelContent || finalContent
    }

    const prepareFinalResponse = (reason: string) => {
      callbacks.onCandidateAnswerClear?.()
      forceFinalResponseReason = reason
      consecutiveNoProgressRounds = 0
      messages.push({
        role: 'user',
        content: [
          '## App Context',
          `Tool execution stopped: ${reason}`,
          'Based on the original user request and existing tool results, write a natural, complete final answer. State what was completed, what was not, and why; do not call any more tools.',
        ].join('\n'),
      })
    }

    const drainSteering = async () => {
      if (!this.steeringRequested) return false
      if (this.steeringQueue.length === 0 && !this.stopped) {
        await new Promise<void>((resolve) => {
          this.steeringReadyResolver = resolve
        })
      }
      if (this.stopped) return false

      const payloads = this.steeringQueue.splice(0)
      if (payloads.length === 0) return false
      this.steeringRequested = false
      callbacks.onStatus?.('steering')

      for (const payload of payloads) {
        const text = payload.additionalContext
          ? `## App Context\n${payload.additionalContext}\n\n## User steering message\n${payload.text}`
          : payload.text
        messages.push(await this.contextManager.buildCurrentUserMessage(text, payload.imageUrls))
      }

      const latest = payloads[payloads.length - 1]
      context.userInput = latest.text
      context.currentQuote = latest.currentQuote
      context.attachments = latest.attachments ?? context.attachments
      const steeredSkillIds = payloads.flatMap(payload => payload.selectedSkills || [])
      if (steeredSkillIds.length > 0) {
        context.selectedSkills = [
          ...new Set([...(context.selectedSkills || []), ...steeredSkillIds]),
        ]
        const availableSkillIds = new Set(
          (context.availableSkills || []).map(skill => skill.id)
        )
        for (const skillId of steeredSkillIds) {
          if (availableSkillIds.has(skillId)) continue
          const skill = skillManager.getSkill(skillId)
          if (!skill || skill.metadata.enabled === false) continue
          context.availableSkills = [
            ...(context.availableSkills || []),
            {
              id: skill.metadata.id,
              name: skill.metadata.name,
              description: skill.metadata.description,
              scope: skill.metadata.scope,
            },
          ]
          availableSkillIds.add(skillId)
        }
      }
      if (latest.imageAttachments?.length) {
        context.imageAttachments = [
          ...(context.imageAttachments ?? []),
          ...latest.imageAttachments,
        ].slice(-6)
      }
      context.currentEditorState = undefined
      tools = selectToolsForContext(context, allTools, input.permissionMode)
      editorStateReadLocked = false
      editorSelectionReadLocked = hasInlineCurrentEditorSelection(context)
      consecutiveNoProgressRounds = 0
      forceFinalResponseReason = undefined
      successfulMutationCalls.clear()
      directAnswerEvidenceChecked = false
      memoryContext = input.useMemories === false
        ? {
            memories: [],
            usedTokens: 0,
            policyEnabled: false,
            workspaceId: input.workspaceId || 'default',
          }
        : await memoryContextService.getMemoryContext({
            query: latest.text,
            conversationId: input.conversationId,
            workspaceId: input.workspaceId,
          })
      systemPrompt = this.promptAssembler.assemble(
        context,
        tools,
        customSystemPrompt,
        memoryContextService.formatMemoryContext(memoryContext)
      )
      messages[0] = { role: 'system', content: systemPrompt }

      const steeringTrace = recorder.add({
        type: 'steering',
        title: 'Follow-up information applied',
        status: 'success',
        message: payloads.map((payload) => payload.text).join('\n'),
      })
      callbacks.onTrace?.(steeringTrace)
      return true
    }

    const finalizeInterruptedModelTrace = (
      status: 'success' | 'error',
      title: string,
      isIntermediateResponse = false
    ) => {
      if (!activeModelTraceId) {
        return
      }

      const interruptedTrace = recorder.update(activeModelTraceId, {
        type: 'model_response',
        title,
        status,
        duration: Date.now() - activeModelStartedAt,
        output: activeModelContent || undefined,
        reasoning: activeModelReasoning || undefined,
        isIntermediateResponse: isIntermediateResponse && Boolean(activeModelContent),
        streamedTokenCount: activeModelStreamedTokenCount,
      })
      if (interruptedTrace) callbacks.onTrace?.(interruptedTrace)

      activeModelTraceId = undefined
      activeModelStartedAt = 0
      activeModelReasoning = ''
      activeModelContent = ''
      activeModelStreamedTokenCount = 0
    }

    try {
      agentLoop: for (let iteration = 1; iteration <= ABSOLUTE_MAX_MODEL_ROUNDS + 1; iteration += 1) {
        if (iteration > ABSOLUTE_MAX_MODEL_ROUNDS && !forceFinalResponseReason) {
          break
        }
        if (this.stopped) {
          callbacks.onStatus?.('stopped')
          const stoppedContent = getSafeStoppedContent()
          if (stoppedContent) {
            callbacks.onFinalAnswerRender?.(stoppedContent)
          }
          return {
            runId,
            content: stoppedContent,
            stopped: true,
            steps,
            toolCalls,
            changes,
            trace: recorder.all(),
          }
        }

        await drainSteering()
        const evidenceCountAtRoundStart = toolResultEvidence.size

        callbacks.onStatus?.('thinking')
        await agentEventBus.emit('before-model-call', { runId })
        agentDebugLog('model_call_start', {
          runId,
          iteration,
          model: aiConfig?.model || '',
          messageCount: messages.length,
          toolCount: tools.length,
        })
        const modelTrace = recorder.add({
          type: 'model_call',
          title: 'Model thinking',
          status: 'running',
          message: `Round ${iteration}`,
          streamedTokenCount: 0,
        })
        activeModelTraceId = modelTrace.id
        activeModelStartedAt = modelTrace.timestamp
        activeModelReasoning = ''
        activeModelContent = ''
        activeModelStreamedTokenCount = 0
        callbacks.onTrace?.(modelTrace)

        const offeredTools = forceFinalResponseReason ? [] : tools.filter((tool) => {
          if (editorStateReadLocked && tool.name === 'editor_get_state') {
            return false
          }
          if (editorSelectionReadLocked && tool.name === 'editor_get_selection') {
            return false
          }
          return true
        })
        const offeredToolNames = new Set(offeredTools.map((tool) => tool.name))
        const openAITools = agentToolRegistry.toOpenAITools(offeredTools, loadedSkillIds)
        const requestMessages = this.contextManager.prepareMessages(messages)
        const messageTextTokens = requestMessages.reduce(
          (sum, message) => sum + estimateMessageTextTokens(message),
          0
        )
        const toolSchemaTokens = estimateTokens(JSON.stringify(openAITools))
        agentDebugLog('model_request_budget', {
          runId,
          iteration,
          messageCount: requestMessages.length,
          messageTextTokens,
          offeredToolCount: offeredTools.length,
          toolSchemaTokens,
          estimatedTextAndToolTokens: messageTextTokens + toolSchemaTokens,
          imageCount: input.imageUrls?.length || 0,
        })
        const toolParams = openAITools.length > 0
          ? {
              tools: openAITools,
              tool_choice: 'auto' as const,
            }
          : {}
        const stream = await this.recoveryManager.withRetry(() =>
          createChatCompletionStreamWithToolChoiceFallback(client, withFastAiRequestOptions({
            model: aiConfig?.model || '',
            messages: requestMessages,
            temperature: aiConfig?.temperature,
            top_p: aiConfig?.topP,
            stream: true,
            ...toolParams,
            ...getChatTokenLimitParams(aiConfig),
          }, aiConfig), {
            signal: this.abortController?.signal,
          })
        )
        let assistantContent = ''
        let finishReason: string | null | undefined
        let toolCallsStarted = false
        let candidateAnswerRendered = false
        let assistantReasoning = ''
        let streamedText = ''
        let streamedTokenCount = 0
        let lastModelProgressTraceAt = 0
        let steeringInterrupted = false
        const streamedToolCalls = new Map<number, StreamingToolCallAccumulator>()

        for await (const chunk of stream) {
          if (this.stopped) {
            throw new Error('USER_STOPPED')
          }
          if (this.steeringRequested) {
            steeringInterrupted = true
            break
          }

          const choice = chunk.choices[0]
          if (!choice) {
            continue
          }

          finishReason = choice.finish_reason ?? finishReason
          const delta = choice.delta
          const extendedDelta = delta as typeof delta & {
            reasoning?: string
            reasoning_content?: string
          }
          const reasoningDelta = extendedDelta.reasoning_content || extendedDelta.reasoning
          if (typeof reasoningDelta === 'string') {
            assistantReasoning += reasoningDelta
            streamedText += reasoningDelta
            activeModelReasoning = assistantReasoning
          }
          if (typeof delta.content === 'string' && delta.content) {
            assistantContent += delta.content
            streamedText += delta.content
            activeModelContent = assistantContent
            if (
              !toolCallsStarted &&
              assistantContent.trim()
            ) {
              candidateAnswerRendered = true
              callbacks.onCandidateAnswerRender?.(assistantContent)
            }
          }

          for (const toolCallDelta of delta.tool_calls || []) {
            if (!toolCallsStarted) {
              toolCallsStarted = true
            }

            const index = toolCallDelta.index
            const current = streamedToolCalls.get(index) || {
              index,
              id: toolCallDelta.id,
              type: 'function' as const,
              function: {
                name: '',
                arguments: '',
              },
            }

            if (toolCallDelta.id) {
              current.id = toolCallDelta.id
            }
            if (toolCallDelta.type === 'function') {
              current.type = toolCallDelta.type
            }
            if (toolCallDelta.function?.name) {
              current.function.name += toolCallDelta.function.name
              streamedText += toolCallDelta.function.name
            }
            if (toolCallDelta.function?.arguments) {
              current.function.arguments += toolCallDelta.function.arguments
              streamedText += toolCallDelta.function.arguments
            }

            streamedToolCalls.set(index, current)
          }

          const now = Date.now()
          if (streamedText && now - lastModelProgressTraceAt >= 100) {
            streamedTokenCount = estimateTokens(streamedText)
            activeModelStreamedTokenCount = streamedTokenCount
            lastModelProgressTraceAt = now
            const progressTrace = recorder.update(modelTrace.id, {
              output: assistantContent || undefined,
              reasoning: assistantReasoning || undefined,
              streamedTokenCount,
            })
            if (progressTrace) callbacks.onTrace?.(progressTrace)
          }
        }
        streamedTokenCount = estimateTokens(streamedText)
        activeModelStreamedTokenCount = streamedTokenCount
        assistantContent = assistantContent.trim() ? assistantContent : ''
        const rawToolUses = toToolCallList(streamedToolCalls)
        const toolUses = rawToolUses.map((toolCall) => {
          const rewritten = rewriteWorkspaceReadAsAttachmentRead(toolCall, context)
          if (rewritten.function.name !== toolCall.function.name) {
            agentDebugLog('tool_call_auto_routed_to_attachment', {
              runId,
              toolCallId: toolCall.id,
              originalToolName: toolCall.function.name,
              originalArguments: toolCall.function.arguments,
              rewrittenToolName: rewritten.function.name,
              rewrittenArguments: rewritten.function.arguments,
            })
          }
          return rewritten
        })
        if (steeringInterrupted) {
          finalizeInterruptedModelTrace('success', 'Model response redirected by follow-up information', true)
          if (assistantContent) {
            messages.push({ role: 'assistant', content: assistantContent })
          }
          await drainSteering()
          iteration -= 1
          continue
        }
        agentDebugLog('model_call_end', {
          runId,
          iteration,
          finishReason,
          assistantContentLength: assistantContent.length,
          assistantPreview: previewText(assistantContent),
          toolCalls: toolUses.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsPreview: previewText(toolCall.function.arguments || ''),
          })),
        })
        const modelTraceOutput = assistantContent || (
          toolUses.length > 0
            ? {
              finishReason,
              toolCalls: toolUses.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.function.name,
                argumentsPreview: previewText(toolCall.function.arguments || '', 500),
              })),
            }
            : undefined
        )
        const responseTrace = recorder.update(modelTrace.id, {
          type: 'model_response',
          title: assistantContent ? 'Model response' : toolUses.length > 0 ? 'Model selected tools' : 'Model thinking',
          status: 'success',
          duration: Date.now() - modelTrace.timestamp,
          output: modelTraceOutput,
          reasoning: assistantReasoning || undefined,
          isIntermediateResponse: toolUses.length > 0 && Boolean(assistantContent),
          streamedTokenCount,
        })
        if (responseTrace) callbacks.onTrace?.(responseTrace)
        activeModelTraceId = undefined
        activeModelStartedAt = 0
        activeModelReasoning = ''
        activeModelContent = ''
        activeModelStreamedTokenCount = 0
        if (toolCallsStarted && candidateAnswerRendered) {
          callbacks.onCandidateAnswerClear?.()
        }
        await agentEventBus.emit('after-model-call', { runId, content: assistantContent })

        if (toolUses.length === 0) {
          const resolvedContent = assistantContent || finalContent
          if (!resolvedContent) {
            throw new Error('AI response did not include a message')
          }
          if (
            !forceFinalResponseReason
            && !directAnswerEvidenceChecked
            && noteSearchCount === 0
            && toolCalls.length === 0
            && offeredToolNames.has('note_search_files')
            && claimsUserNoteEvidence(resolvedContent)
          ) {
            directAnswerEvidenceChecked = true
            callbacks.onCandidateAnswerClear?.()
            messages.push(
              { role: 'assistant', content: resolvedContent },
              {
                role: 'user',
                content: [
                  '## App Context',
                  'The draft above claims that its answer is supported by the user\'s notes or records, but no note search occurred in this run.',
                  'Verify that attribution semantically, without relying on required keywords or fixed business fields. Do not treat the draft itself as evidence.',
                  'If the claimed fact is not already supported by the conversation, current editor context, or saved memory context, call note_search_files now. If the existing context really supports it, return the final answer directly.',
                  'Do not mention this internal evidence-attribution check.',
                ].join('\n'),
              }
            )
            continue
          }
          agentDebugLog('final_answer', {
            runId,
            contentLength: resolvedContent.length,
            preview: previewText(resolvedContent),
          })
          callbacks.onStatus?.('completed')
          callbacks.onFinalAnswerRender?.(resolvedContent)
          const finalTrace = recorder.add({
            type: 'final',
            title: 'Done',
            status: 'success',
            message: resolvedContent,
          })
          callbacks.onTrace?.(finalTrace)

          return {
            runId,
            content: resolvedContent,
            stopped: false,
            steps,
            toolCalls,
            changes,
            trace: recorder.all(),
          }
        }

        messages.push({
          role: 'assistant',
          content: assistantContent || null,
          tool_calls: toolUses,
        })

        const cancelRemainingToolCalls = (afterIndex: number, reason: string) => {
          for (const pendingToolUse of toolUses.slice(afterIndex + 1)) {
            appendToolResult(pendingToolUse.id, pendingToolUse.function.name, {}, {
              ok: false,
              message: `Run protection stopped further tool calls: ${reason}`,
              error: 'CANCELLED_BY_RUNTIME_GUARD',
            })
          }
        }

        for (let toolIndex = 0; toolIndex < toolUses.length; toolIndex += 1) {
          const toolUse = toolUses[toolIndex]
          if (this.stopped) {
            throw new Error('USER_STOPPED')
          }
          const toolName = toolUse.function.name
          if (this.steeringRequested) {
            appendToolResult(toolUse.id, toolName, {}, {
              ok: false,
              message: 'The user added new guidance; tool calls that had not started were cancelled.',
              error: 'SUPERSEDED_BY_STEERING',
            })
            continue
          }

          const tool = toolMap.get(toolName)
          let args: Record<string, unknown>
          try {
            args = parseToolArguments(toolUse.function.arguments)
          } catch (error) {
            const parseErrorResult: AgentToolResult = {
              ok: false,
              message: `Invalid tool argument JSON: ${error instanceof Error ? error.message : String(error)}. Retry the same tool call with valid JSON arguments.`,
              error: 'INVALID_TOOL_ARGUMENTS_JSON',
            }
            const toolCall: ToolCall = {
              id: toolUse.id || createAgentId('tool-call'),
              toolName,
              params: {},
              status: 'error',
              result: toolResultToLegacy(parseErrorResult),
              timestamp: Date.now(),
            }
            toolCalls.push(toolCall)
            callbacks.onToolCall?.(toolCall)
            agentDebugLog('tool_args_parse_error', {
              runId,
              toolCallId: toolUse.id,
              toolName,
              rawArguments: toolUse.function.arguments || '',
              error: parseErrorResult.message,
            })
            appendToolResult(toolUse.id, toolName, {}, parseErrorResult)
            continue
          }

          const repairedEditorArgs = repairEditorWriteArgs(toolName, args, context)
          if (repairedEditorArgs !== args) {
            agentDebugLog('tool_args_auto_repaired', {
              runId,
              toolName,
              originalArgs: args,
              repairedArgs: repairedEditorArgs,
              reason: 'Normalized editor line replacement arguments and preserved Markdown structure.',
            })
            args = repairedEditorArgs
          }

          const repairedAttachmentArgs = repairAttachmentToolArgs(toolName, args, context)
          if (repairedAttachmentArgs !== args) {
            agentDebugLog('attachment_args_auto_repaired', {
              runId,
              toolCallId: toolUse.id,
              toolName,
              originalArgs: args,
              repairedArgs: repairedAttachmentArgs,
            })
            args = repairedAttachmentArgs
          }

          agentDebugLog('tool_call_received', {
            runId,
            toolCallId: toolUse.id,
            toolName,
            args,
          })

          if (!tool) {
            const missingResult: AgentToolResult = {
              ok: false,
              message: `Tool does not exist: ${toolName}`,
              error: `Unknown tool ${toolName}`,
            }
            agentDebugLog('tool_missing', {
              runId,
              toolName,
            })
            appendToolResult(toolUse.id, toolName, args, missingResult)
            continue
          }

          callbacks.onStatus?.('calling_tool')
          const toolCall: ToolCall = {
            id: toolUse.id || createAgentId('tool-call'),
            toolName,
            params: args,
            status: 'pending',
            timestamp: Date.now(),
          }
          toolCalls.push(toolCall)
          callbacks.onToolCall?.(toolCall)

          if (!offeredToolNames.has(toolName)) {
            const blockedResult: AgentToolResult = {
              ok: false,
              message: `Blocked a tool call not available in the current context or permission mode: ${toolName}.`,
              error: 'BLOCKED_UNAVAILABLE_TOOL',
            }
            agentDebugLog('tool_blocked_as_unavailable', {
              runId,
              toolName,
              args,
              offeredToolNames: [...offeredToolNames],
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(blockedResult)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, blockedResult)
            continue
          }

          const invalidToolInput = validateToolInputShape(tool, args)
          if (invalidToolInput) {
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidToolInput)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, invalidToolInput)
            continue
          }

          if (
            (toolName === 'skill_execute_script' || toolName === 'skill_read_resource')
            && (
              typeof args.skill_id !== 'string'
              || !loadedSkillIds.has(args.skill_id)
            )
          ) {
            const notLoadedResult: AgentToolResult = {
              ok: false,
              message: `Skill "${String(args.skill_id || '')}" is not loaded in this task. Call skill_load once before using its resources or scripts.`,
              error: 'SKILL_NOT_LOADED',
            }
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(notLoadedResult)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(notLoadedResult),
            })
            continue
          }

          if (toolName === 'skill_execute_script' && typeof args.skill_id === 'string') {
            const availableScripts = skillManager.getSkill(args.skill_id)?.scripts.map(script => script.name) || []
            if (
              typeof args.script_id !== 'string'
              || !availableScripts.includes(args.script_id)
            ) {
              const invalidScriptResult: AgentToolResult = {
                ok: false,
                message: [
                  `Invalid script_id for loaded Skill "${args.skill_id}": ${String(args.script_id || '')}.`,
                  `Choose one exact registered ID: ${availableScripts.join(', ') || '(none)'}.`,
                  'Do not invent, abbreviate, or recreate a script.',
                ].join('\n'),
                error: 'INVALID_REGISTERED_SCRIPT_ID',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(invalidScriptResult)
              callbacks.onToolCall?.(toolCall)
              messages.push({
                role: 'tool',
                tool_call_id: toolUse.id,
                content: stringifyToolResult(invalidScriptResult),
              })
              continue
            }
          }

          const invalidEditorTarget = validateEditorTargetFile(context, tool, args)
          if (invalidEditorTarget) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidEditorTarget.message,
              error: invalidEditorTarget.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidEditorTarget)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, invalidEditorTarget)
            continue
          }

          const invalidQuotedWrite = validateQuotedEditorWrite(context, toolName, args)
          if (invalidQuotedWrite) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidQuotedWrite.message,
              error: invalidQuotedWrite.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidQuotedWrite)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, invalidQuotedWrite)
            continue
          }

          const blockedByHook = await agentEventBus.emit('pre-tool-use', {
            runId,
            tool,
            input: args,
          })

          if (blockedByHook) {
            const blockedResult: AgentToolResult = {
              ok: false,
              message: blockedByHook,
              error: 'BLOCKED_BY_HOOK',
            }
            agentDebugLog('tool_blocked_by_hook', {
              runId,
              toolName,
              reason: blockedByHook,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(blockedResult)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, blockedResult)
            continue
          }

          const permission = this.permissionEngine.evaluate(tool, args, input.permissionMode)
          agentDebugLog('permission_decision', {
            runId,
            toolName,
            risk: tool.risk,
            allowed: permission.allowed,
            requiresApproval: permission.requiresApproval,
            reason: permission.reason,
            canApproveForSession: permission.canApproveForSession,
            sessionApprovalType: permission.sessionApprovalType,
            sessionApprovalKey: permission.sessionApprovalKey,
          })
          if (!permission.allowed) {
            const deniedResult: AgentToolResult = {
              ok: false,
              message: permission.reason || 'Tool call blocked by permission policy.',
              error: 'BLOCKED_BY_PERMISSION',
            }
            agentDebugLog('tool_blocked_by_permission', {
              runId,
              toolName,
              reason: deniedResult.message,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(deniedResult)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, deniedResult)
            continue
          }

          if (permission.requiresApproval) {
            callbacks.onStatus?.('waiting_approval')
            agentDebugLog('approval_request', {
              runId,
              toolName,
              args,
            })
            const approvalTrace = recorder.add({
              type: 'approval',
              title: 'Waiting for user confirmation',
              status: 'running',
              toolName,
              input: args,
            })
            callbacks.onTrace?.(approvalTrace)

            const approvalPreview = await buildEditorApprovalPreview(tool.name, args)
            if (this.stopped) {
              throw new Error('USER_STOPPED')
            }
            let approvalDecision = this.steeringRequested
              ? 'steered'
              : await callbacks.requestConfirmation?.(
                  tool.name,
                  args,
                  approvalPreview ?? { previewParams: args }
                )

            agentDebugLog('approval_result', {
              runId,
              toolName,
              approved: approvalDecision === 'approved',
              decision: approvalDecision,
            })

            if (this.stopped) {
              throw new Error('USER_STOPPED')
            }
            if (this.steeringRequested) {
              approvalDecision = 'steered'
            }

            if (approvalDecision === 'steered') {
              const supersededResult: AgentToolResult = {
                ok: false,
                message: 'The user added new guidance; the pending confirmation was cancelled.',
                error: 'SUPERSEDED_BY_STEERING',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(supersededResult)
              callbacks.onToolCall?.(toolCall)
              const updatedApprovalTrace = recorder.update(approvalTrace.id, {
                status: 'error',
                message: supersededResult.message,
                output: supersededResult,
              })
              if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
              appendToolResult(toolUse.id, toolName, args, supersededResult)
              continue
            }

            if (approvalDecision !== 'approved') {
              const deniedResult: AgentToolResult = {
                ok: false,
                message: 'The user rejected this operation. Do not retry the same high-risk tool; answer read-only or ask how to proceed.',
                error: 'USER_DENIED_TOOL',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(deniedResult)
              callbacks.onToolCall?.(toolCall)
              const updatedApprovalTrace = recorder.update(approvalTrace.id, {
                status: 'error',
                message: deniedResult.message,
                output: deniedResult,
              })
              if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
              appendToolResult(toolUse.id, toolName, args, deniedResult)
              finalContent = changes.length > 0
                ? `Cancelled the pending confirmation; ${changes.length} earlier changes already succeeded—treat the change log as source of truth.`
                : 'Cancelled the pending confirmation; that change was not applied.'
              agentDebugLog('approval_denied_final', {
                runId,
                toolName,
                content: finalContent,
              })
              callbacks.onStatus?.('completed')
              callbacks.onFinalAnswerRender?.(finalContent)
              const finalTrace = recorder.add({
                type: 'final',
                title: 'Cancelled',
                status: 'success',
                message: finalContent,
              })
              callbacks.onTrace?.(finalTrace)

              return {
                runId,
                content: finalContent,
                stopped: false,
                steps,
                toolCalls,
                changes,
                trace: recorder.all(),
              }
            }

            const updatedApprovalTrace = recorder.update(approvalTrace.id, {
              status: 'success',
              message: 'User confirmed the operation.',
            })
            if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
          }

          callbacks.onStatus?.(
            ['editor-write', 'file-create', 'file-update', 'delete', 'medium'].includes(tool.risk)
              ? 'applying_change'
              : 'calling_tool'
          )

          const trace = recorder.add({
            type: 'tool_call',
            title: tool.title,
            status: 'running',
            toolName,
            input: args,
          })
          callbacks.onTrace?.(trace)
          toolCall.status = 'running'
          callbacks.onToolCall?.(toolCall)

          const startedAt = Date.now()
          const reusableEditorStateResult = toolName === 'editor_get_state' && editorStateReadLocked
            ? latestEditorStateResult
            : undefined
          const reusedLockedEditorState = reusableEditorStateResult !== undefined
          const mutationCallSignature = isMutatingTool(tool)
            ? `${tool.name}:${JSON.stringify(args)}`
            : undefined
          const repeatedFailedMutation = Boolean(
            mutationCallSignature && failedToolResultHistory.has(mutationCallSignature)
          )
          const repeatedSuccessfulMutation = Boolean(
            mutationCallSignature && successfulMutationCalls.has(mutationCallSignature)
          )
          agentDebugLog('tool_execute_start', {
            runId,
            iteration,
            toolName,
            args,
            reusedLockedEditorState,
            repeatedFailedMutation,
            repeatedSuccessfulMutation,
          })
          const result: AgentToolResult = repeatedSuccessfulMutation
            ? {
                ok: true,
                message: 'The same write already succeeded in this task; this repeat was ignored. Finish the answer directly.',
                data: { deduplicated: true },
              }
            : repeatedFailedMutation
            ? {
                ok: false,
                message: 'The same write previously failed; this repeat was blocked. Adjust arguments, use another tool, or explain the failure to the user.',
                error: 'REPEATED_FAILED_MUTATION_BLOCKED',
              }
            : reusableEditorStateResult
            ? {
                ...reusableEditorStateResult,
                message: [
                  reusableEditorStateResult.message,
                  'The same editor state was already read this turn; reuse that result and do not read again.',
                ].join('\n\n'),
              }
            : await executeToolWithBudget(tool, args)
          const folderAttachmentProgress = getFolderAttachmentProgress(tool.name, args, result)
          const duration = Date.now() - startedAt
          agentDebugLog('tool_execute_end', {
            runId,
            iteration,
            toolName,
            ok: result.ok,
            duration,
            message: result.message,
            error: result.error,
            changeCount: result.changes?.length || 0,
          })

          if (result.changes) {
            for (const change of result.changes) {
              changes.push(change)
              callbacks.onChange?.(change)
              const changeTrace = recorder.add({
                type: 'change',
                title: change.summary || 'Record changes',
                status: 'success',
                toolName,
                output: change,
                message: change.target,
              })
              callbacks.onTrace?.(changeTrace)
            }
          }

          toolCall.status = result.ok ? 'success' : 'error'
          toolCall.result = toolResultToLegacy(result)
          callbacks.onToolCall?.(toolCall)

          const step = buildStep(tool, args, result, duration)
          steps.push(step)
          callbacks.onStep?.(step)

          const updatedTrace = recorder.update(trace.id, {
            status: result.ok ? 'success' : 'error',
            duration,
            output: result,
            message: [result.message, folderAttachmentProgress].filter(Boolean).join('\n\n'),
          })
          if (updatedTrace) callbacks.onTrace?.(updatedTrace)

          await agentEventBus.emit('post-tool-use', {
            runId,
            tool,
            input: args,
            result,
          })

          let modelFacingResult = result
          let identicalReadResultRepeatCount = 0
          const readToolCallSignature = reusedLockedEditorState
            ? undefined
            : getReadToolCallSignature(tool, args)
          if (result.ok && readToolCallSignature) {
            const serializedResult = stringifyToolResult(result)
            const previousRead = readToolResultHistory.get(readToolCallSignature)

            if (previousRead?.result === serializedResult) {
              identicalReadResultRepeatCount = previousRead.repeatCount + 1
              readToolResultHistory.set(readToolCallSignature, {
                result: serializedResult,
                repeatCount: identicalReadResultRepeatCount,
              })
              modelFacingResult = {
                ...result,
                message: [
                  result.message,
                  'This read is identical to the previous one, which is still in context. Do not read again; use the existing result for the next write, or finish the answer.',
                ].join('\n\n'),
              }
            } else {
              readToolResultHistory.set(readToolCallSignature, {
                result: serializedResult,
                repeatCount: 0,
              })
            }
          }

          if (result.ok && isMutatingTool(tool) && !repeatedSuccessfulMutation) {
            modelFacingResult = {
              ...result,
              message: [
                result.message || 'Operation completed successfully.',
                'This operation already succeeded; do not call the same tool again with the same arguments. If the user request is done, give the final answer.',
              ].join('\n\n'),
            }
          } else if (!result.ok) {
            modelFacingResult = {
              ...result,
              message: [
                result.message || result.error || 'Tool did not return a confirmable success result.',
                isMutatingTool(tool)
                  ? 'This operation was not confirmed successful. Do not repeat with the same arguments; adjust the plan, use another tool, or explain to the user.'
                  : 'Adjust arguments from this result, use another tool, or tell the user; do not ignore the error and end the conversation.',
              ].join('\n\n'),
            }
          }

          if (folderAttachmentProgress) {
            modelFacingResult = {
              ...modelFacingResult,
              message: [modelFacingResult.message, folderAttachmentProgress].filter(Boolean).join('\n\n'),
            }
          }

          appendToolResult(toolUse.id, tool.name, args, modelFacingResult)

          if (repeatedSuccessfulMutation || repeatedFailedMutation) {
            const reason = repeatedSuccessfulMutation
              ? `The same ${tool.title} operation already succeeded; this repeat was not executed again.`
              : `The same ${tool.title} operation previously failed; this repeat was blocked.`
            cancelRemainingToolCalls(toolIndex, reason)
            prepareFinalResponse(reason)
            continue agentLoop
          }

          if (result.ok && tool.name === 'skill_load' && typeof args.skill_id === 'string') {
            loadedSkillIds.add(args.skill_id)
          }

          if (result.ok && mutationCallSignature && !repeatedSuccessfulMutation) {
            successfulMutationCalls.add(mutationCallSignature)
          }

          if (!result.ok) {
            const failedCallSignature = `${tool.name}:${JSON.stringify(args)}`
            const serializedResult = stringifyToolResult(result)
            const previousFailure = failedToolResultHistory.get(failedCallSignature)
            const repeatCount = previousFailure?.result === serializedResult
              ? previousFailure.repeatCount + 1
              : 0
            failedToolResultHistory.set(failedCallSignature, {
              result: serializedResult,
              repeatCount,
            })
          } else {
            failedToolResultHistory.delete(`${tool.name}:${JSON.stringify(args)}`)
          }

          if (identicalReadResultRepeatCount >= MAX_IDENTICAL_READ_RESULT_REPEATS) {
            const reason = [
              `Model repeatedly called ${toolName} with unchanged read results; stopped to avoid a loop.`,
              writeActionCompleted ? 'Previously completed changes were kept.' : 'This change is not finished yet.',
            ].join('\n')
            cancelRemainingToolCalls(toolIndex, reason)
            prepareFinalResponse(reason)
            continue agentLoop
          }

          if (result.ok && isMutatingTool(tool)) {
            writeActionCompleted = true
            readToolResultHistory.clear()
            latestEditorStateResult = undefined
            editorStateReadLocked = false
            editorSelectionReadLocked = false
          } else if (isEditorStateStaleResult(tool, result)) {
            latestEditorStateResult = undefined
            editorStateReadLocked = false
            editorSelectionReadLocked = false
          }

          if (result.ok && tool.name === 'editor_get_state') {
            if (!reusedLockedEditorState) {
              latestEditorStateResult = result
            }
            editorStateReadLocked = true
            const editorStateData = result.data && typeof result.data === 'object'
              ? result.data as { selection?: unknown }
              : undefined
            if (editorStateData?.selection) {
              editorSelectionReadLocked = true
            }
          }

          if (result.ok && tool.name === 'editor_get_selection') {
            editorSelectionReadLocked = true
          }

        }

        const madeProgress = toolResultEvidence.size > evidenceCountAtRoundStart
        consecutiveNoProgressRounds = madeProgress
          ? 0
          : consecutiveNoProgressRounds + 1
        agentDebugLog('agent_round_progress', {
          runId,
          iteration,
          madeProgress,
          newEvidenceCount: toolResultEvidence.size - evidenceCountAtRoundStart,
          consecutiveNoProgressRounds,
        })

        if (consecutiveNoProgressRounds >= MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS) {
          const completedWrite = writeActionCompleted || changes.length > 0
          const reason = completedWrite
            ? [
                'Changes succeeded; the model produced no further tool results, so repeat calls were stopped.',
                changes.length > 0 ? `Recorded ${changes.length} successful changes this turn.` : 'Duplicate write was ignored.',
              ].join('\n')
            : [
                `No new tool results for ${MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS} consecutive rounds; stopped to avoid an idle loop.`,
                'This task is not confirmed complete yet.',
              ].join('\n')
          prepareFinalResponse(reason)
          continue
        }

        if (iteration >= ABSOLUTE_MAX_MODEL_ROUNDS && !forceFinalResponseReason) {
          prepareFinalResponse(`Reached the tool-execution safety limit of ${ABSOLUTE_MAX_MODEL_ROUNDS} rounds.`)
        }

      }

      finalContent = finalContent || `Reached the absolute safety limit of ${ABSOLUTE_MAX_MODEL_ROUNDS} rounds; the task may be incomplete.`
      callbacks.onFinalAnswerRender?.(finalContent)
      return {
        runId,
        content: finalContent,
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    } catch (error) {
      if (
        this.stopped
        || (error instanceof Error && error.message === 'USER_STOPPED')
        || isRequestAbortError(error)
      ) {
        // AbortController may surface an AbortError before the stream loop can throw
        // USER_STOPPED. Treat both paths as a normal stop and preserve what the
        // current model has already streamed to the user.
        finalContent = getSafeStoppedContent()
        finalizeInterruptedModelTrace('success', 'Model response stopped')
        callbacks.onStatus?.('stopped')
        if (finalContent) {
          callbacks.onFinalAnswerRender?.(finalContent)
        }
        return {
          runId,
          content: finalContent,
          stopped: true,
          steps,
          toolCalls,
          changes,
          trace: recorder.all(),
        }
      }

      callbacks.onStatus?.('failed')
      finalizeInterruptedModelTrace('error', 'Model response failed')
      const message = handleAIError(error, false) || (error instanceof Error ? error.message : String(error))
      const errorTrace = recorder.add({
        type: 'error',
        title: 'Execution failed',
        status: 'error',
        message,
      })
      callbacks.onTrace?.(errorTrace)
      throw new Error(message)
    }
  }
}
