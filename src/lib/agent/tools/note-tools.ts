import { Tool, ToolResult } from '../types'
import { BaseDirectory, readTextFile, writeTextFile, remove, rename, copyFile, stat, exists } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { getAllMarkdownFiles, MarkdownFile } from '@/lib/files'
import {
  ensureSafeWorkspaceRelativePath,
  getFilePathOptions,
  toWorkspaceRelativePath,
} from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'
import { isLinkedFolder } from '@/lib/files'
import emitter from '@/lib/emitter'
import { getVectorDocumentKey } from '@/lib/vector-document-key'
import { Store } from '@tauri-apps/plugin-store'
import { DEFAULT_EXCLUDED_RAG_PATHS, isPathAllowedForRag } from '@/lib/rag-retrieval-policy'

function normalizeLinkedCandidate(candidate: unknown): string {
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function getLinkedFileName(path: unknown): string {
  const normalized = normalizeLinkedCandidate(path)
  return normalized.split('/').pop() || normalized
}

function matchesLinkedFileCandidate(
  candidate: unknown,
  linkedResource: { relativePath?: string; name?: string; path?: string }
): boolean {
  const normalized = normalizeLinkedCandidate(candidate)
  if (!normalized) {
    return false
  }

  const linkedPaths = new Set([
    linkedResource.relativePath,
    linkedResource.name,
    linkedResource.path,
    getLinkedFileName(linkedResource.relativePath),
    getLinkedFileName(linkedResource.path),
  ].filter(Boolean))

  return linkedPaths.has(normalized) || linkedPaths.has(getLinkedFileName(normalized))
}

function getBatchLinkedFileReadPlan(
  filePaths: string[],
  linkedResource: { relativePath?: string; name?: string; path?: string }
): { filesToRead: string[]; skippedFiles: string[] } {
  const filesToRead: string[] = []
  const skippedFiles: string[] = []

  for (const filePath of filePaths) {
    if (matchesLinkedFileCandidate(filePath, linkedResource)) {
      skippedFiles.push(filePath)
    } else {
      filesToRead.push(filePath)
    }
  }

  return {
    filesToRead,
    skippedFiles,
  }
}

function joinRelativePath(folderPath: string | undefined, fileName: string): string {
  return folderPath ? `${folderPath}/${fileName}` : fileName
}

function isFileNotFoundError(error: unknown): boolean {
  return /no such file or directory|os error 2|path not found/i.test(String(error))
}

function missingFileReadResult(filePath: string): ToolResult {
  return {
    success: true,
    data: {
      filePath,
      exists: false,
    },
    message: `File does not exist: ${filePath}. Tell the user or continue without it; do not retry the same read arguments.`,
  }
}

async function mirrorVectorDocuments(sourcePath: string, targetPath: string): Promise<number | null> {
  const { getVectorDocumentsByFilename, upsertVectorDocument } = await import('@/db/vector')
  const sourceKey = getVectorDocumentKey(sourcePath)
  const targetKey = getVectorDocumentKey(targetPath)
  const sourceDocs = await getVectorDocumentsByFilename(sourceKey)

  if (sourceDocs.length === 0) {
    return null
  }

  let latestUpdatedAt = 0
  for (const doc of sourceDocs) {
    await upsertVectorDocument({
      filename: targetKey,
      chunk_id: doc.chunk_id,
      content: doc.content,
      embedding: doc.embedding,
      updated_at: doc.updated_at,
    })
    latestUpdatedAt = Math.max(latestUpdatedAt, doc.updated_at)
  }

  const { getBM25Index } = await import('@/lib/bm25')
  getBM25Index()?.replaceByFilename(
    targetKey,
    sourceDocs.sort((a, b) => a.chunk_id - b.chunk_id).map(doc => doc.content)
  )

  return latestUpdatedAt
}

async function removeVectorDocumentsForPath(filePath: string): Promise<void> {
  const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
  const vectorKey = getVectorDocumentKey(filePath)
  const legacyFilename = filePath.split('/').pop() || filePath

  await deleteVectorDocumentsByFilename(vectorKey)
  if (legacyFilename !== vectorKey) {
    await deleteVectorDocumentsByFilename(legacyFilename)
  }
}

function updateVectorIndexedState(oldPath: string | null, newPath: string | null, updatedAt?: number | null) {
  const articleState = useArticleStore.getState()
  const nextMap = new Map(articleState.vectorIndexedFiles)

  if (oldPath) {
    nextMap.delete(getVectorDocumentKey(oldPath))
  }

  if (newPath && updatedAt) {
    nextMap.set(getVectorDocumentKey(newPath), updatedAt)
  }

  useArticleStore.setState({ vectorIndexedFiles: nextMap })
}

export const listMarkdownFilesTool: Tool = {
  name: 'list_markdown_files',
  description: 'List all Markdown files in the workspace.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const files = await getAllMarkdownFiles()

      return {
        success: true,
        data: files,
        message: `Found ${files.length} Markdown files`,
      }
    } catch (error) {
      console.error('[list_markdown_files] Failed to get file list', {
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to get Markdown file list: ${error}`,
      }
    }
  },
}

// Read the saved on-disk content for a note file.
// Prefer get_editor_content for the currently open note so unsaved/runtime state is included.
export const readMarkdownFileTool: Tool = {
  name: 'read_markdown_file',
  description: 'Read the saved on-disk content of a Markdown note by path. Prefer `get_editor_content` for the currently open note.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file whose saved content should be read (relative path, e.g., "folder/note.md")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // （）
      const chatStore = useChatStore.getState()
      const { linkedResource } = chatStore

      // （），，
      if (linkedResource && !isLinkedFolder(linkedResource)) {
        // ，
        const requestedFileName = normalizedFilePath.split('/').pop() || normalizedFilePath
        const linkedFileName = linkedResource.relativePath.split('/').pop() || linkedResource.relativePath

        if (requestedFileName === linkedFileName) {
          return {
            success: true,
            data: {
              filePath: normalizedFilePath,
              content: `[File content already in conversation context] File "${linkedResource.name}" (${linkedResource.relativePath}) is linked to this conversation and its full content is already in context—do not read it again. Use the file content already present in context.`,
              alreadyInContext: true,
            },
            message: `File "${linkedResource.name}" is already in conversation context; no need to read again`,
          }
        }
      }

      let content = ''

      // getFilePathOptions ，
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

      const fileExists = baseDir
        ? await exists(path, { baseDir })
        : await exists(path)
      if (!fileExists) {
        return missingFileReadResult(normalizedFilePath)
      }

      if (baseDir) {
        content = await readTextFile(path, { baseDir })
      } else {
        content = await readTextFile(path)
      }

      return {
        success: true,
        data: { filePath: normalizedFilePath, content },
        message: `Successfully read file: ${normalizedFilePath}`,
      }
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return missingFileReadResult(String(params.filePath || ''))
      }

      console.error('[read_markdown_file] Read failed', {
        filePath: params.filePath,
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to read file: ${error}`,
      }
    }
  },
}

export const openMarkdownFileTool: Tool = {
  name: 'open_markdown_file',
  description: 'Open a specified Markdown file in the editor and load its content.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to open',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)
      const content = baseDir
        ? await readTextFile(path, { baseDir })
        : await readTextFile(path)

      const articleStore = useArticleStore.getState()
      emitter.emit('editor-file-content-updated', {
        path: normalizedFilePath,
        content,
      })
      await articleStore.setActiveFilePath(normalizedFilePath)
      articleStore.setCurrentArticle(content)
      emitter.emit('external-content-update', content)

      return {
        success: true,
        data: { filePath: normalizedFilePath, content },
        message: `Successfully opened file: ${normalizedFilePath}`,
      }
    } catch (error) {
      console.error('[open_markdown_file] Open failed', {
        filePath: params.filePath,
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to open file: ${error}`,
      }
    }
  },
}

export const createFileTool: Tool = {
  name: 'create_file',
  description: 'Create a new file in the file system. Returns filePath (relative) and fullPath (absolute for script execution).',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'fileName',
      type: 'string',
      description: 'Filename (including extension, e.g., "note.md", "config.json", "script.js")',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'File content (plain text)',
      required: true,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional: subfolder path, defaults to root directory. For temporary scripts executed by execute_skill_script, prefer paths like "skills/pptx/runtime"',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let normalizedFolderPath = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(params.folderPath)
        : undefined

      //
      if (!params.content || typeof params.content !== 'string') {
        return {
          success: false,
          error: 'Missing required parameter content, or wrong type',
        }
      }

      // fileName，
      let fileName = params.fileName
      if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        fileName = `file-${timestamp}.txt`
      }
      fileName = fileName.trim().replace(/\\/g, '/')

      if (!normalizedFolderPath && fileName.includes('/')) {
        const parts = fileName.split('/').filter(Boolean)
        fileName = parts.pop() || fileName
        normalizedFolderPath = parts.length > 0
          ? await ensureSafeWorkspaceRelativePath(parts.join('/'))
          : undefined
      }

      const filePath = await ensureSafeWorkspaceRelativePath(joinRelativePath(normalizedFolderPath, fileName))
      const isSpecialSkillPath =
        filePath.startsWith('skills/') || filePath.startsWith('outputs/')

      // getFilePathOptions
      const specialArticleRelativePath = isSpecialSkillPath
        ? `article/${filePath}`.replace(/^article\/article\//, 'article/')
        : undefined
      const { path, baseDir } = specialArticleRelativePath
        ? { path: specialArticleRelativePath as string, baseDir: BaseDirectory.AppData }
        : await getFilePathOptions(filePath)

      // ，
      const parentFolderPath = filePath.substring(0, filePath.lastIndexOf('/'))
      const needsParentFolder = parentFolderPath && parentFolderPath !== filePath

      const { exists } = await import('@tauri-apps/plugin-fs')
      const fileAlreadyExists = baseDir
        ? await exists(path, { baseDir })
        : await exists(path)

      if (fileAlreadyExists) {
        const existingContent = baseDir
          ? await readTextFile(path, { baseDir })
          : await readTextFile(path)
        if (existingContent === params.content) {
          return {
            success: true,
            data: { filePath, alreadyExists: true },
            message: `File already exists with the same content; no create needed: ${filePath}`,
          }
        }
        return {
          success: false,
          error: `File already exists: ${filePath}. create_file can only create new files; this create was cancelled. If overwrite or update is needed, have the user explicitly request an update.`,
        }
      }

      if (needsParentFolder) {
        const specialParentRelativePath = isSpecialSkillPath
          ? `article/${parentFolderPath}`.replace(/^article\/article\//, 'article/')
          : undefined
        const { path: parentPath, baseDir: parentBaseDir } = specialParentRelativePath
          ? { path: specialParentRelativePath as string, baseDir: BaseDirectory.AppData }
          : await getFilePathOptions(parentFolderPath)
        const { mkdir } = await import('@tauri-apps/plugin-fs')
        if (parentBaseDir) {
          await mkdir(parentPath, { baseDir: parentBaseDir, recursive: true })
        } else {
          await mkdir(parentPath, { recursive: true })
        }
      }

      if (baseDir) {
        await writeTextFile(path, params.content, { baseDir })
      } else {
        await writeTextFile(path, params.content)
      }

      //
      const { getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()
      const workspacePath = workspace.isCustom
        ? workspace.path
        : `${await appDataDir()}/article`

      //
      const fullPath = `${workspacePath}/${filePath}`

      const articleStore = useArticleStore.getState()
      const createdContent = params.content
      const inserted = articleStore.insertLocalEntry(filePath, false)
      await articleStore.ensurePathExpanded(filePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      // Markdown ，
      if (filePath.endsWith('.md')) {
        emitter.emit('editor-file-content-updated', {
          path: filePath,
          content: createdContent,
        })
        await articleStore.setActiveFilePath(filePath)
        articleStore.setCurrentArticle(createdContent)
        emitter.emit('external-content-update', createdContent)
      }

      return {
        success: true,
        data: {
          filePath,
          fullPath,
          alreadyExists: false,
        },
        message: `Successfully created file: ${fullPath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to create file: ${error}`,
      }
    }
  },
}

export const updateMarkdownFileTool: Tool = {
  name: 'update_markdown_file',
  description: 'Update the content of a Markdown note file. Optionally provide `expectedModifiedAt` to avoid overwriting a file that changed since it was last read.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New content (Markdown format)',
      required: true,
    },
    {
      name: 'expectedModifiedAt',
      type: 'string',
      description: 'Optional ISO timestamp of the file\'s last known modified time. If the on-disk file changed since then, the update will be rejected.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // getFilePathOptions
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

      if (params.expectedModifiedAt) {
        const expectedModifiedAt = new Date(params.expectedModifiedAt)
        if (Number.isNaN(expectedModifiedAt.getTime())) {
          return {
            success: false,
            error: `Invalid expectedModifiedAt: ${params.expectedModifiedAt}`,
          }
        }

        const currentStat = baseDir
          ? await stat(path, { baseDir })
          : await stat(path)
        const currentModifiedAt = currentStat.mtime

        if (currentModifiedAt && currentModifiedAt.getTime() !== expectedModifiedAt.getTime()) {
          return {
            success: false,
            error: `File changed on disk; update cancelled: ${normalizedFilePath}`,
            data: {
              filePath: normalizedFilePath,
              conflict: true,
              expectedModifiedAt: expectedModifiedAt.toISOString(),
              currentModifiedAt: currentModifiedAt.toISOString(),
            },
          }
        }
      }

      const currentContent = baseDir
        ? await readTextFile(path, { baseDir })
        : await readTextFile(path)
      if (currentContent === params.content) {
        const currentStat = baseDir
          ? await stat(path, { baseDir })
          : await stat(path)
        return {
          success: true,
          data: {
            filePath: normalizedFilePath,
            modifiedAt: currentStat.mtime?.toISOString(),
            unchanged: true,
          },
          message: `File already has the target content; no update needed: ${normalizedFilePath}`,
        }
      }

      if (baseDir) {
        await writeTextFile(path, params.content, { baseDir })
      } else {
        await writeTextFile(path, params.content)
      }

      const updatedContent = typeof params.content === 'string' ? params.content : String(params.content ?? '')
      const articleStore = useArticleStore.getState()
      emitter.emit('editor-file-content-updated', {
        path: normalizedFilePath,
        content: updatedContent,
      })

      if (articleStore.activeFilePath === normalizedFilePath) {
        // Keep the store and editor in sync without routing through the debounced save path.
        articleStore.setCurrentArticle(updatedContent)
        emitter.emit('external-content-update', updatedContent)
      }

      const updatedStat = baseDir
        ? await stat(path, { baseDir })
        : await stat(path)

      return {
        success: true,
        data: {
          filePath: normalizedFilePath,
          modifiedAt: updatedStat.mtime?.toISOString(),
        },
        message: `Successfully updated file: ${normalizedFilePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to update file: ${error}`,
      }
    }
  },
}

export const deleteMarkdownFileTool: Tool = {
  name: 'delete_markdown_file',
  description: 'Delete a Markdown file from the file system.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      //
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      // getFilePathOptions
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)
      const fileExists = baseDir
        ? await exists(path, { baseDir })
        : await exists(path)

      if (fileExists) {
        if (baseDir) {
          await remove(path, { baseDir })
        } else {
          await remove(path)
        }
      }

      //
      const filename = normalizedFilePath.split('/').pop() || normalizedFilePath
      try {
        const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
        await deleteVectorDocumentsByFilename(filename)
      } catch (error) {
        console.error(`Failed to delete vector data for file ${filename}:`, error)
      }

      const removed = articleStore.removeLocalEntry(normalizedFilePath)
      if (!removed) {
        await articleStore.loadFileTree()
      }

      await articleStore.cleanTabsByDeletedFile(normalizedFilePath)

      // ，
      if (isCurrentFile) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }

      return {
        success: true,
        data: {
          filePath: normalizedFilePath,
          alreadyAbsent: !fileExists,
        },
        message: fileExists
          ? `Successfully deleted file: ${normalizedFilePath}`
          : `File no longer exists; no delete needed: ${normalizedFilePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete file: ${error}`,
      }
    }
  },
}

export const searchMarkdownFilesTool: Tool = {
  name: 'search_markdown_files',
  description: `Search content within Markdown files in the file system.

Use this automatically when the answer depends on the user's notes, personal history, prior decisions, plans, opinions, or recorded material. Do not use it for general knowledge or when the current open note already provides enough context. Respect explicit requests not to search other notes.

Two modes:
- keyword: Fast exact matching for specific terms like "useState", "React", "API"
- rag: Hybrid semantic search for natural-language questions and related notes

Use folderPath to limit scope to a specific folder.`,
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword or natural language query',
      required: true,
    },
    {
      name: 'mode',
      type: 'string',
      description: 'Search mode: keyword for exact matching or rag for hybrid semantic search. Agent calls default to rag.',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional: limit search to specified folder (relative path)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFolderPath = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(params.folderPath)
        : undefined
      const ragStore = await Store.load('store.json')
      const excludedPaths = await ragStore.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS
      const isSearchablePath = (relativePath: string) => isPathAllowedForRag(relativePath, { excludedPaths })

      // RAG ： RAG
      if (params.mode === 'rag') {
        const { getContextForQuery, getContextForQueryInFolder } = await import('@/lib/rag')

        // ， BM25、。
        let keywords = [{ text: params.query, weight: 1 }]
        try {
          const rankedKeywords = await invoke<Array<{ text: string; weight: number }>>('rank_keywords', {
            text: params.query,
            topK: 15,
          })
          if (rankedKeywords.length > 0) {
            keywords = rankedKeywords
          }
        } catch (error) {
          console.warn('Failed to rank note search keywords, using the full query:', error)
        }

        // RAG
        const ragResult = normalizedFolderPath
          ? await getContextForQueryInFolder(params.query, keywords, normalizedFolderPath)
          : await getContextForQuery(params.query, keywords)

        // ，（，）
        const allFiles = (await getAllMarkdownFiles()).filter(file => isSearchablePath(file.relativePath))
        // （）
        const fileNameToPath = new Map<string, string[]>()
        const relativePathSet = new Set<string>()
        for (const file of allFiles) {
          const relativePath = file.relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
          relativePathSet.add(relativePath)
          const name = file.name
          if (!fileNameToPath.has(name)) {
            fileNameToPath.set(name, [])
          }
          fileNameToPath.get(name)!.push(relativePath)
        }

        const scoreByPath = new Map(
          ragResult.diagnostics.map(diagnostic => [diagnostic.filepath, diagnostic.finalScore])
        )

        // ，。
        const resolvedResults = await Promise.all(ragResult.sourceDetails.map(async source => {
          const workspaceRelativePath = (await toWorkspaceRelativePath(source.filepath))
            .replace(/\\/g, '/')
            .replace(/^\.\//, '')
          let filePath = relativePathSet.has(workspaceRelativePath)
            ? workspaceRelativePath
            : undefined

          if (!filePath) {
            const suffixMatches = allFiles
              .map(file => file.relativePath.replace(/\\/g, '/').replace(/^\.\//, ''))
              .filter(relativePath => workspaceRelativePath.endsWith(`/${relativePath}`))
            if (suffixMatches.length === 1) {
              filePath = suffixMatches[0]
            }
          }

          if (!filePath) {
            const paths = fileNameToPath.get(source.filename)
            if (paths?.length === 1) {
              filePath = paths[0]
            }
          }

          if (!filePath) return undefined

          return {
            filePath: await ensureSafeWorkspaceRelativePath(filePath),
            fileName: source.filename,
            matchedContent: source.content,
            relevanceScore: scoreByPath.get(source.filepath) ?? 0,
          }
        }))
        const formattedResults = resolvedResults.filter(result => result !== undefined)

        return {
          success: true,
          data: formattedResults,
 message: `RAG search found ${ragResult.sources.length} related notes${normalizedFolderPath ? ` (folder: ${normalizedFolderPath})` : ''}`,
        }
      }

      // ：
      // ，
      let allFiles = (await getAllMarkdownFiles()).filter(file => isSearchablePath(file.relativePath))
      if (normalizedFolderPath) {
        allFiles = allFiles.filter(file => file.relativePath.startsWith(normalizedFolderPath))
      }

      const results: Array<{
        filePath: string
        fileName: string
        matchedContent: string
        lineNumber?: number
      }> = []

      for (const file of allFiles) {
        try {
          let content = ''

          // getFilePathOptions
          const { path, baseDir } = await getFilePathOptions(file.relativePath)

          if (baseDir) {
            content = await readTextFile(path, { baseDir })
          } else {
            content = await readTextFile(path)
          }

          if (content.toLowerCase().includes(params.query.toLowerCase())) {
            //
            const lines = content.split('\n')

            //
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(params.query.toLowerCase())) {
                // （ 2 ）
                const contextStart = Math.max(0, i - 2)
                const contextEnd = Math.min(lines.length, i + 3)
                const contextLines = lines.slice(contextStart, contextEnd)

                // ，
                const formattedLines = contextLines.map((line, idx) => {
                  const actualLineNum = contextStart + idx + 1
                  const isMatchLine = actualLineNum === i + 1
                  const prefix = isMatchLine ? '>' : ' '
                  return `${prefix} ${actualLineNum}: ${line}`
                })

                results.push({
                  filePath: file.relativePath,
                  fileName: file.name,
                  matchedContent: formattedLines.join('\n'),
                  lineNumber: i + 1,
                })

                break // Only add the first match to avoid duplicates
              }
            }
          }
        } catch (error) {
          console.error(`Failed to read file ${file.path}:`, error)
        }
      }

      return {
        success: true,
        data: results,
 message: `Found ${results.length} matching files${normalizedFolderPath ? ` (folder: ${normalizedFolderPath})` : ''}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to search files: ${error}`,
      }
    }
  },
}

// ⚠️ DEPRECATED: Use replace_editor_content from editor-tools.ts instead
// This tool writes to disk, but since content is saved in real-time,
// replace_editor_content provides the same result with better performance.
// @deprecated since content is saved in real-time, use replace_editor_content instead
export const modifyCurrentNoteTool: Tool = {
  name: 'modify_current_note',
  description: '**DEPRECATED**: Use replace_editor_content from editor-tools instead. This tool writes to disk, but replace_editor_content provides better performance for real-time saved content.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    return {
      success: false,
      error: 'This tool is deprecated. Use replace_editor_content from editor-tools instead.',
    }
  },
}

export const readMarkdownFilesBatchTool: Tool = {
  name: 'read_markdown_files_batch',
  description: 'Batch read the saved on-disk contents of multiple Markdown notes. Prefer `get_editor_content` for any note that is currently open in the editor.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'Array of Markdown file paths whose saved contents should be read',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.filePaths) || params.filePaths.length === 0) {
        return {
          success: false,
          error: 'Parameter filePaths must be a non-empty array',
        }
      }

      const results = []
      const errors = []
      const skipped = []
      const { linkedResource } = useChatStore.getState()
      const readPlan = linkedResource && !isLinkedFolder(linkedResource)
        ? getBatchLinkedFileReadPlan(params.filePaths, linkedResource)
        : { filesToRead: params.filePaths, skippedFiles: [] }

      for (const filePath of readPlan.skippedFiles) {
        skipped.push({
          filePath,
          alreadyInContext: true,
        })
      }

      for (const filePath of readPlan.filesToRead) {
        try {
          let content = ''

          // getFilePathOptions
          const normalizedFilePath = await ensureSafeWorkspaceRelativePath(filePath)
          const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

          if (baseDir) {
            content = await readTextFile(path, { baseDir })
          } else {
            content = await readTextFile(path)
          }

          results.push({ filePath: normalizedFilePath, content })
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      // ，
      const hasErrors = errors.length > 0
      return {
        success: !hasErrors,
        data: {
          files: results,
          skipped,
          failed: errors,
          successCount: results.length,
          skippedCount: skipped.length,
          failCount: errors.length,
        },
        message: hasErrors
          ? `Partial failure: read ${results.length} files, skipped ${skipped.length} already in context, ${errors.length} failed`
          : `Successfully read ${results.length} files; skipped ${skipped.length} already in context`,
        error: hasErrors
          ? `Some files failed to read: ${errors.map(e => `${e.filePath}: ${e.error}`).join('; ')}`
          : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-read files: ${error}`,
      }
    }
  },
}

export const deleteMarkdownFilesBatchTool: Tool = {
  name: 'delete_markdown_files_batch',
  description: 'Batch delete multiple Markdown note files to avoid loop calls.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'Array of Markdown file paths to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.filePaths) || params.filePaths.length === 0) {
        return {
          success: false,
          error: 'Parameter filePaths must be a non-empty array',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileDeleted = false

      for (const filePath of params.filePaths) {
        try {
          const normalizedFilePath = await ensureSafeWorkspaceRelativePath(filePath)

          if (articleStore.activeFilePath === normalizedFilePath) {
            currentFileDeleted = true
          }

          // getFilePathOptions
          const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

          if (baseDir) {
            await remove(path, { baseDir })
          } else {
            await remove(path)
          }

          results.push(normalizedFilePath)
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      // （）
      const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
      for (const filePath of results) {
        const filename = filePath.split('/').pop() || filePath
        try {
          await deleteVectorDocumentsByFilename(filename)
        } catch (error) {
          console.error(`Failed to delete vector data for file ${filename}:`, error)
        }
      }

      await articleStore.loadFileTree()

      if (currentFileDeleted) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }

      // ，
      const hasErrors = errors.length > 0
      return {
        success: !hasErrors,
        data: {
          deleted: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: hasErrors
          ? `Partial failure: deleted ${results.length} files, ${errors.length} failed`
          : `Successfully deleted ${results.length} files`,
        error: hasErrors
          ? `Some files failed to delete: ${errors.map(e => `${e.filePath}: ${e.error}`).join('; ')}`
          : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-delete files: ${error}`,
      }
    }
  },
}

export const listMarkdownFilesByDateTool: Tool = {
  name: 'list_markdown_files_by_date',
  description: 'List Markdown note files updated within a specified time range. Supports filtering by relative time (e.g., last N days, N days ago) or absolute time range.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'lastNDays',
      type: 'number',
      description: 'Optional: get files modified within the last N days. Mutually exclusive with olderThanDays/startDate/endDate, has highest priority.',
      required: false,
    },
    {
      name: 'olderThanDays',
      type: 'number',
      description: 'Optional: get files modified more than N days ago (excluding recent N days). Mutually exclusive with lastNDays/startDate/endDate.',
      required: false,
    },
    {
      name: 'startDate',
      type: 'string',
      description: 'Optional: start date (ISO 8601 format, e.g., 2024-01-01 or 2024-01-01T00:00:00Z)',
      required: false,
    },
    {
      name: 'endDate',
      type: 'string',
      description: 'Optional: end date (ISO 8601 format, e.g., 2024-12-31 or 2024-12-31T23:59:59Z), defaults to current time',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let startDate: Date | undefined
      let endDate: Date | undefined

      // lastNDays （ N ）
      if (params.lastNDays && typeof params.lastNDays === 'number') {
        const now = new Date()
        startDate = new Date(now.getTime() - params.lastNDays * 24 * 60 * 60 * 1000)
        endDate = now
      }
      // olderThanDays （N ）
      else if (params.olderThanDays && typeof params.olderThanDays === 'number') {
        const now = new Date()
        endDate = new Date(now.getTime() - params.olderThanDays * 24 * 60 * 60 * 1000)
        // startDate ， endDate
      }
      // startDate/ endDate （）
      else {
        if (params.startDate) {
          startDate = new Date(params.startDate)
          if (isNaN(startDate.getTime())) {
            return {
              success: false,
              error: `Invalid startDate format: ${params.startDate}. Use ISO 8601 (e.g. 2024-01-01)`,
            }
          }
        }
        if (params.endDate) {
          endDate = new Date(params.endDate)
          if (isNaN(endDate.getTime())) {
            return {
              success: false,
              error: `Invalid endDate format: ${params.endDate}. Use ISO 8601 (e.g. 2024-12-31)`,
            }
          }
        } else {
          endDate = new Date()
        }
      }

      //
      const allFiles = await getAllMarkdownFiles(true)

      //
      const filteredFiles: MarkdownFile[] = []
      for (const file of allFiles) {
        if (!file.modifiedAt) {
 continue // File
        }

        const modifiedTime = new Date(file.modifiedAt)

        //
        if (startDate && modifiedTime < startDate) {
          continue
        }
        if (endDate && modifiedTime > endDate) {
          continue
        }

        filteredFiles.push(file)
      }

      //
      filteredFiles.sort((a, b) => {
        const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
        const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
        return bTime - aTime
      })

      return {
        success: true,
        data: filteredFiles.map(({ name, relativePath, modifiedAt, metadata }) => ({
          name,
          relativePath,
          modifiedAt: modifiedAt?.toISOString(),
          size: metadata?.size,
          createdAt: metadata?.createdAt?.toISOString(),
          accessedAt: metadata?.accessedAt?.toISOString(),
          isReadOnly: metadata?.isReadOnly,
        })),
        message: [
          'Found',
          String(filteredFiles.length),
          'matching files',
          startDate || endDate
            ? `(${[startDate ? `from ${startDate.toISOString()}` : '', endDate ? `to ${endDate.toISOString()}` : ''].filter(Boolean).join(' ')})`
            : '',
        ].filter(Boolean).join(' '),
      }
    } catch (error) {
      console.error('[list_markdown_files_by_date] Failed to get file list', {
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to list Markdown files by date: ${error}`,
      }
    }
  },
}

export const renameFileTool: Tool = {
  name: 'rename_file',
  description: 'Rename the specified Markdown file. Only changes the filename, not the folder containing the file.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to rename',
      required: true,
    },
    {
      name: 'newName',
      type: 'string',
      description: 'New filename (including .md extension, e.g., "new-note.md")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      //
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      // .md
      let newName = params.newName
      if (!newName.endsWith('.md')) {
        newName += '.md'
      }

      //
      const { path: oldPath, baseDir } = await getFilePathOptions(normalizedFilePath)
      let currentFileContent = ''
      if (isCurrentFile) {
        currentFileContent = articleStore.currentArticle
        try {
          if (!currentFileContent) {
            currentFileContent = baseDir
              ? await readTextFile(oldPath, { baseDir })
              : await readTextFile(oldPath)
          }
        } catch {
          currentFileContent = articleStore.currentArticle
        }
      }

      // （，）
      const pathParts = normalizedFilePath.split('/')
      pathParts[pathParts.length - 1] = newName
      const newRelativePath = pathParts.join('/')

      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      //
      const { exists } = await import('@tauri-apps/plugin-fs')
      const targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      const sourceExists = baseDir
        ? await exists(oldPath, { baseDir })
        : await exists(oldPath)

      if (targetExists && (!sourceExists || newRelativePath === normalizedFilePath)) {
        return {
          success: true,
          data: {
            oldPath: normalizedFilePath,
            newPath: newRelativePath,
            newName,
            alreadyRenamed: true,
          },
          message: `File is already at the renamed path; no repeat needed: ${newRelativePath}`,
        }
      }

      if (targetExists) {
        return {
          success: false,
          error: `Filename "${newName}" already exists; choose another name`,
        }
      }

      //
      if (baseDir) {
        await rename(oldPath, newPath, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
      } else {
        await rename(oldPath, newPath)
      }

      const migratedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (migratedVectorUpdatedAt !== null) {
        await removeVectorDocumentsForPath(normalizedFilePath)
        updateVectorIndexedState(normalizedFilePath, newRelativePath, migratedVectorUpdatedAt)
      } else {
        updateVectorIndexedState(normalizedFilePath, null)
      }

      const moved = articleStore.moveLocalEntry(normalizedFilePath, newRelativePath)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!moved) {
        await articleStore.loadFileTree()
      }

      await articleStore.syncOpenTabsForPathChange(normalizedFilePath, newRelativePath)
      const pathChangedEvent: { oldPath: string; newPath: string; content?: string } = {
        oldPath: normalizedFilePath,
        newPath: newRelativePath,
      }
      if (isCurrentFile) {
        pathChangedEvent.content = currentFileContent
      }
      emitter.emit('editor-file-path-changed', pathChangedEvent)

      // ， activeFilePath
      if (isCurrentFile) {
        await articleStore.setActiveFilePath(newRelativePath)
        articleStore.setCurrentArticle(currentFileContent)
        emitter.emit('external-content-update', currentFileContent)
      }

      return {
        success: true,
        data: {
          oldPath: normalizedFilePath,
          newPath: newRelativePath,
          newName,
        },
        message: `Successfully renamed "${normalizedFilePath}" to "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[rename_file] Rename failed', {
        filePath: params.filePath,
        newName: params.newName,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to rename file: ${error}`,
      }
    }
  },
}

export const moveFileTool: Tool = {
  name: 'move_file',
  description: 'Move the specified Markdown file to another folder. The filename remains unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to move',
      required: true,
    },
    {
      name: 'targetFolderPath',
      type: 'string',
      description: 'Target folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const normalizedTargetFolderPath = await ensureSafeWorkspaceRelativePath(params.targetFolderPath)

      //
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      //
      const fileName = normalizedFilePath.split('/').pop() || normalizedFilePath

      //
      const newRelativePath = normalizedTargetFolderPath
        ? `${normalizedTargetFolderPath}/${fileName}`
        : fileName

      //
      const { exists } = await import('@tauri-apps/plugin-fs')
      const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(normalizedTargetFolderPath)

      const targetFolderExists = targetBaseDir
        ? await exists(targetFolderDir, { baseDir: targetBaseDir })
        : await exists(targetFolderDir)

      if (!targetFolderExists) {
        return {
          success: false,
          error: `Target folder "${normalizedTargetFolderPath}" does not exist. Create it first`,
        }
      }

      //
      const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(normalizedFilePath)
      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)
      let currentFileContent = ''
      if (isCurrentFile) {
        currentFileContent = articleStore.currentArticle
        try {
          if (!currentFileContent) {
            currentFileContent = oldBaseDir
              ? await readTextFile(oldPath, { baseDir: oldBaseDir })
              : await readTextFile(oldPath)
          }
        } catch {
          currentFileContent = articleStore.currentArticle
        }
      }

      //
      const targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      const sourceExists = oldBaseDir
        ? await exists(oldPath, { baseDir: oldBaseDir })
        : await exists(oldPath)

      if (targetExists && (!sourceExists || newRelativePath === normalizedFilePath)) {
        return {
          success: true,
          data: {
            oldPath: normalizedFilePath,
            newPath: newRelativePath,
            alreadyMoved: true,
          },
          message: `File is already at the destination; no move needed: ${newRelativePath}`,
        }
      }

      if (targetExists) {
        return {
          success: false,
          error: `A file named "${fileName}" already exists at the destination; rename or delete it first`,
        }
      }

      // （ rename）
      if (oldBaseDir) {
        await rename(oldPath, newPath, { oldPathBaseDir: oldBaseDir, newPathBaseDir: oldBaseDir })
      } else {
        await rename(oldPath, newPath)
      }

      const migratedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (migratedVectorUpdatedAt !== null) {
        await removeVectorDocumentsForPath(normalizedFilePath)
        updateVectorIndexedState(normalizedFilePath, newRelativePath, migratedVectorUpdatedAt)
      } else {
        updateVectorIndexedState(normalizedFilePath, null)
      }

      const moved = articleStore.moveLocalEntry(normalizedFilePath, newRelativePath)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!moved) {
        await articleStore.loadFileTree()
      }

      await articleStore.syncOpenTabsForPathChange(normalizedFilePath, newRelativePath)
      const pathChangedEvent: { oldPath: string; newPath: string; content?: string } = {
        oldPath: normalizedFilePath,
        newPath: newRelativePath,
      }
      if (isCurrentFile) {
        pathChangedEvent.content = currentFileContent
      }
      emitter.emit('editor-file-path-changed', pathChangedEvent)

      // ， activeFilePath
      if (isCurrentFile) {
        await articleStore.setActiveFilePath(newRelativePath)
        articleStore.setCurrentArticle(currentFileContent)
        emitter.emit('external-content-update', currentFileContent)
      }

      return {
        success: true,
        data: {
          oldPath: normalizedFilePath,
          newPath: newRelativePath,
        },
        message: `Successfully moved "${normalizedFilePath}" to "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[move_file] Move failed', {
        filePath: params.filePath,
        targetFolderPath: params.targetFolderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to move file: ${error}`,
      }
    }
  },
}

export const copyFileTool: Tool = {
  name: 'copy_file',
  description: 'Copy the specified Markdown file to another folder. The original file remains unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to copy',
      required: true,
    },
    {
      name: 'targetFolderPath',
      type: 'string',
      description: 'Target folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes"). Leave empty to copy to current folder',
      required: false,
    },
    {
      name: 'newName',
      type: 'string',
      description: 'Optional: new filename (including .md extension). If not specified, uses the original filename, and automatically adds a number if a file with the same name exists',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const normalizedTargetFolderPath = params.targetFolderPath
        ? await ensureSafeWorkspaceRelativePath(params.targetFolderPath)
        : undefined

      //
      const originalFileName = normalizedFilePath.split('/').pop() || normalizedFilePath

      //
      let newFileName = params.newName || originalFileName
      if (!newFileName.endsWith('.md')) {
        newFileName += '.md'
      }

      //
      let newRelativePath = normalizedTargetFolderPath
        ? `${normalizedTargetFolderPath}/${newFileName}`
        : newFileName

      // （）
      if (normalizedTargetFolderPath) {
        const { exists } = await import('@tauri-apps/plugin-fs')
        const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(normalizedTargetFolderPath)

        const targetFolderExists = targetBaseDir
          ? await exists(targetFolderDir, { baseDir: targetBaseDir })
          : await exists(targetFolderDir)

        if (!targetFolderExists) {
          return {
            success: false,
            error: `Target folder "${normalizedTargetFolderPath}" does not exist. Create it first`,
          }
        }
      }

      //
      const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(normalizedFilePath)
      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      //
      const { exists } = await import('@tauri-apps/plugin-fs')
      let targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      // ，
      if (targetExists && !params.newName) {
        const baseName = newFileName.replace(/\.md$/, '')
        let counter = 1
        do {
          newFileName = `${baseName} ${counter}.md`
          newRelativePath = normalizedTargetFolderPath
            ? `${normalizedTargetFolderPath}/${newFileName}`
            : newFileName

          const { path: checkPath, baseDir: checkBaseDir } = await getFilePathOptions(newRelativePath)
          targetExists = checkBaseDir
            ? await exists(checkPath, { baseDir: checkBaseDir })
            : await exists(checkPath)
          counter++
        } while (targetExists && counter < 1000)
      }

      //
      const { path: finalNewPath, baseDir: finalNewBaseDir } = await getFilePathOptions(newRelativePath)

      //
      if (oldBaseDir && finalNewBaseDir) {
        await copyFile(oldPath, finalNewPath, { fromPathBaseDir: oldBaseDir, toPathBaseDir: finalNewBaseDir })
      } else {
        await copyFile(oldPath, finalNewPath)
      }

      const copiedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (copiedVectorUpdatedAt !== null) {
        updateVectorIndexedState(null, newRelativePath, copiedVectorUpdatedAt)
      }

      const inserted = articleStore.insertLocalEntry(newRelativePath, false)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      return {
        success: true,
        data: {
          sourcePath: normalizedFilePath,
          newPath: newRelativePath,
          newName: newFileName,
        },
        message: `Successfully copied "${normalizedFilePath}" to "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[copy_file] Copy failed', {
        filePath: params.filePath,
        targetFolderPath: params.targetFolderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to copy file: ${error}`,
      }
    }
  },
}

export const moveFilesBatchTool: Tool = {
  name: 'move_files_batch',
  description: 'Batch move multiple Markdown files to another folder to avoid loop calls. The filenames remain unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to move, each file contains filePath (source path) and targetFolderPath (destination folder)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: 'Parameter files must be a non-empty array',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileMoved = false

      for (const file of params.files) {
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          const targetFolderPath = await ensureSafeWorkspaceRelativePath(file.targetFolderPath)

          //
          if (articleStore.activeFilePath === filePath) {
            currentFileMoved = true
          }

          //
          const fileName = filePath.split('/').pop() || filePath

          //
          const newRelativePath = targetFolderPath
            ? `${targetFolderPath}/${fileName}`
            : fileName

          //
          const { exists } = await import('@tauri-apps/plugin-fs')
          const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(targetFolderPath)

          const targetFolderExists = targetBaseDir
            ? await exists(targetFolderDir, { baseDir: targetBaseDir })
            : await exists(targetFolderDir)

          if (!targetFolderExists) {
            errors.push({ filePath, error: `Target folder "${targetFolderPath}" does not exist` })
            continue
          }

          //
          const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(filePath)
          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          //
          const targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          if (targetExists) {
            errors.push({ filePath, error: 'A file with the same name already exists at the destination' })
            continue
          }

          // （ rename）
          if (oldBaseDir) {
            await rename(oldPath, newPath, { oldPathBaseDir: oldBaseDir, newPathBaseDir: oldBaseDir })
          } else {
            await rename(oldPath, newPath)
          }

          const migratedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (migratedVectorUpdatedAt !== null) {
            await removeVectorDocumentsForPath(filePath)
            updateVectorIndexedState(filePath, newRelativePath, migratedVectorUpdatedAt)
          } else {
            updateVectorIndexedState(filePath, null)
          }

          results.push({ oldPath: filePath, newPath: newRelativePath })
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      //
      await articleStore.loadFileTree()

      // ， activeFilePath
      if (currentFileMoved && results.length > 0) {
        const movedFile = results.find(r => articleStore.activeFilePath === r.oldPath)
        if (movedFile) {
          await articleStore.setActiveFilePath(movedFile.newPath)
          await articleStore.readArticle(movedFile.newPath)
        }
      }

      // ，
      return {
        success: errors.length === 0,
        data: {
          moved: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `Successfully moved ${results.length} files`
          : `Partial failure: moved ${results.length} files, ${errors.length} failed`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-move files: ${error}`,
      }
    }
  },
}

export const copyFilesBatchTool: Tool = {
  name: 'copy_files_batch',
  description: 'Batch copy multiple Markdown files to other folders to avoid loop calls. The original files remain unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to copy, each file contains filePath (source path), targetFolderPath (destination folder), and optionally newName (new filename)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: 'Parameter files must be a non-empty array',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []

      for (const file of params.files) {
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          const targetFolderPath = file.targetFolderPath
            ? await ensureSafeWorkspaceRelativePath(file.targetFolderPath)
            : undefined
          const newName = file.newName

          //
          const originalFileName = filePath.split('/').pop() || filePath

          //
          let newFileName = newName || originalFileName
          if (!newFileName.endsWith('.md')) {
            newFileName += '.md'
          }

          //
          let newRelativePath = targetFolderPath
            ? `${targetFolderPath}/${newFileName}`
            : newFileName

          // （）
          if (targetFolderPath) {
            const { exists } = await import('@tauri-apps/plugin-fs')
            const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(targetFolderPath)

            const targetFolderExists = targetBaseDir
              ? await exists(targetFolderDir, { baseDir: targetBaseDir })
              : await exists(targetFolderDir)

            if (!targetFolderExists) {
              errors.push({ filePath, error: `Target folder "${targetFolderPath}" does not exist` })
              continue
            }
          }

          //
          const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(filePath)
          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          //
          const { exists } = await import('@tauri-apps/plugin-fs')
          let targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          // ，
          if (targetExists && !newName) {
            const baseName = newFileName.replace(/\.md$/, '')
            let counter = 1
            do {
              newFileName = `${baseName} ${counter}.md`
              newRelativePath = targetFolderPath
                ? `${targetFolderPath}/${newFileName}`
                : newFileName

              const { path: checkPath, baseDir: checkBaseDir } = await getFilePathOptions(newRelativePath)
              targetExists = checkBaseDir
                ? await exists(checkPath, { baseDir: checkBaseDir })
                : await exists(checkPath)
              counter++
            } while (targetExists && counter < 1000)
          }

          //
          const { path: finalNewPath, baseDir: finalNewBaseDir } = await getFilePathOptions(newRelativePath)

          //
          if (oldBaseDir && finalNewBaseDir) {
            await copyFile(oldPath, finalNewPath, { fromPathBaseDir: oldBaseDir, toPathBaseDir: finalNewBaseDir })
          } else {
            await copyFile(oldPath, finalNewPath)
          }

          const copiedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (copiedVectorUpdatedAt !== null) {
            updateVectorIndexedState(null, newRelativePath, copiedVectorUpdatedAt)
          }

          results.push({
            sourcePath: filePath,
            newPath: newRelativePath,
            newName: newFileName,
          })
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      //
      await articleStore.loadFileTree()

      // ，
      return {
        success: errors.length === 0,
        data: {
          copied: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `Successfully copied ${results.length} files`
          : `Partial failure: copied ${results.length} files, ${errors.length} failed`,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to batch-copy files: ${error}`,
      }
    }
  },
}

export const renameFilesBatchTool: Tool = {
  name: 'rename_files_batch',
  description: 'Batch rename multiple Markdown files to avoid loop calls. Only changes the filenames, not the folders containing the files.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to rename, each file contains filePath (original path) and newName (new filename including .md extension)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: 'Parameter files must be a non-empty array',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileRenamed = false

      for (const file of params.files) {
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          let newName = file.newName

          // .md
          if (!newName.endsWith('.md')) {
            newName += '.md'
          }

          //
          if (articleStore.activeFilePath === filePath) {
            currentFileRenamed = true
          }

          //
          const { path: oldPath, baseDir } = await getFilePathOptions(filePath)

          // （，）
          const pathParts = filePath.split('/')
          pathParts[pathParts.length - 1] = newName
          const newRelativePath = pathParts.join('/')

          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          //
          const { exists } = await import('@tauri-apps/plugin-fs')
          const targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          if (targetExists) {
            errors.push({ filePath, error: `Filename "${newName}" already exists` })
            continue
          }

          //
          if (baseDir) {
            await rename(oldPath, newPath, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
          } else {
            await rename(oldPath, newPath)
          }

          const migratedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (migratedVectorUpdatedAt !== null) {
            await removeVectorDocumentsForPath(filePath)
            updateVectorIndexedState(filePath, newRelativePath, migratedVectorUpdatedAt)
          } else {
            updateVectorIndexedState(filePath, null)
          }

          results.push({
            oldPath: filePath,
            newPath: newRelativePath,
            newName,
          })
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      //
      await articleStore.loadFileTree()

      // ， activeFilePath
      if (currentFileRenamed && results.length > 0) {
        const renamedFile = results.find(r => articleStore.activeFilePath === r.oldPath)
        if (renamedFile) {
          await articleStore.setActiveFilePath(renamedFile.newPath)
          await articleStore.readArticle(renamedFile.newPath)
        }
      }

      // ，
      return {
        success: errors.length === 0,
        data: {
          renamed: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `Successfully renamed ${results.length} files`
          : `Partial failure: renamed ${results.length} files, ${errors.length} failed`,
      }
    } catch (error) {
      console.error('[rename_files_batch] Batch rename failed', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `Failed to batch-rename files: ${error}`,
      }
    }
  },
}

export const noteTools: Tool[] = [
  listMarkdownFilesTool,
  readMarkdownFileTool,
  openMarkdownFileTool,
  createFileTool,
  updateMarkdownFileTool,
  deleteMarkdownFileTool,
  searchMarkdownFilesTool,
  // modifyCurrentNoteTool: DEPRECATED - use replace_editor_content from editor-tools.ts instead
  readMarkdownFilesBatchTool,
  deleteMarkdownFilesBatchTool,
  listMarkdownFilesByDateTool,
  renameFileTool,
  moveFileTool,
  copyFileTool,
  moveFilesBatchTool,
  copyFilesBatchTool,
  renameFilesBatchTool,
]
