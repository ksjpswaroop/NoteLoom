'use client'

import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import emitter from '@/lib/emitter'
import { pullRemoteFile, setLocalRecordedSha, getLocalRecordedSha } from './auto-sync'
import { getRemoteFileInfo } from './auto-sync'
import { isSyncConfigured } from './sync-manager'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { S3Config, WebDAVConfig } from '@/types/sync'
import { debugSyncPerf } from './remote-file'
import { generateGitSyncCommitMessage } from './commit-message'

type SyncProvider = 'gitee' | 'github' | 'gitlab' | 'gitea' | 's3' | 'webdav'

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

/**
 * 
 */
async function getProxyConfig(): Promise<{ all: string } | undefined> {
  const store = await Store.load('store.json')
  const proxyUrl = await store.get<string>('proxy')
  return proxyUrl ? { all: proxyUrl } : undefined
}

interface PushTask {
  path: string
  timestamp: number
}

function getPerfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value)
}

// ， HMR
let initialized = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleSavedListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editorInputListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let syncPulledListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleOpenedListener: any = null

class SyncPushQueue {
  private queue: PushTask[] = []
  private isProcessing = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastInputTime: number = Date.now()

  private get IDLE_THRESHOLD(): number {
    // autoSync
    const state = useSettingStore.getState()
    if (!state) return 0

    const { autoSync } = state

    if (!autoSync || autoSync === 'disabled') {
      return 0 //
    }
    return parseInt(autoSync, 10) * 1000
  }

  private readonly CHECK_INTERVAL = 100 // 100ms

  /**
 * - 
 */
  init() {
    if (initialized) return
    initialized = true
    this.initListeners()
  }

  private initListeners() {
    // （）
    this.removeListeners()

    //
    articleSavedListener = ((event: { path: string; content: string }) => {
      this.addTask(event.path)
    }) as any
    emitter.on('article-saved', articleSavedListener)

    // ，
    editorInputListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('editor-input', editorInputListener)

    // ，
    syncPulledListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('sync-pulled', syncPulledListener)

    // ，
    articleOpenedListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('article-opened', articleOpenedListener)
  }

  private removeListeners() {
    if (articleSavedListener) {
      emitter.off('article-saved', articleSavedListener)
    }
    if (editorInputListener) {
      emitter.off('editor-input', editorInputListener)
    }
    if (syncPulledListener) {
      emitter.off('sync-pulled', syncPulledListener)
    }
    if (articleOpenedListener) {
      emitter.off('article-opened', articleOpenedListener)
    }
    articleSavedListener = null
    editorInputListener = null
    syncPulledListener = null
    articleOpenedListener = null
  }

  /**
 * - 
 * 10 
 */
  addTask(path: string) {
    const now = Date.now()
    const task: PushTask = {
      path,
      timestamp: now
    }

    // lastInputTime， 10
    this.lastInputTime = now

    //
    if (this.isProcessing) {
      // Bug fix: Instead of silently dropping, add the task to queue for processing
      // This ensures all file changes are eventually synced
      this.queue.push(task)
      return
    }

    // ，
    this.queue = [task]

    //
    this.scheduleFlush()
  }

  /**
 * - 
 */
  private scheduleFlush() {
    // ，
    if (!this.IDLE_THRESHOLD) {
      return
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    const checkIdle = () => {
      const now = Date.now()
      const timeSinceInput = now - this.lastInputTime

      if (timeSinceInput >= this.IDLE_THRESHOLD) {
        // ，
        this.flush()
      } else {
        //
        this.debounceTimer = setTimeout(checkIdle, this.CHECK_INTERVAL)
      }
    }

    this.debounceTimer = setTimeout(checkIdle, this.CHECK_INTERVAL)
  }

  /**
 * 
 * Bug fix: Process all tasks in the queue, not just the last one
 */
  private async flush() {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    if (!await isSyncConfigured()) {
      this.clear()
      return
    }

    // Bug fix: Process all tasks in the queue (newest first)
    // Group by path - keep only the newest task for each path
    const taskMap = new Map<string, PushTask>()
    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      // Only keep the newest task for each path
      const existing = taskMap.get(task.path)
      if (!existing || task.timestamp > existing.timestamp) {
        taskMap.set(task.path, task)
      }
    }
    const tasksToProcess = Array.from(taskMap.values()).sort((a, b) => b.timestamp - a.timestamp)

    this.isProcessing = false // Will be set to true in the loop

    // Process each task
    for (const task of tasksToProcess) {
      this.isProcessing = true

      try {
        // Wait for file system to complete write
        await new Promise(resolve => setTimeout(resolve, 100))
        //
        emitter.emit('sync-push-started', { path: task.path })
        await this.pushToRemote(task.path)
      } catch (error) {
        console.error(`[SyncPushQueue] Failed to push ${task.path}:`, error)
      } finally {
        this.isProcessing = false
      }
    }

    // Schedule if there are new tasks
    if (this.queue.length > 0) {
      this.scheduleFlush()
    }
  }

  /**
 * 
 */
  private async pushToRemote(path: string): Promise<{ success: boolean; sha?: string }> {
    const maxRetries = 3
    const syncStartedAt = getPerfNow()
    let previousPerfAt = syncStartedAt
    let providerForLog: SyncProvider | 'unknown' = 'unknown'
    const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
      const now = getPerfNow()
      debugSyncPerf(`syncQueue.${step}`, {
        path,
        provider: providerForLog,
        stepMs: roundMs(now - previousPerfAt),
        totalMs: roundMs(now - syncStartedAt),
        ...payload,
      })
      previousPerfAt = now
    }

    if (!await isSyncConfigured()) {
      logPerf('skipped', { reason: 'sync-not-configured' })
      return { success: false }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logPerf('startAttempt', {
          attempt,
          maxRetries,
        })
        const store = await Store.load('store.json')
        const provider = (await store.get<string>('primaryBackupMethod') || 'github') as SyncProvider
        providerForLog = provider
        const repo = (provider !== 's3' && provider !== 'webdav') ? await getSyncRepoName(provider) : undefined
        logPerf('loadConfig', {
          attempt,
          hasRepo: Boolean(repo),
        })

        // ，
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        logPerf('readLocalFile', {
          attempt,
          workspaceCustom: workspace.isCustom,
          contentLength: content.length,
        })

        // ，
        try {
          const remoteContent = await pullRemoteFile(path)
          logPerf('pullRemoteFile', {
            attempt,
            remoteLength: remoteContent.length,
            isSameContent: remoteContent === content,
          })
          if (remoteContent === content) {
            // SHA
            const remoteSha = await this.getRemoteSha(path)
            logPerf('getRemoteShaWhenSame', {
              attempt,
              hasSha: Boolean(remoteSha),
            })
            // SHA， SHA
            if (remoteSha) {
              await setLocalRecordedSha(path, remoteSha)
              logPerf('recordLocalSha', {
                attempt,
                hasSha: true,
              })
            }
            //
            emitter.emit('sync-push-completed', { path, success: true, sha: remoteSha })
            logPerf('completed', {
              attempt,
              skippedUpload: true,
              success: true,
              hasSha: Boolean(remoteSha),
            })
            return { success: true, sha: remoteSha }
          }
        } catch (remoteError) {
          // ，
          logPerf('pullRemoteFileFailed', {
            attempt,
            message: remoteError instanceof Error ? remoteError.message : String(remoteError),
          })
        }

        const needsCommitMessage = provider !== 's3' && provider !== 'webdav'
        const commitMessage = needsCommitMessage
          ? await generateGitSyncCommitMessage(path, content)
          : ''
        if (needsCommitMessage) {
          logPerf('generateCommitMessage', {
            attempt,
            messageLength: commitMessage.length,
            thinkingDisabled: true,
          })
        } else {
          logPerf('skipCommitMessage', {
            attempt,
            reason: 'provider-without-commits',
          })
        }

        let success = false
        let uploadedSha: string | undefined

        switch (provider) {
          case 'github': {
            const githubModule = await import('@/lib/sync/github') as any
            logPerf('loadProviderModule', { attempt, module: 'github' })
            // SHA，
            const fileInfo = await githubModule.getFiles({ path, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })

            //
            // GitHub API ，
            // （）， sha，
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} Yes ，None`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }

            const result = await githubModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha,
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
              hasResultSha: Boolean(result?.data?.content?.sha),
            })
            // （result data）
            if (result && result.data) {
              success = true
              uploadedSha = result?.data?.content?.sha || fileInfo?.sha
            }
            break
          }
          case 'gitee': {
            const giteeModule = await import('@/lib/sync/gitee') as any
            logPerf('loadProviderModule', { attempt, module: 'gitee' })
            // SHA
            const fileInfo = await giteeModule.getFiles({ path, repo})
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })

            //
            // Gitee API ，
            // （）， sha，
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} Yes ，None`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }

            const result = await giteeModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha,
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
              hasResultSha: Boolean(result?.data?.content?.sha),
            })
            //
            if (result && result.data) {
              success = true
              // Gitee API result.data.content.sha
              uploadedSha = result?.data?.content?.sha || fileInfo?.sha
            }
            break
          }
          case 'gitlab': {
            const gitlabModule = await import('@/lib/sync/gitlab') as any
            logPerf('loadProviderModule', { attempt, module: 'gitlab' })
            // SHA（blob_id），uploadFile last_commit_id
            const fileInfo = await gitlabModule.getFiles({ path, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })
            // GitLab getFiles ，（）
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} Yes ，None`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }
            const result = await gitlabModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha, // GitLab sha last_commit_id
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
            })
            //
            if (result && result.data) {
              success = true
              // GitLab commit SHA
              uploadedSha = await this.getRemoteSha(path)
              logPerf('refreshUploadedSha', {
                attempt,
                hasSha: Boolean(uploadedSha),
              })
            }
            break
          }
          case 'gitea': {
            const giteaModule = await import('@/lib/sync/gitea') as any
            logPerf('loadProviderModule', { attempt, module: 'gitea' })
            // SHA
            const fileInfo = await giteaModule.getFiles({ path, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })
            // Gitea getFiles ，（）
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} Yes ，None`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }
            const result = await giteaModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha, // SHA Gitea
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
            })
            //
            if (result && result.data) {
              success = true
              // Gitea commit SHA
              uploadedSha = await this.getRemoteSha(path)
              logPerf('refreshUploadedSha', {
                attempt,
                hasSha: Boolean(uploadedSha),
              })
            }
            break
          }
          case 's3': {
            const s3Module = await import('@/lib/sync/s3') as any
            const s3Config = await getS3Config()
            logPerf('loadProviderModule', { attempt, module: 's3', hasConfig: Boolean(s3Config) })
            if (!s3Config) {
              console.warn('[SyncPushQueue] S3 is not configured')
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'missing-config',
              })
              return { success: false }
            }

            //
            const proxy = await getProxyConfig()
            logPerf('loadProxyConfig', {
              attempt,
              hasProxy: Boolean(proxy),
            })

            // S3 SHA ，
            const result = await s3Module.s3Upload(s3Config, path, content, proxy)
            logPerf('uploadFile', {
              attempt,
              hasResult: Boolean(result),
              hasEtag: Boolean(result?.etag),
            })
            if (result && result.etag) {
              success = true
              uploadedSha = result.etag // ETag
              // ETag
              useSyncStore.getState().updateS3FileEtag(path, result.etag)
            }
            break
          }
          case 'webdav': {
            const webdavModule = await import('@/lib/sync/webdav') as any
            const webdavConfig = await getWebDAVConfig()
            logPerf('loadProviderModule', { attempt, module: 'webdav', hasConfig: Boolean(webdavConfig) })
            if (!webdavConfig) {
              console.warn('[SyncPushQueue] WebDAV is not configured')
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'missing-config',
              })
              return { success: false }
            }

            //
            const proxy = await getProxyConfig()
            logPerf('loadProxyConfig', {
              attempt,
              hasProxy: Boolean(proxy),
            })

            // WebDAV SHA ，
            const result = await webdavModule.webdavUpload(webdavConfig, path, content, proxy)
            logPerf('uploadFile', {
              attempt,
              hasResult: Boolean(result),
              hasEtag: Boolean(result?.etag),
            })
            if (result) {
              success = true
              uploadedSha = result.etag || 'uploaded' // ETag ，
              // ETag
              useSyncStore.getState().updateWebDAVFileEtag(path, result.etag || '')
            }
            break
          }
        }

        if (success) {
          // ， SHA store
          if (uploadedSha) {
            await setLocalRecordedSha(path, uploadedSha)
            logPerf('recordLocalSha', {
              attempt,
              hasSha: true,
            })
          }
          emitter.emit('sync-push-completed', { path, success: true, sha: uploadedSha })
          logPerf('completed', {
            attempt,
            success: true,
            hasSha: Boolean(uploadedSha),
          })
          return { success: true, sha: uploadedSha }
        } else {
          // （result ）
          emitter.emit('sync-push-completed', { path, success: false })
          logPerf('completed', {
            attempt,
            success: false,
            reason: 'empty-upload-result',
          })
          return { success: false }
        }
      } catch (error: any) {
        logPerf('failedAttempt', {
          attempt,
          message: error instanceof Error ? error.message : String(error),
          status: error?.status,
        })
        // SHA
        const errorMessage = error?.message || ''
        const errorStatus = error?.status || 0

        // SHA ：
        // 1. HTTP 422 (Unprocessable Entity) - GitHub/GitLab
        // 2. HTTP 409 (Conflict) -
        // 3.
        const isShaMismatch =
          errorStatus === 422 ||
          errorStatus === 409 ||
          errorMessage.includes('does not match') ||
          errorMessage.includes('sha') ||
          errorMessage.includes('SHA') ||
          errorMessage.includes('blob') ||
          errorMessage.includes('conflict') ||
          errorMessage.includes('out of date') ||
          errorMessage.includes('Stale') ||
          errorMessage.includes('Stale')

        // SHA ，
        if (isShaMismatch && attempt === 1) {
          // SHA SHA
          const localRecordedSha = await getLocalRecordedSha(path)
          const remoteFileInfo = await getRemoteFileInfo(path)
          const remoteFileSha = remoteFileInfo.sha
          logPerf('shaMismatchInfo', {
            attempt,
            hasLocalSha: Boolean(localRecordedSha),
            hasRemoteSha: Boolean(remoteFileSha),
          })

          // UI
          emitter.emit('sync-sha-mismatch', {
            path,
            localSha: localRecordedSha || undefined,
            remoteSha: remoteFileSha || undefined,
            force: false
          })

          // ，
          emitter.emit('sync-push-completed', { path, success: false })
          logPerf('completed', {
            attempt,
            success: false,
            reason: 'sha-mismatch',
          })
          return { success: false }
        }

        if (isShaMismatch && attempt < maxRetries) {
          // （）
          const waitTime = Math.pow(2, attempt - 1) * 500
          logPerf('retryWait', {
            attempt,
            waitMs: waitTime,
          })
          await new Promise(resolve => setTimeout(resolve, waitTime))
          continue
        }

        // SHA ，
        if (attempt === maxRetries || !isShaMismatch) {
          console.error('[SyncPushQueue] Push failed:', error)
          emitter.emit('sync-push-completed', { path, success: false })
          logPerf('completed', {
            attempt,
            success: false,
            reason: 'error',
          })
          return { success: false }
        }
      }
    }

    return { success: false }
  }

  /**
 * SHA
 */
  private async getRemoteSha(path: string): Promise<string | undefined> {
    try {
      const info = await getRemoteFileInfo(path)
      return info.sha
    } catch {
      return undefined
    }
  }

  /**
 * （ SHA ）
 * 
 */
  async forcePush(path: string): Promise<{ success: boolean; sha?: string }> {
    try {
      if (!await isSyncConfigured()) {
        return { success: false }
      }

      const store = await Store.load('store.json')
      const provider = (await store.get<string>('primaryBackupMethod') || 'github') as 'gitee' | 'github' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      const repo = (provider !== 's3' && provider !== 'webdav') ? await getSyncRepoName(provider) : undefined

      //
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(path)
      const content = workspace.isCustom
        ? await readTextFile(pathOptions.path)
        : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

      const needsCommitMessage = provider !== 's3' && provider !== 'webdav'
      const commitMessage = needsCommitMessage
        ? await generateGitSyncCommitMessage(path, content)
        : ''

      let success = false
      let uploadedSha: string | undefined

      switch (provider) {
        case 'github': {
          const githubModule = await import('@/lib/sync/github') as any
          // ： sha
          const result = await githubModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined, // ， sha
            message: commitMessage,
            repo,
            path
          })
          if (result && result.data) {
            success = true
            uploadedSha = result?.data?.content?.sha
          }
          break
        }
        case 'gitee': {
          const giteeModule = await import('@/lib/sync/gitee') as any
          const result = await giteeModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined, //
            message: commitMessage,
            repo,
            path
          })
          if (result && result.data) {
            success = true
            // Gitee API result.data.content.sha
            uploadedSha = result?.data?.content?.sha
          }
          break
        }
        case 'gitlab': {
          const gitlabModule = await import('@/lib/sync/gitlab') as any
          await gitlabModule.uploadFile({
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined,
            message: commitMessage,
            repo,
            path
          })
          success = true
          uploadedSha = await this.getRemoteSha(path)
          break
        }
        case 'gitea': {
          const giteaModule = await import('@/lib/sync/gitea') as any
          await giteaModule.uploadFile({
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined,
            message: commitMessage,
            repo,
            path
          })
          success = true
          uploadedSha = await this.getRemoteSha(path)
          break
        }
        case 's3': {
          const s3Module = await import('@/lib/sync/s3') as any
          const s3Config = await getS3Config()
          if (!s3Config) {
            console.warn('[SyncPushQueue] S3 is not configured')
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }

          //
          const proxy = await getProxyConfig()

          // S3 ：， ETag
          const result = await s3Module.s3Upload(s3Config, path, content, proxy)
          if (result && result.etag) {
            success = true
            uploadedSha = result.etag
            // ETag
            useSyncStore.getState().updateS3FileEtag(path, result.etag)
          }
          break
        }
        case 'webdav': {
          const webdavModule = await import('@/lib/sync/webdav') as any
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            console.warn('[SyncPushQueue] WebDAV is not configured')
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }

          //
          const proxy = await getProxyConfig()

          // WebDAV ：， ETag
          const result = await webdavModule.webdavUpload(webdavConfig, path, content, proxy)
          if (result && result.etag) {
            success = true
            uploadedSha = result.etag
            // ETag
            useSyncStore.getState().updateWebDAVFileEtag(path, result.etag)
          }
          break
        }
      }

      if (success) {
        // SHA
        if (uploadedSha) {
          await setLocalRecordedSha(path, uploadedSha)
        }
        emitter.emit('sync-push-completed', { path, success: true, sha: uploadedSha })
        return { success: true, sha: uploadedSha }
      } else {
        emitter.emit('sync-push-completed', { path, success: false })
        return { success: false }
      }
    } catch (error) {
      console.error('[SyncPushQueue] Push failed', error)
      emitter.emit('sync-push-completed', { path, success: false })
      return { success: false }
    }
  }

  /**
 * 
 */
  clear() {
    this.queue = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}

//
let syncPushQueue: SyncPushQueue | null = null

export function getSyncPushQueue(): SyncPushQueue {
  if (!syncPushQueue) {
    syncPushQueue = new SyncPushQueue()
    syncPushQueue.init() //
  }
  return syncPushQueue
}

export default SyncPushQueue
