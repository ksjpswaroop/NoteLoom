import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import type OpenAI from 'openai';
import { AiConfig } from "@/app/core/setting/config";
import { readFile } from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";
import { createTauriOpenAIClient, type OpenAICompatibleClient } from "./tauri-client";
import {
  AGENT_CORE_PROMPT_VERSION,
  isManagedAgentSystemPrompt,
} from './system-prompt';
import { loadWebSearchSettings } from '@/lib/web-search/settings';

/**
 * prompt
 */
export async function getPromptContent(): Promise<string> {
  const store = await Store.load('store.json')
  const currentPromptId = await store.get<string>('currentPromptId')
  let promptContent = ''
  
  if (currentPromptId) {
    const promptList = await store.get<Array<{id: string, content: string}>>('promptList')
    if (promptList) {
      const currentPrompt = promptList.find(prompt => prompt.id === currentPromptId)
      if (currentPrompt && currentPrompt.content) {
        promptContent = currentPrompt.content
      }
    }
  }
  
  return promptContent
}

/**
 * Agent 
 */
export async function getSystemPromptContent(): Promise<string> {
  const store = await Store.load('store.json')
  const extension = await store.get<string>('agentSystemPromptExtension')
  if (typeof extension === 'string') {
    return extension.trim()
  }

  const legacySystemPrompt = await store.get<string>('systemPrompt')
  const migratedExtension = typeof legacySystemPrompt === 'string'
    && !isManagedAgentSystemPrompt(legacySystemPrompt)
    ? legacySystemPrompt.trim()
    : ''

  await store.set('agentSystemPromptExtension', migratedExtension)
  await store.set('agentCorePromptVersion', AGENT_CORE_PROMPT_VERSION)
  await store.save()
  return migratedExtension
}

/**
 * AI
 */
export async function getAISettings(modelType?: string): Promise<AiConfig | undefined> {
  const store = await Store.load('store.json')
  const aiConfigs = await store.get<AiConfig[]>('aiModelList')
  const modelId = await store.get(modelType || 'primaryModel')

  if (!modelId || !aiConfigs) {
    return undefined
  }
  const webSearchSettings = await loadWebSearchSettings(store, { aiConfigs, modelId })

  // ，ID
  for (const config of aiConfigs) {
    // models
    if (config.models && config.models.length > 0) {
      // ID
      let targetModel = config.models.find(model => model.id === modelId)

      // ， ${config.key}-${model.id}
      if (!targetModel && typeof modelId === 'string' && modelId.includes('-')) {
        const expectedPrefix = `${config.key}-`
        if (modelId.startsWith(expectedPrefix)) {
          const originalModelId = modelId.substring(expectedPrefix.length)
          targetModel = config.models.find(model => model.id === originalModelId)
        }
      }

      if (targetModel) {
        const result = {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream,
          maxTokens: targetModel.maxTokens,
          contextWindow: targetModel.contextWindow,
          tokenLimitParam: targetModel.tokenLimitParam,
          enableWebSearch: webSearchSettings.nativeEnabled
            || webSearchSettings.thirdPartyEnabled
            || webSearchSettings.basicEnabled,
          enableNativeWebSearch: webSearchSettings.nativeEnabled,
          enableThirdPartyWebSearch: webSearchSettings.thirdPartyEnabled,
          enableBasicWebSearch: webSearchSettings.basicEnabled,
          webSearchProvider: webSearchSettings.provider,
          webSearchApiKey: webSearchSettings.provider === 'auto'
            ? undefined
            : webSearchSettings.apiKeys[webSearchSettings.provider],
          webSearchApiKeys: webSearchSettings.apiKeys,
          webSearchProviderOrder: webSearchSettings.providerOrder,
        }
        return result
      }
    } else {
      // ：
      if (config.key === modelId) {
        return {
          ...config,
          enableWebSearch: webSearchSettings.nativeEnabled
            || webSearchSettings.thirdPartyEnabled
            || webSearchSettings.basicEnabled,
          enableNativeWebSearch: webSearchSettings.nativeEnabled,
          enableThirdPartyWebSearch: webSearchSettings.thirdPartyEnabled,
          enableBasicWebSearch: webSearchSettings.basicEnabled,
          webSearchProvider: webSearchSettings.provider,
          webSearchApiKey: webSearchSettings.provider === 'auto'
            ? undefined
            : webSearchSettings.apiKeys[webSearchSettings.provider],
          webSearchApiKeys: webSearchSettings.apiKeys,
          webSearchProviderOrder: webSearchSettings.providerOrder,
        }
      }
    }
  }

  return undefined
}

export async function getEditorAISettings(): Promise<AiConfig | undefined> {
  return await getAISettings('editorModel') || await getAISettings('primaryModel')
}

export function getChatTokenLimitParams(
  config?: Pick<AiConfig, 'maxTokens' | 'tokenLimitParam'>
): { max_completion_tokens?: number; max_tokens?: number } {
  if (!config?.maxTokens || config.maxTokens < 1) return {}

  return config.tokenLimitParam === 'max_tokens'
    ? { max_tokens: config.maxTokens }
    : { max_completion_tokens: config.maxTokens }
}

/**
 * AI
 */
export async function validateAIService(baseURL: string | undefined): Promise<string | null> {
  if (!baseURL) {
    toast({
      title: 'AI error',
      description: 'Set the AI endpoint first',
      variant: 'destructive',
    })
    return null
  }
  return baseURL
}

/**
 * URL base64 
 */
export async function convertImageToBase64(imageUrl: string): Promise<string | null> {
  try {
    // base64 ，
    if (imageUrl.startsWith('data:image')) {
      return imageUrl
    }

    // convertFileSrc URL
    let filePath = imageUrl

    try {
      const url = new URL(imageUrl)
      filePath = decodeURIComponent(url.pathname)
      if (platform() === 'windows' && filePath.startsWith('/')) {
        filePath = filePath.substring(1)
      }
    } catch {
      filePath = imageUrl
    }

    //
    const fileData = await readFile(filePath)

    // base64
    const base64 = btoa(
      new Uint8Array(fileData).reduce((data, byte) => data + String.fromCharCode(byte), '')
    )

    // MIME
    let mimeType = 'image/png'
    if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) {
      mimeType = 'image/jpeg'
    } else if (filePath.toLowerCase().endsWith('.gif')) {
      mimeType = 'image/gif'
    } else if (filePath.toLowerCase().endsWith('.webp')) {
      mimeType = 'image/webp'
    }

    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.error('Failed to convert image to base64:', error)
    return null
  }
}

/**
 * AI
 */
export function handleAIError(error: any, showToast = true): string | null {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error'
  // ，
  if (error.message === 'Request was aborted.') {
    // ，
    return null
  }
  
  if (showToast) {
    toast({
      description: errorMessage || 'AI error',
      variant: 'destructive',
    })
  }
  
  return `Request failed: ${errorMessage}`
}

/**
 * AI
 * @param text （ baseMessages，）
 * @param baseMessages （），，
 */
export async function prepareMessages(
  text: string,
  baseMessages?: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    conversationId?: number
    workspaceId?: string
    useMemory?: boolean
  }
): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  geminiText?: string
}> {
  // Prompt
  let promptContent = await getPromptContent()

  const currentChatState = (await import('@/stores/chat')).default.getState()
  const shouldUseMemory = options?.useMemory
    ?? !currentChatState.isTemporaryConversation

  if (shouldUseMemory) {
    try {
      const { memoryContextService } = await import('@/lib/context/loader')
      //
      let queryText = text || ''
      if (baseMessages && baseMessages.length > 0) {
        const lastUserMessage = [...baseMessages].reverse().find(message => message.role === 'user')
        if (lastUserMessage) {
          queryText = typeof lastUserMessage.content === 'string'
            ? lastUserMessage.content
            : queryText
        }
      }

      if (queryText) {
        const memoryContext = await memoryContextService.getMemoryContext({
          query: queryText,
          conversationId: options?.conversationId
            ?? currentChatState.currentConversationId
            ?? undefined,
          workspaceId: options?.workspaceId,
        })
        const memoryPrompt = memoryContextService.formatMemoryContext(memoryContext)
        if (memoryPrompt) {
          promptContent += '\n\n' + memoryPrompt
        }
      }
    } catch (error) {
      console.error('Failed to load memory context:', error)
    }
  }

  // ，
  if (baseMessages && baseMessages.length > 0) {
    // system
    const hasSystemMessage = baseMessages.some(msg => msg.role === 'system')

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // system prompt system
    if (promptContent && !hasSystemMessage) {
      messages.push({
        role: 'system',
        content: promptContent
      })
    }

    //
    messages.push(...baseMessages)

    // （）
    if (promptContent && hasSystemMessage) {
      // system ，
      const firstSystemIndex = messages.findIndex(msg => msg.role === 'system')
      if (firstSystemIndex !== -1) {
        const existingContent = typeof messages[firstSystemIndex].content === 'string'
          ? messages[firstSystemIndex].content
          : ''
        messages[firstSystemIndex] = {
          role: 'system',
          content: existingContent + '\n\n' + promptContent
        }
      }
    }

    return { messages, geminiText: undefined }
  }

  // （，）
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let geminiText: string | undefined

  if (promptContent) {
    messages.push({
      role: 'system',
      content: promptContent
    })
  }

  messages.push({
    role: 'user',
    content: text
  })

  return { messages, geminiText }
}

/**
 * OpenAI，AI
 */
export async function createOpenAIClient(AiConfig?: AiConfig): Promise<OpenAICompatibleClient> {
  const store = await Store.load('store.json')

  if (AiConfig) {
    return createTauriOpenAIClient(AiConfig)
  }

  const baseURL = await store.get<string>('baseURL')
  const apiKey = await store.get<string>('apiKey')

  return createTauriOpenAIClient({
    key: 'runtime',
    title: 'Runtime',
    baseURL,
    apiKey,
  })
}

function getAIRequestErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function isUnsupportedToolChoiceError(error: unknown): boolean {
  const message = getAIRequestErrorMessage(error)
  return /tool[_\s-]?choice/i.test(message)
    && /不支持|不存在|not\s+support|unsupported|unknown\s+(?:parameter|field)|invalid\s+(?:parameter|field)|does\s+not\s+exist\s+in\s+tools|not\s+found\s+in\s+tools|not\s+available/i.test(message)
}

function omitToolChoice(
  params: OpenAI.Chat.ChatCompletionCreateParamsStreaming
): OpenAI.Chat.ChatCompletionCreateParamsStreaming {
  const fallbackParams = { ...params }
  delete fallbackParams.tool_choice
  return fallbackParams
}

/**
 * OpenAI tools， tool_choice。
 * ， tool_choice 。
 */
export async function createChatCompletionStreamWithToolChoiceFallback(
  client: OpenAICompatibleClient,
  params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  options?: { signal?: AbortSignal }
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const fallbackParams = omitToolChoice(params)
  let initialStream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

  try {
    initialStream = await client.chat.completions.create(params, options)
  } catch (error) {
    if (params.tool_choice === undefined || !isUnsupportedToolChoiceError(error)) {
      throw error
    }
    return client.chat.completions.create(fallbackParams, options)
  }

  return (async function* () {
    let receivedChunk = false

    try {
      for await (const chunk of initialStream) {
        receivedChunk = true
        yield chunk
      }
    } catch (error) {
      if (receivedChunk || params.tool_choice === undefined || !isUnsupportedToolChoiceError(error)) {
        throw error
      }

      const fallbackStream = await client.chat.completions.create(fallbackParams, options)
      for await (const chunk of fallbackStream) {
        yield chunk
      }
    }
  })()
}

function supportsEnableThinkingSwitch(aiConfig?: AiConfig): boolean {
  const model = aiConfig?.model?.toLowerCase() || ''
  const baseURL = aiConfig?.baseURL?.toLowerCase() || ''

  if (!model) {
    return false
  }

  if (model.includes('qwen3') || model.includes('qwq')) {
    return true
  }

  const isQwenProvider =
    baseURL.includes('dashscope') ||
    baseURL.includes('aliyuncs') ||
    baseURL.includes('siliconflow') ||
    baseURL.includes('notegen')

  return isQwenProvider && model.includes('qwen')
}

export function withFastAiRequestOptions<const T extends OpenAI.Chat.ChatCompletionCreateParams>(
  params: T,
  aiConfig?: AiConfig
): T {
  const hasTaskTokenLimit = params.max_completion_tokens != null || params.max_tokens != null
  const tokenLimitParams = hasTaskTokenLimit ? {} : getChatTokenLimitParams(aiConfig)

  return {
    ...tokenLimitParams,
    ...params,
    ...(supportsEnableThinkingSwitch(aiConfig) ? { enable_thinking: false } : {}),
  } as T
}

export function withEditorFastAiRequestOptions<const T extends OpenAI.Chat.ChatCompletionCreateParams>(
  params: T,
  aiConfig?: AiConfig
): T {
  return withFastAiRequestOptions(params, aiConfig)
}
