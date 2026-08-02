import { Tool, ToolResult } from '../types'
import { getChats, insertChat, updateChat, deleteChat, clearChatsByTagId, Chat, insertChats, updateChats, deleteChats } from '@/db/chats'

export const readChatsTool: Tool = {
  name: 'read_chats',
  description: 'Read all chat records under the specified tag',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId)
      return {
        success: true,
        data: chats,
        message: `Found ${chats.length} chat records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to read chat records: ${error}`,
      }
    }
  },
}

export const createChatTool: Tool = {
  name: 'create_chat',
  description: 'Create a new chat record',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Chat content',
      required: true,
    },
    {
      name: 'role',
      type: 'string',
      description: 'Role: system or user',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Type: chat, note, clipboard, clear',
      required: false,
      default: 'chat',
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chat: Omit<Chat, 'id' | 'createdAt'> = {
        tagId: params.tagId,
        content: params.content,
        role: params.role as 'system' | 'user',
        type: (params.type || 'chat') as 'chat' | 'note' | 'clipboard' | 'clear',
        inserted: false,
      }
      const result = await insertChat(chat)
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `Successfully created chat record, ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create chat record: ${error}`,
      }
    }
  },
}

export const updateChatTool: Tool = {
  name: 'update_chat',
  description: 'Update the specified chat record',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Chat record ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New chat content',
      required: false,
    },
    {
      name: 'inserted',
      type: 'boolean',
      description: 'Whether inserted into notes',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId || 1)
      const chat = chats.find(c => c.id === params.id)
      
      if (!chat) {
        return {
          success: false,
          error: `Chat record with ID ${params.id} not found`,
        }
      }
      
      const updatedChat: Chat = {
        ...chat,
        content: params.content !== undefined ? params.content : chat.content,
        inserted: params.inserted !== undefined ? params.inserted : chat.inserted,
      }
      
      await updateChat(updatedChat)
      return {
        success: true,
        message: `Successfully updated chat record ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to update chat record: ${error}`,
      }
    }
  },
}

export const deleteChatTool: Tool = {
  name: 'delete_chat',
  description: 'Delete the specified chat record',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'ID of the chat record to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await deleteChat(params.id)
      return {
        success: true,
        message: `Successfully deleted chat record ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete chat record: ${error}`,
      }
    }
  },
}

export const clearChatsTool: Tool = {
  name: 'clear_chats',
  description: 'Clear all chat records under the specified tag',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await clearChatsByTagId(params.tagId)
      return {
        success: true,
        message: `Successfully cleared all chat records under tag ${params.tagId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to clear chat records: ${error}`,
      }
    }
  },
}

export const searchChatsTool: Tool = {
  name: 'search_chats',
  description: 'Search chat records for content containing keywords',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword',
      required: true,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Optional: limit search to specified tag',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId || 1)
      const results = chats.filter(chat => 
        chat.content?.toLowerCase().includes(params.query.toLowerCase())
      )
      
      return {
        success: true,
        data: results,
        message: `Found ${results.length} matching chat records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to search chat records: ${error}`,
      }
    }
  },
}

export const createChatsBatchTool: Tool = {
  name: 'create_chats_batch',
  description: 'Batch create multiple chat records to avoid loop calls. Use for scenarios requiring multiple chat records to be created at once.',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'chats',
      type: 'array',
      description: 'Array of chat records to create, each record contains tagId, content, role, type and other fields',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.chats) || params.chats.length === 0) {
        return {
          success: false,
          error: 'Parameter chats must be a non-empty array',
        }
      }

      const chatsToInsert: Chat[] = params.chats.map((chat: any) => ({
        id: 0,
        tagId: chat.tagId,
        content: chat.content,
        role: chat.role as 'system' | 'user',
        type: (chat.type || 'chat') as 'chat' | 'note' | 'clipboard' | 'clear',
        inserted: false,
        createdAt: Date.now(),
      }))

      await insertChats(chatsToInsert)
      
      return {
        success: true,
        data: { count: chatsToInsert.length },
        message: `Successfully batch-created ${chatsToInsert.length} chat records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-create chat records: ${error}`,
      }
    }
  },
}

export const updateChatsBatchTool: Tool = {
  name: 'update_chats_batch',
  description: 'Batch update multiple chat records to avoid loop calls. Each record must include the id field.',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'chats',
      type: 'array',
      description: 'Array of chat records to update, each record must include id and fields to update',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.chats) || params.chats.length === 0) {
        return {
          success: false,
          error: 'Parameter chats must be a non-empty array',
        }
      }

      const chatsToUpdate: Chat[] = params.chats.map((chat: any) => ({
        id: chat.id,
        tagId: chat.tagId,
        content: chat.content,
        role: chat.role,
        type: chat.type,
        inserted: chat.inserted ?? false,
        createdAt: chat.createdAt || Date.now(),
        image: chat.image,
        images: chat.images,
        ragSources: chat.ragSources,
        agentHistory: chat.agentHistory,
        thinking: chat.thinking,
        quoteData: chat.quoteData,
      }))

      await updateChats(chatsToUpdate)
      
      return {
        success: true,
        data: { count: chatsToUpdate.length },
        message: `Successfully batch-updated ${chatsToUpdate.length} chat records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-update chat records: ${error}`,
      }
    }
  },
}

export const deleteChatsBatchTool: Tool = {
  name: 'delete_chats_batch',
  description: 'Batch delete multiple chat records to avoid loop calls.',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of chat record IDs to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.ids) || params.ids.length === 0) {
        return {
          success: false,
          error: 'Parameter ids must be a non-empty array',
        }
      }

      await deleteChats(params.ids)
      
      return {
        success: true,
        data: { count: params.ids.length },
        message: `Successfully batch-deleted ${params.ids.length} chat records`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-delete chat records: ${error}`,
      }
    }
  },
}

export const chatTools: Tool[] = [
  readChatsTool,
  createChatTool,
  updateChatTool,
  deleteChatTool,
  clearChatsTool,
  searchChatsTool,
  createChatsBatchTool,
  updateChatsBatchTool,
  deleteChatsBatchTool,
]
