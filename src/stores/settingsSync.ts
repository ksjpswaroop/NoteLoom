import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { filterSyncData, mergeSyncData } from '@/config/sync-exclusions'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github'
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee'
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab'
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea'
import { getRemoteFileContent, hasEmptyRemoteFileContent, isMissingRemoteFileError } from '@/lib/sync/remote-file'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { s3Download, s3Upload } from '@/lib/sync/s3'
import { webdavDownload, webdavUpload } from '@/lib/sync/webdav'
import { setAutoDataSyncApplyingRemote } from '@/lib/sync/auto-data-sync-queue'
import type { S3Config, WebDAVConfig } from '@/types/sync'

type SettingsSyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
type GitSettingsSyncProvider = Exclude<SettingsSyncProvider, 's3' | 'webdav'>
type RemoteFileEntry = {
  name?: string
  path?: string
  type?: string
  sha?: string
}
interface SettingsDownloadOptions {
  allowMissingRemote?: boolean
}
function debugSettingsSync(message: string, details?: Record<string, unknown>) {
  void message
  void details
}

function isRemoteFileEntry(value: unknown): value is RemoteFileEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRemoteFileSha(file: unknown, filename: string): string | undefined {
  if (Array.isArray(file)) {
    return file.find((entry: unknown) => (
      isRemoteFileEntry(entry) &&
      entry.name === filename &&
      typeof entry.sha === 'string'
    ))?.sha
  }

  if (isRemoteFileEntry(file) && typeof file.sha === 'string') {
    return file.sha
  }

  return undefined
}

interface SettingsSyncState {
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  
  uploadSettings: () => Promise<boolean>
  downloadSettings: (options?: SettingsDownloadOptions) => Promise<boolean>
}

const useSettingsSyncStore = create<SettingsSyncState>((set) => ({
  syncState: false,
  setSyncState: (syncState) => set({ syncState }),
  
  lastSyncTime: '',
  setLastSyncTime: (lastSyncTime) => set({ lastSyncTime }),
  
  /**
 * 
 * （）
 */
  uploadSettings: async () => {
    try {
      const store = await Store.load('store.json')
      const primaryBackupMethod = await store.get<SettingsSyncProvider>('primaryBackupMethod') || 'github'
      const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
      debugSettingsSync('upload started', {
        provider: primaryBackupMethod,
        excludeSensitiveConfig,
      })
      
      //
      const allSettings: Record<string, unknown> = {}
      const entries = await store.entries()
      
      for (const [key, value] of entries) {
        allSettings[key] = value
      }
      
      //
      const syncableSettings = filterSyncData(allSettings, { excludeSensitiveConfig })
      debugSettingsSync('settings filtered for upload', {
        totalKeys: Object.keys(allSettings).length,
        syncableKeys: Object.keys(syncableSettings).length,
        path: '.data/settings.json',
      })
      
      // JSON
      const content = JSON.stringify(syncableSettings, null, 2)
      
      if (primaryBackupMethod === 's3') {
        const config = await store.get<S3Config>('s3SyncConfig')
        if (!config) {
          return false
        }

        const result = await s3Upload(config, '.data/settings.json', content)
        debugSettingsSync('s3 upload result', { success: Boolean(result) })
        if (result) {
          set({ lastSyncTime: new Date().toISOString() })
          return true
        }

        return false
      }

      if (primaryBackupMethod === 'webdav') {
        const config = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (!config) {
          return false
        }

        const result = await webdavUpload(config, '.data/settings.json', content)
        debugSettingsSync('webdav upload result', { success: Boolean(result) })
        if (result) {
          set({ lastSyncTime: new Date().toISOString() })
          return true
        }

        return false
      }

      //
      const repoName = await getSyncRepoName(primaryBackupMethod as GitSettingsSyncProvider)
      
      //
      let uploadFile: typeof uploadGithubFile
      let getFiles: typeof githubGetFiles
      
      switch (primaryBackupMethod) {
        case 'gitee':
          uploadFile = uploadGiteeFile
          getFiles = giteeGetFiles
          break
        case 'gitlab':
          uploadFile = uploadGitlabFile
          getFiles = gitlabGetFiles
          break
        case 'gitea':
          uploadFile = uploadGiteaFile
          getFiles = giteaGetFiles
          break
        default:
          uploadFile = uploadGithubFile
          getFiles = githubGetFiles
      }
      
      //
      const settingsPath = '.data/settings.json'
      const existingFile = await getFiles({
        path: settingsPath,
        repo: repoName,
      })
      const existingSha = getRemoteFileSha(existingFile, 'settings.json')
      debugSettingsSync('git upload target resolved', {
        provider: primaryBackupMethod,
        path: settingsPath,
        hasExistingSha: Boolean(existingSha),
      })
      const result = await uploadFile({
        file: content,
        filename: 'settings.json',
        repo: repoName,
        path: settingsPath,
        sha: existingSha,
      })
      debugSettingsSync('git upload result', {
        provider: primaryBackupMethod,
        success: Boolean(result),
      })
      
      if (result) {
        //
        const now = new Date().toISOString()
        set({ lastSyncTime: now })
        return true
      }
      
      return false
    } catch (error) {
      console.error('Failed to upload settings:', error)
      debugSettingsSync('upload failed', {
        message: error instanceof Error ? error.message : 'unknown error',
      })
      return false
    }
  },
  
  /**
 * 
 * （）
 */
  downloadSettings: async (options: SettingsDownloadOptions = {}) => {
    try {
      const store = await Store.load('store.json')
      const primaryBackupMethod = await store.get<SettingsSyncProvider>('primaryBackupMethod') || 'github'
      const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
      debugSettingsSync('download started', {
        provider: primaryBackupMethod,
        excludeSensitiveConfig,
      })
      
      // （）
      const localSettings: Record<string, unknown> = {}
      const entries = await store.entries()
      
      for (const [key, value] of entries) {
        localSettings[key] = value
      }
      
      let remoteSettings: Record<string, unknown> | null = null

      if (primaryBackupMethod === 's3') {
        const config = await store.get<S3Config>('s3SyncConfig')
        if (!config) {
          return false
        }

        const file = await s3Download(config, '.data/settings.json')
        debugSettingsSync('s3 download result', { success: Boolean(file) })
        if (!file) {
          return Boolean(options.allowMissingRemote)
        }

        remoteSettings = JSON.parse(file.content)
      } else if (primaryBackupMethod === 'webdav') {
        const config = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (!config) {
          return false
        }

        const file = await webdavDownload(config, '.data/settings.json')
        debugSettingsSync('webdav download result', { success: Boolean(file) })
        if (!file) {
          return Boolean(options.allowMissingRemote)
        }

        remoteSettings = JSON.parse(file.content)
      }

      //
      const repoName = primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav'
        ? ''
        : await getSyncRepoName(primaryBackupMethod as GitSettingsSyncProvider)

      //
      let getFiles: typeof githubGetFiles

      switch (primaryBackupMethod) {
        case 'gitee':
          getFiles = giteeGetFiles
          break
        case 'gitlab':
          getFiles = gitlabGetFiles
          break
        case 'gitea':
          getFiles = giteaGetFiles
          break
        default:
          getFiles = githubGetFiles
      }
      
      //
      if (!remoteSettings) {
        const settingsPath = '.data/settings.json'
        const files = primaryBackupMethod === 'gitlab'
          ? await gitlabGetFileContent({ path: settingsPath, ref: 'main', repo: repoName })
          : primaryBackupMethod === 'gitea'
          ? await giteaGetFileContent({ path: settingsPath, ref: 'main', repo: repoName })
          : await getFiles({
              path: settingsPath,
              repo: repoName,
            })

        if (!files) {
          debugSettingsSync('git download result', {
            provider: primaryBackupMethod,
            success: false,
            skippedMissingRemote: Boolean(options.allowMissingRemote),
          })
          return Boolean(options.allowMissingRemote)
        }

        if (options.allowMissingRemote && hasEmptyRemoteFileContent(files)) {
          debugSettingsSync('download skipped because remote settings file is empty or missing', {
            provider: primaryBackupMethod,
          })
          return true
        }

        debugSettingsSync('git download result', {
          provider: primaryBackupMethod,
          success: true,
        })

        // base64
        const content = decodeBase64ToString(getRemoteFileContent(files, settingsPath))
        remoteSettings = JSON.parse(content)
      }

      if (!remoteSettings) {
        return false
      }
      
      // ：，
      const mergedSettings = mergeSyncData(localSettings, remoteSettings, { excludeSensitiveConfig })
      debugSettingsSync('settings merged from remote', {
        localKeys: Object.keys(localSettings).length,
        remoteKeys: Object.keys(remoteSettings).length,
        mergedKeys: Object.keys(mergedSettings).length,
      })
      
      //
      setAutoDataSyncApplyingRemote(true)
      try {
        for (const [key, value] of Object.entries(mergedSettings)) {
          await store.set(key, value)
        }
        await store.save()
      } finally {
        setAutoDataSyncApplyingRemote(false)
      }
      
      //
      const now = new Date().toISOString()
      set({ lastSyncTime: now })
      
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      if (options.allowMissingRemote && isMissingRemoteFileError(message)) {
        debugSettingsSync('download skipped because remote settings file is missing', {
          message,
        })
        return true
      }

      console.error('Failed to download settings:', error)
      debugSettingsSync('download failed', {
        message,
      })
      return false
    }
  }
}))

export default useSettingsSyncStore
