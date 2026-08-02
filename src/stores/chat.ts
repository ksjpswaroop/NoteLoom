import { create } from 'zustand'
import { Chat, clearChatsByTagId, deleteChat, initChatsDb, insertChat, updateChat, updateChatsInsertedById, getAllChats, deleteAllChats, insertChats, getChatsByConversation } from '@/db/chats'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { s3Upload, s3Delete, s3HeadObject, s3Download } from '@/lib/sync/s3'
import { webdavUpload, webdavDelete, webdavHeadObject, webdavDownload } from '@/lib/sync/webdav'
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { getRemoteFileContent } from '@/lib/sync/remote-file';
import { Store } from '@tauri-apps/plugin-store';
import { locales } from '@/lib/locales';
import { AgentState, ToolCall } from '@/lib/agent/types'
import { LinkedResource } from '@/lib/files'
import type { Conversation } from '@/db/conversations'
import { S3Config, WebDAVConfig } from '@/types/sync'

export interface PendingQuote {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

function getPendingQuoteIdentity(quote: PendingQuote | null) {
  if (!quote) {
    return ''
  }

  return [
    quote.articlePath,
    quote.from,
    quote.to,
    quote.startLine,
    quote.endLine,
    quote.fullContent,
  ].join('|')
}

// MCP （，）
export interface McpToolCall {
  id: string
  chatId: number // Related chat ID
  toolName: string
  serverId: string
  serverName: string
  params: Record<string, any>
  result: string
  status: 'calling' | 'success' | 'error'
  timestamp: number
}

interface ChatState {
  loading: boolean
  setLoading: (loading: boolean) => void

  // ：（）
  chats: Chat[]
  init: (tagId: number) => Promise<void> // Initialize chats
  insert: (chat: Omit<Chat, 'id' | 'createdAt'>) => Promise<Chat | null> // Insert a chat
  updateChat: (chat: Chat) => void // Update a chat
  saveChat: (chat: Chat, isSave?: boolean) => Promise<void> // Save a chat after streaming AI reply finishes
  deleteChat: (id: number) => Promise<void> // Delete a chat

  locale: string
  getLocale: () => Promise<void>
  setLocale: (locale: string) => void

  clearChats: (tagId: number) => Promise<void> // Clear chats (legacy)
  updateInsert: (id: number) => Promise<void> // Update inserted

  //
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadChats: () => Promise<boolean>
  downloadChats: () => Promise<Chat[]>

  // MCP （）
  mcpToolCalls: McpToolCall[]
  addMcpToolCall: (toolCall: McpToolCall) => void
  updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => void
  getMcpToolCallsByChatId: (chatId: number) => McpToolCall[]
  clearMcpToolCalls: () => void

  // Agent
  agentState: AgentState
  setAgentState: (state: Partial<AgentState>) => void
  resetAgentState: () => void
  addAgentToolCall: (toolCall: ToolCall) => void
  updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => void
  agentAutoApproveConversationId: number | null
  setAgentAutoApproveConversationId: (conversationId: number | null) => void
  agentAutoApproveRuntimeScriptKey: string | null
  setAgentAutoApproveRuntimeScriptKey: (permissionKey: string | null) => void

  // Placeholder
  isPlaceholderEnabled: boolean
  setPlaceholderEnabled: (enabled: boolean) => void

  // （ Agent ）
  linkedResource: LinkedResource | null
  setLinkedResource: (resource: LinkedResource | null) => void

  // （ AI ）
  linkedResourcePreview: string | null
  setLinkedResourcePreview: (preview: string | null) => void

  pendingQuote: PendingQuote | null
  setPendingQuote: (quote: PendingQuote | null) => void
  clearPendingQuote: () => void

  editorSelectionQuote: PendingQuote | null
  setEditorSelectionQuote: (quote: PendingQuote | null) => void
  clearEditorSelectionQuote: () => void

  onboardingPromptDraft: string | null
  setOnboardingPromptDraft: (prompt: string | null) => void

  // === ： ===
  //
  currentConversationId: number | null
  conversations: Conversation[]
  isTemporaryConversation: boolean //

  //
  initConversations: () => Promise<void> //
  createConversation: (title?: string) => Promise<number> //
  switchConversation: (id: number) => Promise<void> //
  updateConversationTitle: (id: number, title: string) => Promise<void> // Update conversation title
  deleteConversation: (id: number) => Promise<void> //
  toggleConversationPin: (id: number) => Promise<boolean> //
  startNewConversation: () => Promise<void> // Start a new conversation after saving the current one
  startTemporaryConversation: () => void //
}

let nextTemporaryChatId = -1

const useChatStore = create<ChatState>((set, get) => ({
  loading: false,

  setLoading: (loading: boolean) => {
    set({ loading })
  },

  agentState: {
    activeChatId: undefined,
    runId: undefined,
    status: 'idle',
    isRunning: false,
    isThinking: false,
    currentThought: '',
    thoughtHistory: [],
    completedSteps: [],
    currentAction: undefined,
    currentObservation: undefined,
    toolCalls: [],
    traceEvents: [],
    changes: [],
    maxIterations: 15,
    currentIteration: 0,
    pendingConfirmation: undefined,
    confirmationHistory: [],
    loadedSkills: undefined,
    selectedSkills: undefined,
    currentStepStartTime: undefined,
    ragSources: undefined,
    ragSourceDetails: undefined,
  },

  setAgentState: (state: Partial<AgentState>) => {
    set({ agentState: { ...get().agentState, ...state } })
  },

  resetAgentState: () => {
    set({
      agentState: {
        activeChatId: undefined,
        runId: undefined,
        status: 'idle',
        isRunning: false,
        isThinking: false,
        currentThought: '',
        thoughtHistory: [],
        completedSteps: [],
        currentAction: '',
        currentObservation: '',
        toolCalls: [],
        traceEvents: [],
        changes: [],
        maxIterations: 15,
        currentIteration: 0,
        pendingConfirmation: undefined,
        confirmationHistory: [],
        loadedSkills: undefined,
        selectedSkills: undefined,
        currentStepStartTime: undefined,
        // Agent ，。
        ragSources: undefined,
        ragSourceDetails: undefined,
        // Final Answer
        isFinalAnswerMode: false,
        finalAnswerContent: undefined,
      }
    })
  },

  addAgentToolCall: (toolCall: ToolCall) => {
    const agentState = get().agentState
    set({
      agentState: {
        ...agentState,
        toolCalls: [...agentState.toolCalls, toolCall]
      }
    })
  },

  updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => {
    const agentState = get().agentState
    set({
      agentState: {
        ...agentState,
        toolCalls: agentState.toolCalls.map(call =>
          call.id === id ? { ...call, ...updates } : call
        )
      }
    })
  },

  agentAutoApproveConversationId: null,
  setAgentAutoApproveConversationId: (conversationId: number | null) => {
    set({ agentAutoApproveConversationId: conversationId })
  },
  agentAutoApproveRuntimeScriptKey: null,
  setAgentAutoApproveRuntimeScriptKey: (permissionKey: string | null) => {
    set({ agentAutoApproveRuntimeScriptKey: permissionKey })
  },

  isPlaceholderEnabled: true,
  setPlaceholderEnabled: (enabled: boolean) => {
    set({ isPlaceholderEnabled: enabled })
  },

  linkedResource: null,
  setLinkedResource: (resource: LinkedResource | null) => {
    set({ linkedResource: resource })
  },

  linkedResourcePreview: null,
  setLinkedResourcePreview: (preview: string | null) => {
    set({ linkedResourcePreview: preview })
  },

  pendingQuote: null,
  setPendingQuote: (pendingQuote: PendingQuote | null) => {
    set({ pendingQuote })
  },
  clearPendingQuote: () => {
    set({ pendingQuote: null })
  },

  editorSelectionQuote: null,
  setEditorSelectionQuote: (editorSelectionQuote: PendingQuote | null) => {
    set((state) => {
      if (getPendingQuoteIdentity(state.editorSelectionQuote) === getPendingQuoteIdentity(editorSelectionQuote)) {
        return state
      }

      return { editorSelectionQuote }
    })
  },
  clearEditorSelectionQuote: () => {
    set({ editorSelectionQuote: null })
  },

  onboardingPromptDraft: null,
  setOnboardingPromptDraft: (prompt: string | null) => {
    set({ onboardingPromptDraft: prompt })
  },

  chats: [],
  // ：init
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  init: async (_tagId: number) => {
    set({ isTemporaryConversation: false })
    await initChatsDb()
    //
    await get().initConversations()

    const { currentConversationId, conversations } = get()

    //
    if (!currentConversationId) {
      if (conversations.length > 0) {
        // ，
        await get().switchConversation(conversations[0].id)
      }
      // ，，
    } else {
      //
      const data = await getChatsByConversation(currentConversationId)
      set({ chats: data })
    }
  },
  insert: async (chat) => {
    const { currentConversationId, isTemporaryConversation } = get()

    if (isTemporaryConversation) {
      const data: Chat = {
        ...chat,
        id: nextTemporaryChatId--,
        conversationId: undefined,
        createdAt: Date.now(),
      }
      set({ chats: [...get().chats, data] })
      return data
    }

    // conversationId，
    let conversationId = chat.conversationId || currentConversationId
    if (!conversationId) {
      // ，
      const { createConversation } = await import('@/db/conversations')
      conversationId = await createConversation('New chat')
      //
      set({ currentConversationId: conversationId })
      await get().initConversations()
    }

    const res = await insertChat({ ...chat, conversationId })
    let data: Chat
    if (res.lastInsertId) {
      data =  {
        id: res.lastInsertId,
        createdAt: Date.now(),
        ...chat,
        conversationId
      }
      const chats = get().chats
      const newChats = [...chats, data]
      set({ chats: newChats })

      //
      if (conversationId) {
        const { updateConversationMessageCount, updateConversationTime, updateConversationTitle, getConversation } = await import('@/db/conversations')
        await updateConversationMessageCount(conversationId, 1)
        await updateConversationTime(conversationId)

        // ，
        // ，
        const currentConv = await getConversation(conversationId)
        if (currentConv && currentConv.messageCount === 1 && chat.role === 'user' && chat.content) {
          // 30
          const title = chat.content
            .replace(/\n/g, ' ')  //
            .trim()
            .slice(0, 30)

          if (title && title !== currentConv.title) {
            await updateConversationTitle(conversationId, title)
          }
        }

        //
        await get().initConversations()
      }

      return data
    }
    return null
  },
  updateChat: (chat) => {
    const chats = get().chats
    const newChats = chats.map(item => {
      if (item.id === chat.id) {
        // ， undefined ，（ ragSources）
        const result = { ...item }
        for (const key in chat) {
          if ((chat as any)[key] !== undefined) {
            (result as any)[key] = (chat as any)[key]
          }
        }
        return result
      }
      return item
    })
    set({ chats: newChats })
  },
  saveChat: async (chat, isSave = false) => {
    get().updateChat(chat)
    if (isSave && !get().isTemporaryConversation) {
      await updateChat(chat)
    }
  },
  deleteChat: async (id) => {
    const chats = get().chats
    const newChats = chats.filter(item => item.id !== id)
    set({ chats: newChats })

    if (get().isTemporaryConversation) {
      return
    }

    await deleteChat(id)

    //
    const { currentConversationId } = get()
    if (currentConversationId) {
      const { deleteConversationCompactions } = await import('@/db/conversation-compactions')
      await deleteConversationCompactions(currentConversationId)
      const { updateConversationMessageCount } = await import('@/db/conversations')
      await updateConversationMessageCount(currentConversationId, -1)
      await get().initConversations()
    }
  },


  locale: locales[0],
  getLocale: async () => {
    const store = await Store.load('store.json');
    // Force English-only note output language regardless of any legacy store value.
    const res = locales[0]
    set({ locale: res })
    await store.set('note_locale', res)
  },
  setLocale: async (_locale) => {
    void _locale
    const locale = locales[0]
    set({ locale })
    const store = await Store.load('store.json');
    await store.set('note_locale', locale)
  },

  // ：clearChats
  clearChats: async (tagId) => {
    const isTemporaryConversation = get().isTemporaryConversation
    set({ chats: [] })
    // Agent
    get().resetAgentState()
    get().clearMcpToolCalls()
    get().clearPendingQuote()
    get().clearEditorSelectionQuote()

    if (isTemporaryConversation) {
      return
    }

    //
    const { currentConversationId } = get()
    if (currentConversationId) {
      //
      const { chats } = get()
      const count = chats.length

      //
      const db = await import('@/db').then(m => m.getDb())
      await db.execute("delete from chats where conversationId = $1", [currentConversationId])
      const { deleteConversationCompactions } = await import('@/db/conversation-compactions')
      await deleteConversationCompactions(currentConversationId)

      const { updateConversationMessageCount } = await import('@/db/conversations')
      await updateConversationMessageCount(currentConversationId, -count)
      await get().initConversations()
    } else {
      // ： conversationId， tagId
      await clearChatsByTagId(tagId)
    }
  },

  updateInsert: async (id) => {
    if (!get().isTemporaryConversation) {
      await updateChatsInsertedById(id)
    }
    const chats = get().chats
    const newChats = chats.map(item => {
      if (item.id === id) {
        item.inserted = true
      }
      return item
    })
    set({ chats: newChats })
  },

  //
  syncState: false,
  setSyncState: (syncState) => {
    set({ syncState })
  },
  lastSyncTime: '',
  setLastSyncTime: (lastSyncTime) => {
    set({ lastSyncTime })
  },
  uploadChats: async () => {
    set({ syncState: true })
    const path = '.data'
    const filename = 'chats.json'
    const chats = await getAllChats()
    const store = await Store.load('store.json');
    const jsonToBase64 = (data: Chat[]) => {
      return Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    }
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = false
    let files: any;
    let res;
    const fullPath = `${path}/${filename}`;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        files = await githubGetFiles({ path: fullPath, repo: githubRepo })
        res = await uploadGithubFile({
          file: jsonToBase64(chats),
          repo: githubRepo,
          path: fullPath,
          sha: files?.sha,
        })
        break;
      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: fullPath, repo: giteeRepo })
        res = await uploadGiteeFile({
          file: jsonToBase64(chats),
          repo: giteeRepo,
          path: fullPath,
          sha: files?.sha,
        })
        break;
      case 'gitlab':
        const gitlabRepo = await getSyncRepoName('gitlab')
        files = await gitlabGetFiles({ path, repo: gitlabRepo })
        const chatFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGitlabFile({
          file: jsonToBase64(chats),
          repo: gitlabRepo,
          path,
          filename,
          sha: chatFile?.sha || '',
        })
        break;
      case 'gitea':
        const giteaRepo = await getSyncRepoName('gitea')
        files = await giteaGetFiles({ path, repo: giteaRepo })
        const giteaChatFile = Array.isArray(files)
          ? files.find(file => file.name === filename)
          : (files?.name === filename ? files : undefined)
        res = await uploadGiteaFile({
          file: jsonToBase64(chats),
          repo: giteaRepo,
          path,
          filename,
          sha: giteaChatFile?.sha || '',
        })
        break;
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3Key = `${path}/${filename}`
          const existingFile = await s3HeadObject(s3Config, s3Key)
          if (existingFile) {
            await s3Delete(s3Config, s3Key)
          }
          res = await s3Upload(s3Config, s3Key, JSON.stringify(chats, null, 2))
        }
        break;
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavKey = `${path}/${filename}`
          const existingFile = await webdavHeadObject(webdavConfig, webdavKey)
          if (existingFile) {
            await webdavDelete(webdavConfig, webdavKey)
          }
          res = await webdavUpload(webdavConfig, webdavKey, JSON.stringify(chats, null, 2))
        }
        break;
      }
    }
    if (res) {
      result = true
    }
    set({ syncState: false })
    return result
  },
  // MCP
  mcpToolCalls: [],

  addMcpToolCall: (toolCall: McpToolCall) => {
    const mcpToolCalls = get().mcpToolCalls
    set({ mcpToolCalls: [...mcpToolCalls, toolCall] })
  },

  updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => {
    const mcpToolCalls = get().mcpToolCalls.map(call =>
      call.id === id ? { ...call, ...updates } : call
    )
    set({ mcpToolCalls })
  },

  getMcpToolCallsByChatId: (chatId: number) => {
    return get().mcpToolCalls.filter(call => call.chatId === chatId)
  },

  clearMcpToolCalls: () => {
    set({ mcpToolCalls: [] })
  },

  downloadChats: async () => {
    const path = '.data'
    const filename = 'chats.json'
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let result = []
    let files;
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo2 = await getSyncRepoName('github')
        files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo2 })
        break;
      case 'gitee':
        const giteeRepo2 = await getSyncRepoName('gitee')
        files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo2 })
        break;
      case 'gitlab':
        const gitlabRepo2 = await getSyncRepoName('gitlab')
        files = await gitlabGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: gitlabRepo2 })
        break;
      case 'gitea':
        const giteaRepo2 = await getSyncRepoName('gitea')
        files = await giteaGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: giteaRepo2 })
        break;
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3Key = `${path}/${filename}`
          const s3Result = await s3Download(s3Config, s3Key)
          if (s3Result) {
            // S3 content ，
            result = JSON.parse(s3Result.content)
          }
        }
        break;
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavKey = `${path}/${filename}`
          const webdavResult = await webdavDownload(webdavConfig, webdavKey)
          if (webdavResult) {
            result = JSON.parse(webdavResult.content)
          }
        }
        break;
      }
    }
    // S3/WebDAV result ， Git
    if (files) {
      const configJson = decodeBase64ToString(getRemoteFileContent(files, `${path}/${filename}`))
      result = JSON.parse(configJson)
    }
    if (result.length > 0) {
      const { deleteAllConversationCompactions } = await import('@/db/conversation-compactions')
      await deleteAllConversationCompactions()
      await deleteAllChats()
      await insertChats(result)
    }
    set({ syncState: false })
    return result
  },

  // === ： ===
  currentConversationId: null,
  conversations: [],
  isTemporaryConversation: false,

  initConversations: async () => {
    const { getAllConversations } = await import('@/db/conversations')
    const conversations = await getAllConversations()
    set({ conversations })
  },

  createConversation: async (title = 'New chat') => {
    const { createConversation: createConv } = await import('@/db/conversations')
    const id = await createConv(title)
    //
    set({ currentConversationId: id, isTemporaryConversation: false })
    await get().initConversations()
    return id
  },

  switchConversation: async (id: number) => {
    const previousConversationId = get().currentConversationId
    if (previousConversationId && previousConversationId !== id) {
      const { scheduleConversationMemoryExtraction } = await import('@/lib/memory/auto-memory')
      scheduleConversationMemoryExtraction(previousConversationId)
    }
    // ， messageCount
    const { syncConversationMessageCount } = await import('@/db/conversations')
    await syncConversationMessageCount(id)
    //
    const { getChatsByConversation } = await import('@/db/chats')
    const data = await getChatsByConversation(id)
    set({
      currentConversationId: id,
      chats: data,
      isTemporaryConversation: false,
      pendingQuote: null,
      editorSelectionQuote: null,
    })
    // UI
    await get().initConversations()
  },

  updateConversationTitle: async (id: number, title: string) => {
    const { updateConversationTitle: updateTitle } = await import('@/db/conversations')
    await updateTitle(id, title)
    //
    await get().initConversations()
  },

  deleteConversation: async (id: number) => {
    const { deleteConversation: deleteConv } = await import('@/db/conversations')
    await deleteConv(id)

    const { currentConversationId, conversations, switchConversation } = get()

    // ，
    if (id === currentConversationId) {
      const remainingConversations = conversations.filter(c => c.id !== id)
      if (remainingConversations.length > 0) {
        await switchConversation(remainingConversations[0].id)
      } else {
        // ，，
        set({
          currentConversationId: null,
          chats: [],
          isTemporaryConversation: false,
          pendingQuote: null,
          editorSelectionQuote: null,
          agentAutoApproveConversationId: null,
          agentAutoApproveRuntimeScriptKey: null
        })
        get().resetAgentState()
        get().clearMcpToolCalls()
      }
    }

    //
    await get().initConversations()
  },

  toggleConversationPin: async (id: number) => {
    const { toggleConversationPin: togglePin } = await import('@/db/conversations')
    const isPinned = await togglePin(id)
    //
    await get().initConversations()
    return isPinned
  },

  startNewConversation: async () => {
    const { currentConversationId } = get()
    if (currentConversationId) {
      const { scheduleConversationMemoryExtraction } = await import('@/lib/memory/auto-memory')
      scheduleConversationMemoryExtraction(currentConversationId)
    }

    // ，（）
    if (currentConversationId) {
      const { getConversation } = await import('@/db/conversations')
      const currentConv = await getConversation(currentConversationId)
      if (currentConv && currentConv.messageCount === 0) {
        // ，
        const { deleteConversation: deleteConv } = await import('@/db/conversations')
        await deleteConv(currentConversationId)
      }
      //
      await get().initConversations()
    }

    // ，
    //
    set({
      currentConversationId: null,
      chats: [],
      isTemporaryConversation: false,
      pendingQuote: null,
      editorSelectionQuote: null,
      agentAutoApproveConversationId: null,
      agentAutoApproveRuntimeScriptKey: null
    })
    // Agent
    get().resetAgentState()
    get().clearMcpToolCalls()
  },

  startTemporaryConversation: () => {
    set({
      currentConversationId: null,
      chats: [],
      isTemporaryConversation: true,
      pendingQuote: null,
      editorSelectionQuote: null,
      agentAutoApproveConversationId: null,
      agentAutoApproveRuntimeScriptKey: null,
    })
    get().resetAgentState()
    get().clearMcpToolCalls()
  },
}))

export default useChatStore
