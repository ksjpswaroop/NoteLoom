import { BaseDirectory } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'

function normalizeFsPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
}

export function isAbsoluteFsPath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/**
 * 
 * ，
 * AppData/article 
 */
export async function getWorkspacePath(): Promise<{ path: string, isCustom: boolean }> {
  //
  const store = await Store.load('store.json')
  const workspacePath = await store.get<string>('workspacePath')

  // ，
  if (workspacePath) {
    return {
      path: workspacePath,
      isCustom: true
    }
  }

  //
  return {
    path: 'article',
    isCustom: false
  }
}

/**
 * 
 * @param relativePath 
 * @returns baseDir
 */
export async function getFilePathOptions(relativePath: string): Promise<{ path: string, baseDir?: BaseDirectory }> {
  if (isAbsoluteFsPath(relativePath)) {
    return { path: relativePath }
  }

  const workspace = await getWorkspacePath()

  if (workspace.isCustom) {
    // ，，baseDir
    const fullPath = await join(workspace.path, relativePath)
    return { path: fullPath }
  } else {
    // ，AppDatabaseDir
    const resolvedPath = `article/${relativePath}`
    return {
      path: resolvedPath,
      baseDir: BaseDirectory.AppData
    }
  }
}

/**
 * AppData/article 
 * skills/runtime、outputs ， baseDir 
 */
export async function getDefaultArticleAbsolutePath(relativePath: string): Promise<string> {
  const normalized = relativePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^article\//, '')

  const appDataPath = await appDataDir()
  return await join(appDataPath, 'article', normalized)
}

/**
 * 
 * article，AppData
 * @param path ，
 * @param prefix ，'article'、'image'
 * @returns baseDir
 */
export async function getGenericPathOptions(path: string, prefix?: string): Promise<{ path: string, baseDir?: BaseDirectory }> {
  const workspace = await getWorkspacePath()
  
  if (workspace.isCustom) {
    // ，
    let fullPath = workspace.path
    
    // prefix，pathprefix，prefix
    if (prefix && !path.startsWith(`${prefix}/`) && !path.startsWith(prefix)) {
      fullPath = await join(fullPath, prefix || '', path)
    } else {
      fullPath = await join(fullPath, path)
    }
    
    return { path: fullPath }
  } else {
    // ，AppDatabaseDir
    // prefixpathprefix，prefix/
    if (prefix && !path.startsWith(`${prefix}/`) && !path.startsWith(prefix)) {
      return {
        path: `${prefix}/${path}`,
        baseDir: BaseDirectory.AppData
      }
    }
    
    return { 
      path: path, 
      baseDir: BaseDirectory.AppData 
    }
  }
}

/**
 * 
 * @param path 
 * @returns 
 */
export async function toWorkspaceRelativePath(path: string): Promise<string> {
  const workspace = await getWorkspacePath()
  
  const defaultDirRegex = /^(article[\\\/])/
  // ，"article/"
  if (!workspace.isCustom && defaultDirRegex.test(path)) {
    return path.replace(/article[\\\/]/g, '')
  }
  
  // ，
  const normalizedPath = normalizeFsPath(path)
  const normalizedWorkspacePath = normalizeFsPath(workspace.path).replace(/\/$/, '')
  if (workspace.isCustom && (
    normalizedPath === normalizedWorkspacePath ||
    normalizedPath.startsWith(`${normalizedWorkspacePath}/`)
  )) {
    //
    const relativePath = normalizedPath.substring(normalizedWorkspacePath.length)
    // （）
    return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath
  }
  
  // ，
  return path
}

/**
 * 
 * - : 
 * - (article): article/ 
 */
export async function normalizeWorkspaceRelativePath(relativePath: string): Promise<string> {
  const workspace = await getWorkspacePath()
  const normalized = relativePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')

  if (workspace.isCustom) {
    return normalized
  }

  if (normalized === 'article') {
    return ''
  }

  return normalized.replace(/^article\//, '')
}

/**
 * 、。
 * Agent ，。
 */
export async function ensureSafeWorkspaceRelativePath(relativePath: string): Promise<string> {
  const normalized = await normalizeWorkspaceRelativePath(relativePath)

  if (!normalized) {
    throw new Error('Path cannot be empty')
  }

  if (normalized.startsWith('/')) {
    throw new Error('Absolute paths are not allowed')
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.some(segment => segment === '..')) {
    throw new Error('Path cannot contain ..')
  }

  return normalized
}
