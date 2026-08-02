import { invoke } from '@tauri-apps/api/core';

// Rust
export interface SearchItem {
  id?: string;
  desc?: string;
  title?: string;
  article?: string;
  url?: string;
  path?: string;
  searchType?: string;
  type?: string;
  tagId?: number;
  tagName?: string;
  content?: string;
  createdAt?: number;
  score?: number;
  matches?: MatchInfo;
}

//
export interface MatchInfo {
  key: string;
  indices: [number, number][];
  value: string;
}

//
export interface FuzzySearchResult {
  item: SearchItem;
  refIndex: number;
  matches: MatchInfo[];
  score: number;
}

//
export interface FuzzySearchOptions {
  keys: string[];
  threshold?: number;
  includeScore?: boolean;
  includeMatches?: boolean;
}

// Rust
export class RustFuzzySearch {
  private items: SearchItem[];
  private options: FuzzySearchOptions;

  //
  constructor(items: any[], options: Partial<FuzzySearchOptions> = {}) {
    this.items = items;
    this.options = {
      keys: options.keys || [], //
      threshold: 0.3,
      includeScore: true,
      includeMatches: true,
      ...options
    };
  }

  //
  async search(query: string): Promise<FuzzySearchResult[]> {
    if (!query) return [];
    
    try {
      const rawResults = await invoke<Array<{item: SearchItem; refindex: number; score: number; matches: MatchInfo[]}>>('fuzzy_search', {
        items: this.items,
        query,
        keys: this.options.keys,
        threshold: this.options.threshold || 0.3,
        includeScore: this.options.includeScore ?? true,
        includeMatches: this.options.includeMatches ?? true
      });
      
      return rawResults.map((result: { item: SearchItem; refindex: number; score: number; matches: MatchInfo[] }) => {
        const item = result.item;
        if ('search_type' in item && typeof item.search_type === 'string') {
          item.searchType = item.search_type;
          delete item.search_type;
        }
        
        return {
        item: result.item,
        refIndex: result.refindex,
        score: result.score,
        matches: result.matches
      };
      });
    } catch (error) {
      console.error('Translated message', error);
      return [];
    }
  }

  // （）
  async searchParallel(query: string): Promise<FuzzySearchResult[]> {
    if (!query) return [];
    
    try {
      const rawResults = await invoke<Array<{item: SearchItem; refindex: number; score: number; matches: MatchInfo[]}>>('fuzzy_search_parallel', {
        items: this.items,
        query,
        keys: this.options.keys,
        threshold: this.options.threshold || 0.3,
        includeScore: this.options.includeScore ?? true,
        includeMatches: this.options.includeMatches ?? true
      });

      return rawResults.map((result: { item: SearchItem; refindex: number; score: number; matches: MatchInfo[] }) => {
        const item = result.item;
        if ('search_type' in item && typeof item.search_type === 'string') {
          item.searchType = item.search_type;
          delete item.search_type;
        }

        return {
          item: result.item,
          refIndex: result.refindex,
          score: result.score,
          matches: result.matches
        };
      });
    } catch (error) {
      console.error('Translated message', error);
      return [];
    }
  }
}
