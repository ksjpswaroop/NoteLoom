/**
 * BM25 retrieval module
 * Chinese-friendly BM25 implementation without an external tokenizer
 */

/**
 * Document item shape
 */
export interface BM25Document {
  id: string;           // Document unique id (usually filename)
  content: string;      // Document content
}

/**
 * Search result
 */
export interface BM25Result {
  id: string;           // Document id
  score: number;        // BM25 score
}

const CHUNK_KEY_SEPARATOR = '::rag-chunk::';

export function createBM25ChunkKey(filename: string, chunkId: number): string {
  return `${filename}${CHUNK_KEY_SEPARATOR}${chunkId}`;
}

export function parseBM25ChunkKey(id: string): { filename: string; chunkId: number } | null {
  const separatorIndex = id.lastIndexOf(CHUNK_KEY_SEPARATOR);
  if (separatorIndex < 0) return null;

  const chunkId = Number(id.slice(separatorIndex + CHUNK_KEY_SEPARATOR.length));
  if (!Number.isInteger(chunkId) || chunkId < 0) return null;

  return { filename: id.slice(0, separatorIndex), chunkId };
}

/**
 * BM25 index class
 */
export class BM25Index {
  private documents: Map<string, string> = new Map(); // id -> content
  private docVectors: Map<string, Map<string, number>> = new Map(); // id -> token -> frequency
  private idfCache: Map<string, number> = new Map(); // token -> IDF
  private docLengths: Map<string, number> = new Map(); // id -> document length
  private averageDocLength: number = 0;

  // BM25 parameters
  private k1: number;  // term-frequency saturation parameter
  private b: number;   // length normalization parameter

  constructor(k1: number = 1.2, b: number = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  getStats(): { chunkCount: number; documentCount: number } {
    const filenames = new Set<string>();
    for (const id of this.documents.keys()) {
      filenames.add(parseBM25ChunkKey(id)?.filename || id);
    }
    return {
      chunkCount: this.documents.size,
      documentCount: filenames.size
    };
  }

  /**
   * Multilingual tokenization: keep words/numbers for spaced languages; emit character bigrams for CJK/Hangul runs.
   * This does not depend on a language-specific dictionary and can also match numbers, Japanese, and Arabic.
   */
  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    const normalized = text.normalize('NFKC').toLowerCase();
    const pattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const token = match[0];
      if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(token)) {
        const characters = Array.from(token);
        if (characters.length === 1) {
          tokens.push(token);
        } else {
          for (let index = 0; index < characters.length - 1; index++) {
            tokens.push(characters[index] + characters[index + 1]);
          }
        }
      } else {
        tokens.push(token);
        if (token.includes('-') || token.includes('_')) {
          tokens.push(...token.split(/[-_]+/).filter(Boolean));
        }
      }
    }

    return tokens;
  }

  /**
   * Build the index
   * @param documents document list
   */
  index(documents: BM25Document[]): void {
    // Clear existing index
    this.documents.clear();
    this.docVectors.clear();
    this.idfCache.clear();
    this.docLengths.clear();

    const N = documents.length;
    let totalLength = 0;

    // 1. Process each document
    for (const doc of documents) {
      const tokens = this.tokenize(doc.content);
      const tokenFreq = new Map<string, number>();

      // Compute term frequencies
      for (const token of tokens) {
        tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1);
      }

      // Store documents and term-frequency vectors
      this.documents.set(doc.id, doc.content);
      this.docVectors.set(doc.id, tokenFreq);
      this.docLengths.set(doc.id, tokens.length);
      totalLength += tokens.length;
    }

    // 2. Compute average document length
    this.averageDocLength = N > 0 ? totalLength / N : 0;

    // 3. Compute IDF
    this.calculateIDF(N);
  }

  /**
   * Compute IDF (inverse document frequency)
   * @param N total document count
   */
  private calculateIDF(N: number): void {
    // Count how many documents contain each token
    const docFreq = new Map<string, number>();

    for (const [, tokenFreq] of this.docVectors.entries()) {
      for (const token of tokenFreq.keys()) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    for (const [token, df] of docFreq.entries()) {
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      this.idfCache.set(token, idf);
    }
  }

  /**
   * Search
   * @param query query text
   * @param limit result limit
   * @returns ranked search results
   */
  search(query: string, limit: number = 10): BM25Result[] {
    const queryTokens = this.tokenize(query);

    const results: Map<string, number> = new Map();

    // Score each document with BM25
    for (const [docId, docVector] of this.docVectors.entries()) {
      const docLength = this.docLengths.get(docId) || 0;
      let score = 0;

      // BM25 formula:
      // score = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgDl))
      for (const token of queryTokens) {
        // Skip tokens absent from the document
        const freq = docVector.get(token) || 0;
        if (freq === 0) continue;

        // Get IDF
        const idf = this.idfCache.get(token) || 0;

        // Compute BM25 score component
        const numerator = freq * (this.k1 + 1);
        const denominator = freq + this.k1 * (1 - this.b + this.b * (docLength / this.averageDocLength));
        const componentScore = idf * (numerator / denominator);

        score += componentScore;
      }

      if (score > 0) {
        results.set(docId, score);
      }
    }

    // Sort by score descending
    const sortedResults = Array.from(results.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));

    return sortedResults;
  }

  /**
   * Update a single document
   * @param document document to update
   */
  update(document: BM25Document): void {
    const documents = new Map(this.documents);
    documents.set(document.id, document.content);
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  replaceByFilename(filename: string, chunks: string[]): void {
    const documents = new Map(this.documents);
    for (const id of documents.keys()) {
      if (parseBM25ChunkKey(id)?.filename === filename || id === filename) {
        documents.delete(id);
      }
    }
    chunks.forEach((content, chunkId) => {
      documents.set(createBM25ChunkKey(filename, chunkId), content);
    });
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  deleteByFilename(filename: string): void {
    this.replaceByFilename(filename, []);
  }

  deleteByFilenamePrefix(prefix: string): void {
    const documents = new Map(this.documents);
    for (const id of documents.keys()) {
      const filename = parseBM25ChunkKey(id)?.filename;
      if (filename && (filename === prefix || filename.startsWith(`${prefix}/`))) {
        documents.delete(id);
      }
    }
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  renameFilename(oldFilename: string, newFilename: string): void {
    if (oldFilename === newFilename) return;
    const chunks = Array.from(this.documents.entries())
      .flatMap(([id, content]) => {
        const parsed = parseBM25ChunkKey(id);
        return parsed?.filename === oldFilename ? [{ chunkId: parsed.chunkId, content }] : [];
      })
      .sort((a, b) => a.chunkId - b.chunkId)
      .map(chunk => chunk.content);
    this.deleteByFilename(oldFilename);
    if (chunks.length > 0) {
      this.replaceByFilename(newFilename, chunks);
    }
  }

  renameFilenamePrefix(oldPrefix: string, newPrefix: string): void {
    const documents = new Map(this.documents);
    for (const [id, content] of this.documents.entries()) {
      const parsed = parseBM25ChunkKey(id);
      if (parsed && (parsed.filename === oldPrefix || parsed.filename.startsWith(`${oldPrefix}/`))) {
        documents.delete(id);
        const suffix = parsed.filename.slice(oldPrefix.length);
        documents.set(createBM25ChunkKey(`${newPrefix}${suffix}`, parsed.chunkId), content);
      }
    }
    this.index(Array.from(documents, ([id, content]) => ({ id, content })));
  }

  getDocument(docId: string): string | undefined {
    return this.documents.get(docId);
  }

  /**
   * Delete document
   * @param docId Document id
   */
  delete(docId: string): void {
    if (!this.documents.has(docId)) {
      return;
    }

    // Delete document
    this.documents.delete(docId);
    this.docVectors.delete(docId);
    this.docLengths.delete(docId);

    // Recalculate IDF because document frequencies changed
    this.calculateIDF(this.documents.size);

    // Recalculate average document length
    const totalLength = Array.from(this.docLengths.values()).reduce((a, b) => a + b, 0);
    this.averageDocLength = this.documents.size > 0 ? totalLength / this.documents.size : 0;
  }

  /**
   * Get document count in the index
   */
  size(): number {
    return this.documents.size;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear();
    this.docVectors.clear();
    this.idfCache.clear();
    this.docLengths.clear();
    this.averageDocLength = 0;
  }
}

/**
 * Global BM25 index instance
 */
let globalBM25Index: BM25Index | null = null;

/**
 * Initialize the global BM25 index
 * @param documents document list
 */
export function initBM25Index(documents: BM25Document[]): BM25Index {
  if (!globalBM25Index) {
    globalBM25Index = new BM25Index();
  }
  globalBM25Index.index(documents);
  return globalBM25Index;
}

/**
 * Get the global BM25 index
 */
export function getBM25Index(): BM25Index | null {
  return globalBM25Index;
}

/**
 * Clear the global BM25 index
 */
export function clearBM25Index(): void {
  if (globalBM25Index) {
    globalBM25Index.clear();
    globalBM25Index = null;
  }
}
