export const EXCALIDRAW_EXTENSION = 'excalidraw'
export const EXCALIDRAW_FILE_SUFFIX = `.${EXCALIDRAW_EXTENSION}`
export const EXCALIDRAW_SOURCE = 'https://noteloom.app'

export type ExcalidrawBinaryFiles = Record<string, unknown>

export interface ExcalidrawSceneFile {
  type: 'excalidraw'
  version: 2
  source: string
  elements: readonly unknown[]
  appState: Record<string, unknown>
  files: ExcalidrawBinaryFiles
}

export function isExcalidrawPath(path: string) {
  return path.toLowerCase().endsWith(EXCALIDRAW_FILE_SUFFIX)
}

export function createEmptyExcalidrawScene(
  overrides?: Partial<Pick<ExcalidrawSceneFile, 'elements' | 'appState' | 'files'>>,
): ExcalidrawSceneFile {
  return {
    type: 'excalidraw',
    version: 2,
    source: EXCALIDRAW_SOURCE,
    elements: overrides?.elements ?? [],
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
      ...(overrides?.appState || {}),
    },
    files: overrides?.files ?? {},
  }
}

export function parseExcalidrawFile(raw: string): ExcalidrawSceneFile {
  const trimmed = raw.trim()
  if (!trimmed) {
    return createEmptyExcalidrawScene()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('Invalid Excalidraw JSON')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Excalidraw file must be a JSON object')
  }

  const record = parsed as Record<string, unknown>
  const elements = Array.isArray(record.elements) ? record.elements : []
  const files =
    record.files && typeof record.files === 'object' && !Array.isArray(record.files)
      ? record.files as ExcalidrawBinaryFiles
      : {}
  const appState =
    record.appState && typeof record.appState === 'object' && !Array.isArray(record.appState)
      ? record.appState as Record<string, unknown>
      : { gridSize: null, viewBackgroundColor: '#ffffff' }

  return {
    type: 'excalidraw',
    version: 2,
    source: typeof record.source === 'string' ? record.source : EXCALIDRAW_SOURCE,
    elements,
    appState,
    files,
  }
}

export function serializeExcalidrawScene(scene: ExcalidrawSceneFile): string {
  return `${JSON.stringify(scene, null, 2)}\n`
}

export function summarizeExcalidrawScene(scene: ExcalidrawSceneFile) {
  const elements = scene.elements as Array<{ id?: string; type?: string; isDeleted?: boolean }>
  const active = elements.filter((element) => !element?.isDeleted)
  const byType: Record<string, number> = {}
  for (const element of active) {
    const type = typeof element.type === 'string' ? element.type : 'unknown'
    byType[type] = (byType[type] || 0) + 1
  }
  return {
    elementCount: active.length,
    byType,
    elementIds: active
      .map((element) => (typeof element.id === 'string' ? element.id : ''))
      .filter(Boolean)
      .slice(0, 80),
  }
}
