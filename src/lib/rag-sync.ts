import { getVersion } from '@tauri-apps/api/app'
import { Store } from '@tauri-apps/plugin-store'
import {
  getAllVectorDocuments,
  replaceAllVectorDocuments,
  type VectorDocumentSnapshot,
} from '@/db/vector'
import { downloadRemoteText, isLocalLibraryFile, uploadRemoteText } from '@/lib/sync/remote-library'

const RAG_SYNC_ROOT = '.data/rag'
const RAG_MANIFEST_PATH = `${RAG_SYNC_ROOT}/manifest.json`
const MAX_PAGE_BYTES = 750 * 1024
const RAG_SNAPSHOT_SCHEMA_VERSION = 1

type RagSourceFingerprint = {
  path: string
  contentHash: string
  indexedAt: number
}

export type RagSnapshotManifest = {
  schemaVersion: number
  appVersion: string
  generatedAt: number
  embeddingModel: string
  embeddingDimension: number
  chunkSize: number
  chunkOverlap: number
  documentCount: number
  vectorCount: number
  pages: Array<{ path: string; count: number; bytes: number }>
  sources: RagSourceFingerprint[]
}

export type RagSnapshotDownloadResult = {
  manifest: RagSnapshotManifest
  missingSourceFiles: string[]
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function parseEmbedding(value: string): number[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('Knowledge base contains invalid vector data')
  }
  return parsed
}

function validateDocument(value: unknown): VectorDocumentSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid knowledge base chunk format')
  const document = value as Partial<VectorDocumentSnapshot>
  if (
    typeof document.filename !== 'string' || !document.filename ||
    typeof document.chunk_id !== 'number' || !Number.isInteger(document.chunk_id) || document.chunk_id < 0 ||
    typeof document.content !== 'string' ||
    typeof document.embedding !== 'string' ||
    typeof document.updated_at !== 'number'
  ) {
    throw new Error('Knowledge base chunk fields incomplete')
  }
  parseEmbedding(document.embedding)
  return document as VectorDocumentSnapshot
}

function validateManifest(value: unknown): RagSnapshotManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid remote knowledge base manifest format')
  const manifest = value as Partial<RagSnapshotManifest>
  if (manifest.schemaVersion !== RAG_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported knowledge base schema version: ${manifest.schemaVersion ?? 'unknown'}`)
  }
  if (
    typeof manifest.generatedAt !== 'number' ||
    typeof manifest.embeddingDimension !== 'number' ||
    typeof manifest.vectorCount !== 'number' ||
    !Array.isArray(manifest.pages) ||
    !Array.isArray(manifest.sources)
  ) {
    throw new Error('Remote knowledge base manifest fields incomplete')
  }
  return manifest as RagSnapshotManifest
}

function splitDocumentsIntoPages(documents: VectorDocumentSnapshot[]): VectorDocumentSnapshot[][] {
  const pages: VectorDocumentSnapshot[][] = []
  let currentPage: VectorDocumentSnapshot[] = []
  let currentBytes = 2

  for (const document of documents) {
    const documentBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength + 1
    if (currentPage.length > 0 && currentBytes + documentBytes > MAX_PAGE_BYTES) {
      pages.push(currentPage)
      currentPage = []
      currentBytes = 2
    }
    currentPage.push(document)
    currentBytes += documentBytes
  }

  if (currentPage.length > 0) pages.push(currentPage)
  return pages
}

async function buildSources(documents: VectorDocumentSnapshot[]): Promise<RagSourceFingerprint[]> {
  const grouped = new Map<string, VectorDocumentSnapshot[]>()
  for (const document of documents) {
    const current = grouped.get(document.filename) || []
    current.push(document)
    grouped.set(document.filename, current)
  }

  const sources: RagSourceFingerprint[] = []
  for (const [path, chunks] of grouped.entries()) {
    chunks.sort((left, right) => left.chunk_id - right.chunk_id)
    sources.push({
      path,
      contentHash: await sha256(chunks.map(chunk => chunk.content).join('\n\n')),
      indexedAt: Math.max(...chunks.map(chunk => chunk.updated_at)),
    })
  }
  return sources.sort((left, right) => left.path.localeCompare(right.path))
}

export async function uploadKnowledgeBaseSnapshot(
  onProgress?: (current: number, total: number, path: string) => void
): Promise<RagSnapshotManifest> {
  const documents = await getAllVectorDocuments()
  if (documents.length === 0) throw new Error('Local knowledge base is empty; recalculate first')

  const dimensions = new Set(documents.map(document => parseEmbedding(document.embedding).length))
  if (dimensions.size !== 1) throw new Error('Local knowledge base contains vectors of mixed dimensions; recalculate first')

  const store = await Store.load('store.json')
  const pages = splitDocumentsIntoPages(documents)
  const pageMetadata: RagSnapshotManifest['pages'] = []

  for (let index = 0; index < pages.length; index++) {
    const pagePath = `${RAG_SYNC_ROOT}/pages/${String(index + 1).padStart(5, '0')}.json`
    const content = JSON.stringify(pages[index])
    onProgress?.(index, pages.length + 1, pagePath)
    await uploadRemoteText(pagePath, content, `Upload RAG snapshot page ${index + 1}`)
    pageMetadata.push({
      path: pagePath,
      count: pages[index].length,
      bytes: new TextEncoder().encode(content).byteLength,
    })
  }

  const manifest: RagSnapshotManifest = {
    schemaVersion: RAG_SNAPSHOT_SCHEMA_VERSION,
    appVersion: await getVersion(),
    generatedAt: Date.now(),
    embeddingModel: await store.get<string>('embeddingModel') || '',
    embeddingDimension: Array.from(dimensions)[0],
    chunkSize: await store.get<number>('ragChunkSize') || 1000,
    chunkOverlap: await store.get<number>('ragChunkOverlap') || 100,
    documentCount: new Set(documents.map(document => document.filename)).size,
    vectorCount: documents.length,
    pages: pageMetadata,
    sources: await buildSources(documents),
  }

  onProgress?.(pages.length, pages.length + 1, RAG_MANIFEST_PATH)
  await uploadRemoteText(
    RAG_MANIFEST_PATH,
    JSON.stringify(manifest),
    `Publish RAG snapshot (${manifest.vectorCount} vectors)`
  )
  onProgress?.(pages.length + 1, pages.length + 1, RAG_MANIFEST_PATH)
  return manifest
}

export async function downloadKnowledgeBaseSnapshot(
  onProgress?: (current: number, total: number, path: string) => void
): Promise<RagSnapshotDownloadResult> {
  const manifest = validateManifest(JSON.parse(await downloadRemoteText(RAG_MANIFEST_PATH)))
  const documents: VectorDocumentSnapshot[] = []

  for (let index = 0; index < manifest.pages.length; index++) {
    const page = manifest.pages[index]
    onProgress?.(index, manifest.pages.length, page.path)
    const parsed: unknown = JSON.parse(await downloadRemoteText(page.path))
    if (!Array.isArray(parsed) || parsed.length !== page.count) {
      throw new Error(`Knowledge base page corrupted: ${page.path}`)
    }
    documents.push(...parsed.map(validateDocument))
  }

  if (documents.length !== manifest.vectorCount) {
    throw new Error(`Knowledge base vector count mismatch: expected ${manifest.vectorCount}, got ${documents.length}`)
  }

  const dimensions = new Set(documents.map(document => parseEmbedding(document.embedding).length))
  if (dimensions.size !== 1 || Array.from(dimensions)[0] !== manifest.embeddingDimension) {
    throw new Error('Knowledge base vector dimensions do not match the manifest')
  }

  await replaceAllVectorDocuments(documents)
  const store = await Store.load('store.json')
  await store.set('lastVectorProcessTime', manifest.generatedAt)
  await store.set('lastDownloadedRagSnapshot', manifest)

  const missingSourceFiles: string[] = []
  for (const source of manifest.sources) {
    if (!await isLocalLibraryFile(source.path)) missingSourceFiles.push(source.path)
  }

  onProgress?.(manifest.pages.length, manifest.pages.length, RAG_MANIFEST_PATH)
  return { manifest, missingSourceFiles }
}

export async function getLastDownloadedKnowledgeBaseSnapshot(): Promise<RagSnapshotManifest | null> {
  const store = await Store.load('store.json')
  return await store.get<RagSnapshotManifest>('lastDownloadedRagSnapshot') || null
}
