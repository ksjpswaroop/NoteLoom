import { Store } from '@tauri-apps/plugin-store'
import { calculateFileSha, getLocalFileMetadata, getRemoteFileInfo, compareFileVersions, pullRemoteFile, saveLocalFile, setLocalRecordedSha } from './auto-sync'
import { decodeBase64ToString } from './github'
import { updateFileSyncTime } from './conflict-resolution'
import { getSyncRepoName } from './repo-utils'
import { uploadFile as uploadToGithub, getFiles as getGithubFiles, deleteFile as deleteGithubFile } from './github'
import { uploadFile as uploadToGitee, getFiles as getGiteeFiles, deleteFile as deleteGiteeFile } from './gitee'
import { uploadFile as uploadToGitlab, getFileContent as getGitlabFile, deleteFile as deleteGitlabFile } from './gitlab'
import { uploadFile as uploadToGitea, getFileContent as getGiteaFile, deleteFile as deleteGiteaFile } from './gitea'
import { s3Upload, s3Download, s3Delete } from './s3'
import { webdavUpload, webdavDownload, webdavDelete } from './webdav'
import { S3Config, WebDAVConfig } from '@/types/sync'
import useSyncStore from '@/stores/sync'
import { toast } from '@/hooks/use-toast'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { shouldExclude } from '@/config/sync-exclusions'

/**
 * GitLab 
 */
async function getGitlabBranch(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('gitlabBranch') || 'main'
}

/**
 * Gitea 
 */
async function getGiteaBranch(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('giteaBranch') || 'main'
}

/**
 * S3 
 */
async function getS3Config(): Promise<S3Config | null> {
  const store = await Store.load('store.json')
  const config = await store.get<S3Config>('s3SyncConfig')
  if (config && config.accessKeyId && config.secretAccessKey && config.region && config.bucket) {
    return config
  }
  return null
}

/**
 * WebDAV 
 */
async function getWebDAVConfig(): Promise<WebDAVConfig | null> {
  const store = await Store.load('store.json')
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (config && config.url && config.username && config.password) {
    return config
  }
  return null
}

//
export interface SyncConfig {
  autoSync: boolean           //
  autoPushOnSave: boolean     // Save
  autoPullOnOpen: boolean     //
  conflictPolicy: 'ask' | 'local' | 'remote'
}

export const defaultSyncConfig: SyncConfig = {
  autoSync: true,
  autoPushOnSave: true,
  autoPullOnOpen: true,       //
  conflictPolicy: 'ask'
}

//
export interface SyncState {
  isSyncing: boolean          //
  pendingSync: boolean         //
  lastSyncTime: number        //
  lastSyncSha: string         // SHA
  syncStatus: 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown'
}

//
export interface SyncResult {
  success: boolean
  action: 'push' | 'pull' | 'delete' | 'none' | 'conflict'
  message?: string
  error?: string
}

//
export interface SyncLog {
  timestamp: number
  action: 'push' | 'pull' | 'delete'
  filePath: string
  success: boolean
  error?: string
}

//
export class SyncManager {
  private config: SyncConfig = { ...defaultSyncConfig }
  private state: SyncState = {
    isSyncing: false,
    pendingSync: false,
    lastSyncTime: 0,
    lastSyncSha: '',
    syncStatus: 'unknown'
  }
  private syncQueue: Map<string, { timestamp: number }> = new Map()
  private throttleTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.loadConfig()
  }

  /**
 * 
 */
  async loadConfig(): Promise<void> {
    try {
      // sync_config.json
      const syncStore = await Store.load('sync_config.json')
      const savedConfig = await syncStore.get<SyncConfig>('config')
      if (savedConfig) {
        this.config = { ...defaultSyncConfig, ...savedConfig }
      }

      // store.json autoPull
      const settingStore = await Store.load('store.json')
      const autoPullOnOpen = await settingStore.get<boolean>('autoPullOnOpen')

      //
      if (autoPullOnOpen !== undefined && autoPullOnOpen !== null) {
        this.config.autoPullOnOpen = autoPullOnOpen
      }
    } catch {
      //
    }
  }

  /**
 * 
 */
  async saveConfig(): Promise<void> {
    try {
      const store = await Store.load('sync_config.json')
      await store.set('config', this.config)
      await store.save()
    } catch {
      //
    }
  }

  /**
 * 
 */
  async updateConfig(config: Partial<SyncConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
    await this.saveConfig()
  }

  /**
 * 
 */
  getConfig(): SyncConfig {
    return { ...this.config }
  }

  /**
 * 
 */
  getState(): SyncState {
    return { ...this.state }
  }

  /**
 * 
 */
  async getCurrentPlatform(): Promise<string> {
    const store = await Store.load('store.json')
    return await store.get<string>('primaryBackupMethod') || 'github'
  }

  /**
 * SHA
 */
  async calculateSha(content: string): Promise<string> {
    return await calculateFileSha(content)
  }

  /**
 * SHA
 */
  async getLocalSha(path: string): Promise<string | null> {
    const meta = await getLocalFileMetadata(path)
    return meta.localSha || null
  }

  /**
 * SHA
 */
  async getRemoteSha(path: string): Promise<string | null> {
    const info = await getRemoteFileInfo(path)
    return info.sha || null
  }

  /**
 * 
 */
  async pushFile(path: string, content: string): Promise<SyncResult> {
    //
    if (shouldExclude(path)) {
      return { success: true, action: 'none', message: 'File is excluded from sync' }
    }

    try {
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      // S3 repo，
      const repo = (platform === 's3' || platform === 'webdav') ? '' : await getSyncRepoName(platform)
      const sha = (platform === 's3' || platform === 'webdav') ? undefined : await this.getRemoteSha(path) || undefined
      const message = `Sync: ${path} - ${new Date().toLocaleString('en-US')}`
      const filename = path.split('/').pop() || path

      let uploadSuccess = false

      switch (platform) {
        case 'github': {
          const result = await uploadToGithub({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitee': {
          const result = await uploadToGitee({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitlab': {
          const result = await uploadToGitlab({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitea': {
          const result = await uploadToGitea({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'push', error: 'S3 configuration not found' }
          }
          // S3 key， pathPrefix
          const result = await s3Upload(s3Config, path, content)
          uploadSuccess = !!result
          if (uploadSuccess && result) {
            // ETag
            useSyncStore.getState().updateS3FileEtag(path, result.etag)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'push', error: 'WebDAV configuration not found' }
          }
          const result = await webdavUpload(webdavConfig, path, content)
          uploadSuccess = !!result
          if (uploadSuccess && result) {
            // ETag
            useSyncStore.getState().updateWebDAVFileEtag(path, result.etag)
          }
          break
        }
      }

      if (uploadSuccess) {
        // SHA
        if (platform !== 's3' && platform !== 'webdav') {
          const newRemoteSha = await this.getRemoteSha(path)
          if (newRemoteSha) {
            await setLocalRecordedSha(path, newRemoteSha)
          }
        }
        await this.logSync(path, 'push', true)
        return { success: true, action: 'push', message: 'Push succeeded' }
      }

      await this.logSync(path, 'push', false, 'Push failed')
      return { success: false, action: 'push', error: 'Push failed' }
    } catch (error) {
      await this.logSync(path, 'push', false, String(error))
      return { success: false, action: 'push', error: String(error) }
    }
  }

  /**
 * 
 */
  async pullFile(path: string): Promise<SyncResult> {
    try {
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      // S3 repo
      const repo = (platform === 's3' || platform === 'webdav') ? '' : await getSyncRepoName(platform)

      let content: string | undefined

      switch (platform) {
        case 'github':
          const githubFile = await getGithubFiles({ path, repo })
          content = githubFile?.content
          break
        case 'gitee':
          const giteeFile = await getGiteeFiles({ path, repo })
          content = giteeFile?.content
          break
        case 'gitlab': {
          const branch = await getGitlabBranch()
          const gitlabFile = await getGitlabFile({ path, ref: branch, repo })
          content = gitlabFile?.content
          break
        }
        case 'gitea': {
          const branch = await getGiteaBranch()
          const giteaFile = await getGiteaFile({ path, ref: branch, repo })
          content = giteaFile?.content
          break
        }
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'pull', error: 'S3 configuration not found' }
          }
          // S3 key
          const s3File = await s3Download(s3Config, path)
          if (s3File) {
            content = s3File.content
            // ETag
            useSyncStore.getState().updateS3FileEtag(path, s3File.etag)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'pull', error: 'WebDAV configuration not found' }
          }
          const webdavFile = await webdavDownload(webdavConfig, path)
          if (webdavFile) {
            content = webdavFile.content
            // ETag
            useSyncStore.getState().updateWebDAVFileEtag(path, webdavFile.etag)
          }
          break
        }
      }

      if (content) {
        // S3 WebDAV base64 ，
        let decodedContent = content
        if (platform !== 's3' && platform !== 'webdav') {
          decodedContent = decodeBase64ToString(content)
        }
        await saveLocalFile(path, decodedContent)

        // SHA
        if (platform !== 's3' && platform !== 'webdav') {
          const remoteSha = await this.getRemoteSha(path)
          if (remoteSha) {
            await setLocalRecordedSha(path, remoteSha)
          }
        }

        await updateFileSyncTime(path)
        await this.logSync(path, 'pull', true)
        return { success: true, action: 'pull', message: 'Remote file does not exist' }
      }

      await this.logSync(path, 'pull', false, 'File does not exist')
      return { success: false, action: 'pull', error: 'Remote file does not exist' }
    } catch (error) {
      await this.logSync(path, 'pull', false, String(error))
      return { success: false, action: 'pull', error: String(error) }
    }
  }

  /**
 * 
 */
  async deleteRemoteFile(path: string): Promise<SyncResult> {
    try {
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      // S3 repo
      const repo = (platform === 's3' || platform === 'webdav') ? '' : await getSyncRepoName(platform)
      const sha = (platform === 's3' || platform === 'webdav') ? undefined : await this.getRemoteSha(path)

      // S3 WebDAV SHA，
      if ((platform !== 's3' && platform !== 'webdav') && !sha) {
        return { success: true, action: 'none', message: 'Remote file does not exist; nothing to delete' }
      }

      let success = false

      switch (platform) {
        case 'github':
          success = !!(await deleteGithubFile({ path, sha: sha!, repo }))
          break
        case 'gitee':
          success = !!(await deleteGiteeFile({ path, sha: sha!, repo }))
          break
        case 'gitlab':
          success = !!(await deleteGitlabFile({ path, sha: sha!, repo }))
          break
        case 'gitea':
          success = !!(await deleteGiteaFile({ path, sha: sha!, repo }))
          break
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'delete', error: 'S3 configuration not found' }
          }
          // S3 key
          success = await s3Delete(s3Config, path)
          if (success) {
            // ETag
            useSyncStore.getState().removeS3FileEtag(path)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'delete', error: 'WebDAV configuration not found' }
          }
          success = await webdavDelete(webdavConfig, path)
          if (success) {
            // ETag
            useSyncStore.getState().removeWebDAVFileEtag(path)
          }
          break
        }
      }

      if (success) {
        await this.logSync(path, 'delete', true)
        return { success: true, action: 'delete', message: 'Delete succeeded' }
      }

      await this.logSync(path, 'delete', false, 'Delete failed')
      return { success: false, action: 'delete', error: 'Delete failed' }
    } catch (error) {
      await this.logSync(path, 'delete', false, String(error))
      return { success: false, action: 'delete', error: String(error) }
    }
  }

  /**
 * 
 */
  async resolveConflict(path: string, strategy: 'ask' | 'local' | 'remote', localContent?: string, remoteContent?: string): Promise<SyncResult> {
    try {
      // ask，
      if (strategy === 'ask') {
        // UI ，
        return { success: false, action: 'conflict', message: 'User choice required' }
      }

      //
      if (!localContent) {
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        try {
          localContent = workspace.isCustom
            ? await readTextFile(pathOptions.path)
            : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        } catch {
          localContent = ''
        }
      }

      if (!remoteContent) {
        remoteContent = await pullRemoteFile(path)
      }

      switch (strategy) {
        case 'local':
          // ，
          await this.deleteRemoteFile(path)
          await this.pushFile(path, localContent)
          toast({ title: 'Keep local version', description: 'Keep local version' })
          break
        case 'remote':
          //
          await saveLocalFile(path, remoteContent)
          await updateFileSyncTime(path)
          toast({ title: 'Use remote version', description: 'Use remote version' })
          break
      }

      return { success: true, action: 'push', message: 'Conflict resolved' }
    } catch (error) {
      return { success: false, action: 'conflict', error: String(error) }
    }
  }

  /**
 * 
 */
  async syncFile(path: string, options: {
    onConflict?: (local: string, remote: string) => Promise<'local' | 'remote' | 'cancel'>
  } = {}): Promise<SyncResult> {
    //
    if (this.state.isSyncing) {
      this.state.pendingSync = true
      return { success: true, action: 'none', message: 'Sync in progress; marked as pending' }
    }

    this.state.isSyncing = true

    try {
      // SHA
      const localSha = await this.getLocalSha(path)
      const remoteSha = await this.getRemoteSha(path)

      //
      const syncResult = await compareFileVersions(path)

      if (syncResult.action === 'none') {
        return { success: true, action: 'none', message: 'File is already in sync' }
      }

      if (syncResult.action === 'push') {
        //
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

        const result = await this.pushFile(path, content)
        this.state.lastSyncTime = Date.now()
        this.state.lastSyncSha = localSha || ''
        return result
      }

      if (syncResult.action === 'pull') {
        //
        const result = await this.pullFile(path)
        this.state.lastSyncTime = Date.now()
        this.state.lastSyncSha = remoteSha || ''
        return result
      }

      if (syncResult.action === 'conflict' && options.onConflict) {
        //
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const localContent = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        const remoteContent = await pullRemoteFile(path)
        const choice = await options.onConflict(localContent, remoteContent)

        if (choice === 'cancel') {
          return { success: false, action: 'conflict', error: 'Cancelled by user' }
        }

        return await this.resolveConflict(path, choice, localContent, remoteContent)
      }

      return { success: true, action: 'none' }
    } finally {
      this.state.isSyncing = false

      // ，
      if (this.state.pendingSync) {
        this.state.pendingSync = false
        await this.syncFile(path, options)
      }
    }
  }

  /**
 * （）
 */
  async onSave(path: string): Promise<void> {
    if (!this.config.autoSync || !this.config.autoPushOnSave) {
      return
    }

    //
    if (shouldExclude(path)) {
      return
    }

    // （）
    this.syncQueue.set(path, { timestamp: Date.now() })

    // ，
    if (this.state.isSyncing) {
      this.state.pendingSync = true
      return
    }

    // 2
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
    }

    this.throttleTimer = setTimeout(async () => {
      await this.processSyncQueue()
    }, 2000)
  }

  /**
 * 
 * { updated: true, content: string } 
 */
  async onOpen(path: string): Promise<{ updated: boolean; content?: string } | null> {
    if (!this.config.autoSync || !this.config.autoPullOnOpen) {
      return null
    }

    //
    if (shouldExclude(path)) {
      return null
    }

    // ，
    const syncResult = await compareFileVersions(path)

    if (syncResult.action === 'pull') {
      const result = await this.pullFile(path)
      if (result.success && result.action === 'pull') {
        //
        try {
          const { pullRemoteFile } = await import('./auto-sync')
          const content = await pullRemoteFile(path)
          return { updated: true, content }
        } catch {
          return { updated: true }
        }
      }
      return { updated: result.success }
    }

    // ： SHA （）
    if (syncResult.action === 'conflict') {
      const result = await this.pullFile(path)
      if (result.success && result.action === 'pull') {
        try {
          const { pullRemoteFile } = await import('./auto-sync')
          const content = await pullRemoteFile(path)
          return { updated: true, content }
        } catch {
          return { updated: true }
        }
      }
      return { updated: result.success }
    }

    return null
  }

  /**
 * 
 */
  private async processSyncQueue(): Promise<void> {
    this.state.isSyncing = true

    try {
      for (const [path] of this.syncQueue) {
        // ，
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)

        let content: string
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        const result = await this.pushFile(path, content)
        if (result.success) {
          this.syncQueue.delete(path)
        }
      }
    } finally {
      this.state.isSyncing = false
      this.state.pendingSync = false
    }
  }

  /**
 * 
 */
  async syncAll(paths: string[]): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    for (const path of paths) {
      const result = await this.syncFile(path)
      results.push(result)
    }

    return results
  }

  /**
 * 
 */
  private async logSync(filePath: string, action: 'push' | 'pull' | 'delete', success: boolean, error?: string): Promise<void> {
    try {
      const store = await Store.load('sync_logs.json')
      const logs = await store.get<SyncLog[]>('logs') || []

      logs.unshift({
        timestamp: Date.now(),
        action,
        filePath,
        success,
        error
      })

      // 100
      if (logs.length > 100) {
        logs.splice(100)
      }

      await store.set('logs', logs)
      await store.save()
    } catch {
    }
  }

  /**
 * 
 */
  async getLogs(limit?: number): Promise<SyncLog[]> {
    try {
      const store = await Store.load('sync_logs.json')
      const logs = await store.get<SyncLog[]>('logs') || []
      return limit ? logs.slice(0, limit) : logs
    } catch {
      return []
    }
  }

  /**
 * 
 */
  async clearLogs(): Promise<void> {
    try {
      const store = await Store.load('sync_logs.json')
      await store.set('logs', [])
      await store.save()
    } catch {
    }
  }

  /**
 * 
 */
  async getFileSyncStatus(path: string): Promise<SyncState['syncStatus']> {
    const localSha = await this.getLocalSha(path)
    const remoteSha = await this.getRemoteSha(path)

    if (!localSha && !remoteSha) {
      return 'unknown'
    }

    if (!localSha) {
      return 'remote_newer'
    }

    if (!remoteSha) {
      return 'local_newer'
    }

    if (localSha === remoteSha) {
      return 'synced'
    }

    return 'conflict'
  }
}

//
let syncManager: SyncManager | null = null

export function getSyncManager(): SyncManager {
  if (!syncManager) {
    syncManager = new SyncManager()
  }
  return syncManager
}

//
export async function syncOnSave(path: string): Promise<void> {
  const manager = getSyncManager()
  await manager.onSave(path)
}

export async function syncOnOpen(path: string): Promise<{ updated: boolean; content?: string } | null> {
  const manager = getSyncManager()
  return await manager.onOpen(path)
}

export async function syncSingleFile(path: string, onConflict?: (local: string, remote: string) => Promise<'local' | 'remote' | 'cancel'>): Promise<SyncResult> {
  const manager = getSyncManager()
  return await manager.syncFile(path, { onConflict })
}

function hasConfiguredText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

/**
 * 
 * 
 */
export async function isSyncConfigured(): Promise<boolean> {
  try {
    const store = await Store.load('store.json')
    const platform = await store.get<string>('primaryBackupMethod') || 'github'

    // （）
    switch (platform) {
      case 'github': {
        const token = await store.get<string>('accessToken')
        const username = await store.get<string>('githubUsername')
        return hasConfiguredText(token) && hasConfiguredText(username)
      }
      case 'gitee': {
        const giteeToken = await store.get<string>('giteeAccessToken')
        const giteeUsername = await store.get<string>('giteeUsername')
        return hasConfiguredText(giteeToken) && hasConfiguredText(giteeUsername)
      }
      case 'gitlab': {
        const gitlabToken = await store.get<string>('gitlabAccessToken')
        const gitlabUsername = await store.get<string>('gitlabUsername')
        const repo = await getSyncRepoName('gitlab')
        const projectId = await store.get<string>(`gitlab_${repo}_project_id`)
        const instanceType = await store.get<string>('gitlabInstanceType')
        const customUrl = await store.get<string>('gitlabCustomUrl')
        const instanceConfigured = instanceType !== 'self-hosted' || hasConfiguredText(customUrl)

        return hasConfiguredText(gitlabToken) &&
          hasConfiguredText(gitlabUsername) &&
          hasConfiguredText(projectId) &&
          instanceConfigured
      }
      case 'gitea': {
        const giteaToken = await store.get<string>('giteaAccessToken')
        const giteaUsername = await store.get<string>('giteaUsername')
        const instanceType = await store.get<string>('giteaInstanceType')
        const customUrl = await store.get<string>('giteaCustomUrl')
        const instanceConfigured = instanceType !== 'self-hosted' || hasConfiguredText(customUrl)

        return hasConfiguredText(giteaToken) &&
          hasConfiguredText(giteaUsername) &&
          instanceConfigured
      }
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        return Boolean(s3Config) &&
          hasConfiguredText(s3Config?.accessKeyId) &&
          hasConfiguredText(s3Config?.secretAccessKey) &&
          hasConfiguredText(s3Config?.region) &&
          hasConfiguredText(s3Config?.bucket)
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        return Boolean(webdavConfig) &&
          hasConfiguredText(webdavConfig?.url) &&
          hasConfiguredText(webdavConfig?.username) &&
          hasConfiguredText(webdavConfig?.password)
      }
      default:
        return false
    }
  } catch {
    return false
  }
}
