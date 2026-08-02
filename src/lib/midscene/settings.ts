import { Store } from '@tauri-apps/plugin-store'
import {
  DEFAULT_MIDSCENE_MODEL,
  DEFAULT_MIDSCENE_SETTINGS,
  type MidsceneModelEnv,
  type MidsceneSettings,
} from './types'

const ENABLED_KEY = 'midscene.enabled'
const OPT_IN_KEY = 'midscene.optInAccepted'
const MODEL_API_KEY = 'midscene.model.apiKey'
const MODEL_NAME_KEY = 'midscene.model.modelName'
const MODEL_BASE_URL_KEY = 'midscene.model.baseUrl'
const MODEL_FAMILY_KEY = 'midscene.model.family'
const MODEL_REASONING_KEY = 'midscene.model.reasoningEnabled'

let cachedSettings: MidsceneSettings = { ...DEFAULT_MIDSCENE_SETTINGS, model: { ...DEFAULT_MIDSCENE_MODEL } }

function normalizeModel(partial?: Partial<MidsceneModelEnv> | null): MidsceneModelEnv {
  return {
    apiKey: typeof partial?.apiKey === 'string' ? partial.apiKey : '',
    modelName: typeof partial?.modelName === 'string' ? partial.modelName.trim() : '',
    baseUrl: typeof partial?.baseUrl === 'string' ? partial.baseUrl.trim() : '',
    family: typeof partial?.family === 'string' ? partial.family.trim() : '',
    reasoningEnabled: typeof partial?.reasoningEnabled === 'boolean'
      ? partial.reasoningEnabled
      : false,
  }
}

export function getMidsceneSettingsSync(): MidsceneSettings {
  return {
    enabled: cachedSettings.enabled,
    optInAccepted: cachedSettings.optInAccepted,
    model: { ...cachedSettings.model },
  }
}

export function isMidsceneAutomationAvailableSync(): boolean {
  return cachedSettings.enabled && cachedSettings.optInAccepted
}

export async function loadMidsceneSettings(): Promise<MidsceneSettings> {
  try {
    const store = await Store.load('store.json')
    const [
      enabled,
      optInAccepted,
      apiKey,
      modelName,
      baseUrl,
      family,
      reasoningEnabled,
    ] = await Promise.all([
      store.get<boolean>(ENABLED_KEY),
      store.get<boolean>(OPT_IN_KEY),
      store.get<string>(MODEL_API_KEY),
      store.get<string>(MODEL_NAME_KEY),
      store.get<string>(MODEL_BASE_URL_KEY),
      store.get<string>(MODEL_FAMILY_KEY),
      store.get<boolean>(MODEL_REASONING_KEY),
    ])

    cachedSettings = {
      enabled: enabled === true,
      optInAccepted: optInAccepted === true,
      model: normalizeModel({
        apiKey: typeof apiKey === 'string' ? apiKey : '',
        modelName: typeof modelName === 'string' ? modelName : '',
        baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
        family: typeof family === 'string' ? family : '',
        reasoningEnabled: typeof reasoningEnabled === 'boolean' ? reasoningEnabled : false,
      }),
    }
  } catch {
    cachedSettings = {
      ...DEFAULT_MIDSCENE_SETTINGS,
      model: { ...DEFAULT_MIDSCENE_MODEL },
    }
  }
  return getMidsceneSettingsSync()
}

export async function saveMidsceneSettings(settings: MidsceneSettings): Promise<MidsceneSettings> {
  const next: MidsceneSettings = {
    enabled: settings.enabled === true,
    optInAccepted: settings.optInAccepted === true,
    model: normalizeModel(settings.model),
  }

  const store = await Store.load('store.json')
  await Promise.all([
    store.set(ENABLED_KEY, next.enabled),
    store.set(OPT_IN_KEY, next.optInAccepted),
    store.set(MODEL_API_KEY, next.model.apiKey),
    store.set(MODEL_NAME_KEY, next.model.modelName),
    store.set(MODEL_BASE_URL_KEY, next.model.baseUrl),
    store.set(MODEL_FAMILY_KEY, next.model.family),
    store.set(MODEL_REASONING_KEY, next.model.reasoningEnabled === true),
  ])
  await store.save()
  cachedSettings = next
  return getMidsceneSettingsSync()
}

export function isMidsceneModelConfigured(model: MidsceneModelEnv): boolean {
  return Boolean(
    model.apiKey.trim()
    && model.modelName.trim()
    && model.baseUrl.trim()
    && model.family.trim(),
  )
}
