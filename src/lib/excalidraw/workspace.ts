import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import {
  createEmptyExcalidrawScene,
  EXCALIDRAW_FILE_SUFFIX,
  isExcalidrawPath,
  parseExcalidrawFile,
  serializeExcalidrawScene,
  type ExcalidrawSceneFile,
} from './file-format'

function joinRelativePath(folderPath: string | undefined, fileName: string) {
  if (!folderPath) return fileName
  return `${folderPath.replace(/\/+$/, '')}/${fileName.replace(/^\/+/, '')}`
}

async function ensureParentDir(relativePath: string) {
  const parent = relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/'))
    : ''
  if (!parent) return

  const { path, baseDir } = await getFilePathOptions(parent)
  const parentExists = baseDir
    ? await exists(path, { baseDir })
    : await exists(path)
  if (parentExists) return

  if (baseDir) {
    await mkdir(path, { baseDir, recursive: true })
  } else {
    await mkdir(path, { recursive: true })
  }
}

export async function readExcalidrawScene(relativePath: string): Promise<ExcalidrawSceneFile> {
  if (!isExcalidrawPath(relativePath)) {
    throw new Error('Path must end with .excalidraw')
  }
  const { path, baseDir } = await getFilePathOptions(relativePath)
  const raw = baseDir
    ? await readTextFile(path, { baseDir })
    : await readTextFile(path)
  return parseExcalidrawFile(raw)
}

export async function writeExcalidrawScene(
  relativePath: string,
  scene: ExcalidrawSceneFile,
): Promise<void> {
  if (!isExcalidrawPath(relativePath)) {
    throw new Error('Path must end with .excalidraw')
  }
  await ensureParentDir(relativePath)
  const { path, baseDir } = await getFilePathOptions(relativePath)
  const content = serializeExcalidrawScene(scene)
  if (baseDir) {
    await writeTextFile(path, content, { baseDir })
  } else {
    await writeTextFile(path, content)
  }
}

export async function createExcalidrawWorkspaceFile(options: {
  fileName?: string
  folderPath?: string
  scene?: ExcalidrawSceneFile
  open?: boolean
}): Promise<{ filePath: string; scene: ExcalidrawSceneFile; created: boolean }> {
  const folderPath = options.folderPath?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || ''
  let fileName = (options.fileName || 'Untitled sketch').trim().replace(/\\/g, '/')
  if (fileName.includes('/')) {
    fileName = fileName.split('/').filter(Boolean).pop() || 'Untitled sketch'
  }
  if (!fileName.toLowerCase().endsWith(EXCALIDRAW_FILE_SUFFIX)) {
    fileName = `${fileName}${EXCALIDRAW_FILE_SUFFIX}`
  }

  let relativePath = joinRelativePath(folderPath || undefined, fileName)
  const scene = options.scene || createEmptyExcalidrawScene()

  let { path, baseDir } = await getFilePathOptions(relativePath)
  let alreadyExists = baseDir
    ? await exists(path, { baseDir })
    : await exists(path)

  if (alreadyExists && !options.fileName) {
    const stamp = Date.now()
    relativePath = joinRelativePath(folderPath || undefined, `Untitled sketch-${stamp}${EXCALIDRAW_FILE_SUFFIX}`)
    ;({ path, baseDir } = await getFilePathOptions(relativePath))
    alreadyExists = baseDir
      ? await exists(path, { baseDir })
      : await exists(path)
  }

  if (alreadyExists) {
    throw new Error(`File already exists: ${relativePath}`)
  }

  await writeExcalidrawScene(relativePath, scene)

  if (options.open !== false) {
    const { default: useArticleStore } = await import('@/stores/article')
    const { useSidebarStore } = await import('@/stores/sidebar')
    await useArticleStore.getState().loadFileTree({ skipRemoteSync: true })
    await useSidebarStore.getState().setLeftSidebarTab('files')
    await useArticleStore.getState().setActiveFilePath(relativePath)
  }

  return { filePath: relativePath, scene, created: true }
}
