
import Database from '@tauri-apps/plugin-sql';

//
export const db = await Database.load('sqlite:note.db');

// ()
export async function getDb() {
  return db;
}

//
export async function initAllDatabases() {
  //
  const { initChatsDb } = await import('./chats');
  const { initMarksDb } = await import('./marks');
  const { initNotesDb } = await import('./notes');
  const { initTagsDb } = await import('./tags');
  const { initVectorDb } = await import('./vector');
  const { initConversationsDb } = await import('./conversations');
  const { initMemoriesDb } = await import('./memories');
  const { initActivityDb } = await import('./activity');
  const { initCanvasesDb } = await import('./canvases');
  const { initConversationCompactionsDb } = await import('./conversation-compactions');
  const { initImageAnalysisCacheDb } = await import('./image-analysis-cache');

  // ：， conversations chats /。
  await initChatsDb();
  await initConversationsDb();
  await initConversationCompactionsDb();
  await initImageAnalysisCacheDb();
  await initMarksDb();
  await initNotesDb();
  await initTagsDb();
  await initVectorDb();
  await initMemoriesDb();
  await initActivityDb();
  await initCanvasesDb();
}
