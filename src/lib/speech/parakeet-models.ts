export type LocalSttEngine = 'parakeet' | 'browser'

export type ParakeetAttentionMode = 'full' | 'local'

export interface ParakeetModelOption {
  id: string
  label: string
  description: string
  languages: string
  default?: boolean
}

/** Catalog mirrored in the Rust sidecar allow-list. */
export const PARAKEET_MODEL_OPTIONS: ParakeetModelOption[] = [
  {
    id: 'mlx-community/parakeet-tdt-0.6b-v2',
    label: 'Parakeet TDT 0.6B v2 (English)',
    description: 'Best default for English voice notes on Apple Silicon.',
    languages: 'English',
    default: true,
  },
  {
    id: 'mlx-community/parakeet-tdt-0.6b-v3',
    label: 'Parakeet TDT 0.6B v3 (Multilingual)',
    description: 'English plus many European languages. Larger download.',
    languages: 'English + European',
  },
  {
    id: 'mlx-community/parakeet-ctc-0.6b',
    label: 'Parakeet CTC 0.6B (English)',
    description: 'CTC variant. Often faster; English-focused.',
    languages: 'English',
  },
]

export const DEFAULT_PARAKEET_MODEL_ID = 'mlx-community/parakeet-tdt-0.6b-v2'

export function normalizeLocalSttEngine(value: unknown): LocalSttEngine {
  if (value === 'browser' || value === 'parakeet') {
    return value
  }
  return 'parakeet'
}

export function normalizeParakeetModelId(value: unknown): string {
  if (typeof value === 'string' && PARAKEET_MODEL_OPTIONS.some(option => option.id === value)) {
    return value
  }
  return DEFAULT_PARAKEET_MODEL_ID
}

export function normalizeParakeetAttentionMode(value: unknown): ParakeetAttentionMode {
  if (value === 'local' || value === 'full') {
    return value
  }
  return 'full'
}

export function normalizeParakeetLanguage(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().toLowerCase()
  }
  return 'en'
}
