import { db } from './index';
import { getBM25Index } from '@/lib/bm25';

//
export interface VectorDocument {
  id: number;
  filename: string;   //
  chunk_id: number;   // ID
  content: string;    //
  embedding: string;  // JSON
  updated_at: number; //
}

export type VectorDocumentSnapshot = Omit<VectorDocument, 'id'>;

export interface VectorIndexStats {
  documentCount: number;
  chunkCount: number;
  bm25DocumentCount: number;
  bm25ChunkCount: number;
  lastUpdatedAt: number | null;
}

export interface VectorIndexSummary {
  filename: string;
  updated_at: number;
}

//
interface CachedVector {
  id: number;
  filename: string;
  chunk_id: number;
  content: string;
  embedding: number[];  //
  updated_at: number;
}

//
class VectorCache {
  private cache: Map<number, CachedVector> = new Map();
  private vectorsByFilename: Map<string, number[]> = new Map(); // ID
  private lastUpdate: number = 0;
  private cacheVersion: number = 0;

  // ，
  getVersion(): number {
    return this.cacheVersion;
  }

  //
  getAll(): CachedVector[] {
    return Array.from(this.cache.values());
  }

  //
  getByFilename(filename: string): CachedVector[] {
    const ids = this.vectorsByFilename.get(filename) || [];
    return ids.map(id => this.cache.get(id)).filter(Boolean) as CachedVector[];
  }

  //
  async update() {
    const docs = await db.select<VectorDocument[]>(`
      select id, filename, chunk_id, content, embedding, updated_at from vector_documents
    `);

    //
    this.cache.clear();
    this.vectorsByFilename.clear();

    //
    for (const doc of docs) {
      try {
        const embedding = JSON.parse(doc.embedding) as number[];
        const cached: CachedVector = {
          id: doc.id,
          filename: doc.filename,
          chunk_id: doc.chunk_id,
          content: doc.content,
          embedding,
          updated_at: doc.updated_at
        };
        this.cache.set(doc.id, cached);

        //
        if (!this.vectorsByFilename.has(doc.filename)) {
          this.vectorsByFilename.set(doc.filename, []);
        }
        this.vectorsByFilename.get(doc.filename)!.push(doc.id);
      } catch (error) {
        console.error(`Failed to parse embedding for doc ${doc.id}:`, error);
      }
    }

    this.lastUpdate = Date.now();
    this.cacheVersion++;
  }

  //
  add(doc: VectorDocument) {
    try {
      const embedding = JSON.parse(doc.embedding) as number[];
      const cached: CachedVector = {
        id: doc.id,
        filename: doc.filename,
        chunk_id: doc.chunk_id,
        content: doc.content,
        embedding,
        updated_at: doc.updated_at
      };
      this.cache.set(doc.id, cached);

      if (!this.vectorsByFilename.has(doc.filename)) {
        this.vectorsByFilename.set(doc.filename, []);
      }
      const fileIds = this.vectorsByFilename.get(doc.filename)!;
      if (!fileIds.includes(doc.id)) {
        fileIds.push(doc.id);
      }
      this.cacheVersion++;
    } catch (error) {
      console.error(`Failed to add vector to cache for doc ${doc.id}:`, error);
    }
  }

  //
  deleteByFilename(filename: string) {
    const ids = this.vectorsByFilename.get(filename) || [];
    for (const id of ids) {
      this.cache.delete(id);
    }
    this.vectorsByFilename.delete(filename);
    this.cacheVersion++;
  }

  // （5）
  needsUpdate(): boolean {
    return Date.now() - this.lastUpdate > 5 * 60 * 1000 || this.cache.size === 0;
  }
}

//
const vectorCache = new VectorCache();

//
let vectorDbInitPromise: Promise<void> | null = null;

export async function initVectorDb() {
  if (!vectorDbInitPromise) {
    vectorDbInitPromise = (async () => {
      await db.execute(`
        create table if not exists vector_documents (
          id integer primary key autoincrement,
          filename text not null,
          chunk_id integer not null,
          content text not null,
          embedding text not null,
          updated_at integer not null,
          unique(filename, chunk_id)
        )
      `);

      //
      await db.execute(`
        create index if not exists idx_vector_documents_filename
        on vector_documents(filename)
      `);

      // 。，。
      await vectorCache.update();
    })().catch((error) => {
      vectorDbInitPromise = null;
      throw error;
    });
  }

  await vectorDbInitPromise;
}

export async function getAllVectorDocuments(): Promise<VectorDocumentSnapshot[]> {
  return await db.select<VectorDocumentSnapshot[]>(`
    select filename, chunk_id, content, embedding, updated_at
    from vector_documents
    order by filename, chunk_id
  `);
}

export async function getVectorIndexSummaries(): Promise<VectorIndexSummary[]> {
  return await db.select<VectorIndexSummary[]>(`
    select filename, max(updated_at) as updated_at
    from vector_documents
    group by filename
  `);
}

export async function getVectorIndexStats(): Promise<VectorIndexStats> {
  const rows = await db.select<Array<{
    document_count: number;
    chunk_count: number;
    last_updated_at: number | null;
  }>>(`
    select
      count(distinct filename) as document_count,
      count(*) as chunk_count,
      max(updated_at) as last_updated_at
    from vector_documents
  `);
  const bm25Stats = getBM25Index()?.getStats();
  return {
    documentCount: Number(rows[0]?.document_count || 0),
    chunkCount: Number(rows[0]?.chunk_count || 0),
    bm25DocumentCount: bm25Stats?.documentCount || 0,
    bm25ChunkCount: bm25Stats?.chunkCount || 0,
    lastUpdatedAt: rows[0]?.last_updated_at ? Number(rows[0].last_updated_at) : null
  };
}

async function insertVectorDocumentSnapshots(documents: VectorDocumentSnapshot[]): Promise<void> {
  for (const document of documents) {
    await db.execute(
      `insert into vector_documents
        (filename, chunk_id, content, embedding, updated_at)
       values ($1, $2, $3, $4, $5)`,
      [
        document.filename,
        document.chunk_id,
        document.content,
        document.embedding,
        document.updated_at,
      ]
    );
  }
}

export async function replaceAllVectorDocuments(documents: VectorDocumentSnapshot[]): Promise<void> {
  // tauri-plugin-sql may execute successive statements on different pooled
  // connections, so a manual BEGIN here can lock the following DELETE. Keep a
  // complete recovery snapshot instead and restore it if replacement fails.
  const previousDocuments = await getAllVectorDocuments();

  try {
    await db.execute('delete from vector_documents');
    await insertVectorDocumentSnapshots(documents);
    await vectorCache.update();
  } catch (error) {
    await db.execute('delete from vector_documents');
    await insertVectorDocumentSnapshots(previousDocuments);
    await vectorCache.update();
    throw error;
  }
}

//
export async function upsertVectorDocument(doc: Omit<VectorDocument, 'id'>) {
  await db.execute(
    "insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at",
    [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at]);

  // ID
  const inserted = await db.select<VectorDocument[]>(
    "select * from vector_documents where filename = $1 and chunk_id = $2",
    [doc.filename, doc.chunk_id]
  );

  if (inserted.length > 0) {
    vectorCache.add(inserted[0]);
  }
}

//
export async function getVectorDocumentsByFilename(filename: string) {
  return await db.select<VectorDocument[]>(
    "select * from vector_documents where filename = $1 order by chunk_id",
    [filename]);
}

//
export async function deleteVectorDocumentsByFilename(filename: string) {
  await db.execute(
    "delete from vector_documents where filename = $1",
    [filename]);

  //
  vectorCache.deleteByFilename(filename);
  getBM25Index()?.deleteByFilename(filename);
}

export async function renameVectorDocumentsByFilename(oldFilename: string, newFilename: string) {
  if (oldFilename === newFilename) return;
  await db.execute('delete from vector_documents where filename = $1', [newFilename]);
  await db.execute(
    'update vector_documents set filename = $1, updated_at = $2 where filename = $3',
    [newFilename, Date.now(), oldFilename]
  );
  getBM25Index()?.renameFilename(oldFilename, newFilename);
  await vectorCache.update();
}

export async function deleteVectorDocumentsByPrefix(prefix: string) {
  await db.execute(
    'delete from vector_documents where filename = $1 or filename like $2',
    [prefix, `${prefix}/%`]
  );
  getBM25Index()?.deleteByFilenamePrefix(prefix);
  await vectorCache.update();
}

export async function renameVectorDocumentsByPrefix(oldPrefix: string, newPrefix: string) {
  if (oldPrefix === newPrefix) return;
  const filenames = await db.select<{ filename: string }[]>(
    'select distinct filename from vector_documents where filename = $1 or filename like $2',
    [oldPrefix, `${oldPrefix}/%`]
  );
  for (const { filename } of filenames) {
    const suffix = filename.slice(oldPrefix.length);
    const nextFilename = `${newPrefix}${suffix}`;
    await db.execute('delete from vector_documents where filename = $1', [nextFilename]);
    await db.execute(
      'update vector_documents set filename = $1, updated_at = $2 where filename = $3',
      [nextFilename, Date.now(), filename]
    );
  }
  getBM25Index()?.renameFilenamePrefix(oldPrefix, newPrefix);
  await vectorCache.update();
}

//
export async function checkVectorDocumentExists(filename: string) {
  const result = await db.select<{ count: number }[]>(
    "select count(*) as count from vector_documents where filename = $1",
    [filename]);
  
  return result[0]?.count > 0;
}

// （：）
export async function getSimilarDocuments(
  queryEmbedding: number[],
  limit: number = 5,
  threshold: number = 0.7,
  allowedFilenames?: ReadonlySet<string>
): Promise<{id: number, filename: string, chunk_id: number, content: string, similarity: number}[]> {
  //
  if (vectorCache.needsUpdate()) {
    await vectorCache.update();
  }

  // （， JSON.parse）
  const cachedVectors = vectorCache.getAll().filter(
    doc => !allowedFilenames || allowedFilenames.has(doc.filename)
  );

  if (!cachedVectors.length) return [];

  //
  const allSimilarities = cachedVectors.map(doc => {
    const similarity = cosineSimilarity(queryEmbedding, doc.embedding);

    return {
      id: doc.id,
      filename: doc.filename,
      chunk_id: doc.chunk_id,
      content: doc.content,
      similarity
    };
  });

  const results = allSimilarities
  .filter(doc => doc.similarity >= threshold)
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, limit);

  return results;
}

//
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vector dimension mismatch');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

//
export async function clearVectorDb() {
  await db.execute(`
    delete from vector_documents
  `);

  //
  await vectorCache.update();
  getBM25Index()?.clear();
}

//
export async function getAllVectorDocumentFilenames() {
  return await db.select<{filename: string}[]>(`
    select distinct filename from vector_documents
  `);
}

//
export async function refreshVectorCache() {
  await vectorCache.update();
}
