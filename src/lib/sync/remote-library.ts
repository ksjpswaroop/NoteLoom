import { exists, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { deleteFile as deleteGithubFile, getFiles as getGithubFiles, uploadFile as uploadGithubFile } from './github'
import { deleteFile as deleteGiteeFile, getFiles as getGiteeFiles, uploadFile as uploadGiteeFile } from './gitee'
import { deleteFile as deleteGitlabFile, getFileContent as getGitlabFileContent, getFiles as getGitlabFiles, uploadFile as uploadGitlabFile } from './gitlab'
import { deleteFile as deleteGiteaFile, getFileContent as getGiteaFileContent, getFiles as getGiteaFiles, uploadFile as uploadGiteaFile } from './gitea'
import { s3Delete, s3DownloadBytes, s3HeadObject, s3ListObjects, s3Upload } from './s3'
import { webdavDelete, webdavDownloadBytes, webdavHeadObject, webdavListObjects, webdavUpload } from './webdav'
import { ensureDirectoryExists, pullRemoteFile } from './auto-sync'
import { getSyncRepoName } from './repo-utils'
import { getFilePathOptions } from '@/lib/workspace'
import { decodeBase64ToBytes, getRemoteFileContent } from './remote-file'
import type { S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'

const MARKDOWN_FILE_PATTERN = /\.md$/i

const STATIC_ASSET_CONTENT_TYPES: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  gif: 'image/gif',
  html: 'text/html; charset=utf-8',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
}

export type RemoteLibraryOptions = {
  includeStaticAssets?: boolean
}

type GitRemoteEntry = {
  name?: string
  path?: string
  type?: string
  sha?: string
  size?: number
}

export type RemoteLibraryFile = {
  path: string
  sha: string
  size?: number
  modifiedAt?: string
}

export type PullAllProgress = {
  phase: 'listing' | 'downloading' | 'uploading' | 'uploaded' | 'completed'
  current: number
  total: number
  path?: string
  sha?: string
}

export type PullAllResult = {
  total: number
  downloaded: number
  skipped: number
  failed: Array<{ path: string; message: string }>
}

export type UploadAllResult = {
  total: number
  uploaded: number
  failed: Array<{ path: string; message: string }>
}

async function getPlatform(store: Store): Promise<SyncPlatform> {
  return await store.get<SyncPlatform>('primaryBackupMethod') || 'github'
}

function isLibraryPath(path: string, options: RemoteLibraryOptions): boolean {
  if (!path || path.startsWith('.') || path.split('/').some(part => part.startsWith('.'))) {
    return false
  }
  return options.includeStaticAssets === true || MARKDOWN_FILE_PATTERN.test(path)
}

export function getRemoteContentType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() || ''
  return STATIC_ASSET_CONTENT_TYPES[extension] || 'application/octet-stream'
}

function normalizeGitEntries(value: unknown): GitRemoteEntry[] {
  return Array.isArray(value) ? value as GitRemoteEntry[] : []
}

async function listGitRemoteFiles(
  platform: Exclude<SyncPlatform, 's3' | 'webdav'>,
  options: RemoteLibraryOptions
): Promise<RemoteLibraryFile[]> {
  const repo = await getSyncRepoName(platform)
  const queue = ['']
  const visited = new Set<string>()
  const files: RemoteLibraryFile[] = []

  while (queue.length > 0) {
    const path = queue.shift() || ''
    if (visited.has(path)) continue
    visited.add(path)

    let result: unknown
    switch (platform) {
      case 'github':
        result = await getGithubFiles({ path, repo })
        break
      case 'gitee':
        result = await getGiteeFiles({ path, repo })
        break
      case 'gitlab':
        result = await getGitlabFiles({ path, repo })
        break
      case 'gitea':
        result = await getGiteaFiles({ path, repo })
        break
    }

    for (const entry of normalizeGitEntries(result)) {
      const entryPath = entry.path || (path ? `${path}/${entry.name || ''}` : entry.name || '')
      if (!entryPath || entryPath.split('/').some(part => part.startsWith('.'))) continue

      if (entry.type === 'dir' || entry.type === 'tree') {
        queue.push(entryPath)
        continue
      }

      if (isLibraryPath(entryPath, options)) {
        files.push({
          path: entryPath,
          sha: entry.sha || '',
          size: entry.size,
        })
      }
    }
  }

  return files
}

async function listObjectStorageFiles(
  store: Store,
  platform: 's3' | 'webdav',
  options: RemoteLibraryOptions
): Promise<RemoteLibraryFile[]> {
  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (!config) throw new Error('S3 not configured')
    const objects = await s3ListObjects(config, '')
    return objects
      .filter(object => isLibraryPath(object.key, options))
      .map(object => ({
        path: object.key,
        sha: object.etag,
        size: object.size,
        modifiedAt: object.lastModified,
      }))
  }

  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (!config) throw new Error('WebDAV not configured')
  const queue = ['']
  const visited = new Set<string>()
  const files: RemoteLibraryFile[] = []

  while (queue.length > 0) {
    const path = queue.shift() || ''
    if (visited.has(path)) continue
    visited.add(path)
    const objects = await webdavListObjects(config, path)

    for (const object of objects) {
      const relativeObjectPath = object.key.replace(/^\/+/, '')
      const objectPath = path
        ? `${path}/${relativeObjectPath}`.replace(/\/$/, '')
        : relativeObjectPath.replace(/\/$/, '')

      if (object.key.endsWith('/')) {
        queue.push(objectPath)
      } else if (isLibraryPath(objectPath, options)) {
        files.push({
          path: objectPath,
          sha: object.etag,
          size: object.size,
          modifiedAt: object.lastModified,
        })
      }
    }
  }

  return files
}

export async function listRemoteLibraryFiles(options: RemoteLibraryOptions = {}): Promise<RemoteLibraryFile[]> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)
  const files = platform === 's3' || platform === 'webdav'
    ? await listObjectStorageFiles(store, platform, options)
    : await listGitRemoteFiles(platform, options)

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export async function isLocalLibraryFile(path: string): Promise<boolean> {
  const pathOptions = await getFilePathOptions(path)
  return pathOptions.baseDir
    ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await exists(pathOptions.path)
}

export async function pullAllRemoteLibraryFiles(
  options: RemoteLibraryOptions = {},
  onProgress?: (progress: PullAllProgress) => void
): Promise<PullAllResult> {
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const files = await listRemoteLibraryFiles(options)
  return await pullRemoteLibraryFiles(files, onProgress)
}

export async function pullRemoteLibraryFolder(
  folderPath: string,
  onProgress?: (progress: PullAllProgress) => void
): Promise<PullAllResult> {
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const normalizedFolderPath = folderPath.replace(/^\/+|\/+$/g, '')
  const files = (await listRemoteLibraryFiles({ includeStaticAssets: true }))
    .filter(file => file.path.startsWith(`${normalizedFolderPath}/`))
  // “”。
  // ，。
  return await pullRemoteLibraryFiles(files, onProgress, { overwriteExisting: true })
}

async function pullRemoteLibraryFiles(
  files: RemoteLibraryFile[],
  onProgress?: (progress: PullAllProgress) => void,
  options: { overwriteExisting?: boolean } = {}
): Promise<PullAllResult> {
  const result: PullAllResult = { total: files.length, downloaded: 0, skipped: 0, failed: [] }

  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    onProgress?.({ phase: 'downloading', current: index + 1, total: files.length, path: file.path })

    try {
      if (!options.overwriteExisting && await isLocalLibraryFile(file.path)) {
        result.skipped += 1
        continue
      }

      const content = await downloadRemoteBytes(file.path)
      await saveLocalBytes(file.path, content)
      result.downloaded += 1
    } catch (error) {
      result.failed.push({
        path: file.path,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  onProgress?.({ phase: 'completed', current: files.length, total: files.length })
  return result
}

export async function downloadRemoteLibraryFile(path: string): Promise<void> {
  const content = await downloadRemoteBytes(path)
  await saveLocalBytes(path, content)
}

export async function uploadAllLocalLibraryFiles(
  options: RemoteLibraryOptions = {},
  onProgress?: (progress: PullAllProgress) => void
): Promise<UploadAllResult> {
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const files = await collectLocalLibraryFiles('', options)
  return await uploadLocalLibraryFiles(files, onProgress)
}

export async function uploadLocalLibraryFolder(
  folderPath: string,
  onProgress?: (progress: PullAllProgress) => void
): Promise<UploadAllResult> {
  onProgress?.({ phase: 'listing', current: 0, total: 0 })
  const files = await collectLocalLibraryFiles(folderPath, { includeStaticAssets: true })
  return await uploadLocalLibraryFiles(files, onProgress)
}

export async function uploadLocalLibraryFile(path: string): Promise<string> {
  const pathOptions = await getFilePathOptions(path)
  const content = pathOptions.baseDir
    ? await readFile(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await readFile(pathOptions.path)

  return await uploadRemoteBytes(path, content, `Upload file: ${path}`, getRemoteContentType(path))
}

async function uploadLocalLibraryFiles(
  files: Array<{ path: string; name: string }>,
  onProgress?: (progress: PullAllProgress) => void
): Promise<UploadAllResult> {
  const result: UploadAllResult = { total: files.length, uploaded: 0, failed: [] }

  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    onProgress?.({ phase: 'uploading', current: index + 1, total: files.length, path: file.path })

    try {
      const sha = await uploadLocalLibraryFile(file.path)
      result.uploaded += 1
      onProgress?.({
        phase: 'uploaded',
        current: index + 1,
        total: files.length,
        path: file.path,
        sha,
      })
    } catch (error) {
      result.failed.push({
        path: file.path,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  onProgress?.({ phase: 'completed', current: files.length, total: files.length })
  return result
}

async function collectLocalLibraryFiles(
  folderPath: string,
  options: RemoteLibraryOptions
): Promise<Array<{ path: string; name: string }>> {
  const files: Array<{ path: string; name: string }> = []
  const pathOptions = await getFilePathOptions(folderPath)
  const entries = pathOptions.baseDir
    ? await readDir(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await readDir(pathOptions.path)

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name.startsWith('.') || entry.isSymlink) {
      continue
    }

    const entryPath = folderPath ? `${folderPath}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      files.push(...await collectLocalLibraryFiles(entryPath, options))
    } else if (entry.isFile && isLibraryPath(entryPath, options)) {
      files.push({ path: entryPath, name: entry.name })
    }
  }

  return files
}

async function saveLocalBytes(path: string, content: Uint8Array): Promise<void> {
  await ensureDirectoryExists(path)
  const pathOptions = await getFilePathOptions(path)
  if (pathOptions.baseDir) {
    await writeFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
  } else {
    await writeFile(pathOptions.path, content)
  }
}

export async function downloadRemoteBytes(path: string): Promise<Uint8Array> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    const file = config ? await s3DownloadBytes(config, path) : null
    if (!file) throw new Error('S3 download failed')
    return file.content
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    const file = config ? await webdavDownloadBytes(config, path) : null
    if (!file) throw new Error('WebDAV download failed')
    return file.content
  }

  const repo = await getSyncRepoName(platform)
  let file: unknown
  switch (platform) {
    case 'github':
      file = await getGithubFiles({ path, repo })
      break
    case 'gitee':
      file = await getGiteeFiles({ path, repo })
      break
    case 'gitlab':
      file = await getGitlabFileContent({ path, ref: 'main', repo })
      break
    case 'gitea':
      file = await getGiteaFileContent({ path, ref: 'main', repo })
      break
  }

  return decodeBase64ToBytes(getRemoteFileContent(file, path))
}

async function getExistingRemoteSha(platform: Exclude<SyncPlatform, 's3' | 'webdav'>, path: string, repo: string) {
  let entry: unknown
  switch (platform) {
    case 'github':
      entry = await getGithubFiles({ path, repo })
      break
    case 'gitee':
      entry = await getGiteeFiles({ path, repo })
      break
    case 'gitlab':
      entry = await getGitlabFiles({ path, repo })
      break
    case 'gitea':
      entry = await getGiteaFiles({ path, repo })
      break
  }

  return entry && !Array.isArray(entry) && typeof entry === 'object'
    ? (entry as { sha?: string }).sha
    : undefined
}

function getUploadedRemoteVersion(response: unknown): string {
  if (!response || typeof response !== 'object') return ''

  const responseRecord = response as Record<string, unknown>
  const wrappedData = 'data' in responseRecord ? responseRecord.data : responseRecord
  if (!wrappedData || typeof wrappedData !== 'object') return ''

  const dataRecord = wrappedData as Record<string, unknown>
  const contentData = dataRecord.content
  if (contentData && typeof contentData === 'object') {
    const contentSha = (contentData as Record<string, unknown>).sha
    if (typeof contentSha === 'string') return contentSha
  }

  for (const key of ['sha', 'id', 'commit_id'] as const) {
    const value = dataRecord[key]
    if (typeof value === 'string') return value
  }

  return ''
}

async function uploadRemoteContent(
  path: string,
  content: string | Uint8Array,
  message: string,
  contentType?: string
): Promise<string> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    const result = config ? await s3Upload(config, path, content, undefined, contentType) : null
    if (!result) throw new Error('S3 upload failed')
    return result.etag || `uploaded:${path}`
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    const result = config ? await webdavUpload(config, path, content, undefined, contentType) : null
    if (!result) throw new Error('WebDAV upload failed')
    return result.etag || `uploaded:${path}`
  }

  const repo = await getSyncRepoName(platform)
  const sha = await getExistingRemoteSha(platform, path, repo)
  const filename = path.split('/').pop() || path
  let response: unknown

  switch (platform) {
    case 'github':
      response = await uploadGithubFile({ file: content, filename, path, repo, sha, message })
      break
    case 'gitee':
      response = await uploadGiteeFile({ file: content, filename, path, repo, sha, message })
      break
    case 'gitlab':
      response = await uploadGitlabFile({ file: content, filename, path, repo, sha, message })
      break
    case 'gitea':
      response = await uploadGiteaFile({ file: content, filename, path, repo, sha, message })
      break
  }

  if (!response) throw new Error(`${platform} Upload failed`)
  return getUploadedRemoteVersion(response) || sha || `uploaded:${path}`
}

export async function uploadRemoteText(path: string, content: string, message: string): Promise<string> {
  return await uploadRemoteContent(path, content, message)
}

export async function uploadRemoteBytes(
  path: string,
  content: Uint8Array,
  message: string,
  contentType: string
): Promise<string> {
  return await uploadRemoteContent(path, content, message, contentType)
}

export async function downloadRemoteText(path: string): Promise<string> {
  return await pullRemoteFile(path)
}

export async function remoteFileExists(path: string): Promise<boolean> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    return config ? Boolean(await s3HeadObject(config, path)) : false
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    return config ? Boolean(await webdavHeadObject(config, path)) : false
  }

  const repo = await getSyncRepoName(platform)
  return Boolean(await getExistingRemoteSha(platform, path, repo))
}

export async function deleteRemoteFile(path: string): Promise<void> {
  const store = await Store.load('store.json')
  const platform = await getPlatform(store)

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    if (config && await s3HeadObject(config, path)) {
      await s3Delete(config, path)
    }
    return
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    if (config && await webdavHeadObject(config, path)) {
      await webdavDelete(config, path)
    }
    return
  }

  const repo = await getSyncRepoName(platform)
  const sha = await getExistingRemoteSha(platform, path, repo)
  if (!sha) return

  switch (platform) {
    case 'github':
      await deleteGithubFile({ path, sha, repo })
      break
    case 'gitee':
      await deleteGiteeFile({ path, sha, repo })
      break
    case 'gitlab':
      await deleteGitlabFile({ path, repo })
      break
    case 'gitea':
      await deleteGiteaFile({ path, sha, repo })
      break
  }
}
