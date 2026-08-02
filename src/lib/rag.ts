import { readTextFile, readDir, BaseDirectory, DirEntry } from "@tauri-apps/plugin-fs";
import { fetchEmbedding, fetchEmbeddings, rerankDocuments } from "./ai";
import {
  upsertVectorDocument,
  deleteVectorDocumentsByFilename,
  getSimilarDocuments,
  getVectorDocumentsByFilename,
  initVectorDb,
  VectorDocument
} from "@/db/vector";
import { invoke } from "@tauri-apps/api/core";
import {
  BM25Document,
  createBM25ChunkKey,
  initBM25Index,
  getBM25Index,
  parseBM25ChunkKey
} from "./bm25";

// initVectorDb，
export { initVectorDb };
import { getFilePathOptions, getWorkspacePath } from "./workspace";
import { DirTree } from "@/stores/article";
import { toast } from "@/hooks/use-toast";
import { join } from "@tauri-apps/api/path";
import { Store } from "@tauri-apps/plugin-store";
import { createHash } from 'crypto';
import { isSkillsFolder } from './skills/utils';
import { getVectorDocumentKey } from './vector-document-key';
import {
  createRetrievalStrategy,
  DEFAULT_EXCLUDED_RAG_PATHS,
  getRagDisplayFilename,
  isPathAllowedForRag,
  normalizeRagPath,
  RetrievalScope,
  RetrievalStrategy
} from './rag-retrieval-policy';

/**
 * 
 */
function handleRAGError(error: unknown, context: string, showToast: boolean = true): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[RAG Error] ${context}:`, errorMessage);

  if (showToast) {
    toast({
      title: 'RAG feature error',
      description: `${context}: ${errorMessage}`,
      variant: 'destructive',
    });
  }
}

/**
 * ，
 */
function generateContentHash(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex');
}

const queryEmbeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();
const QUERY_EMBEDDING_CACHE_TTL = 5 * 60 * 1000;
const QUERY_EMBEDDING_CACHE_LIMIT = 50;

async function getQueryEmbedding(query: string): Promise<number[] | null> {
  const cacheKey = query.normalize('NFKC').trim();
  const cached = queryEmbeddingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.embedding;
  }
  const embedding = await fetchEmbedding(query);
  if (!embedding) return null;
  queryEmbeddingCache.set(cacheKey, {
    embedding,
    expiresAt: Date.now() + QUERY_EMBEDDING_CACHE_TTL
  });
  while (queryEmbeddingCache.size > QUERY_EMBEDDING_CACHE_LIMIT) {
    const oldestKey = queryEmbeddingCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    queryEmbeddingCache.delete(oldestKey);
  }
  return embedding;
}

async function getConfiguredExcludedPaths(store?: Store): Promise<string[]> {
  const targetStore = store || await Store.load('store.json');
  return await targetStore.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS;
}

async function resolveRetrievalScope(scope: RetrievalScope = {}, store?: Store): Promise<RetrievalScope> {
  const configuredExcludedPaths = await getConfiguredExcludedPaths(store);
  return {
    includedPaths: scope.includedPaths,
    excludedPaths: Array.from(new Set([...configuredExcludedPaths, ...(scope.excludedPaths || [])]))
  };
}

export async function shouldIndexRagPath(path: string): Promise<boolean> {
  return isPathAllowedForRag(path, await resolveRetrievalScope());
}

/**
 * - 
 */
async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: (completed: number, total: number, taskIndex: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextTaskIndex = 0;
  let completed = 0;

  async function runWorker(): Promise<void> {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex++;

      try {
        results[taskIndex] = await tasks[taskIndex]();
      } finally {
        completed++;
        onProgress?.(completed, tasks.length, taskIndex);
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

interface MarkdownBlock {
  content: string;
  atomic: boolean;
}

function splitLongMarkdownBlock(content: string, chunkSize: number): string[] {
  if (content.length <= chunkSize) return [content];
  const sentences = content.match(/[^.!?。！？\n]+[.!?。！？]?|\n+/g) || [content];
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > chunkSize) {
      parts.push(current.trim());
      current = '';
    }
    if (sentence.length > chunkSize) {
      for (let offset = 0; offset < sentence.length; offset += chunkSize) {
        const slice = sentence.slice(offset, offset + chunkSize).trim();
        if (slice) parts.push(slice);
      }
    } else {
      current += sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseMarkdownBlocks(text: string, chunkSize: number): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  const headings: string[] = [];
  let paragraph: string[] = [];

  const headingPrefix = () => headings.filter(Boolean).join('\n');
  const pushParagraph = () => {
    const body = paragraph.join('\n').trim();
    paragraph = [];
    if (!body) return;
    const prefix = headingPrefix();
    const contextualContent = prefix && !body.startsWith('#') ? `${prefix}\n\n${body}` : body;
    for (const part of splitLongMarkdownBlock(contextualContent, chunkSize)) {
      blocks.push({ content: part, atomic: false });
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      pushParagraph();
      const level = headingMatch[1].length;
      headings.splice(level - 1);
      headings[level - 1] = line.trim();
      continue;
    }

    if (/^\s*(```|~~~)/.test(line)) {
      pushParagraph();
      const marker = line.trim().slice(0, 3);
      const codeLines = [line];
      while (++index < lines.length) {
        codeLines.push(lines[index]);
        if (lines[index].trim().startsWith(marker)) break;
      }
      const prefix = headingPrefix();
      blocks.push({
        content: prefix ? `${prefix}\n\n${codeLines.join('\n')}` : codeLines.join('\n'),
        atomic: true
      });
      continue;
    }

    const nextLine = lines[index + 1] || '';
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(nextLine)) {
      pushParagraph();
      const tableLines = [line, nextLine];
      index++;
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        tableLines.push(lines[++index]);
      }
      const prefix = headingPrefix();
      blocks.push({
        content: prefix ? `${prefix}\n\n${tableLines.join('\n')}` : tableLines.join('\n'),
        atomic: true
      });
      continue;
    }

    if (!line.trim()) {
      pushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  pushParagraph();
  return blocks;
}

/**
 * Markdown ：Heading，Code blockTable。
 */
export function chunkText(
  text: string, 
  chunkSize: number = 1000,
  chunkOverlap: number = 200
): string[] {
  if (!text.trim()) return [];
  if (text.length <= chunkSize) return [text.trim()];

  const blocks = parseMarkdownBlocks(text, chunkSize);
  const chunks: string[] = [];
  let currentBlocks: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (currentBlocks.length === 0) return;
    chunks.push(currentBlocks.join('\n\n').trim());
    const overlapBlocks: string[] = [];
    let overlapLength = 0;
    for (let index = currentBlocks.length - 1; index >= 0; index--) {
      const block = currentBlocks[index];
      if (overlapLength + block.length > chunkOverlap) break;
      overlapBlocks.unshift(block);
      overlapLength += block.length;
    }
    currentBlocks = overlapBlocks;
    currentLength = overlapBlocks.reduce((total, block) => total + block.length + 2, 0);
  };

  for (const block of blocks) {
    if (currentBlocks.length > 0 && currentLength + block.content.length + 2 > chunkSize) {
      flush();
    }
    if (block.atomic && block.content.length > chunkSize) {
      flush();
      chunks.push(block.content.trim());
      currentBlocks = [];
      currentLength = 0;
    } else {
      currentBlocks.push(block.content);
      currentLength += block.content.length + 2;
    }
  }
  flush();
  return chunks.filter(Boolean);
}

/**
 * BM25 
 * Markdown File BM25 
 */
export async function initBM25Search(): Promise<void> {
  try {
    const items = await collectMarkdownContents();
    const store = await Store.load('store.json');
    const chunkSize = await store.get<number>('ragChunkSize');
    const chunkOverlap = await store.get<number>('ragChunkOverlap');
    const documents: BM25Document[] = items.flatMap(item => {
      const filename = getVectorDocumentKey(item.id || item.title || 'unknown');
      return chunkText(item.article || '', chunkSize, chunkOverlap)
        .filter(content => content.trim().length > 0)
        .map((content, chunkId) => ({
          id: createBM25ChunkKey(filename, chunkId),
          content
        }));
    });

    initBM25Index(documents);
  } catch (error) {
    console.error('Failed to initialize BM25 index:', error);
  }
}

/**
 * /List
 * ，
 */
const STOP_WORDS = new Set([
  //
  '的', '了', '是', '在', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看',
  '好', '自己', '这', '那', '里', '就是', '为', '与', '之', '用', '可以',
  '但', '而', '或', '及', '等', '对', '把', '被', '让', '给', '从', '向',

  //
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
]);

/**
 * 
 * ，
 */
const SYNONYM_DICT: Record<string, string[]> = {
  // AI/
  'ai': ['人工智能', 'artificial intelligence', '机器学习', 'ml'],
  'llm': ['大语言模型', 'large language model', '语言模型'],
  'rag': ['检索增强生成', 'retrieval augmented generation'],
  'agent': ['智能体', '代理', '助手'],
  'embedding': ['Embed', '向量', '向量化'],
  'vector': ['向量', '矢量'],
  'prompt': ['提示词', '提示', '指令'],

  //
  '如何': ['怎么', '怎样', '如何做', '方法'],
  '怎么': ['如何', '怎样', '怎么操作'],
  '怎样': ['如何', '怎么', '怎样做'],
  '是什么': ['定义', '解释', '含义', '概念'],
  '为什么': ['原因', '为何', '理由'],
  '做什么': ['干什么', '做什么用', '作用'],
  '使用': ['应用', '运用', '采用', '利用'],
  '创建': ['建立', '新建', '生成', '构建'],
  '获取': ['得到', '获得', '取得'],
  '设置': ['配置', '设定', '修改'],
  '问题': ['疑问', '困难', '难题'],
  '解决': ['处理', '修复', '解答'],
};

/**
 * 
 */
function isStopWord(keyword: string): boolean {
  const cleanKeyword = keyword.trim().toLowerCase();
  return STOP_WORDS.has(cleanKeyword);
}

/**
 * 
 */
interface QueryVariant {
  original: string;  // 原始查询
  transformed: string; // 转换后的查询
  source: 'original' | 'synonym';
}

/**
 * 
 * @param query 
 * @param maxVariants 
 * @returns List
 */
function expandWithSynonyms(query: string, maxVariants: number = 3): QueryVariant[] {
  const variants: QueryVariant[] = [
    { original: query, transformed: query, source: 'original' }
  ];

  //
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  for (const word of words) {
    //
    const cleanWord = word.replace(/[^\w\u4e00-\u9fa5]/g, '');

    if (SYNONYM_DICT[cleanWord]) {
      const synonyms = SYNONYM_DICT[cleanWord];

      //
      for (const synonym of synonyms) {
        if (variants.length >= maxVariants) break;

        const transformed = queryLower.replace(new RegExp(cleanWord, 'gi'), synonym);

        //
        if (!variants.some(v => v.transformed === transformed)) {
          variants.push({
            original: query,
            transformed,
            source: 'synonym'
          });
        }
      }
    }

    if (variants.length >= maxVariants) break;
  }

  return variants;
}

/**
 * （）
 * @param keywords List
 * @param enableExpansion 
 * @param maxVariants 
 * @returns List
 */
function transformQueries(
  keywords: Keyword[],
  enableExpansion: boolean,
  maxVariants: number
): Keyword[] {
  if (!enableExpansion) {
    return keywords;
  }

  const expandedKeywords: Keyword[] = [];

  for (const keyword of keywords) {
    //
    const variants = expandWithSynonyms(keyword.text, maxVariants);

    // List
    for (const variant of variants) {
      //
      if (!expandedKeywords.some(k => k.text === variant.transformed)) {
        expandedKeywords.push({
          text: variant.transformed,
          weight: keyword.weight // 保持原始权重
        });
      }
    }
  }

  return expandedKeywords;
}

function normalizeKeywordWeights(keywords: Keyword[]): Keyword[] {
  const maxWeight = keywords.reduce((maximum, keyword) => (
    Math.max(maximum, Number.isFinite(keyword.weight) ? Math.max(0, keyword.weight) : 0)
  ), 0);
  return keywords.map(keyword => ({
    ...keyword,
    weight: maxWeight > 0
      ? Math.min(1, Math.max(0, keyword.weight) / maxWeight)
      : 1
  }));
}

/**
 * 
 * chunk File chunk，
 *
 * @param results 
 * @param windowSize （ N chunk）
 * @returns 
 */
async function expandWithSentenceWindow(
  results: Array<{ id: number; filename: string; content: string; similarity?: number }>,
  windowSize: number = 2
): Promise<Array<{ id: number; filename: string; content: string; similarity?: number }>> {
  // File
  const resultsByFile = new Map<string, typeof results>();
  for (const result of results) {
    if (!resultsByFile.has(result.filename)) {
      resultsByFile.set(result.filename, []);
    }
    resultsByFile.get(result.filename)!.push(result);
  }

  const expandedResults: typeof results = [];

  // File
  for (const [filename, fileResults] of resultsByFile.entries()) {
    try {
      // File（ chunk_id ）
      const allChunks = await getVectorDocumentsByFilename(filename);

      // chunk_id
      const chunkMap = new Map<number, VectorDocument>();
      for (const chunk of allChunks) {
        chunkMap.set(chunk.chunk_id, chunk);
      }

      //
      for (const result of fileResults) {
        // chunk_id
        let centerChunkId: number | undefined;

        // chunk_id
        for (const [chunkId, chunk] of chunkMap.entries()) {
          if (chunk.content === result.content) {
            centerChunkId = chunkId;
            break;
          }
        }

        if (centerChunkId === undefined) {
          // chunk，
          expandedResults.push(result);
          continue;
        }

        // chunk
        const windowContents: string[] = [];
        for (let i = centerChunkId - windowSize; i <= centerChunkId + windowSize; i++) {
          const chunk = chunkMap.get(i);
          if (chunk) {
            windowContents.push(chunk.content);
          }
        }

        //
        const expandedContent = windowContents.join('\n\n---\n\n');

        expandedResults.push({
          ...result,
          content: expandedContent
        });
      }
    } catch (error) {
      console.error(`Failed to expand sentence window for ${filename}:`, error);
      // Failed
      expandedResults.push(...fileResults);
    }
  }

  return expandedResults;
}

/**
 * BM25 
 * @param query 
 * @param limit 
 * @returns BM25 
 */
async function searchWithBM25(query: string, limit: number = 10): Promise<Array<{id: string, score: number, content: string}>> {
  const index = getBM25Index();
  if (!index) {
    console.warn('BM25 index not initialized; skipping BM25 search');
    return [];
  }

  return index.search(query, limit).flatMap(result => {
    const content = index.getDocument(result.id);
    return content === undefined ? [] : [{ ...result, content }];
  });
}

/**
 * MarkdownFile，
 */
export async function processMarkdownFile(
  filePath: string,
  fileContent?: string
): Promise<boolean> {
  try {
    // File skills File，
    const pathParts = filePath.split('/');
    if (pathParts.some(part => isSkillsFolder(part))) {
      return false;
    }

    const workspace = await getWorkspacePath()
    let content = ''
    if (workspace.isCustom) {
      content = fileContent || await readTextFile(filePath)
    } else {
      const { path, baseDir } = await getFilePathOptions(filePath)
      content = fileContent || await readTextFile(path, { baseDir })
    }
    const vectorDocumentKey = getVectorDocumentKey(filePath);
    const legacyFilename = filePath.split('/').pop() || filePath;
    // File，。
    if (!content || content.trim().length === 0) {
      await deleteVectorDocumentsByFilename(vectorDocumentKey);
      if (legacyFilename !== vectorDocumentKey) {
        await deleteVectorDocumentsByFilename(legacyFilename);
      }
      return true;
    }

    const store = await Store.load('store.json')
    const chunkSize = await store.get<number>('ragChunkSize');
    const chunkOverlap = await store.get<number>('ragChunkOverlap');
    const chunks = chunkText(content, chunkSize, chunkOverlap).filter(chunk => chunk.trim().length > 0);
    // ，。
    if (chunks.length === 0) {
      await deleteVectorDocumentsByFilename(vectorDocumentKey);
      if (legacyFilename !== vectorDocumentKey) {
        await deleteVectorDocumentsByFilename(legacyFilename);
      }
      return true;
    }
    const scope = await resolveRetrievalScope({}, store);
    if (!isPathAllowedForRag(vectorDocumentKey, scope)) {
      await deleteVectorDocumentsByFilename(vectorDocumentKey);
      if (legacyFilename !== vectorDocumentKey) {
        await deleteVectorDocumentsByFilename(legacyFilename);
      }
      return true;
    }

    const existingDocuments = await getVectorDocumentsByFilename(vectorDocumentKey);
    const existingChunks = existingDocuments
      .sort((a, b) => a.chunk_id - b.chunk_id)
      .map(document => document.content);
    if (
      existingChunks.length === chunks.length
      && generateContentHash(existingChunks.join('\u0000')) === generateContentHash(chunks.join('\u0000'))
    ) {
      getBM25Index()?.replaceByFilename(vectorDocumentKey, chunks);
      return true;
    }

    const embeddings: Array<number[] | null> = [];
    const embeddingBatchSize = 16;
    for (let offset = 0; offset < chunks.length; offset += embeddingBatchSize) {
      embeddings.push(...await fetchEmbeddings(chunks.slice(offset, offset + embeddingBatchSize)));
    }
    if (embeddings.length !== chunks.length || embeddings.some(embedding => !embedding)) {
      console.error(`Could not fully compute vectors for ${vectorDocumentKey}; keeping previous index`);
      return false;
    }

    // ，Failed。
    await deleteVectorDocumentsByFilename(vectorDocumentKey);
    if (legacyFilename !== vectorDocumentKey) {
      await deleteVectorDocumentsByFilename(legacyFilename);
    }

    //
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const embedding = embeddings[i];
      if (!embedding) continue;

      // Save
      await upsertVectorDocument({
        filename: vectorDocumentKey,
        chunk_id: i,
        content: chunk,
        embedding: JSON.stringify(embedding),
        updated_at: Date.now()
      });
    }

    const bm25Index = getBM25Index();
    if (bm25Index) {
      bm25Index.replaceByFilename(
        vectorDocumentKey,
        chunks
      );
    }

    return true;
  } catch (error) {
    console.error(`Failed to process file ${filePath}:`, error);
    return false;
  }
}

/**
 * 
 */
async function getWorkspaceFiles(): Promise<DirTree[]> {
  const workspace = await getWorkspacePath();
  
  //
  async function processDirectory(dirPath: string, useCustomPath: boolean): Promise<DirTree[]> {
    let entries: DirEntry[];
    
    if (useCustomPath) {
      entries = await readDir(dirPath);
    } else {
      entries = await readDir(dirPath, { baseDir: BaseDirectory.AppData });
    }
    
    const result: DirTree[] = [];
    
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name.startsWith('.')) continue;
      if (!entry.isDirectory && !entry.name.endsWith('.md')) continue;
      
      // DirTree
      const item: DirTree = {
        name: entry.name,
        isFile: !entry.isDirectory,
        isDirectory: entry.isDirectory,
        isSymlink: false, // Tauri FS API不直接提供isSymlink
        children: [],
        isLocale: true,
        isEditing: false
      };
      
      // ，
      if (entry.isDirectory) {
        const childPath = await join(dirPath, entry.name);
        //
        item.children = await processDirectory(childPath, useCustomPath);
        
        //
        item.children.forEach(child => {
          child.parent = item;
        });
      }
      
      result.push(item);
    }
    
    return result;
  }
  
  // Start
  const rootPath = workspace.isCustom ? workspace.path : 'article';
  return await processDirectory(rootPath, workspace.isCustom);
}

/**
 * MarkdownFile（）
 */
export async function processAllMarkdownFiles(onProgress?: (current: number, total: number, fileName: string) => void): Promise<{
  total: number;
  success: number;
  failed: number;
  failedFiles: Array<{fileName: string, error: string}>;
}> {
  try {
    // File
    const fileTree = await getWorkspaceFiles();
    const retrievalScope = await resolveRetrievalScope();

    // File
    const filesToProcess: Array<{name: string, path: string}> = [];

    async function collectFiles(tree: DirTree[]): Promise<void> {
      for (const item of tree) {
        if (item.isFile && item.name.endsWith('.md')) {
          const filePath = await getFilePath(item);
          if (isPathAllowedForRag(filePath, retrievalScope)) {
            filesToProcess.push({ name: item.name, path: filePath });
          }
        }

        //
        if (item.children && item.children.length > 0) {
          await collectFiles(item.children);
        }
      }
    }

    await collectFiles(fileTree);

    // File（ 3）
    const results = await runWithConcurrencyLimit(
      filesToProcess.map(file => async () => {
        try {
          const success = await processMarkdownFile(file.path);
          return { success, fileName: file.name, error: null };
        } catch (error) {
          handleRAGError(error, `Failed to process file ${file.name}`, false);
          return { success: false, fileName: file.name, error: String(error) };
        }
      }),
      3, // 并发限制为 3，避免过多 API 调用
      (completed, total, taskIndex) => {
        if (onProgress && completed > 0) {
          const currentFile = filesToProcess[taskIndex]?.name || '';
          onProgress(completed, total, currentFile);
        }
      }
    );

    //
    const failedFiles: Array<{fileName: string, error: string}> = [];
    let success = 0;
    let failed = 0;

    for (const result of results) {
      if (result.success) {
        success++;
      } else {
        failed++;
        if (result.error) {
          failedFiles.push({ fileName: result.fileName, error: result.error });
        }
      }
    }

    return {
      total: filesToProcess.length,
      success,
      failed,
      failedFiles
    };
  } catch (error) {
    handleRAGError(error, 'Failed to process workspace Markdown files');
    throw error;
  }
}

/**
 * DirTreeFile
 */
async function getFilePath(item: DirTree): Promise<string> {
  const workspace = await getWorkspacePath();
  let path = item.name;
  let parent = item.parent;
  
  //
  while (parent) {
    path = `${parent.name}/${path}`;
    parent = parent.parent;
  }
  
  //
  if (workspace.isCustom) {
    return await join(workspace.path, path);
  } else {
    return path; // 返回相对于AppData/article的路径
  }
}

/**
 * fuzzy_search
 */
interface SearchItem {
  id?: string;
  desc?: string;
  title?: string;
  article?: string;
  url?: string;
  search_type?: string;
  score?: number;
  matches?: {
    key: string;
    indices: [number, number][];
    value: string;
  }[];
}

/**
 * fuzzy_search
 */
interface FuzzySearchResult {
  item: SearchItem;
  refindex: number;
  score: number;
  matches: {
    key: string;
    indices: [number, number][];
    value: string;
  }[];
}

/**
 * MarkdownFile，
 */
async function collectMarkdownContents(scope: RetrievalScope = {}): Promise<SearchItem[]> {
  try {
    // File
    const fileTree = await getWorkspaceFiles();
    const items: SearchItem[] = [];
    const resolvedScope = await resolveRetrievalScope(scope);
    
    // File
    async function processTree(tree: DirTree[]): Promise<void> {
      for (const item of tree) {
        if (item.isFile && item.name.endsWith('.md')) {
          //
          const filePath = await getFilePath(item);
          if (!isPathAllowedForRag(filePath, resolvedScope)) continue;
          
          try {
            // File
            let content = '';
            const workspace = await getWorkspacePath();
            if (workspace.isCustom) {
              content = await readTextFile(filePath);
            } else {
              const { path, baseDir } = await getFilePathOptions(filePath);
              content = await readTextFile(path, { baseDir });
            }
            
            //
            items.push({
              id: filePath,
              title: item.name,
              article: content,
              search_type: 'markdown'
            });
          } catch (error) {
            console.error(`Failed to read file ${filePath}:`, error);
          }
        }
        
        //
        if (item.children && item.children.length > 0) {
          await processTree(item.children);
        }
      }
    }
    
    await processTree(fileTree);
    return items;
  } catch (error) {
    console.error('Failed to collect Markdown content:', error);
    return [];
  }
}

/**
 * 
 */
interface SearchResult {
  stableId: string;
  filename: string;
  filepath: string;
  content: string;
  rawScore: number;      // 原始分数（未归一化）
  normalizedScore: number; // 归一化后的分数
  rank: number;
  queryWeight: number;
  keyword?: string;
  type: 'fuzzy' | 'vector' | 'bm25';
  matchedTypes?: Array<'fuzzy' | 'vector' | 'bm25'>;
}

function createChunkStableId(filename: string, chunkId: number): string {
  return createBM25ChunkKey(filename, chunkId);
}

async function resolveSnippetToChunk(
  filepath: string,
  snippet: string
): Promise<{ stableId: string; filename: string; content: string }> {
  const filename = getVectorDocumentKey(filepath);
  const chunks = await getVectorDocumentsByFilename(filename);
  if (chunks.length === 0) {
    return {
      stableId: `${filename}::content::${generateContentHash(snippet)}`,
      filename,
      content: snippet
    };
  }

  const bestChunk = chunks.reduce((best, current) =>
    calculateContentOverlap(current.content, snippet) > calculateContentOverlap(best.content, snippet)
      ? current
      : best
  );
  return {
    stableId: createChunkStableId(filename, bestChunk.chunk_id),
    filename,
    content: bestChunk.content
  };
}

function buildLexicalQueries(query: string, keywords: Keyword[]): Keyword[] {
  const queries = [{ text: query.trim(), weight: 1 }, ...keywords];
  const unique = new Map<string, Keyword>();
  for (const item of queries) {
    const key = item.text.trim().toLocaleLowerCase();
    if (!key || isStopWord(key)) continue;
    const previous = unique.get(key);
    if (!previous || item.weight > previous.weight) {
      unique.set(key, { text: item.text.trim(), weight: item.weight });
    }
  }
  return Array.from(unique.values());
}

/**
 * 
 */
export interface Keyword {
  text: string;
  weight: number;
}

/**
 * RAG 
 */
export interface RagSource {
  filepath: string;  // File的相对路径
  filename: string;  // File名
  content: string;   // Quote的文本片段
}

export interface RagDiagnosticResult extends RagSource {
  rank: number;
  beforeRerankRank: number;
  fusedScore: number;
  finalScore: number;
  retrievers: Array<'fuzzy' | 'vector' | 'bm25'>;
}

export interface RagSearchResponse {
  context: string;
  sources: string[];
  sourceDetails: RagSource[];
  diagnostics: RagDiagnosticResult[];
}

/**
 * 
 * @param query ，
 * @param keywords ，、BM25 
 * @returns QuoteFile
 */
export async function getContextForQuery(
  query: string,
  keywords: Keyword[],
  scope: RetrievalScope = {}
): Promise<RagSearchResponse> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') ?? 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? 0.25;
    const rerankThreshold = await store.get<number>('ragRerankThreshold') ?? 0.1;

    // （）
    const fuzzyWeight = await store.get<number>('ragFuzzyWeight') ?? 0.2;
    const vectorWeight = await store.get<number>('ragVectorWeight') ?? 0.7;
    const bm25Weight = await store.get<number>('ragBm25Weight') ?? 0.1;

    const baseWeights = {
      fuzzyWeight,
      vectorWeight,
      bm25Weight
    };
    const strategy = createRetrievalStrategy(query, baseWeights, rerankThreshold);
    const resolvedScope = await resolveRetrievalScope(scope, store);

    // （ SearchResult ）
    const allResults: SearchResult[] = [];

    //
    if (!query.trim()) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    //
    const enableQueryExpansion = await store.get<boolean>('ragEnableQueryExpansion') ?? true;
    const maxQueryVariations = await store.get<number>('ragMaxQueryVariations') ?? 3;

    // （）
    const expandedKeywords = normalizeKeywordWeights(
      transformQueries(keywords || [], enableQueryExpansion, maxQueryVariations)
    );

    // ，
    const sortedKeywords = [...expandedKeywords].sort((a, b) => b.weight - a.weight);
    const lexicalQueries = buildLexicalQueries(query, sortedKeywords);
    const items = await collectMarkdownContents(resolvedScope);
    const allowedVectorKeys = new Set(items.map(item => getVectorDocumentKey(item.id || item.title || '')));

    // 1. File
    try {
      if (items.length > 0) {
        //
        for (const keyword of sortedKeywords) {
          // （）
          if (isStopWord(keyword.text)) {
            continue;
          }

          // Rustfuzzy_search
          const fuzzyResults: FuzzySearchResult[] = await invoke('fuzzy_search', {
            items,
            query: keyword.text,  // 单独使用每个关键词
            keys: ['title', 'article'],
            threshold: strategy.fuzzyThreshold,
            includeScore: true,
            includeMatches: true
          });

          //
          for (const [resultIndex, result] of fuzzyResults.entries()) {
            if (result.score > 0) {
              const item = result.item;
              //
              const articleMatches = result.matches.filter(m => m.key === 'article');
              if (articleMatches.length > 0) {
                // （500）
                const match = articleMatches[0];
                const content = match.value;

                //
                let startIdx = 0;
                let endIdx = content.length;
                if (match.indices.length > 0) {
                  const firstMatch = match.indices[0];
                  startIdx = Math.max(0, firstMatch[0] - 250);
                  endIdx = Math.min(content.length, firstMatch[1] + 250);
                }

                const contextSnippet = content.substring(startIdx, endIdx);
                const filepath = item.id || item.title || 'Untitled file';
                const resolvedChunk = await resolveSnippetToChunk(filepath, contextSnippet);

                allResults.push({
                  stableId: resolvedChunk.stableId,
                  filename: resolvedChunk.filename,
                  filepath: resolvedChunk.filename,
                  content: resolvedChunk.content,
                  rawScore: result.score,
                  normalizedScore: 0, // 稍后计算
                  rank: resultIndex + 1,
                  queryWeight: keyword.weight,
                  keyword: keyword.text,
                  type: 'fuzzy'
                });
              }
            }
          }
        }
      }
    } catch (error) {
      handleRAGError(error, 'Fuzzy search failed', false);
    }

    // 2. ，
    try {
      const queryEmbedding = await getQueryEmbedding(query);

      if (queryEmbedding) {
        const vectorCandidateCount = Math.max(resultCount * strategy.vectorCandidateMultiplier, 20);
        const similarDocs = await getSimilarDocuments(
          queryEmbedding,
          vectorCandidateCount,
          similarityThreshold,
          allowedVectorKeys
        );

        for (const [docIndex, doc] of similarDocs.entries()) {
          allResults.push({
            stableId: createChunkStableId(doc.filename, doc.chunk_id),
            filename: doc.filename,
            filepath: doc.filename,
            content: doc.content,
            rawScore: doc.similarity || 0,
            normalizedScore: 0,
            rank: docIndex + 1,
            queryWeight: 1,
            type: 'vector'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'Vector search failed', false);
    }

    // 3. BM25
    try {
      for (const lexicalQuery of lexicalQueries) {
        const bm25Results = await searchWithBM25(
          lexicalQuery.text,
          Math.max(resultCount * strategy.lexicalCandidateMultiplier, 20)
        );

        for (const [resultIndex, result] of bm25Results.entries()) {
          const chunkKey = parseBM25ChunkKey(result.id);
          if (!chunkKey || !allowedVectorKeys.has(chunkKey.filename)) continue;
          allResults.push({
            stableId: result.id,
            filename: chunkKey.filename,
            filepath: chunkKey.filename,
            content: result.content,
            rawScore: result.score,
            normalizedScore: 0,
            rank: resultIndex + 1,
            queryWeight: lexicalQuery.weight,
            keyword: lexicalQuery.text,
            type: 'bm25'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'BM25 search failed', false);
    }

    // ，
    if (allResults.length === 0) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    const windowSize = await store.get<number>('ragWindowSize') ?? 2;
    return await finalizeSearchResults(query, allResults, strategy, resultCount, windowSize);
  } catch (error) {
    handleRAGError(error, 'Failed to get query context', false);
    return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
  }
}

/**
 * 
 * @param results 
 * @param weights 
 */
function mergeResultsByDocument(
  results: SearchResult[],
  weights: {
    fuzzyWeight: number;
    vectorWeight: number;
    bm25Weight: number;
  }
): SearchResult[] {
  const docGroups = new Map<string, SearchResult[]>();

  for (const result of results) {
    if (!docGroups.has(result.stableId)) {
      docGroups.set(result.stableId, []);
    }
    docGroups.get(result.stableId)!.push(result);
  }

  const mergedResults: SearchResult[] = [];
  const sanitizedWeights = {
    fuzzy: Math.max(0, weights.fuzzyWeight),
    vector: Math.max(0, weights.vectorWeight),
    bm25: Math.max(0, weights.bm25Weight)
  };
  const totalWeight = sanitizedWeights.fuzzy + sanitizedWeights.vector + sanitizedWeights.bm25;
  const weightByType = totalWeight > 0
    ? {
        fuzzy: sanitizedWeights.fuzzy / totalWeight,
        vector: sanitizedWeights.vector / totalWeight,
        bm25: sanitizedWeights.bm25 / totalWeight
      }
    : { fuzzy: 1 / 3, vector: 1 / 3, bm25: 1 / 3 };
  const maxRawScoreByType = new Map<SearchResult['type'], number>();
  const maxQueryWeightByType = new Map<SearchResult['type'], number>();
  for (const result of results) {
    maxRawScoreByType.set(
      result.type,
      Math.max(maxRawScoreByType.get(result.type) || 0, Math.max(0, result.rawScore))
    );
    maxQueryWeightByType.set(
      result.type,
      Math.max(maxQueryWeightByType.get(result.type) || 0, Math.max(0, result.queryWeight))
    );
  }
  const reciprocalRankConstant = 20;
  const rankBlend = 0.75;

  for (const group of docGroups.values()) {
    const bestContributionByType = new Map<SearchResult['type'], number>();
    for (const result of group) {
      const normalizedRank = (reciprocalRankConstant + 1)
        / (reciprocalRankConstant + Math.max(1, result.rank));
      const maxRawScore = maxRawScoreByType.get(result.type) || 0;
      const normalizedConfidence = maxRawScore > 0
        ? Math.min(1, Math.max(0, result.rawScore) / maxRawScore)
        : 0;
      const maxQueryWeight = maxQueryWeightByType.get(result.type) || 1;
      const normalizedQueryWeight = Math.min(1, Math.max(0, result.queryWeight) / maxQueryWeight);
      const contribution = weightByType[result.type]
        * (rankBlend * normalizedRank + (1 - rankBlend) * normalizedConfidence)
        * normalizedQueryWeight;
      bestContributionByType.set(
        result.type,
        Math.max(bestContributionByType.get(result.type) || 0, contribution)
      );
    }
    const hybridScore = Array.from(bestContributionByType.values())
      .reduce((total, contribution) => total + contribution, 0);
    const bestResult = group.find(result => result.type === 'vector') || group[0];
    const keywords = Array.from(new Set(group.flatMap(result => result.keyword ? [result.keyword] : [])));

    mergedResults.push({
      ...bestResult,
      rawScore: hybridScore,
      normalizedScore: hybridScore,
      keyword: keywords.join(', '),
      matchedTypes: Array.from(new Set(group.map(result => result.type)))
    });
  }

  return mergedResults;
}

/**
 * （）
 */
function calculateContentOverlap(content1: string, content2: string): number {
  const normalized1 = content1.trim().toLowerCase();
  const normalized2 = content2.trim().toLowerCase();

  // ， 0
  if (!normalized1 || !normalized2) return 0;

  // ：
  const set1 = new Set(normalized1.split(''));
  const set2 = new Set(normalized2.split(''));

  const intersection = new Set([...set1].filter(char => set2.has(char)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  // Jaccard
  return intersection.size / union.size;
}

/**
 * 、，。
 * Done，。
 */
async function finalizeSearchResults(
  query: string,
  allResults: SearchResult[],
  strategy: RetrievalStrategy,
  resultCount: number,
  windowSize: number
): Promise<RagSearchResponse> {
  const mergedResults = mergeResultsByDocument(allResults, strategy.weights);
  const uniqueResults: SearchResult[] = [];
  const mergedIndices = new Set<number>();

  for (let i = 0; i < mergedResults.length; i++) {
    if (mergedIndices.has(i)) continue;

    const current = mergedResults[i];
    let bestResult = current;
    const mergedKeywords = new Set<string>();

    if (current.keyword) {
      mergedKeywords.add(current.keyword);
    }

    for (let j = i + 1; j < mergedResults.length; j++) {
      if (mergedIndices.has(j)) continue;

      const other = mergedResults[j];
      if (other.filename !== current.filename) continue;

      if (calculateContentOverlap(current.content, other.content) > 0.7) {
        mergedIndices.add(j);
        if (other.normalizedScore > bestResult.normalizedScore) {
          bestResult = other;
        }
        if (other.keyword) {
          mergedKeywords.add(other.keyword);
        }
      }
    }

    uniqueResults.push({
      ...bestResult,
      keyword: Array.from(mergedKeywords).join(', ')
    });
  }

  uniqueResults.sort((a, b) => b.normalizedScore - a.normalizedScore);

  // ，。
  const rerankCandidateCount = Math.max(
    resultCount * Math.max(strategy.vectorCandidateMultiplier, strategy.lexicalCandidateMultiplier),
    20
  );
  const perRetrieverCandidateCount = Math.max(resultCount, 5);
  const uniqueResultById = new Map(uniqueResults.map(result => [result.stableId, result]));
  const selectedCandidateIds = new Set<string>();

  for (const type of ['vector', 'bm25', 'fuzzy'] as const) {
    const typeResults = allResults
      .filter(result => result.type === type)
      .sort((a, b) => a.rank - b.rank);
    const selectedForType = new Set<string>();
    for (const result of typeResults) {
      if (!uniqueResultById.has(result.stableId) || selectedForType.has(result.stableId)) continue;
      selectedForType.add(result.stableId);
      selectedCandidateIds.add(result.stableId);
      if (selectedForType.size >= perRetrieverCandidateCount) break;
    }
  }

  for (const result of uniqueResults) {
    if (selectedCandidateIds.size >= rerankCandidateCount) break;
    selectedCandidateIds.add(result.stableId);
  }

  // rerank Failed，，。
  const rerankCandidates = uniqueResults
    .filter(result => selectedCandidateIds.has(result.stableId))
    .slice(0, rerankCandidateCount);
  const fusedRankById = new Map(rerankCandidates.map((result, index) => [result.stableId, index + 1]));
  const fusedScoreById = new Map(rerankCandidates.map(result => [result.stableId, result.normalizedScore]));
  const rerankDocumentsInput = rerankCandidates.map((result, index) => ({
    id: index,
    filename: result.filename,
    content: result.content,
    similarity: result.normalizedScore
  }));
  const rerankedDocuments = await rerankDocuments(
    query,
    rerankDocumentsInput,
    strategy.rerankThreshold
  );
  let finalResults = rerankedDocuments.slice(0, resultCount).map(document => ({
    ...rerankCandidates[document.id],
    rawScore: document.similarity,
    normalizedScore: document.similarity
  }));

  // ，。
  const chunkResults = finalResults.flatMap((result, index) => parseBM25ChunkKey(result.stableId)
    ? [{
        id: index,
        filename: result.filename,
        content: result.content,
        similarity: result.normalizedScore
      }]
    : []
  );

  if (chunkResults.length > 0 && windowSize > 0) {
    const expandedVectorResults = await expandWithSentenceWindow(chunkResults, windowSize);
    const expandedContentByIndex = new Map(
      expandedVectorResults.map(result => [result.id, result.content])
    );

    finalResults = finalResults.map((result, index) => ({
      ...result,
      content: expandedContentByIndex.get(index) ?? result.content
    }));
  }

  const sources = Array.from(new Set(finalResults.map(result => getRagDisplayFilename(result.filepath))));
  const sourceDetailsMap = new Map<string, RagSource>();

  for (const result of finalResults) {
    if (!sourceDetailsMap.has(result.filepath)) {
      sourceDetailsMap.set(result.filepath, {
        filepath: result.filepath,
        filename: getRagDisplayFilename(result.filepath),
        content: result.content
      });
    }
  }

  const sourceDetails = Array.from(sourceDetailsMap.values());
  const diagnostics = finalResults.map((result, index): RagDiagnosticResult => ({
    rank: index + 1,
    beforeRerankRank: fusedRankById.get(result.stableId) || index + 1,
    fusedScore: fusedScoreById.get(result.stableId) || result.normalizedScore,
    finalScore: result.normalizedScore,
    retrievers: result.matchedTypes || [result.type],
    filepath: result.filepath,
    filename: getRagDisplayFilename(result.filepath),
    content: result.content
  }));
  const context = finalResults.map(result => `File: ${normalizeRagPath(result.filepath)}
${result.content}
`).join('\n---\n\n');

  return { context, sources, sourceDetails, diagnostics };
}

/**
 * Handle file updates by refreshing the vector database
 */
export async function handleFileUpdate(filePath: string, content: string): Promise<void> {
  if (!filePath.endsWith('.md')) return;

  try {
    await processMarkdownFile(filePath, content);
  } catch (error) {
    handleRAGError(error, `Failed to update vectors for ${filePath}`, false);
  }
}

/**
 * Embed
 */
export async function checkEmbeddingModelAvailable(): Promise<boolean> {
  try {
    //
    const embedding = await fetchEmbedding('test embedding model');
    return !!embedding;
  } catch (error) {
    handleRAGError(error, 'Embedding model check failed', false);
    return false;
  }
}

/**
 * Vector processingtoast
 */
export function showVectorProcessingToast(message: string) {
  toast({
    title: 'Vector database update',
    description: message,
  });
}

/**
 * FileMarkdownFile
 */
async function collectMarkdownContentsInFolder(
  folderPath: string,
  scope: RetrievalScope = {}
): Promise<SearchItem[]> {
  try {
    const workspace = await getWorkspacePath();
    const items: SearchItem[] = [];
    const resolvedScope = await resolveRetrievalScope(scope);

    // File
    let fullFolderPath: string;
    if (workspace.isCustom) {
      fullFolderPath = await join(workspace.path, folderPath);
    } else {
      fullFolderPath = folderPath;
    }

    // File
    async function processTree(dirPath: string, relativePath: string): Promise<void> {
      let currentEntries: DirEntry[];

      if (workspace.isCustom) {
        currentEntries = await readDir(dirPath);
      } else {
        const { path, baseDir } = await getFilePathOptions(relativePath);
        currentEntries = await readDir(path, { baseDir });
      }

      for (const entry of currentEntries) {
        if (entry.name.startsWith('.')) continue;

        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const ragPath = workspace.isCustom ? await join(dirPath, entry.name) : entryRelativePath;
        if (!isPathAllowedForRag(ragPath, resolvedScope)) continue;

        if (entry.isDirectory) {
          const entryFullPath = workspace.isCustom
            ? await join(dirPath, entry.name)
            : entryRelativePath;
          await processTree(entryFullPath, entryRelativePath);
        } else if (entry.name.endsWith('.md')) {
          // File items
          try {
            let content = '';
            const entryFullPath = workspace.isCustom
              ? await join(dirPath, entry.name)
              : entryRelativePath;

            if (workspace.isCustom) {
              content = await readTextFile(entryFullPath);
            } else {
              const { path, baseDir } = await getFilePathOptions(entryRelativePath);
              content = await readTextFile(path, { baseDir });
            }

            items.push({
              id: workspace.isCustom ? entryFullPath : entryRelativePath,
              title: entry.name,
              article: content,
              search_type: 'markdown'
            });
          } catch (error) {
            console.error(`Failed to read file ${entryRelativePath}:`, error);
          }
        }
      }
    }

    await processTree(fullFolderPath, folderPath);
    return items;
  } catch (error) {
    console.error('Failed to collect folder Markdown content:', error);
    return [];
  }
}

/**
 * 
 * @param query 
 * @param keywords ，
 * @param folderPath 
 * @returns 
 */
export async function getContextForQueryInFolder(
  query: string,
  keywords: Keyword[],
  folderPath: string
): Promise<RagSearchResponse> {
  try {
    const store = await Store.load('store.json');
    const resultCount = await store.get<number>('ragResultCount') ?? 5;
    const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? 0.25;
    const rerankThreshold = await store.get<number>('ragRerankThreshold') ?? 0.1;

    //
    const fuzzyWeight = await store.get<number>('ragFuzzyWeight') ?? 0.2;
    const vectorWeight = await store.get<number>('ragVectorWeight') ?? 0.7;
    const bm25Weight = await store.get<number>('ragBm25Weight') ?? 0.1;

    const baseWeights = {
      fuzzyWeight,
      vectorWeight,
      bm25Weight
    };
    const strategy = createRetrievalStrategy(query, baseWeights, rerankThreshold);

    const allResults: SearchResult[] = [];

    if (!query.trim()) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    //
    const enableQueryExpansion = await store.get<boolean>('ragEnableQueryExpansion') ?? true;
    const maxQueryVariations = await store.get<number>('ragMaxQueryVariations') ?? 3;

    // （）
    const expandedKeywords = normalizeKeywordWeights(
      transformQueries(keywords || [], enableQueryExpansion, maxQueryVariations)
    );

    const sortedKeywords = [...expandedKeywords].sort((a, b) => b.weight - a.weight);
    const lexicalQueries = buildLexicalQueries(query, sortedKeywords);

    //
    const items = await collectMarkdownContentsInFolder(folderPath);
    const folderVectorKeys = new Set(items.map(item => getVectorDocumentKey(item.id || item.title || '')));

    // 1. （）
    try {
      if (items.length > 0) {
        for (const keyword of sortedKeywords) {
          //
          if (isStopWord(keyword.text)) {
            continue;
          }

          const fuzzyResults: FuzzySearchResult[] = await invoke('fuzzy_search', {
            items,
            query: keyword.text,
            keys: ['title', 'article'],
            threshold: strategy.fuzzyThreshold,
            includeScore: true,
            includeMatches: true
          });

          for (const [resultIndex, result] of fuzzyResults.entries()) {
            if (result.score > 0) {
              const item = result.item;
              const articleMatches = result.matches.filter(m => m.key === 'article');
              if (articleMatches.length > 0) {
                const match = articleMatches[0];
                const content = match.value;

                let startIdx = 0;
                let endIdx = content.length;
                if (match.indices.length > 0) {
                  const firstMatch = match.indices[0];
                  startIdx = Math.max(0, firstMatch[0] - 250);
                  endIdx = Math.min(content.length, firstMatch[1] + 250);
                }

                const contextSnippet = content.substring(startIdx, endIdx);
                const filepath = item.id || item.title || 'Untitled file';
                const resolvedChunk = await resolveSnippetToChunk(filepath, contextSnippet);

                allResults.push({
                  stableId: resolvedChunk.stableId,
                  filename: resolvedChunk.filename,
                  filepath: resolvedChunk.filename,
                  content: resolvedChunk.content,
                  rawScore: result.score,
                  normalizedScore: 0,
                  rank: resultIndex + 1,
                  queryWeight: keyword.weight,
                  keyword: keyword.text,
                  type: 'fuzzy'
                });
              }
            }
          }
        }
      }
    } catch (error) {
      handleRAGError(error, 'Fuzzy search failed', false);
    }

    // 2. ，
    try {
      const queryEmbedding = await getQueryEmbedding(query);
      if (queryEmbedding) {
        const vectorCandidateCount = Math.max(resultCount * strategy.vectorCandidateMultiplier, 20);
        const similarDocs = (await getSimilarDocuments(
          queryEmbedding,
          vectorCandidateCount,
          similarityThreshold,
          folderVectorKeys
        ));

        for (const [docIndex, doc] of similarDocs.entries()) {
          allResults.push({
            stableId: createChunkStableId(doc.filename, doc.chunk_id),
            filename: doc.filename,
            filepath: doc.filename,
            content: doc.content,
            rawScore: doc.similarity || 0,
            normalizedScore: 0,
            rank: docIndex + 1,
            queryWeight: 1,
            type: 'vector'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'Vector search failed', false);
    }

    // 3. BM25 （）
    try {
      for (const lexicalQuery of lexicalQueries) {
        const bm25Results = await searchWithBM25(
          lexicalQuery.text,
          Math.max(resultCount * strategy.lexicalCandidateMultiplier, 20)
        );

        for (const [resultIndex, result] of bm25Results.entries()) {
          const chunkKey = parseBM25ChunkKey(result.id);
          if (!chunkKey || !folderVectorKeys.has(chunkKey.filename)) continue;
          allResults.push({
            stableId: result.id,
            filename: chunkKey.filename,
            filepath: chunkKey.filename,
            content: result.content,
            rawScore: result.score,
            normalizedScore: 0,
            rank: resultIndex + 1,
            queryWeight: lexicalQuery.weight,
            keyword: lexicalQuery.text,
            type: 'bm25'
          });
        }
      }
    } catch (error) {
      handleRAGError(error, 'BM25 search failed', false);
    }

    // ，
    if (allResults.length === 0) {
      return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
    }

    const windowSize = await store.get<number>('ragWindowSize') ?? 2;
    return await finalizeSearchResults(query, allResults, strategy, resultCount, windowSize);
  } catch (error) {
    handleRAGError(error, 'Failed to get folder query context', false);
    return { context: '', sources: [], sourceDetails: [], diagnostics: [] };
  }
}
