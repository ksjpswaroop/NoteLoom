import { Store } from '@tauri-apps/plugin-store'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { collectMarkdownFiles } from '@/lib/files'
import { RepoNames } from './github.types'
import { getSyncRepoName } from './repo-utils'
import { getGiteaApiBaseUrl } from './gitea'
import { s3Upload } from './s3'
import { webdavUpload } from './webdav'
import { S3Config, WebDAVConfig } from '@/types/sync'
import { buildGithubCreateTreePayload, buildGitlabCommitActions } from './folder-sync-payload'
import { buildRepoContentPath, debugSyncPath } from './remote-file'

export interface FolderSyncResult {
  success: boolean
  totalFiles: number
  successCount: number
  failedCount: number
  message: string
  errors?: string[]
}

type GitProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

export class FolderSync {
  private platform: string = 'github'

  constructor() {
    // constructor
  }

  /**
 * （）
 */
  private async init() {
    const store = await Store.load('store.json')
    this.platform = await store.get<string>('primaryBackupMethod') || 'github'
  }

  async syncFolder(localFolderPath: string): Promise<FolderSyncResult> {
    //
    await this.init()

    try {
      // 1. Markdown
      const markdownFiles = await collectMarkdownFiles(localFolderPath)

      if (markdownFiles.length === 0) {
        return {
          success: false,
          totalFiles: 0,
          successCount: 0,
          failedCount: 0,
          message: 'No Markdown files in the current folder'
        }
      }

      // 2.
      const workspace = await getWorkspacePath()
      const filesToUpload: Array<{ path: string; content: string; sha?: string }> = []

      for (const file of markdownFiles) {
        const pathOptions = await getFilePathOptions(file.path)
        let content = ''

        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        //
        const remotePath = file.path
        debugSyncPath('folderSync.collectFile', {
          localFolderPath,
          sourcePath: file.path,
          remotePath,
        })

        filesToUpload.push({
          path: remotePath,
          content
        })
      }

      // 3.
      const message = `Sync folder: ${localFolderPath} - ${new Date().toLocaleString('en-US')}`
      let success = false
      const repoName = this.platform === 's3' || this.platform === 'webdav'
        ? RepoNames.sync
        : await getSyncRepoName(this.platform as GitProvider)

      switch (this.platform) {
        case 'github': {
          // GitHub
          success = await this._githubBatchCommit(repoName, filesToUpload, message)
          break
        }
        case 'gitee': {
          // SHA（）
          const giteeFiles = await this._getGiteeFiles(repoName)
          for (const file of filesToUpload) {
            if (giteeFiles[file.path]) {
              file.sha = giteeFiles[file.path].sha
            }
          }
          // Gitee: ， SHA
          success = await this._giteeBatchCommit(repoName, filesToUpload, message)
          break
        }
        case 'gitlab':
          success = await this._gitlabBatchCommit(repoName, filesToUpload, message)
          break
        case 'gitea':
          success = await this._giteaBatchCommit(repoName, filesToUpload)
          break
        case 's3':
          success = await this._s3BatchUpload(filesToUpload)
          break
        case 'webdav':
          success = await this._webdavBatchUpload(filesToUpload)
          break
        default:
          return {
            success: false,
            totalFiles: markdownFiles.length,
            successCount: 0,
            failedCount: markdownFiles.length,
            message: `Unsupported platform: ${this.platform}`
          }
      }

      if (success) {
        return {
          success: true,
          totalFiles: markdownFiles.length,
          successCount: markdownFiles.length,
          failedCount: 0,
          message: `Successfully synced ${markdownFiles.length} files`
        }
      } else {
        return {
          success: false,
          totalFiles: markdownFiles.length,
          successCount: 0,
          failedCount: markdownFiles.length,
          message: 'Sync failed'
        }
      }
    } catch (error) {
      return {
        success: false,
        totalFiles: 0,
        successCount: 0,
        failedCount: 0,
        message: String(error),
        errors: [String(error)]
      }
    }
  }

  /**
 * SHA
 */
  async _getGithubTreeFiles(
    repo: string,
    path: string
  ): Promise<Record<string, { sha: string; type: string }>> {
    const store = await Store.load('store.json')
    const accessToken = await store.get<string>('accessToken')
    const githubUsername = await store.get<string>('githubUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${accessToken}`)
    headers.append('Accept', 'application/vnd.github+json')
    headers.append('X-GitHub-Api-Version', '2022-11-28')

    // git tree API
    const url = `https://api.github.com/repos/${githubUsername}/${repo}/git/trees/main?recursive=1`
    const response = await fetch(url, { method: 'GET', headers, proxy })

    if (!response.ok) return {}

    const data = await response.json()
    const result: Record<string, { sha: string; type: string }> = {}

    if (data.tree) {
      for (const item of data.tree) {
        if (item.path && item.path.startsWith(path) && item.type === 'blob') {
          result[item.path] = { sha: item.sha, type: item.type }
        }
      }
    }

    return result
  }

  /**
 * GitHub
 */
  async _githubBatchCommit(
    repo: string,
    files: Array<{ path: string; content: string; sha?: string }>,
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const accessToken = await store.get<string>('accessToken')
    const githubUsername = await store.get<string>('githubUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${accessToken}`)
    headers.append('Accept', 'application/vnd.github+json')
    headers.append('X-GitHub-Api-Version', '2022-11-28')
    headers.append('Content-Type', 'application/json')

    // 1. commit tree，，
    const refUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/ref/heads/main`
    const refResponse = await fetch(refUrl, { method: 'GET', headers, proxy })
    if (!refResponse.ok) return false
    const refData = await refResponse.json()
    const parentCommitSha = refData.object.sha

    const parentCommitUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/commits/${parentCommitSha}`
    const parentCommitResponse = await fetch(parentCommitUrl, { method: 'GET', headers, proxy })
    if (!parentCommitResponse.ok) return false
    const parentCommitData = await parentCommitResponse.json()
    const baseTreeSha = parentCommitData.tree?.sha

    if (!baseTreeSha) {
      console.error('Failed to get GitHub base tree')
      return false
    }

    // 2. tree tree，
    const createTreeUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/trees`
    const treeResponse = await fetch(createTreeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildGithubCreateTreePayload(files, baseTreeSha)),
      proxy,
    })

    if (!treeResponse.ok) {
      console.error('Failed to create tree:', await treeResponse.text())
      return false
    }

    const treeData = await treeResponse.json()

    // 3. commit
    const commitUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/commits`
    const commitResponse = await fetch(commitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [parentCommitSha],
      }),
      proxy,
    })

    if (!commitResponse.ok) {
      console.error('Failed to create commit:', await commitResponse.text())
      return false
    }

    const commitData = await commitResponse.json()

    // 4. ref
    const updateRefUrl = `https://api.github.com/repos/${githubUsername}/${repo}/git/refs/heads/main`
    const updateResponse = await fetch(updateRefUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sha: commitData.sha,
        force: false,
      }),
      proxy,
    })

    return updateResponse.ok
  }

  /**
 * Gitee SHA（）
 */
  async _getGiteeFiles(repo: string, path: string = ''): Promise<Record<string, { sha: string }>> {
    const store = await Store.load('store.json')
    const giteeAccessToken = await store.get<string>('giteeAccessToken')
    const giteeUsername = await store.get<string>('giteeUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!giteeAccessToken || !giteeUsername) {
      console.error('[Gitee] Missing accessToken or username')
      return {}
    }

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteeAccessToken}`)

    // Gitee API
    const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents${path ? '/' + path : ''}?access_token=${giteeAccessToken}`
    const response = await fetch(url, { method: 'GET', headers, proxy })

    if (!response.ok) {
      console.error('[Gitee] Failed to get file list:', await response.text())
      return {}
    }

    const data = await response.json()
    const result: Record<string, { sha: string }> = {}

    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.type === 'file' && item.path && item.sha) {
          result[item.path] = { sha: item.sha }
        } else if (item.type === 'dir' && item.path) {
          //
          const subFiles = await this._getGiteeFiles(repo, item.path)
          Object.assign(result, subFiles)
        }
      }
    }

    return result
  }

  /**
 * Gitea SHA（）
 */
  async _getGiteaFiles(repo: string, path: string = ''): Promise<Record<string, { sha: string }>> {
    const store = await Store.load('store.json')
    const giteaAccessToken = await store.get<string>('giteaAccessToken')
    const giteaUsername = await store.get<string>('giteaUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!giteaAccessToken || !giteaUsername) {
      console.error('[Gitea] Missing accessToken or username')
      return {}
    }

    let giteaUrl: string
    try {
      giteaUrl = await getGiteaApiBaseUrl()
    } catch {
      return {}
    }

    const apiBaseUrl = giteaUrl.endsWith('/') ? giteaUrl.slice(0, -1) : giteaUrl

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteaAccessToken}`)

      const encodedPath = buildRepoContentPath({ path })
      debugSyncPath('folderSync.gitea.listFiles', {
        inputPath: path,
        encodedPath,
      })
    const url = `${apiBaseUrl}/repos/${giteaUsername}/${repo}/contents${encodedPath ? '/' + encodedPath : ''}`

    try {
      const response = await fetch(url, { method: 'GET', headers, proxy })

      if (!response.ok) {
        console.error('[Gitea] Failed to get file list:', response.status)
        return {}
      }

      const data = await response.json()
      const result: Record<string, { sha: string }> = {}

      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === 'file' && item.path && item.sha) {
            result[item.path] = { sha: item.sha }
          } else if (item.type === 'dir' && item.path) {
            //
            const subFiles = await this._getGiteaFiles(repo, item.path)
            Object.assign(result, subFiles)
          }
        }
      }

      return result
    } catch (error) {
      console.error('[Gitea] File list exception:', error)
      return {}
    }
  }

  /**
 * Gitee 
 * ：Gitee API ，
 */
  async _giteeBatchCommit(
    repo: string,
    files: Array<{ path: string; content: string; sha?: string }>,
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const giteeAccessToken = await store.get<string>('giteeAccessToken')
    const giteeUsername = await store.get<string>('giteeUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!giteeAccessToken || !giteeUsername) {
      console.error('[Gitee] Missing accessToken or username')
      return false
    }

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteeAccessToken}`)
    headers.append('Content-Type', 'application/json')

    // Gitee API: ，
    //

    const uploadPromises = files.map(async (file) => {
      const base64Content = Buffer.from(file.content).toString('base64')
      const encodedPath = buildRepoContentPath({ path: file.path })
      debugSyncPath('folderSync.gitee.uploadFile', {
        inputPath: file.path,
        encodedPath,
        hasSha: Boolean(file.sha),
      })
      const url = `https://gitee.com/api/v5/repos/${giteeUsername}/${repo}/contents/${encodedPath}`

      const body: Record<string, unknown> = {
        access_token: giteeAccessToken,
        content: base64Content,
        message: message
      }

      // SHA（）， PUT
      if (file.sha) {
        body.sha = file.sha
      }

      const response = await fetch(url, {
        method: file.sha ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(body),
        proxy
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[Gitee] Failed to upload file ${file.path}:`, errorText)
      }

      return response.ok
    })

    const results = await Promise.all(uploadPromises)
    const successCount = results.filter(r => r).length

    //
    return successCount > 0
  }

  /**
 * GitLab （ commit with actions）
 */
  async _gitlabBatchCommit(
    repo: string,
    files: Array<{ path: string; content: string; sha?: string }>,
    message: string
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
    const gitlabUrl = await store.get<string>('gitlabUrl') || 'https://gitlab.com'
    const gitlabBranch = await store.get<string>('gitlabBranch') || 'main'
    const gitlabProjectId = await store.get<string>(`gitlab_${repo}_project_id`)
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!gitlabAccessToken) {
      console.error('[GitLab] Missing accessToken')
      return false
    }

    if (!gitlabProjectId) {
      console.error('[GitLab] Missing projectId')
      return false
    }

    const headers = new Headers()
    headers.append('PRIVATE-TOKEN', gitlabAccessToken)
    headers.append('Content-Type', 'application/json;charset=iso-8859-1')

    // actions
    const actions = buildGitlabCommitActions(files)

    const url = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(gitlabProjectId)}/repository/commits`

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        branch: gitlabBranch,
        commit_message: message,
        actions
      }),
      proxy
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[GitLab] Batch commit failed:', errorText)
      return false
    }

    return true
  }

  /**
 * Gitea （ + ）
 * Gitea API commit，
 */
  async _giteaBatchCommit(
    repo: string,
    files: Array<{ path: string; content: string; sha?: string }>
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const giteaAccessToken = await store.get<string>('giteaAccessToken')
    const giteaUsername = await store.get<string>('giteaUsername')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    let giteaUrl: string
    try {
      giteaUrl = await getGiteaApiBaseUrl()
    } catch (error) {
      console.error('[Gitea] Failed to get API URL:', error)
      return false
    }

    if (!giteaAccessToken || !giteaUsername) {
      console.error('[Gitea] Missing config: accessToken or username')
      return false
    }

    const headers = new Headers()
    headers.append('Authorization', `Bearer ${giteaAccessToken}`)
    headers.append('Content-Type', 'application/json')

    const apiBaseUrl = giteaUrl.endsWith('/') ? giteaUrl.slice(0, -1) : giteaUrl

    // SHA（）
    const remoteFiles = await this._getGiteaFiles(repo)

    // SHA
    for (const file of files) {
      if (remoteFiles[file.path]) {
        file.sha = remoteFiles[file.path].sha
      }
    }

    // （）
    let successCount = 0
    const uploadedPaths = new Set<string>()

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const base64Content = Buffer.from(file.content).toString('base64')

      const fileName = file.path.split('/').pop() || file.path
      const normalizedPath = buildRepoContentPath({ path: file.path })
      debugSyncPath('folderSync.gitea.uploadFile', {
        inputPath: file.path,
        filename: fileName,
        normalizedPath,
        hasSha: Boolean(file.sha),
      })

      const url = `${apiBaseUrl}/repos/${giteaUsername}/${repo}/contents/${normalizedPath}`

      const requestBody: Record<string, unknown> = {
        branch: 'main',
        content: base64Content,
        message: file.sha ? `Update ${fileName}` : `Create ${fileName}`
      }

      // SHA， PUT
      if (file.sha) {
        requestBody.sha = file.sha
      }

      const response = await fetch(url, {
        method: file.sha ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(requestBody),
        proxy
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[Gitea] Failed to upload file ${file.path}:`, response.status, errorText)
        //
        continue
      }

      successCount++
      uploadedPaths.add(file.path)

      // SHA（）
      if (i < files.length - 1) {
        const newRemoteFiles = await this._getGiteaFiles(repo)
        // SHA
        for (let j = i + 1; j < files.length; j++) {
          const otherFile = files[j]
          if (!uploadedPaths.has(otherFile.path) && newRemoteFiles[otherFile.path]) {
            otherFile.sha = newRemoteFiles[otherFile.path].sha
          }
        }
      }
    }

    return successCount > 0
  }

  /**
 * S3 
 */
  async _s3BatchUpload(
    files: Array<{ path: string; content: string }>
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const s3Config = await store.get<S3Config>('s3SyncConfig')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) {
      console.error('[S3] Missing configuration')
      return false
    }

    //
    const uploadPromises = files.map(async (file) => {
      const result = await s3Upload(s3Config, file.path, file.content, proxy)
      if (!result) {
        console.error(`[S3] Failed to upload file ${file.path}`)
      }
      return !!result
    })

    const results = await Promise.all(uploadPromises)
    const successCount = results.filter(r => r).length

    return successCount > 0
  }

  /**
 * WebDAV 
 */
  async _webdavBatchUpload(
    files: Array<{ path: string; content: string }>
  ): Promise<boolean> {
    const store = await Store.load('store.json')
    const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
    const proxyUrl = await store.get<string>('proxy')
    const proxy: Proxy | undefined = proxyUrl ? { all: proxyUrl } : undefined

    if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) {
      console.error('[WebDAV] Missing configuration')
      return false
    }

    //
    const uploadPromises = files.map(async (file) => {
      const result = await webdavUpload(webdavConfig, file.path, file.content, proxy)
      if (!result) {
        console.error(`[WebDAV] Failed to upload file ${file.path}`)
      }
      return !!result
    })

    const results = await Promise.all(uploadPromises)
    const successCount = results.filter(r => r).length

    return successCount > 0
  }
}
