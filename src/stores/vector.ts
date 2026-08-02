import { create } from 'zustand';
import { initVectorDb, processAllMarkdownFiles, processMarkdownFile, checkEmbeddingModelAvailable, initBM25Search } from '@/lib/rag';
import { checkRerankModelAvailable } from '@/lib/ai/embedding';
import { Store } from "@tauri-apps/plugin-store";
import { toast } from '@/hooks/use-toast';
import {
  clearVectorDb,
  getAllVectorDocuments,
  getVectorIndexStats,
  replaceAllVectorDocuments,
  type VectorDocumentSnapshot,
  type VectorIndexStats
} from '@/db/vector';
import useRagSettingsStore from '@/stores/ragSettings';

interface VectorState {
  isAutoVectorEnabled: boolean;    // Save
  isProcessing: boolean;           //
  lastProcessTime: number | null;  //
  hasRerankModel: boolean;         //
  hasEmbeddingModel: boolean;      //
  indexStats: VectorIndexStats;

  //
  documentCount: number;           //

  //
  initVectorDb: () => Promise<void>;

  setAutoVectorEnabled: (enabled: boolean) => Promise<void>;

  //
  processAllDocuments: () => Promise<void>;
  processDocument: (filename: string, content: string) => Promise<void>;
  checkEmbeddingModel: () => Promise<boolean>;
  checkRerankModel: () => Promise<boolean>;
  refreshIndexStats: () => Promise<void>;
}

const useVectorStore = create<VectorState>((set, get) => ({
  isAutoVectorEnabled: true,
  isProcessing: false,
  lastProcessTime: null,
  hasRerankModel: false,
  hasEmbeddingModel: false,
  indexStats: {
    documentCount: 0,
    chunkCount: 0,
    bm25DocumentCount: 0,
    bm25ChunkCount: 0,
    lastUpdatedAt: null
  },
  documentCount: 0,

  //
  initVectorDb: async () => {
    try {
      await useRagSettingsStore.getState().initSettings();
      await initVectorDb();

      // BM25
      await initBM25Search();

      //
      const store = await Store.load('store.json');
      const isAutoVectorEnabled = await store.get<boolean>('autoVectorEnabled') ?? true;
      const lastProcessTime = await store.get<number>('lastVectorProcessTime') || null;

      set({
        isAutoVectorEnabled,
        lastProcessTime
      });

      //
      if (isAutoVectorEnabled) {
        const modelAvailable = await get().checkEmbeddingModel();
        if (!modelAvailable) {
          toast({
            title: 'Vector database',
            description: 'Embed ， AI Embed',
            variant: 'destructive',
          });
        }
      }

      //
      const hasRerankModel = await get().checkRerankModel();
      set({ hasRerankModel });
      await get().refreshIndexStats();
    } catch (error) {
      console.error('Vector databaseFailed', error);
    }
  },

  setAutoVectorEnabled: async (enabled: boolean) => {
    const store = await Store.load('store.json');
    await store.set('autoVectorEnabled', enabled);
    set({ isAutoVectorEnabled: enabled });
  },

  //
  processAllDocuments: async () => {
    // ，
    if (get().isProcessing) return;

    let processingToast: ReturnType<typeof toast> | undefined;
    let previousDocuments: VectorDocumentSnapshot[] | null = null;

    try {
      //
      const modelAvailable = await get().checkEmbeddingModel();
      if (!modelAvailable) {
        toast({
          title: 'Vector processing',
          description: 'Embed ， AI Embed',
          variant: 'destructive',
        });
        return;
      }

      //
      set({ isProcessing: true });

      const forceRebuild = useRagSettingsStore.getState().indexNeedsRebuild;
      if (forceRebuild) {
        previousDocuments = await getAllVectorDocuments();
        await clearVectorDb();
      }

      //
      processingToast = toast({
        title: 'Vector processing',
        description: 'Vector， ...',
        duration: Infinity,
      });

      // ，
      const result = await processAllMarkdownFiles((current, total, fileName) => {
        processingToast?.update({
          title: 'Processing vectors',
          description: `${current}/${total}：${fileName}`,
          duration: Infinity,
        });
      });

      if (result.failed > 0 && previousDocuments) {
        await replaceAllVectorDocuments(previousDocuments);
        await initBM25Search();
      }

      //
      const currentTime = Date.now();
      const store = await Store.load('store.json');
      await store.set('lastVectorProcessTime', currentTime);

      set({
        isProcessing: false,
        lastProcessTime: currentTime,
        documentCount: result.success
      });

      // BM25
      await initBM25Search();
      if (result.failed === 0) {
        await useRagSettingsStore.getState().markIndexClean();
      }
      await get().refreshIndexStats();

      //
      let description = `${result.success}`;
      if (result.failed > 0) {
        description += `，Failed ${result.failed}`;
        // ，
        if (result.failedFiles && result.failedFiles.length > 0) {
          const failedSample = result.failedFiles.slice(0, 3).map(f => f.fileName).join('、');
          description += `\nFailedFile: ${failedSample}${result.failedFiles.length > 3 ? ' etc.' : ''}`;
        }
      }

      processingToast.update({
        title: result.failed > 0 ? 'Vector processing complete（ Failed）' : 'Vector processing complete',
        description,
        variant: result.failed > 0 ? 'destructive' : 'default',
        duration: 5000,
      });
    } catch (error) {
      console.error('VectorFailed', error);
      set({ isProcessing: false });

      if (previousDocuments) {
        try {
          await replaceAllVectorDocuments(previousDocuments);
          await initBM25Search();
          await get().refreshIndexStats();
        } catch (restoreError) {
          console.error('Failed', restoreError);
        }
      }

      const errorToast = {
        title: 'Vector processing failed',
        description: 'Vector Error，',
        variant: 'destructive',
        duration: 5000,
      } as const;

      if (processingToast) {
        processingToast.update(errorToast);
      } else {
        toast(errorToast);
      }
    }
  },

  //
  processDocument: async (filePath: string, content: string) => {
    try {
      await processMarkdownFile(filePath, content);
    } catch (error) {
      console.error(`${filePath} VectorFailed`, error);
    }
  },

  //
  checkEmbeddingModel: async () => {
    try {
      const modelAvailable = await checkEmbeddingModelAvailable();
      set({ hasEmbeddingModel: modelAvailable });
      return modelAvailable;
    } catch (error) {
      console.error('Embed Failed', error);
      set({ hasEmbeddingModel: false });
      return false;
    }
  },

  //
  checkRerankModel: async () => {
    try {
      const modelAvailable = await checkRerankModelAvailable();
      set({ hasRerankModel: modelAvailable });
      return modelAvailable;
    } catch (error) {
      console.error('Failed', error);
      set({ hasRerankModel: false });
      return false;
    }
  },

  refreshIndexStats: async () => {
    try {
      const indexStats = await getVectorIndexStats();
      set({ indexStats, documentCount: indexStats.documentCount });
    } catch (error) {
      console.error('Failed', error);
    }
  }
}));

export default useVectorStore;
