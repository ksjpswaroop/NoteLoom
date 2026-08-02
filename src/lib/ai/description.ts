import OpenAI from 'openai';
import { getAISettings, prepareMessages, createOpenAIClient, handleAIError, withEditorFastAiRequestOptions } from './utils';

/**
 * 
 * @param text 
 * @returns 
 */
export async function fetchAiDesc(text: string) {
  try {
    // AI
    const aiConfig = await getAISettings('markDescModel')
    
    const descContent = `Based on the screenshot content: ${text}, return a description. Keep it under 50 characters and avoid special characters.`
    
    //
    const { messages } = await prepareMessages(descContent)
    
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create(withEditorFastAiRequestOptions({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
      max_tokens: 80,
    }, aiConfig))
    
    return completion.choices[0].message.content || ''
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}

/**
 * 
 * @param base64 base64
 * @returns 
 */
export async function analyzeImagesWithVlm(
  base64Images: string[],
  prompt = 'Based on the screenshot content, return a description.',
  maxTokens = 120,
  signal?: AbortSignal
) {
  const aiConfig = await getAISettings('imageMethodModel')
  if (!aiConfig?.model) {
    throw new Error('VISION_MODEL_NOT_CONFIGURED')
  }

  // prepareMessages
  const { messages: preparedMessages } = await prepareMessages(prompt)

  const openai = await createOpenAIClient(aiConfig)

  // （）
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (let i = 0; i < preparedMessages.length; i++) {
    const msg = preparedMessages[i]

    if (i === preparedMessages.length - 1 && msg.role === 'user') {
      // ：（ + ）
      const textContent = typeof msg.content === 'string' ? msg.content : prompt
      messages.push({
        role: 'user',
        content: [
          ...base64Images.map((base64) => (
            {
              type: 'image_url',
              image_url: {
                url: base64
              }
            }
          ) as const),
          {
            type: 'text',
            text: textContent
          }
        ]
      })
    } else {
      // ：
      messages.push(msg)
    }
  }

  const completion = await openai.chat.completions.create(withEditorFastAiRequestOptions({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
      max_tokens: maxTokens,
    }, aiConfig), { signal })

  return completion.choices[0].message.content || ''
}

export async function fetchAiDescByImage(
  base64: string,
  prompt = 'Based on the screenshot content, return a description.',
  maxTokens = 120,
  signal?: AbortSignal
) {
  try {
    return await analyzeImagesWithVlm([base64], prompt, maxTokens, signal)
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}
