import { Store } from '@tauri-apps/plugin-store'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { decodeBase64ToString, getFiles as getGithubFiles, getFileCommits as getGithubFileCommits } from '@/lib/sync/github'
import { getFiles as getGiteeFiles, getFileCommits as getGiteeFileCommits } from '@/lib/sync/gitee'
import { getFileContent as getGitlabFileContent, getFileCommits as getGitlabFileCommits } from '@/lib/sync/gitlab'
import { getFileContent as getGiteaFileContent, getFileCommits as getGiteaFileCommits, getGiteaApiBaseUrl } from '@/lib/sync/gitea'
import { s3HeadObject, s3Download } from './s3'
import { webdavHeadObject, webdavDownload } from './webdav'
import { S3Config, WebDAVConfig } from '@/types/sync'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { toast } from '@/hooks/use-toast'
import { readTextFile, writeTextFile, stat, mkdir, exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import {
  checkFileLock,
  detectAndHandleConflict,
  mergeSimpleContent,
  updateFileSyncTime,
  cleanupExpiredLocks,
  getFileSyncStatus,
  getFileRestoreTime
} from './conflict-resolution'
import { sanitizeFilePath, hasInvalidFileNameChars } from './filename-utils'
import { useSyncConfirmStore } from '@/stores/sync-confirm'
import useSyncStore from '@/stores/sync'
import emitter from '@/lib/emitter'

// Store
let storeInstance: Store | null = null

/**
 * Store 
 */
async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load('store.json')
  }
  return storeInstance
}

/**
 * GitLab 
 */
async function getGitlabBranch(): Promise<string> {
  const store = await getStore()
  return await store.get<string>('gitlabBranch') || 'main'
}

/**
 * Gitea 
 */
async function getGiteaBranch(): Promise<string> {
  const store = await getStore()
  return await store.get<string>('giteaBranch') || 'main'
}

/**
 * store SHA
 */
export async function getLocalRecordedSha(filePath: string): Promise<string | null> {
  const store = await getStore()
  const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  return syncedShas[filePath] || null
}

/**
 * SHA
 */
export async function setLocalRecordedSha(filePath: string, sha: string): Promise<void> {
  const store = await getStore()
  const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  syncedShas[filePath] = sha
  await store.set('syncedFileShas', syncedShas)
}

export interface FileMetadata {
  path: string
  localSha?: string
  remoteSha?: string
  lastModified?: number
  lastSyncTime?: number
  syncStatus: 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown'
}

export interface SyncResult {
  shouldUpdate: boolean
  action: 'none' | 'pull' | 'push' | 'conflict'
  localContent?: string
  remoteContent?: string
  reason?: string
}

/**
 * SHA 
 */
export async function calculateFileSha(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * （，）
 */
export async function getLocalFileMetadata(path: string): Promise<FileMetadata> {
  const workspace = await getWorkspacePath()
  
  //
  if (hasInvalidFileNameChars(path)) {
    path = sanitizeFilePath(path)
  }
  
  const pathOptions = await getFilePathOptions(path)
  
  try {
    let fileStat
    if (workspace.isCustom) {
      fileStat = await stat(pathOptions.path)
    } else {
      fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
    }

    let content = ''
    if (workspace.isCustom) {
      content = await readTextFile(pathOptions.path)
    } else {
      content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
    }

    return {
      path,
      localSha: await calculateFileSha(content),
      lastModified: fileStat.mtime?.getTime(),
      syncStatus: 'unknown'
    }
  } catch (error) {
    // ，，
    if (error instanceof Error && 
        (error.message.includes('no such file') || 
         error.message.includes('not found') ||
         error.message.includes('系统找不到指定的路径') || error.message.includes('cannot find the path'))) {
      return {
        path,
        syncStatus: 'unknown'
      }
    }
    
    return {
      path,
      syncStatus: 'unknown'
    }
  }
}

/**
 * 
 */
export async function getRemoteFileInfo(path: string): Promise<{ sha?: string; lastModified?: number }> {
  const store = await Store.load('store.json')
  const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'

  try {
    let file
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        file = await getGithubFiles({ path, repo: githubRepo })
        if (file) {
          //
          const commits = await getGithubFileCommits({ path, repo: githubRepo })
          if (commits && commits.length > 0) {
            return {
              sha: file.sha,
              lastModified: new Date(commits[0].commit.committer.date).getTime()
            }
          }
          // API SHA， undefined
          return { sha: undefined }
        }
        break

      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        file = await getGiteeFiles({ path, repo: giteeRepo })
        if (file) {
          const commits = await getGiteeFileCommits({ path, repo: giteeRepo })
          if (commits && commits.length > 0) {
            return {
              sha: file.sha,
              lastModified: new Date(commits[0].commit.committer.date).getTime()
            }
          }
          // API SHA， undefined
          return { sha: undefined }
        }
        break

      case 'gitlab': {
        const gitlabRepo = await getSyncRepoName('gitlab')
        const gitlabBranch = await getGitlabBranch()
        file = await getGitlabFileContent({ path, ref: gitlabBranch, repo: gitlabRepo })
        if (file) {
          const commits = await getGitlabFileCommits({ path, repo: gitlabRepo })
          if (commits && commits.data && commits.data.length > 0) {
            return {
              sha: commits.data[0].id,
              lastModified: new Date(commits.data[0].committed_date).getTime()
            }
          }
          // API SHA， undefined
          return { sha: undefined }
        }
        break
      }

      case 'gitea': {
        const giteaRepo = await getSyncRepoName('gitea')
        const giteaBranch = await getGiteaBranch()
        file = await getGiteaFileContent({ path, ref: giteaBranch, repo: giteaRepo })
        if (file) {
          const commits = await getGiteaFileCommits({ path, repo: giteaRepo })
          if (commits && commits.data && commits.data.length > 0) {
            return {
              sha: commits.data[0].sha,
              lastModified: new Date(commits.data[0].commit.committer.date).getTime()
            }
          }
          // API SHA， undefined
          return { sha: undefined }
        }
        break
      }
    }
  } catch {
    //
  }

  return { sha: undefined, lastModified: undefined }
}

/**
 * 
 * ： SHA-256 Git blob SHA（SHA-1），
 * SHA，
 */
export async function compareFileVersions(path: string): Promise<SyncResult> {
  // S3
  const store = await getStore()
  const platform = await store.get<string>('primaryBackupMethod')

  if (platform === 's3') {
    return compareS3FileVersions(path)
  }

  if (platform === 'webdav') {
    return compareWebDAVFileVersions(path)
  }

  const localMeta = await getLocalFileMetadata(path)
  const remoteInfo = await getRemoteFileInfo(path)

  //
  const syncStatus = await getFileSyncStatus(path)
  const lastSyncTime = syncStatus.lastSyncTime
  const lastRestoreTime = await getFileRestoreTime(path)

  // SHA ： SHA SHA
  if (remoteInfo.sha) {
    const localRecordedSha = await getLocalRecordedSha(path)

    // SHA SHA，
    if (localRecordedSha && localRecordedSha !== remoteInfo.sha) {
      // SHA ，，
      return {
        shouldUpdate: true,
        action: 'pull',
        reason: 'Remote file updated (SHA mismatch); pull required'
      }
    }

    // SHA，， SHA
    if (!localRecordedSha) {
      await setLocalRecordedSha(path, remoteInfo.sha)
    } else {
      // SHA ，，
      return {
        shouldUpdate: false,
        action: 'none',
        reason: 'SHA matches; file is in sync'
      }
    }
  }

  //
  if (!localMeta.localSha) {
    if (remoteInfo.sha) {
      return {
        shouldUpdate: true,
        action: 'pull',
        reason: 'Local file does not exist; pull from remote'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  // ，
  if (!remoteInfo.sha) {
    if (localMeta.localSha) {
      return {
        shouldUpdate: true,
        action: 'push',
        reason: 'Remote file does not exist; push to remote'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  // （ SHA，）
  const localTime = localMeta.lastModified || 0
  const remoteTime = remoteInfo.lastModified || 0

  // ，，（）
  if (localTime === 0 && remoteTime === 0) {
    return {
      shouldUpdate: true,
      action: 'conflict',
      reason: 'Could not determine file update times; manual resolution required'
    }
  }

  // （）， SHA
  if (remoteTime === 0 && remoteInfo.sha) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: 'Could not determine remote file update time; pulling remote version'
    }
  }

  // （）， SHA
  if (localTime === 0 && localMeta.localSha) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: 'Could not determine local file update time; pushing local version'
    }
  }

  // （10）： > ， ≈
  // ，，
  const PULL_GRACE_PERIOD = 10 * 1000 // 10
  if (localTime > remoteTime) {
    //
    const isInSyncGrace = lastSyncTime && localTime - lastSyncTime < PULL_GRACE_PERIOD
    const isInRestoreGrace = lastRestoreTime && localTime - lastRestoreTime < PULL_GRACE_PERIOD
    if (isInSyncGrace || isInRestoreGrace) {
      return {
        shouldUpdate: false,
        action: 'none',
        reason: 'Recently synced or restored; within buffer period, skip push'
      }
    }
  }

  if (remoteTime > localTime) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: 'Remote file is newer; pull required'
    }
  } else if (localTime > remoteTime) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: 'Local file is newer; push required'
    }
  }

  // Same mtime → treat as in sync
  return {
    shouldUpdate: false,
    action: 'none',
    reason: 'File modification times match; treated as in sync'
  }
}

/**
 * 
 */
export async function pullRemoteFile(path: string): Promise<string> {
  const store = await Store.load('store.json')
  const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'

  try {
    let file
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        file = await getGithubFiles({ path, repo: githubRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break

      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        file = await getGiteeFiles({ path, repo: giteeRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break

      case 'gitlab': {
        const gitlabRepo = await getSyncRepoName('gitlab')
        const gitlabBranch = await getGitlabBranch()
        file = await getGitlabFileContent({ path, ref: gitlabBranch, repo: gitlabRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break
      }

      case 'gitea': {
        const giteaRepo = await getSyncRepoName('gitea')
        const giteaBranch = await getGiteaBranch()
        file = await getGiteaFileContent({ path, ref: giteaBranch, repo: giteaRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break
      }

      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3File = await s3Download(s3Config, path)
          if (s3File) {
            return s3File.content
          }
        }
        break
      }

      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavFile = await webdavDownload(webdavConfig, path)
          if (webdavFile) {
            return webdavFile.content
          }
        }
        break
      }
    }
  } catch (error) {
    throw error
  }

  throw new Error('Could not fetch remote file content')
}

/**
 * ，
 */
export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const workspace = await getWorkspacePath()
  
  //
  if (hasInvalidFileNameChars(filePath)) {
    filePath = sanitizeFilePath(filePath)
  }
  
  //
  const dirPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : ''
  
  if (!dirPath) {
    return // ，
  }
  
  const pathOptions = await getFilePathOptions(dirPath)
  
  try {
    let dirExists = false
    if (workspace.isCustom) {
      dirExists = await exists(pathOptions.path)
    } else {
      dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    }
    
    if (!dirExists) {
      //
      if (workspace.isCustom) {
        await mkdir(pathOptions.path, { recursive: true })
      } else {
        await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true })
      }
    }
  } catch (error) {
    throw error
  }
}

/**
 * （，）
 */
export async function saveLocalFile(path: string, content: string): Promise<void> {
  const workspace = await getWorkspacePath()
  
  //
  if (hasInvalidFileNameChars(path)) {
    path = sanitizeFilePath(path)
  }
  
  //
  await ensureDirectoryExists(path)
  
  const pathOptions = await getFilePathOptions(path)
  
  try {
    if (workspace.isCustom) {
      await writeTextFile(pathOptions.path, content)
    } else {
      await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
    }
  } catch (error) {
    throw error
  }
}

/**
 * commit 
 */
export async function getRemoteCommitInfo(path: string): Promise<{
  sha: string
  message: string
  author: string
  date: Date
  additions?: number
  deletions?: number
} | null> {
  try {
    const store = await Store.load('store.json')
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
    const repo = await getSyncRepoName(primaryBackupMethod as 'github' | 'gitee' | 'gitlab' | 'gitea')
    
    let commits: any[] = []
    
    switch (primaryBackupMethod) {
      case 'github':
        commits = await getGithubFileCommits({ path, repo })
        break
      case 'gitee':
        commits = await getGiteeFileCommits({ path, repo })
        break
      case 'gitlab':
        const gitlabResult = await getGitlabFileCommits({ path, repo })
        commits = Array.isArray(gitlabResult) ? gitlabResult : []
        break
      case 'gitea':
        const giteaResult = await getGiteaFileCommits({ path, repo })
        commits = Array.isArray(giteaResult) ? giteaResult : []
        break
    }
    
    if (!commits || commits.length === 0) {
      return null
    }
    
    const latestCommit = commits[0]
    
    // commit
    let author = 'Unknown'
    let message = 'No message'
    let date = new Date()
    let sha = ''
    let additions: number | undefined
    let deletions: number | undefined
    
    if (primaryBackupMethod === 'github') {
      author = latestCommit.commit?.author?.name || 'Unknown'
      message = latestCommit.commit?.message || 'No message'
      date = new Date(latestCommit.commit?.author?.date || Date.now())
      sha = latestCommit.sha || ''
      additions = latestCommit.stats?.additions
      deletions = latestCommit.stats?.deletions
    } else if (primaryBackupMethod === 'gitee') {
      author = latestCommit.author?.name || 'Unknown'
      message = latestCommit.message || 'No message'
      date = new Date(latestCommit.created_at || Date.now())
      sha = latestCommit.sha || ''
    } else if (primaryBackupMethod === 'gitlab') {
      author = latestCommit.author_name || 'Unknown'
      message = latestCommit.message || 'No message'
      date = new Date(latestCommit.created_at || Date.now())
      sha = latestCommit.id || ''
    } else if (primaryBackupMethod === 'gitea') {
      author = latestCommit.commit?.author?.name || 'Unknown'
      message = latestCommit.commit?.message || 'No message'
      date = new Date(latestCommit.commit?.author?.date || Date.now())
      sha = latestCommit.sha || ''
    }
    
    return {
      sha,
      message,
      author,
      date,
      additions,
      deletions
    }
  } catch {
    return null
  }
}

/**
 * （， commit ）
 */
export async function autoSyncIfNeeded(path: string, options: {
  autoPull?: boolean
  showConfirm?: boolean
  enableConflictResolution?: boolean
} = {}): Promise<string | null> {
  const { autoPull = true, showConfirm = false, enableConflictResolution = true } = options
  
  try {
    //
    await cleanupExpiredLocks()
    
    //
    if (enableConflictResolution) {
      const lockInfo = await checkFileLock(path)
      if (lockInfo) {
        toast({
          title: 'File locked',
          description: `File ${lockInfo.userName}`,
          variant: 'destructive'
        })
        return null
      }
    }
    
    const syncResult = await compareFileVersions(path)
    
    if (!syncResult.shouldUpdate || syncResult.action === 'none') {
      return null
    }
    
    if (syncResult.action === 'pull' && autoPull) {
      if (showConfirm) {
        // commit
        const commitInfo = await getRemoteCommitInfo(path)

        //
        return new Promise<string | null>((resolve) => {
          useSyncConfirmStore.getState().showPullDialog({
            fileName: path || '',
            commitInfo: commitInfo || undefined,
            onConfirm: async () => {
              try {
                //
                const result = await performSync(path || '', enableConflictResolution)
                resolve(result)
              } catch {
                resolve(null)
              }
            },
            onCancel: () => {
              resolve(null)
            }
          })
        })
      } else {
        // （）
        return await performSync(path, enableConflictResolution)
      }
    }
    
    return null
  } catch {
    return null
  }
}

/**
 * 
 */
async function performSync(path: string, enableConflictResolution: boolean): Promise<string | null> {
  try {
    //
    let localContent = ''
    let actualPath = path
    
    //
    if (hasInvalidFileNameChars(path)) {
      actualPath = sanitizeFilePath(path)
    }
    
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(actualPath)
      if (workspace.isCustom) {
        localContent = await readTextFile(pathOptions.path)
      } else {
        localContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch (error) {
      // ，
      if (error instanceof Error && 
          (error.message.includes('no such file') || 
           error.message.includes('not found') ||
           error.message.includes('系统找不到指定的路径') || error.message.includes('cannot find the path'))) {
      } else {
        //
      }
      // ，
    }
    
    const remoteContent = await pullRemoteFile(path)

    // SHA， SHA
    const remoteInfo = await getRemoteFileInfo(path)
    const remoteSha = remoteInfo.sha

    //
    if (enableConflictResolution && localContent && localContent !== remoteContent) {
      const resolution = await detectAndHandleConflict(path, localContent, remoteContent)
      
      let finalContent = remoteContent
      switch (resolution.action) {
        case 'keep_local':
          finalContent = localContent
          toast({
            title: 'Keep local version',
            description: 'Keep local version'
          })
          break
        case 'keep_remote':
          finalContent = remoteContent
          toast({
            title: 'Use remote version',
            description: 'Use remote version'
          })
          break
        case 'merge':
          finalContent = mergeSimpleContent(localContent, remoteContent)
          toast({
            title: 'Auto-merge succeeded',
            description: 'Auto-merge succeeded'
          })
          break
        case 'manual':
          toast({
            title: 'Manual resolution required',
            description: 'Conflict is complex; please resolve it manually',
            variant: 'destructive'
          })
          return null
      }
      
      await saveLocalFile(actualPath, finalContent)
      await updateFileSyncTime(actualPath)

      // ， SHA
      if (remoteSha) {
        await setLocalRecordedSha(actualPath, remoteSha)
      }

      //
      emitter.emit('sync-content-updated', { path: actualPath, content: finalContent })

      return finalContent
    } else {
      // ，
      await saveLocalFile(actualPath, remoteContent)
      await updateFileSyncTime(actualPath)

      // ， SHA
      if (remoteSha) {
        await setLocalRecordedSha(actualPath, remoteSha)
      }

      //
      emitter.emit('sync-content-updated', { path: actualPath, content: remoteContent })

      return remoteContent
    }
  } catch {
    return null
  }
  
  return null
}

/**
 * 
 */
export async function hasNetworkConnection(): Promise<boolean> {
  try {
    const store = await Store.load('store.json')
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'

    // ： API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10

    let url = ''
    let token = ''
    let proxy: Proxy | undefined = undefined

    switch (primaryBackupMethod) {
      case 'github':
        token = await store.get<string>('accessToken') || ''
        url = 'https://api.github.com/user'
        break
      case 'gitee':
        token = await store.get<string>('giteeAccessToken') || ''
        url = 'https://gitee.com/api/v5/user'
        break
      case 'gitlab':
        token = await store.get<string>('gitlabAccessToken') || ''
        const gitlabUrl = await store.get<string>('gitlabUrl') || 'https://gitlab.com'
        url = `${gitlabUrl}/api/v4/user`
        break
      case 'gitea':
        token = await store.get<string>('giteaAccessToken') || ''
        url = `${await getGiteaApiBaseUrl()}/user`
        // Gitea
        const giteaProxyUrl = await store.get<string>('proxy')
        if (giteaProxyUrl) {
          proxy = { all: giteaProxyUrl }
        }
        break
      default:
        clearTimeout(timeoutId)
        return false
    }

    if (!token) {
      clearTimeout(timeoutId)
      return false
    }

    const fetchOptions: any = {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }

    // Gitea
    if (proxy) {
      fetchOptions.proxy = proxy
    }

    const response = await fetch(url, fetchOptions)

    clearTimeout(timeoutId)
    return response.ok
  } catch (error) {
    // 、
    console.error('Network connection check failed:', error)
    return false
  }
}

/**
 * S3 
 * ETag 
 */
export async function compareS3FileVersions(path: string): Promise<SyncResult> {
  // S3
  const store = await getStore()
  const config = await store.get<S3Config>('s3SyncConfig')
  if (!config) {
    return { shouldUpdate: false, action: 'none', reason: 'S3 not configured' }
  }

  // proxy
  const proxyUrl = await store.get<string>('proxy')
  const proxy = proxyUrl ? { all: proxyUrl } : undefined

  //
  const localMeta = await getLocalFileMetadata(path)

  // sync store ETag
  const syncStoreState = useSyncStore.getState()
  const localRecordedEtag = syncStoreState.s3FileEtags[path]

  // ETag
  const remoteInfo = await s3HeadObject(config, path, proxy)

  //
  if (!remoteInfo) {
    if (localMeta.localSha) {
      return {
        shouldUpdate: true,
        action: 'push',
        reason: 'Remote file does not exist; push to remote'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  //
  if (!localMeta.localSha) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: 'Local file does not exist; pull from remote'
    }
  }

  // ETag
  if (localRecordedEtag && localRecordedEtag !== remoteInfo.etag) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: 'Remote file updated (ETag mismatch); pull required'
    }
  }

  // ETag
  if (localRecordedEtag === remoteInfo.etag) {
    return {
      shouldUpdate: false,
      action: 'none',
      reason: 'ETag matches; file is in sync'
    }
  }

  // ETag，
  //
  const localTime = localMeta.lastModified || 0
  const remoteTime = remoteInfo.lastModified ? new Date(remoteInfo.lastModified).getTime() : 0

  if (localTime > remoteTime) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: 'Local file is newer; push required'
    }
  }

  return {
    shouldUpdate: true,
    action: 'pull',
    reason: 'Remote file is newer; pull required'
  }
}

/**
 * WebDAV 
 * ETag 
 */
export async function compareWebDAVFileVersions(path: string): Promise<SyncResult> {
  // WebDAV
  const store = await getStore()
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (!config) {
    return { shouldUpdate: false, action: 'none', reason: 'WebDAV is not configured' }
  }

  // proxy
  const proxyUrl = await store.get<string>('proxy')
  const proxy = proxyUrl ? { all: proxyUrl } : undefined

  //
  const localMeta = await getLocalFileMetadata(path)

  // sync store ETag
  const syncStoreState = useSyncStore.getState()
  const localRecordedEtag = syncStoreState.webdavFileEtags[path]

  // ETag
  const remoteInfo = await webdavHeadObject(config, path, proxy)

  //
  if (!remoteInfo) {
    if (localMeta.localSha) {
      return {
        shouldUpdate: true,
        action: 'push',
        reason: 'Remote file does not exist; push to remote'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  //
  if (!localMeta.localSha) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: 'Local file does not exist; pull from remote'
    }
  }

  // ETag
  if (localRecordedEtag && localRecordedEtag !== remoteInfo.etag) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: 'Remote file updated (ETag mismatch); pull required'
    }
  }

  // ETag
  if (localRecordedEtag === remoteInfo.etag) {
    return {
      shouldUpdate: false,
      action: 'none',
      reason: 'ETag matches; file is in sync'
    }
  }

  // ETag，
  //
  const localTime = localMeta.lastModified || 0
  const remoteTime = remoteInfo.lastModified ? new Date(remoteInfo.lastModified).getTime() : 0

  if (localTime > remoteTime) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: 'Local file is newer; push required'
    }
  }

  return {
    shouldUpdate: true,
    action: 'pull',
    reason: 'Remote file is newer; pull required'
  }
}
