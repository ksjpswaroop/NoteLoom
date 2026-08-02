import { Tool, ToolResult } from '../types'
import { mkdir, remove, exists, readDir } from '@tauri-apps/plugin-fs'
import { ensureSafeWorkspaceRelativePath, getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { join } from '@tauri-apps/api/path'
import useArticleStore from '@/stores/article'
import { getVectorDocumentKey } from '@/lib/vector-document-key'

async function getMarkdownFilesForFolder(folderPath: string): Promise<string[]> {
  const { collectMarkdownFiles } = await import('@/lib/files')
  const files = await collectMarkdownFiles(folderPath)
  return files.map(file => file.path)
}

async function deleteVectorDocumentsForFiles(filePaths: string[]): Promise<void> {
  const { deleteVectorDocumentsByFilename } = await import('@/db/vector')

  for (const filePath of filePaths) {
    const vectorKey = getVectorDocumentKey(filePath)
    const legacyFilename = filePath.split('/').pop() || filePath

    try {
      await deleteVectorDocumentsByFilename(vectorKey)
      if (legacyFilename !== vectorKey) {
        await deleteVectorDocumentsByFilename(legacyFilename)
      }
    } catch (error) {
      console.error(`File ${filePath} Vector Failed`, error)
    }
  }

  const articleState = useArticleStore.getState()
  const nextMap = new Map(articleState.vectorIndexedFiles)
  for (const filePath of filePaths) {
    nextMap.delete(getVectorDocumentKey(filePath))
  }
  useArticleStore.setState({ vectorIndexedFiles: nextMap })
}

export const checkFolderExistsTool: Tool = {
  name: 'check_folder_exists',
  description: 'Check if the specified folder exists',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Folder path to check (relative to notes root directory, e.g., "frontend/React" or "study-notes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFolderPath = await ensureSafeWorkspaceRelativePath(params.folderPath)
      const workspace = await getWorkspacePath()

      let fullPath = ''
      let folderExists = false

      if (workspace.isCustom) {
        fullPath = await join(workspace.path, normalizedFolderPath)
        folderExists = await exists(fullPath)
      } else {
        const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
        fullPath = path
        folderExists = await exists(fullPath, { baseDir })
      }

      return {
        success: true,
        data: {
          folderPath: normalizedFolderPath,
          exists: folderExists,
          fullPath,
        },
        message: folderExists
          ? `Folder "${normalizedFolderPath}"`
          : `Folder "${normalizedFolderPath}"`,
      }
    } catch (error) {
      console.error('[check_folder_exists] Failed', {
        folderPath: params.folderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `FolderFailed: ${error}`,
      }
    }
  },
}

export const createFolderTool: Tool = {
  name: 'create_folder',
  description: 'Create a new folder for organizing notes',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      //
      if (!params.folderPath || typeof params.folderPath !== 'string') {
        return {
          success: false,
          error: 'folderPath Error',
        }
      }

      const normalizedFolderPath = await ensureSafeWorkspaceRelativePath(params.folderPath)

      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        // ：
        const fullPath = await join(workspace.path, normalizedFolderPath)
        
        //
        const folderExists = await exists(fullPath)
        if (folderExists) {
          // ，
          return {
            success: true,
            data: { folderPath: normalizedFolderPath, alreadyExists: true },
            message: `Folder already exists: ${normalizedFolderPath}`,
          }
        }

        //
        await mkdir(fullPath, { recursive: true })
      } else {
        // ： baseDir
        const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
        
        //
        const folderExists = await exists(path, { baseDir })
        if (folderExists) {
          // ，
          return {
            success: true,
            data: { folderPath: normalizedFolderPath, alreadyExists: true },
            message: `Folder already exists: ${normalizedFolderPath}`,
          }
        }

        //
        await mkdir(path, { baseDir, recursive: true })
      }

      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(normalizedFolderPath, true)
      await articleStore.ensurePathExpanded(normalizedFolderPath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      return {
        success: true,
        data: { folderPath: normalizedFolderPath },
        message: `Folder: ${normalizedFolderPath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `FolderFailed: ${error}`,
      }
    }
  },
}

export const deleteFolderTool: Tool = {
  name: 'delete_folder',
  description: 'Delete the specified folder (will delete all contents within the folder)',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Path of the folder to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      //
      if (!params.folderPath || typeof params.folderPath !== 'string') {
        return {
          success: false,
          error: 'folderPath Error',
        }
      }

      const normalizedFolderPath = await ensureSafeWorkspaceRelativePath(params.folderPath)
      const workspace = await getWorkspacePath()
      const articleStore = useArticleStore.getState()
      let folderExists = false
      let filePathsInFolder: string[] = []

      if (workspace.isCustom) {
        // ：
        const fullPath = await join(workspace.path, normalizedFolderPath)
        
        //
        folderExists = await exists(fullPath)

        if (folderExists) {
          filePathsInFolder = await getMarkdownFilesForFolder(normalizedFolderPath)
          await remove(fullPath, { recursive: true })
        }
      } else {
        // ： baseDir
        const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
        
        //
        folderExists = await exists(path, { baseDir })

        if (folderExists) {
          filePathsInFolder = await getMarkdownFilesForFolder(normalizedFolderPath)
          await remove(path, { baseDir, recursive: true })
        }
      }

      const removed = articleStore.removeLocalEntry(normalizedFolderPath)
      if (!removed) {
        await articleStore.loadFileTree()
      }

      await deleteVectorDocumentsForFiles(filePathsInFolder)

      await articleStore.cleanTabsByDeletedFolder(normalizedFolderPath)

      if (articleStore.activeFilePath && articleStore.activeFilePath.startsWith(`${normalizedFolderPath}/`)) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }

      return {
        success: true,
        data: { folderPath: normalizedFolderPath, alreadyAbsent: !folderExists },
        message: folderExists
          ? `Folder: ${normalizedFolderPath}`
          : `Folder ，None : ${normalizedFolderPath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `FolderFailed: ${error}`,
      }
    }
  },
}

export const listFoldersTool: Tool = {
  name: 'list_folders',
  description: 'List all folders under the specified path',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Folder path to list, leave empty for root directory',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const workspace = await getWorkspacePath()

      const normalizedFolderPath = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(params.folderPath)
        : ''

      if (workspace.isCustom) {
        // ：
        const fullPath = normalizedFolderPath
          ? await join(workspace.path, normalizedFolderPath)
          : workspace.path

        //
        const pathExists = await exists(fullPath)

        if (!pathExists) {
          return {
            success: false,
            error: `${normalizedFolderPath || 'Root directory'}`,
          }
        }

        //
        const entries = await readDir(fullPath)

        //
        const folders = entries
          .filter(entry => entry.isDirectory)
          .map(entry => ({
            name: entry.name,
            path: normalizedFolderPath ? `${normalizedFolderPath}/${entry.name}` : entry.name,
          }))

        return {
          success: true,
          data: folders,
          message: `${folders.length} Folder`,
        }
      } else {
        // ： baseDir
        const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)

        //
        const pathExists = await exists(path, { baseDir })

        if (!pathExists) {
          return {
            success: false,
            error: `${normalizedFolderPath || 'Root directory'}`,
          }
        }

        //
        const entries = await readDir(path, { baseDir })

        //
        const folders = entries
          .filter(entry => entry.isDirectory)
          .map(entry => ({
            name: entry.name,
            path: normalizedFolderPath ? `${normalizedFolderPath}/${entry.name}` : entry.name,
          }))

        return {
          success: true,
          data: folders,
          message: `${folders.length} Folder`,
        }
      }
    } catch (error) {
      console.error('[list_folders] Failed', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `List foldersFailed: ${error}`,
      }
    }
  },
}

export const createFoldersBatchTool: Tool = {
  name: 'create_folders_batch',
  description: 'Batch create multiple folders to avoid loop calls. Use for scenarios requiring multiple folders to be created at once.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPaths',
      type: 'array',
      description: 'Array of folder paths to create',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.folderPaths) || params.folderPaths.length === 0) {
        return {
          success: false,
          error: 'folderPaths Yes',
        }
      }

      const workspace = await getWorkspacePath()
      const created = []
      const skipped = []  // ，
      const errors = []   //

      for (const folderPath of params.folderPaths) {
        try {
          const normalizedFolderPath = await ensureSafeWorkspaceRelativePath(folderPath)

          if (workspace.isCustom) {
            const fullPath = await join(workspace.path, normalizedFolderPath)
            const folderExists = await exists(fullPath)
            if (folderExists) {
              skipped.push({ path: normalizedFolderPath, reason: 'Folder already exists' })
              continue
            }
            await mkdir(fullPath, { recursive: true })
          } else {
            const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
            const folderExists = await exists(path, { baseDir })
            if (folderExists) {
              skipped.push({ path: normalizedFolderPath, reason: 'Folder already exists' })
              continue
            }
            await mkdir(path, { baseDir, recursive: true })
          }
          created.push(normalizedFolderPath)
        } catch (error) {
          errors.push({ path: folderPath, error: String(error) })
        }
      }

      const articleStore = useArticleStore.getState()
      await articleStore.loadFileTree()

      // ，（ skipped ）
      return {
        success: errors.length === 0,
        data: {
          created,
          skipped,
          errors,
          createdCount: created.length,
          skippedCount: skipped.length,
          errorCount: errors.length,
        },
        message: errors.length === 0
          ? `${created.length} ， ${skipped.length}`
          : `Failed： ${created.length} ， ${skipped.length} ，${errors.length} Failed`,
      }
    } catch (error) {
      return {
        success: false,
        error: `FolderFailed: ${error}`,
      }
    }
  },
}

export const deleteFoldersBatchTool: Tool = {
  name: 'delete_folders_batch',
  description: 'Batch delete multiple folders (will delete all contents within the folders) to avoid loop calls.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'folderPaths',
      type: 'array',
      description: 'Array of folder paths to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.folderPaths) || params.folderPaths.length === 0) {
        return {
          success: false,
          error: 'folderPaths Yes',
        }
      }

      const workspace = await getWorkspacePath()
      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      const filePathsByFolder = new Map<string, string[]>()

      for (const folderPath of params.folderPaths) {
        try {
          const normalizedFolderPath = await ensureSafeWorkspaceRelativePath(folderPath)
          filePathsByFolder.set(normalizedFolderPath, await getMarkdownFilesForFolder(normalizedFolderPath))

          if (workspace.isCustom) {
            const fullPath = await join(workspace.path, normalizedFolderPath)
            const folderExists = await exists(fullPath)
            if (!folderExists) {
              errors.push({ path: normalizedFolderPath, error: 'Folder does not exist' })
              continue
            }
            await remove(fullPath, { recursive: true })
          } else {
            const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
            const folderExists = await exists(path, { baseDir })
            if (!folderExists) {
              errors.push({ path: normalizedFolderPath, error: 'Folder does not exist' })
              continue
            }
            await remove(path, { baseDir, recursive: true })
          }
          results.push(normalizedFolderPath)
        } catch (error) {
          errors.push({ path: folderPath, error: String(error) })
        }
      }

      for (const deletedFolderPath of results) {
        await deleteVectorDocumentsForFiles(filePathsByFolder.get(deletedFolderPath) || [])
        await articleStore.cleanTabsByDeletedFolder(deletedFolderPath)

        if (articleStore.activeFilePath && articleStore.activeFilePath.startsWith(`${deletedFolderPath}/`)) {
          await articleStore.setActiveFilePath('')
          articleStore.setCurrentArticle('')
        }
      }

      await articleStore.loadFileTree()

      // ，
      return {
        success: errors.length === 0,
        data: {
          deleted: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `${results.length} Folder`
          : `Failed： ${results.length} Folder，${errors.length} Failed`,
      }
    } catch (error) {
      return {
        success: false,
        error: `FolderFailed: ${error}`,
      }
    }
  },
}

export const folderTools: Tool[] = [
  checkFolderExistsTool,
  createFolderTool,
  deleteFolderTool,
  listFoldersTool,
  createFoldersBatchTool,
  deleteFoldersBatchTool,
]
