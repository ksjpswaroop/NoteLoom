import { create } from 'zustand';
import { Store } from "@tauri-apps/plugin-store";
import { toast } from '@/hooks/use-toast';
import { DEFAULT_EXCLUDED_RAG_PATHS } from '@/lib/rag-retrieval-policy';
import {
  DEFAULT_RAG_AGENT_POLICY,
  type RagAgentStrategy,
} from '@/lib/rag-agent-policy';

// RAG
export interface RagSettings {
  // AI
  automaticSearchEnabled: boolean;
  // Agent
  agentStrategy: RagAgentStrategy;
  //
  chunkSize: number;
  //
  chunkOverlap: number;
  //
  resultCount: number;
  // (0.0-1.0)
  similarityThreshold: number;
  //
  rerankThreshold: number;
  //
  excludedPaths: string[];
}

export type RagPreset = 'precision' | 'balanced' | 'recall';

//
export const DEFAULT_RAG_SETTINGS: RagSettings = {
  automaticSearchEnabled: DEFAULT_RAG_AGENT_POLICY.automaticSearchEnabled,
  agentStrategy: DEFAULT_RAG_AGENT_POLICY.strategy,
  chunkSize: 1000,
  chunkOverlap: 200,
  resultCount: 5,
  similarityThreshold: 0.25,
  rerankThreshold: 0.1,
  excludedPaths: DEFAULT_EXCLUDED_RAG_PATHS
};

// RAG
interface RagSettingsState extends RagSettings {
  indexNeedsRebuild: boolean;
  //
  initSettings: () => Promise<void>;
  //
  updateSetting: <K extends keyof RagSettings>(key: K, value: RagSettings[K]) => Promise<void>;
  applyPreset: (preset: RagPreset) => Promise<void>;
  markIndexDirty: () => Promise<void>;
  markIndexClean: () => Promise<void>;
  //
  resetToDefaults: () => Promise<void>;
}

//
const useRagSettingsStore = create<RagSettingsState>((set, get) => ({
  ...DEFAULT_RAG_SETTINGS,
  indexNeedsRebuild: false,

  //
  initSettings: async () => {
    try {
      const store = await Store.load('store.json');
      
      // ，
      const storedAutomaticSearchEnabled = await store.get<boolean>('ragAutomaticSearchEnabled');
      const legacyRagEnabled = await store.get<boolean>('isRagEnabled');
      const automaticSearchEnabled = storedAutomaticSearchEnabled ?? legacyRagEnabled ?? DEFAULT_RAG_SETTINGS.automaticSearchEnabled;
      const storedAgentStrategy = await store.get<string>('ragAgentStrategy');
      const agentStrategy = storedAgentStrategy === 'fast' || storedAgentStrategy === 'balanced' || storedAgentStrategy === 'deep'
        ? storedAgentStrategy
        : DEFAULT_RAG_SETTINGS.agentStrategy;
      const chunkSize = await store.get<number>('ragChunkSize') ?? DEFAULT_RAG_SETTINGS.chunkSize;
      const chunkOverlap = await store.get<number>('ragChunkOverlap') ?? DEFAULT_RAG_SETTINGS.chunkOverlap;
      const resultCount = await store.get<number>('ragResultCount') ?? DEFAULT_RAG_SETTINGS.resultCount;
      const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? DEFAULT_RAG_SETTINGS.similarityThreshold;
      const rerankThreshold = await store.get<number>('ragRerankThreshold') ?? DEFAULT_RAG_SETTINGS.rerankThreshold;
      const excludedPaths = await store.get<string[]>('ragExcludedPaths') ?? DEFAULT_RAG_SETTINGS.excludedPaths;
      const indexNeedsRebuild = await store.get<boolean>('ragIndexNeedsRebuild') ?? false;
      
      set({
        automaticSearchEnabled,
        agentStrategy,
        chunkSize,
        chunkOverlap,
        resultCount,
        similarityThreshold,
        rerankThreshold,
        excludedPaths,
        indexNeedsRebuild
      });
    } catch (error) {
      console.error('Failed to initialize RAG settings:', error);
    }
  },

  //
  updateSetting: async <K extends keyof RagSettings>(key: K, value: RagSettings[K]) => {
    try {
      let resolvedValue = value;
      if (key === 'chunkOverlap') {
        resolvedValue = Math.min(value as number, Math.max(0, get().chunkSize - 50)) as RagSettings[K];
      }
      if (key === 'excludedPaths') {
        resolvedValue = Array.from(new Set(
          (value as string[]).map(path => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '').trim()).filter(Boolean)
        )) as RagSettings[K];
      }

      //
      set({ [key]: resolvedValue } as Pick<RagSettings, K>);
      
      //
      const store = await Store.load('store.json');
      await store.set(`rag${key.charAt(0).toUpperCase() + key.slice(1)}`, resolvedValue);

      if (key === 'chunkSize' && get().chunkOverlap >= (resolvedValue as number)) {
        const chunkOverlap = Math.max(0, (resolvedValue as number) - 50);
        set({ chunkOverlap });
        await store.set('ragChunkOverlap', chunkOverlap);
      }

      if (key === 'chunkSize' || key === 'chunkOverlap' || key === 'excludedPaths') {
        set({ indexNeedsRebuild: true });
        await store.set('ragIndexNeedsRebuild', true);
      }
    } catch (error) {
      console.error(`Failed to update RAG setting ${key}:`, error);
    }
  },

  applyPreset: async (preset) => {
    const presets: Record<RagPreset, Pick<RagSettings, 'resultCount' | 'similarityThreshold' | 'rerankThreshold'>> = {
      precision: { resultCount: 3, similarityThreshold: 0.4, rerankThreshold: 0.25 },
      balanced: { resultCount: 5, similarityThreshold: 0.25, rerankThreshold: 0.1 },
      recall: { resultCount: 8, similarityThreshold: 0.1, rerankThreshold: 0.05 }
    };
    const values = presets[preset];
    const store = await Store.load('store.json');
    set(values);
    await Promise.all([
      store.set('ragResultCount', values.resultCount),
      store.set('ragSimilarityThreshold', values.similarityThreshold),
      store.set('ragRerankThreshold', values.rerankThreshold)
    ]);
  },

  markIndexDirty: async () => {
    set({ indexNeedsRebuild: true });
    const store = await Store.load('store.json');
    await store.set('ragIndexNeedsRebuild', true);
  },

  markIndexClean: async () => {
    set({ indexNeedsRebuild: false });
    const store = await Store.load('store.json');
    await store.set('ragIndexNeedsRebuild', false);
  },

  //
  resetToDefaults: async () => {
    try {
      //
      set({ ...DEFAULT_RAG_SETTINGS, indexNeedsRebuild: true });
      
      //
      const store = await Store.load('store.json');
      await store.set('ragChunkSize', DEFAULT_RAG_SETTINGS.chunkSize);
      await store.set('ragAutomaticSearchEnabled', DEFAULT_RAG_SETTINGS.automaticSearchEnabled);
      await store.set('ragAgentStrategy', DEFAULT_RAG_SETTINGS.agentStrategy);
      await store.set('ragChunkOverlap', DEFAULT_RAG_SETTINGS.chunkOverlap);
      await store.set('ragResultCount', DEFAULT_RAG_SETTINGS.resultCount);
      await store.set('ragSimilarityThreshold', DEFAULT_RAG_SETTINGS.similarityThreshold);
      await store.set('ragRerankThreshold', DEFAULT_RAG_SETTINGS.rerankThreshold);
      await store.set('ragExcludedPaths', DEFAULT_RAG_SETTINGS.excludedPaths);
      await store.set('ragIndexNeedsRebuild', true);
    } catch (error) {
      toast({
        title: 'Failed to reset RAG settings',
        description: error as string,
        variant: 'destructive',
      });
    }
  }
}));

export default useRagSettingsStore;
