import { Store } from "@tauri-apps/plugin-store";
import { AiConfig } from "@/app/core/setting/config";
import { handleAIError } from "./utils";
import { invokeAiJson, resolveAiRequestConfig } from "./tauri-client";

//
interface EmbeddingResponse {
  object: string;
  model: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface RerankResponse {
  results: Array<{
    relevance_score?: number;
    score?: number;
    document_index?: number;
    index?: number;
  }>;
}

/**
 * 
 */
export async function getEmbeddingModelInfo() {
  const store = await Store.load('store.json');
  const embeddingModel = await store.get<string>('embeddingModel');
  if (!embeddingModel) return null;
  
  const aiModelList = await store.get<AiConfig[]>('aiModelList');
  if (!aiModelList) return null;
  
  // ，ID
  for (const config of aiModelList) {
    // models
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.id === embeddingModel && model.modelType === 'embedding'
      );
      if (targetModel) {
        // AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        };
      }
    } else {
      // ：
      if (config.key === embeddingModel && config.modelType === 'embedding') {
        return config;
      }
    }
  }
  
  return null;
}

export async function getEmbeddingModelDescriptor(): Promise<{
  id: string
  model: string
} | null> {
  const modelInfo = await getEmbeddingModelInfo()
  if (!modelInfo?.model) return null
  return {
    id: modelInfo.key,
    model: `${modelInfo.key}:${modelInfo.model}`,
  }
}

/**
 * 
 */
export async function getRerankModelInfo() {
  const store = await Store.load('store.json');
  const rerankModel = await store.get<string>('rerankingModel');
  if (!rerankModel) return null;
  
  const aiModelList = await store.get<AiConfig[]>('aiModelList');
  if (!aiModelList) return null;
  
  // ，ID
  for (const config of aiModelList) {
    // models
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.id === rerankModel && model.modelType === 'rerank'
      );
      if (targetModel) {
        // AiConfig
        return {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        };
      }
    } else {
      // ：
      if (config.key === rerankModel && config.modelType === 'rerank') {
        return config;
      }
    }
  }
  
  return null;
}

/**
 * 
 */
export async function checkRerankModelAvailable(): Promise<boolean> {
  try {
    //
    const modelInfo = await getRerankModelInfo();
    if (!modelInfo) return false;
    
    const { baseURL, model } = modelInfo;
    if (!baseURL || !model) return false;
    
    //
    const testQuery = 'Test query';
    const testDocuments = [
      'This is a test document', 
      'This is another test document'
    ];
    
    //
    const data = await invokeAiJson<RerankResponse>({
      config: await resolveAiRequestConfig(modelInfo),
      path: '/rerank',
      method: 'POST',
      body: {
        model,
        query: testQuery,
        documents: testDocuments,
      }
    });
    return !!(data && data.results);
  } catch (error) {
    console.error('Rerank model check failed:', error);
    return false;
  }
}

/**
 * 
 * @param text 
 * @returns ，null
 */
export async function fetchEmbedding(
  text: string,
  options?: { silent?: boolean }
): Promise<number[] | null> {
  try {
    if (text.length) {
      //
      const modelInfo = await getEmbeddingModelInfo();
      if (!modelInfo) {
        throw new Error('Embedding model not configured or misconfigured');
      }
      
      const { baseURL, model } = modelInfo;

      if (!baseURL || !model) {
        throw new Error('Embedding model configuration incomplete');
      }
      
      //
      const data = await invokeAiJson<EmbeddingResponse>({
        config: await resolveAiRequestConfig(modelInfo),
        path: '/embeddings',
        method: 'POST',
        body: {
          model,
          input: text,
          encoding_format: 'float'
        }
      });
      if (!data || !data.data || !data.data[0] || !data.data[0].embedding) {
        throw new Error('Invalid embedding result format');
      }
      
      return data.data[0].embedding;
    }
    
    return null;
  } catch (error) {
    handleAIError(error, !options?.silent);
    return null;
  }
}

/**
 * 。，。
 */
export async function fetchEmbeddings(texts: string[]): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await fetchEmbedding(texts[0])];

  try {
    const modelInfo = await getEmbeddingModelInfo();
    if (!modelInfo?.baseURL || !modelInfo.model) {
      return await Promise.all(texts.map(text => fetchEmbedding(text)));
    }

    const data = await invokeAiJson<EmbeddingResponse>({
      config: await resolveAiRequestConfig(modelInfo),
      path: '/embeddings',
      method: 'POST',
      body: {
        model: modelInfo.model,
        input: texts,
        encoding_format: 'float'
      }
    });
    const ordered = [...(data?.data || [])].sort((a, b) => a.index - b.index);
    if (ordered.length !== texts.length || ordered.some(item => !Array.isArray(item.embedding))) {
      throw new Error('Batch embedding result count mismatch');
    }
    return ordered.map(item => item.embedding);
  } catch (error) {
    console.warn('[Embedding] Batch request failed; falling back to per-item calculation:', error);
    const results: Array<number[] | null> = [];
    for (const text of texts) {
      results.push(await fetchEmbedding(text));
    }
    return results;
  }
}

/**
 * 
 * @param query 
 * @param documents 
 * @returns 
 */
export async function rerankDocuments(
  query: string,
  documents: {id: number, filename: string, content: string, similarity: number}[],
  relevanceThreshold: number = 0.1
): Promise<{id: number, filename: string, content: string, similarity: number}[]> {
  try {
    if (!documents.length) {
      return documents;
    }

    const modelInfo = await getRerankModelInfo();
    if (!modelInfo) {
      return documents;
    }

    const { baseURL, model } = modelInfo;

    if (!baseURL || !model) {
      return documents;
    }

    const passages = documents.map(doc => doc.content);

    const data = await invokeAiJson<RerankResponse>({
      config: await resolveAiRequestConfig(modelInfo),
      path: '/rerank',
      method: 'POST',
      body: {
        model,
        query,
        documents: passages
      }
    });

    if (!data || !data.results) {
      throw new Error('Invalid rerank result format');
    }

    const scoredResults = data.results.flatMap((result, index) => {
      const docIndex = result.document_index ?? result.index ?? index;
      const originalDoc = documents[docIndex];
      if (!originalDoc) return [];
      const candidateScore = Number(result.relevance_score ?? result.score ?? originalDoc.similarity);
      return Number.isFinite(candidateScore) ? [{ originalDoc, candidateScore }] : [];
    });
    if (scoredResults.length === 0) {
      throw new Error('Rerank results have no valid scores');
    }

    const rawScores = scoredResults.map(result => result.candidateScore);
    const minRawScore = Math.min(...rawScores);
    const maxRawScore = Math.max(...rawScores);
    const normalizeRerankScore = (score: number) => {
      if (minRawScore >= 0 && maxRawScore <= 1) return score;
      if (minRawScore < 0) return 1 / (1 + Math.exp(-score));
      return maxRawScore > 0 ? score / maxRawScore : 0;
    };

    // 、logit 0-1，。
    const normalizedResults = scoredResults.map(result => ({
      ...result.originalDoc,
      similarity: normalizeRerankScore(result.candidateScore)
    }));
    const maxRerankScore = Math.max(...normalizedResults.map(result => result.similarity));
    // rerank ，。
    if (maxRerankScore < relevanceThreshold) {
      return [];
    }

    const rerankResults = normalizedResults.filter(result => result.similarity >= relevanceThreshold);

    return rerankResults.sort((a: {similarity: number}, b: {similarity: number}) => b.similarity - a.similarity);
  } catch (error) {
    console.error('[Rerank] Rerank failed:', error);
    return documents;
  }
}
