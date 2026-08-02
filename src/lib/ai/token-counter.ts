import type { Chat } from '@/db/chats'

/**
 * Token （）
 * ： 1.5 /token， 4 /token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * Chat token 
 */
export function estimateChatTokens(chats: Chat[]): number {
  return chats.reduce((sum, chat) => {
    return sum + estimateTokens(chat.content || '')
  }, 0)
}

/**
 * token 
 */
export function estimateUserTokens(chats: Chat[]): number {
  return chats
    .filter(c => c.role === 'user')
    .reduce((sum, chat) => sum + estimateTokens(chat.content || ''), 0)
}
