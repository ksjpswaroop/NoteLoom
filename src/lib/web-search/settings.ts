import { Store } from '@tauri-apps/plugin-store'
import type {
  AiConfig,
  ModelConfig,
  WebSearchApiKeys,
  WebSearchApiProvider,
  WebSearchProvider,
} from '@/app/core/setting/config'

const ENABLED_KEY = 'webSearch.enabled'
const NATIVE_ENABLED_KEY = 'webSearch.nativeEnabled'
const THIRD_PARTY_ENABLED_KEY = 'webSearch.thirdPartyEnabled'
const WIGOLO_ENABLED_KEY = 'webSearch.wigoloEnabled'
const BASIC_ENABLED_KEY = 'webSearch.basicEnabled'
const PROVIDER_KEY = 'webSearch.provider'
const LEGACY_API_KEY = 'webSearch.apiKey'
const API_KEYS_KEY = 'webSearch.apiKeys'
const PROVIDER_ORDER_KEY = 'webSearch.providerOrder'
const WIGOLO_BASE_URL_KEY = 'webSearch.wigoloBaseUrl'
const WIGOLO_API_TOKEN_KEY = 'webSearch.wigoloApiToken'

export const WEB_SEARCH_API_PROVIDERS: WebSearchApiProvider[] = [
  'zhipu',
  'tavily',
  'brave',
  'exa',
]

export const DEFAULT_WIGOLO_BASE_URL = 'http://127.0.0.1:3333'

export interface WebSearchSettings {
  nativeEnabled: boolean
  thirdPartyEnabled: boolean
  wigoloEnabled: boolean
  basicEnabled: boolean
  provider: WebSearchProvider
  apiKeys: WebSearchApiKeys
  providerOrder: WebSearchApiProvider[]
  wigoloBaseUrl: string
  wigoloApiToken: string
}

interface WebSearchSettingsContext {
  aiConfigs?: AiConfig[]
  modelId?: unknown
}

const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  nativeEnabled: true,
  thirdPartyEnabled: true,
  wigoloEnabled: true,
  basicEnabled: true,
  provider: 'auto',
  apiKeys: {},
  providerOrder: WEB_SEARCH_API_PROVIDERS,
  wigoloBaseUrl: DEFAULT_WIGOLO_BASE_URL,
  wigoloApiToken: '',
}

export function normalizeWebSearchProviderOrder(value: unknown): WebSearchApiProvider[] {
  const configuredOrder = Array.isArray(value)
    ? value.filter((provider): provider is WebSearchApiProvider => (
        typeof provider === 'string'
        && WEB_SEARCH_API_PROVIDERS.includes(provider as WebSearchApiProvider)
      ))
    : []
  const uniqueOrder = [...new Set(configuredOrder)]
  return [
    ...uniqueOrder,
    ...WEB_SEARCH_API_PROVIDERS.filter(provider => !uniqueOrder.includes(provider)),
  ]
}

export function normalizeWigoloBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_WIGOLO_BASE_URL
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return DEFAULT_WIGOLO_BASE_URL
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_WIGOLO_BASE_URL
    }
    return url.origin
  } catch {
    return DEFAULT_WIGOLO_BASE_URL
  }
}

function normalizeApiKeys(value: unknown): WebSearchApiKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return WEB_SEARCH_API_PROVIDERS.reduce<WebSearchApiKeys>((keys, provider) => {
    const apiKey = (value as Record<string, unknown>)[provider]
    if (typeof apiKey === 'string' && apiKey) keys[provider] = apiKey
    return keys
  }, {})
}

function isWebSearchProvider(value: unknown): value is WebSearchProvider {
  return value === 'auto'
    || value === 'zhipu'
    || value === 'tavily'
    || value === 'brave'
    || value === 'exa'
}

function findSelectedModel(aiConfigs: AiConfig[], modelId: unknown): ModelConfig | undefined {
  if (typeof modelId !== 'string' || !modelId) return undefined

  for (const config of aiConfigs) {
    const directMatch = config.models?.find(model => model.id === modelId)
    if (directMatch) return directMatch

    const expectedPrefix = `${config.key}-`
    if (modelId.startsWith(expectedPrefix)) {
      const originalModelId = modelId.substring(expectedPrefix.length)
      const combinedMatch = config.models?.find(model => model.id === originalModelId)
      if (combinedMatch) return combinedMatch
    }
  }

  return undefined
}

function findLegacySettings(
  aiConfigs: AiConfig[],
  modelId: unknown
): Pick<ModelConfig, 'enableWebSearch' | 'webSearchProvider' | 'webSearchApiKey'> | AiConfig | undefined {
  const selectedModel = findSelectedModel(aiConfigs, modelId)
  const candidates = [
    selectedModel,
    ...aiConfigs.flatMap(config => config.models || []),
    ...aiConfigs,
  ]

  return candidates.find(candidate =>
    candidate?.enableWebSearch !== undefined
    || candidate?.webSearchProvider !== undefined
    || candidate?.webSearchApiKey !== undefined
  )
}

export async function saveWebSearchSettings(
  settings: WebSearchSettings,
  targetStore?: Store
) {
  const store = targetStore || await Store.load('store.json')
  await store.set(
    ENABLED_KEY,
    settings.nativeEnabled
      || settings.thirdPartyEnabled
      || settings.wigoloEnabled
      || settings.basicEnabled
  )
  await store.set(NATIVE_ENABLED_KEY, settings.nativeEnabled)
  await store.set(THIRD_PARTY_ENABLED_KEY, settings.thirdPartyEnabled)
  await store.set(WIGOLO_ENABLED_KEY, settings.wigoloEnabled)
  await store.set(BASIC_ENABLED_KEY, settings.basicEnabled)
  await store.set(PROVIDER_KEY, 'auto')
  await store.set(API_KEYS_KEY, settings.apiKeys)
  await store.set(PROVIDER_ORDER_KEY, settings.providerOrder)
  await store.set(WIGOLO_BASE_URL_KEY, normalizeWigoloBaseUrl(settings.wigoloBaseUrl))
  await store.set(WIGOLO_API_TOKEN_KEY, settings.wigoloApiToken.trim())
  await store.save()
}

export async function loadWebSearchSettings(
  targetStore?: Store,
  context: WebSearchSettingsContext = {}
): Promise<WebSearchSettings> {
  const store = targetStore || await Store.load('store.json')
  const [
    enabled,
    nativeEnabled,
    thirdPartyEnabled,
    wigoloEnabled,
    basicEnabled,
    provider,
    apiKeys,
    legacyApiKey,
    providerOrder,
    wigoloBaseUrl,
    wigoloApiToken,
  ] = await Promise.all([
    store.get<boolean>(ENABLED_KEY),
    store.get<boolean>(NATIVE_ENABLED_KEY),
    store.get<boolean>(THIRD_PARTY_ENABLED_KEY),
    store.get<boolean>(WIGOLO_ENABLED_KEY),
    store.get<boolean>(BASIC_ENABLED_KEY),
    store.get<string>(PROVIDER_KEY),
    store.get<unknown>(API_KEYS_KEY),
    store.get<string>(LEGACY_API_KEY),
    store.get<unknown>(PROVIDER_ORDER_KEY),
    store.get<string>(WIGOLO_BASE_URL_KEY),
    store.get<string>(WIGOLO_API_TOKEN_KEY),
  ])

  if (
    typeof enabled === 'boolean'
    || typeof nativeEnabled === 'boolean'
    || typeof thirdPartyEnabled === 'boolean'
    || typeof wigoloEnabled === 'boolean'
    || typeof basicEnabled === 'boolean'
  ) {
    const legacyProvider = isWebSearchProvider(provider) ? provider : 'auto'
    const normalizedApiKeys = normalizeApiKeys(apiKeys)
    const legacyDisabled = enabled === false && typeof basicEnabled !== 'boolean'
    const legacyDefault = typeof enabled === 'boolean' ? enabled : true
    if (
      Object.keys(normalizedApiKeys).length === 0
      && legacyProvider !== 'auto'
      && typeof legacyApiKey === 'string'
      && legacyApiKey
    ) {
      normalizedApiKeys[legacyProvider] = legacyApiKey
    }

    const settings: WebSearchSettings = {
      nativeEnabled: legacyDisabled
        ? false
        : typeof nativeEnabled === 'boolean' ? nativeEnabled : legacyDefault,
      thirdPartyEnabled: legacyDisabled
        ? false
        : typeof thirdPartyEnabled === 'boolean' ? thirdPartyEnabled : legacyDefault,
      wigoloEnabled: legacyDisabled
        ? false
        : typeof wigoloEnabled === 'boolean' ? wigoloEnabled : true,
      basicEnabled: legacyDisabled
        ? false
        : typeof basicEnabled === 'boolean' ? basicEnabled : legacyDefault,
      provider: 'auto' as const,
      apiKeys: normalizedApiKeys,
      providerOrder: normalizeWebSearchProviderOrder(providerOrder),
      wigoloBaseUrl: normalizeWigoloBaseUrl(wigoloBaseUrl),
      wigoloApiToken: typeof wigoloApiToken === 'string' ? wigoloApiToken : '',
    }
    if (
      legacyProvider !== 'auto'
      || nativeEnabled === undefined
      || thirdPartyEnabled === undefined
      || wigoloEnabled === undefined
      || basicEnabled === undefined
      || providerOrder === undefined
      || wigoloBaseUrl === undefined
      || (apiKeys === undefined && Object.keys(normalizedApiKeys).length > 0)
    ) {
      await saveWebSearchSettings(settings, store)
    }
    return settings
  }

  const aiConfigs = context.aiConfigs || await store.get<AiConfig[]>('aiModelList') || []
  const modelId = context.modelId ?? await store.get('primaryModel')
  const legacy = findLegacySettings(aiConfigs, modelId)
  if (!legacy) return DEFAULT_WEB_SEARCH_SETTINGS

  const legacyProvider = isWebSearchProvider(legacy.webSearchProvider)
    ? legacy.webSearchProvider
    : 'auto'
  const legacyEnabled = legacy.enableWebSearch === true
  const migrated: WebSearchSettings = {
    nativeEnabled: legacyEnabled,
    thirdPartyEnabled: legacyEnabled,
    wigoloEnabled: legacyEnabled,
    basicEnabled: legacyEnabled,
    provider: 'auto',
    apiKeys: {},
    providerOrder: WEB_SEARCH_API_PROVIDERS,
    wigoloBaseUrl: DEFAULT_WIGOLO_BASE_URL,
    wigoloApiToken: '',
  }
  if (
    legacyProvider !== 'auto'
    && typeof legacy.webSearchApiKey === 'string'
    && legacy.webSearchApiKey
  ) {
    migrated.apiKeys[legacyProvider] = legacy.webSearchApiKey
  }
  await saveWebSearchSettings(migrated, store)
  return migrated
}
