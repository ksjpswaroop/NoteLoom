import OpenAI from 'openai';
import { getAISettings, validateAIService, prepareMessages, createOpenAIClient, createChatCompletionStreamWithToolChoiceFallback, getChatTokenLimitParams, handleAIError, convertImageToBase64 } from './utils';

/**
 * AI
 * @param text 
 * @param modelType （）
 * @param messages （， text ）
 */
export async function fetchAi(
  text: string,
  modelType?: string,
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  try {
    // AI
    const aiConfig = await getAISettings(modelType)

    // AI
    if (await validateAIService(aiConfig?.baseURL) === null) return ''

    //
    const prepared = await prepareMessages(text, messages)
    const finalMessages = prepared.messages

    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: finalMessages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
      ...getChatTokenLimitParams(aiConfig),
    })

    return completion.choices[0].message.content || ''
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * AI
 * @param text 
 * @param onUpdate 
 * @param abortSignal 
 * @param mcpTools MCP （）
 * @param t （）
 * @param chatId chat ID，MCP（）
 * @param imageUrls URL（）
 * @param onThinkingUpdate （）
 * @param messages （， text ）
 */
export async function fetchAiStream(
  text: string,
  onUpdate: (content: string) => void,
  abortSignal?: AbortSignal,
  mcpTools?: any[],
  t?: (key: string, params?: Record<string, any>) => string,
  chatId?: number,
  imageUrls?: string[],
  onThinkingUpdate?: (thinking: string) => void,
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
): Promise<string> {
  try {


    // AI
    const aiConfig = await getAISettings()

    // AI
    const validatedBaseURL = await validateAIService(aiConfig?.baseURL)
    if (validatedBaseURL === null) {
      return ''
    }

    // - messages ，； prepareMessages
    let preparedMessages: OpenAI.Chat.ChatCompletionMessageParam[]
    if (messages && messages.length > 0) {
      //
      const prepared = await prepareMessages('', messages)
      preparedMessages = prepared.messages
    } else {
      const prepared = await prepareMessages(text)
      preparedMessages = prepared.messages
    }

    // ，
    if (imageUrls && imageUrls.length > 0) {
      const lastMessage = preparedMessages[preparedMessages.length - 1]
      if (lastMessage && lastMessage.role === 'user') {
        const content: any[] = []

        // （ base64）
        for (const imageUrl of imageUrls) {
          try {
            // Tauri URL base64
            const base64Image = await convertImageToBase64(imageUrl)
            if (base64Image) {
              content.push({
                type: 'image_url',
                image_url: {
                  url: base64Image
                }
              })
            }
          } catch (error) {
            console.error('Failed to convert image to base64:', error)
          }
        }

        //
        content.push({
          type: 'text',
          text: typeof lastMessage.content === 'string' ? lastMessage.content : ''
        })

        //
        preparedMessages[preparedMessages.length - 1] = {
          role: 'user',
          content: content
        }
      }
    }

    const openai = await createOpenAIClient(aiConfig)

    //
    const requestParams: any = {
      model: aiConfig?.model || '',
      messages: preparedMessages,
      temperature: aiConfig?.temperature,
      top_p: aiConfig?.topP,
      stream: true,
      ...getChatTokenLimitParams(aiConfig),
    }

    // MCP ，
    if (mcpTools && mcpTools.length > 0) {
      requestParams.tools = mcpTools
      requestParams.tool_choice = 'auto'
    }

    const stream = await createChatCompletionStreamWithToolChoiceFallback(openai, requestParams, {
      signal: abortSignal
    })

    let thinking = ''
    let fullContent = ''
    const toolCalls: any[] = []
    let hasToolCalls = false
    
    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      
      const delta = chunk.choices[0]?.delta
      const thinkingContent = (delta as any)?.reasoning_content || ''
      const content = delta?.content || ''
      
      if (thinkingContent) {
        //
      }
      
      //
      if (delta?.tool_calls) {
        hasToolCalls = true
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index || 0
          
          //
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCall.id || '',
              type: 'function',
              function: {
                name: toolCall.function?.name || '',
                arguments: ''
              }
            }
          }
          
          //
          if (toolCall.function?.arguments) {
            toolCalls[index].function.arguments += toolCall.function.arguments
          }
          
          //
          if (toolCall.id) {
            toolCalls[index].id = toolCall.id
          }
          if (toolCall.function?.name) {
            toolCalls[index].function.name = toolCall.function.name
          }
        }
      }
      
      // ，，
      if (hasToolCalls) {
        continue
      }
      
      // （）
      if (thinkingContent) {
        thinking += thinkingContent
        if (onThinkingUpdate) {
          onThinkingUpdate(thinking)
        }
      }
      
      //
      if (content) {
        fullContent += content
      }

      onUpdate(fullContent)
    }

    // ，（）
    if (toolCalls.length > 0) {
      // callTool （）
      const { callTool } = await import('../mcp/tools')

      //
      let conversationMessages = [...preparedMessages]
      let currentToolCalls = toolCalls
      const maxIterations = 10 //
      let iteration = 0
      
      // ， AI
      while (currentToolCalls.length > 0 && iteration < maxIterations) {
        iteration++

        onUpdate('')
        
        //
        const toolResults = []
        for (const toolCall of currentToolCalls) {
          let mcpToolCallId: string | undefined
          try {
            // （：serverId__toolName）
            const fullName = toolCall.function.name
            const [serverId, ...toolNameParts] = fullName.split('__')
            const toolName = toolNameParts.join('__')
            
            //
            let args = {}
            try {
              args = JSON.parse(toolCall.function.arguments)
            } catch (parseError) {
              const errorMsg = parseError instanceof Error ? parseError.message : 'Invalid JSON'
              throw new Error(`Invalid JSON in tool arguments: ${errorMsg}. Raw arguments: ${toolCall.function.arguments.slice(0, 200)}`)
            }
            
            // MCP （ chatId）
            if (chatId) {
              const { useMcpStore } = await import('@/stores/mcp')
              const { default: useChatStore } = await import('@/stores/chat')
              const mcpStore = useMcpStore.getState()
              const chatStore = useChatStore.getState()
              const server = mcpStore.servers.find(s => s.id === serverId)
              
              mcpToolCallId = `${toolCall.id}-${Date.now()}`
              chatStore.addMcpToolCall({
                id: mcpToolCallId,
                chatId,
                toolName,
                serverId,
                serverName: server?.name || serverId,
                params: args,
                result: '',
                status: 'calling',
                timestamp: Date.now()
              })
            }
            
            // MCP
            const result = await callTool(serverId, toolName, args)
            
            //
            const resultText = result.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('\n')
            
            // MCP
            if (chatId && mcpToolCallId) {
              const { default: useChatStore } = await import('@/stores/chat')
              const chatStore = useChatStore.getState()
              chatStore.updateMcpToolCall(mcpToolCallId, {
                result: resultText || 'Tool executed successfully',
                status: 'success'
              })
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: resultText || 'Tool executed successfully'
            })
            
          } catch (error) {
            console.error('Tool callsFailed:', error)
            
            // MCP
            if (chatId && mcpToolCallId) {
              const { default: useChatStore } = await import('@/stores/chat')
              const chatStore = useChatStore.getState()
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              chatStore.updateMcpToolCall(mcpToolCallId, {
                result: `Error: ${errorMsg}`,
                status: 'error'
              })
            }
            
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool' as const,
              content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            })
          }
        }
        
        //
        conversationMessages = [
          ...conversationMessages,
          {
            role: 'assistant' as const,
            content: null,
            tool_calls: currentToolCalls
          },
          ...toolResults
        ]
        
        const nextStream = await createChatCompletionStreamWithToolChoiceFallback(openai, {
          model: aiConfig?.model || '',
          messages: conversationMessages,
          temperature: aiConfig?.temperature,
          top_p: aiConfig?.topP,
          stream: true,
          tools: mcpTools,
          tool_choice: 'auto',
          ...getChatTokenLimitParams(aiConfig),
        }, {
          signal: abortSignal
        })
        
        //
        currentToolCalls = []
        thinking = ''
        fullContent = ''
        
        //
        for await (const chunk of nextStream) {
          if (abortSignal?.aborted) {
            break;
          }
          
          const delta = chunk.choices[0]?.delta
          const thinkingContent = (delta as any)?.reasoning_content || ''
          const content = delta?.content || ''
          
          //
          if (delta?.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index || 0
              
              if (!currentToolCalls[index]) {
                currentToolCalls[index] = {
                  id: toolCall.id || '',
                  type: 'function',
                  function: {
                    name: toolCall.function?.name || '',
                    arguments: ''
                  }
                }
              }
              
              if (toolCall.function?.arguments) {
                currentToolCalls[index].function.arguments += toolCall.function.arguments
              }
              
              if (toolCall.id) {
                currentToolCalls[index].id = toolCall.id
              }
              if (toolCall.function?.name) {
                currentToolCalls[index].function.name = toolCall.function.name
              }
            }
          }
          
          // ，
          if (currentToolCalls.length > 0) {
            continue
          }
          
          // （）
          if (thinkingContent) {
            thinking += thinkingContent
            if (onThinkingUpdate) {
              onThinkingUpdate(thinking)
            }
          }
          if (content) {
            fullContent += content
          }
          onUpdate(fullContent)
        }
        
        // ，
        if (currentToolCalls.length === 0) {
          break
        }
      }
      
      if (iteration >= maxIterations) {
        console.warn('Tool calls')
        const maxIterationsText = t ? t('record.mark.mark.chat.mcp.maxIterationsReached') : '⚠️ Tool calls'
        onUpdate(fullContent + '\n\n' + maxIterationsText)
      }
    }
    
    return fullContent
  } catch (error) {
    console.error('[fetchAiStream] Error:', error)
    return handleAIError(error) || ''
  }
}

/**
 * AI， token
 * @param text 
 * @param onUpdate 
 * @param abortSignal 
 */
export async function fetchAiStreamToken(text: string, onUpdate: (content: string) => void, abortSignal?: AbortSignal): Promise<string> {
  try {
    // AI
    const aiConfig = await getAISettings()
    
    // AI
    if (await validateAIService(aiConfig?.baseURL) === null) return ''
    
    //
    const { messages } = await prepareMessages(text)
  
    const openai = await createOpenAIClient(aiConfig)

    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature,
      top_p: aiConfig?.topP,
      stream: true,
      ...getChatTokenLimitParams(aiConfig),
    }, {
      signal: abortSignal
    })
    
    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break;
      }
      
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        onUpdate(content)
      }
    }
    
    return ''
  } catch (error) {
    return handleAIError(error) || ''
  }
}
