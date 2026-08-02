import { getDb } from "./index"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'

export type Role = 'system' | 'user'
export type ChatType = 'chat' | 'note' | 'clipboard' | 'clear' | 'condensed'

export interface Chat {
  id: number
  tagId?: number // ，
  conversationId?: number // ID
  content?: string
  role: Role
  type: ChatType
  image?: string
  images?: string // ，JSON
  imageAnalyses?: string // ，JSON
  attachments?: string // ，JSON
  inserted: boolean // Insert mark
  createdAt: number
  ragSources?: string // RAG，JSON
  ragSourceDetails?: string // RAG，JSON（）
  agentHistory?: string // Agent，JSON
  thinking?: string // AI
  quoteData?: string // ，JSON
  //
  condensedContent?: string    // （）
  condensedAt?: number         //
}

// chats
export async function initChatsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists chats (
      id integer primary key autoincrement,
      tagId integer not null,
      content text default null,
      role text not null,
      type text not null,
      image text default null,
      images text default null,
      imageAnalyses text default null,
      attachments text default null,
      inserted boolean default false,
      createdAt integer not null,
      ragSources text default null,
      agentHistory text default null,
      thinking text default null,
      quoteData text default null
    )
  `)
  
  // ： ragSources （）
  try {
    await db.execute(`
      alter table chats add column ragSources text default null
    `)
  } catch {
    // ，
    // SQLite "duplicate column name"
  }
  
  // ： agentHistory （）
  try {
    await db.execute(`
      alter table chats add column agentHistory text default null
    `)
  } catch {
    // ，
  }
  
  // ： images （）
  try {
    await db.execute(`
      alter table chats add column images text default null
    `)
  } catch {
    // ，
  }

  // ：，
  try {
    await db.execute(`
      alter table chats add column imageAnalyses text default null
    `)
  } catch {
    // ，
  }

  // ：，
  try {
    await db.execute(`
      alter table chats add column attachments text default null
    `)
  } catch {
    // ，
  }
  
  // ： thinking （）
  try {
    await db.execute(`
      alter table chats add column thinking text default null
    `)
  } catch {
    // ，
  }
  
  // ： quoteData （）
  try {
    await db.execute(`
      alter table chats add column quoteData text default null
    `)
  } catch {
    // ，
  }

  // ： ragSourceDetails （）
  try {
    await db.execute(`
      alter table chats add column ragSourceDetails text default null
    `)
  } catch {
    // ，
  }

  // ： condensedFrom （）
  try {
    await db.execute(`
      alter table chats add column condensedFrom text default null
    `)
  } catch {
    // ，
  }

  // ： originalTokenCount （）
  try {
    await db.execute(`
      alter table chats add column originalTokenCount integer default null
    `)
  } catch {
    // ，
  }

  // ： originalMessageCount （）
  try {
    await db.execute(`
      alter table chats add column originalMessageCount integer default null
    `)
  } catch {
    // ，
  }

  // ： condensedAt （）
  try {
    await db.execute(`
      alter table chats add column condensedAt integer default null
    `)
  } catch {
    // ，
  }

  // ： condensedContent （）
  try {
    await db.execute(`
      alter table chats add column condensedContent text default null
    `)
  } catch {
    // ，
  }

  // ： conversationId （）
  // ： conversations.ts initConversationsDb
  // ， conversations ，
  try {
    await db.execute(`
      alter table chats add column conversationId integer default null
    `)
  } catch {
    // ，
  }
}

// chat
export async function insertChat(chat: Omit<Chat, 'id' | 'createdAt'>) {
  const db = await getDb()
  const createdAt = Date.now();
  const result = await db.execute(
    "insert into chats (tagId, conversationId, content, role, type, image, images, imageAnalyses, attachments, inserted, createdAt, ragSources, ragSourceDetails, agentHistory, thinking, quoteData, condensedContent, condensedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)",
    [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.imageAnalyses, chat.attachments, chat.inserted ? 1 : 0, createdAt, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt]
  )

  if (chat.role === 'user' && chat.content?.trim()) {
    await insertActivityEvent({
      source: 'chat',
      title: truncateActivityText(chat.content, 64),
      description: truncateActivityText(chat.content, 140),
      tagId: chat.tagId ?? null,
      dedupeKey: result.lastInsertId ? `chat:${result.lastInsertId}` : `chat:${createdAt}`,
      createdAt,
    })
  }

  return result
}

// chats
export async function getChats(tagId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where tagId = $1 order by createdAt",
    [tagId]
  )
  return result
}

// ID （）
export async function getChatsByConversation(conversationId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where conversationId = $1 order by createdAt",
    [conversationId]
  )
  return result
}

// chats（）
export async function getAllChats() {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats order by createdAt",
    []
  )
  return result
}

// chat（）
export async function insertChats(chats: Chat[]) {
  const db = await getDb()

  await db.execute('BEGIN TRANSACTION')
  try {
    for (const chat of chats) {
      await db.execute(
        "insert into chats (tagId, conversationId, content, role, type, image, images, imageAnalyses, attachments, inserted, createdAt, ragSources, ragSourceDetails, agentHistory, thinking, quoteData, condensedContent, condensedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)",
        [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.imageAnalyses, chat.attachments, chat.inserted ? 1 : 0, chat.createdAt, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt]
      )
    }
    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
}

// chats（）
export async function deleteAllChats() {
  const db = await getDb()
  return await db.execute(
    "delete from chats",
    []
  )
}

// chat
export async function updateChat(chat: Chat) {
  const db = await getDb()
  return await db.execute(
    "update chats set tagId = $1, conversationId = $2, content = $3, role = $4, type = $5, image = $6, images = $7, imageAnalyses = $8, attachments = $9, inserted = $10, ragSources = $11, ragSourceDetails = $12, agentHistory = $13, thinking = $14, quoteData = $15, condensedContent = $16, condensedAt = $17 where id = $18",
    [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.imageAnalyses, chat.attachments, chat.inserted ? 1 : 0, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt, chat.id])
}

// tagId chats
export async function clearChatsByTagId(tagId: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where tagId = $1",
    [tagId])
}

//
export async function updateChatsInsertedById(id: number) {
  const db = await getDb()
  return await db.execute(
    "update chats set inserted = $1 where id = $2",
    [true, id])
}

// chat
export async function deleteChat(id: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where id = $1",
    [id])
}

export async function updateChats(chats: Chat[]) {
  const db = await getDb()
  try {
    for (const chat of chats) {
      await db.execute(
        "update chats set tagId = $1, conversationId = $2, content = $3, role = $4, type = $5, image = $6, images = $7, imageAnalyses = $8, attachments = $9, inserted = $10, ragSources = $11, ragSourceDetails = $12, agentHistory = $13, thinking = $14, quoteData = $15, condensedContent = $16, condensedAt = $17 where id = $18",
        [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.imageAnalyses, chat.attachments, chat.inserted ? 1 : 0, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt, chat.id]
      )
    }
  } catch (error) {
    console.error('Error updating chats:', error);
    throw error;
  }
}

export async function deleteChats(ids: number[]) {
  const db = await getDb()
  try {
    for (const id of ids) {
      await db.execute(
        "delete from chats where id = $1",
        [id]
      )
    }
  } catch (error) {
    console.error('Error deleting chats:', error);
    throw error;
  }
}

/**
 * 
 * @param chatId ID
 * @param condensedContent 
 */
export async function updateChatCondensedContent(chatId: number, condensedContent: string) {
  const db = await getDb()
  try {
    await db.execute(
      "update chats set condensedContent = $1, condensedAt = $2 where id = $3",
      [condensedContent, Date.now(), chatId]
    )
  } catch (error) {
    console.error('Error updating chat condensed content:', error);
    throw error;
  }
}
