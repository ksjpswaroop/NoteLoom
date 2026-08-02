import { Store } from '@tauri-apps/plugin-store'
import { writeFile, exists, mkdir } from '@tauri-apps/plugin-fs'
import { dirname } from '@tauri-apps/api/path'
import { v4 as uuidv4 } from 'uuid'
import { uploadImage } from './imageHosting'
import { getFilePathOptions, toWorkspaceRelativePath, getWorkspacePath } from './workspace'
import { convertImageByWorkspace } from './utils'
import { toMarkdownImagePath } from './markdown-image-path'
import { getNormalizedImageHosting } from './image-hosting-config'
import { getWritingAssetsDirName } from './writing-assets-path'
import useArticleStore from '@/stores/article'
import { uploadLocalLibraryFile } from '@/lib/sync/remote-library'

export interface ImageUploadResult {
  /** Webview URL（） */
  src: string
  /** Markdown */
  relativePath: string
  /** */
  useImageHosting: boolean
}

/**
 * ，。
 * ，。
 */
export async function saveImageToWorkspace(
  file: File,
  activeFilePath: string
): Promise<ImageUploadResult> {
  const { imageRelativePath, markdownRelativePath } = await saveImageLocally(file, activeFilePath)
  const articleStore = useArticleStore.getState()

  if (articleStore.syncStaticAssets) {
    try {
      const sha = await uploadLocalLibraryFile(imageRelativePath)
      articleStore.markFileRemote(imageRelativePath, sha)
    } catch (error) {
      console.error('[ImageHandler] Failed to auto-upload local image:', error)
    }
  }

  return {
    src: await convertImageByWorkspace(imageRelativePath),
    relativePath: markdownRelativePath,
    useImageHosting: false,
  }
}

/**
 * ：
 * @param file 
 * @param activeFilePath （）
 * @returns URL 
 */
export async function handleImageUpload(
  file: File,
  activeFilePath?: string
): Promise<ImageUploadResult> {
  //
  const isConfigured = await isImageHostingConfigured()

  // 1. ，
  if (isConfigured) {
    try {
      const imageHostingUrl = await uploadImage(file)
      if (imageHostingUrl) {
        return {
          src: imageHostingUrl,
          relativePath: imageHostingUrl,
          useImageHosting: true,
        }
      }
      // undefined，（）
      // ，
      throw new Error('Image hosting upload returned empty result')
    } catch (error) {
      console.error('[ImageHandler] Failed to upload to image hosting:', error)
      // ，
      throw error
    }
  }

  // 2. ，
  if (activeFilePath) {
    try {
      return await saveImageToWorkspace(file, activeFilePath)
    } catch (error) {
      console.error('Failed to save image locally:', error)
      throw error
    }
  }

  throw new Error('No image hosting configured and no active file path for local storage')
}

/**
 * Markdown 
 * @param file 
 * @param markdownPath Markdown （、）
 * @returns ， Markdown 
 */
async function saveImageLocally(file: File, markdownPath: string): Promise<{
  imageRelativePath: string
  markdownRelativePath: string
}> {
  //
  const ext = file.name.split('.').pop() || 'png'
  const filename = `${uuidv4()}.${ext}`.replace(/\s/g, '_')

  //
  const workspace = await getWorkspacePath()
  const store = await Store.load('store.json')
  const assetsDirName = getWritingAssetsDirName(await store.get<string>('assetsPath'))

  // markdownPath （）
  let markdownDir: string = ''

  // markdownPath ，
  if (markdownPath.includes('/') || markdownPath.includes('\\')) {
    if (workspace.isCustom) {
      //
      const fullDir = await dirname(markdownPath)
      //
      if (fullDir.startsWith(workspace.path)) {
        markdownDir = fullDir.substring(workspace.path.length).replace(/^\//, '')
      } else {
        markdownDir = '' // workspace ，
      }
    } else {
      // （AppData/article）
      // markdown ， article
      const pathOptions = await getFilePathOptions(markdownPath)
      // article/
      const relativeMarkdownPath = pathOptions.path.replace(/^article\//, '')
      markdownDir = await dirname(relativeMarkdownPath)
    }
  }
  // markdownDir ，

  //
  // markdownDir （）， images
  // markdownDir/images
  const imageDir = markdownDir ? `${markdownDir}/${assetsDirName}` : assetsDirName
  const imageRelativePath = `${imageDir}/${filename}`

  //
  await ensureDirectoryExists(imageDir)

  //
  const arrayBuffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  const pathOptions = await getFilePathOptions(imageRelativePath)

  await writeFile(pathOptions.path, uint8Array, {
    baseDir: pathOptions.baseDir,
  })

  //
  const workspaceRelativeImagePath = await toWorkspaceRelativePath(imageRelativePath)
  await syncImageIntoFileTree(imageDir, workspaceRelativeImagePath)

  return {
    imageRelativePath: workspaceRelativeImagePath,
    markdownRelativePath: toMarkdownImagePath(markdownPath, workspaceRelativeImagePath),
  }
}

async function syncImageIntoFileTree(imageDir: string, imagePath: string): Promise<void> {
  const articleStore = useArticleStore.getState()
  const parentDir = imageDir.includes('/') ? imageDir.slice(0, imageDir.lastIndexOf('/')) : ''
  const expandedPaths = new Set(articleStore.collapsibleList)
  const parentWasExpanded = parentDir ? expandedPaths.has(parentDir) : false
  const assetDirWasExpanded = expandedPaths.has(imageDir)

  const insertedDir = articleStore.insertLocalEntry(imageDir, true)
  const insertedFile = articleStore.insertLocalEntry(imagePath, false)

  if (parentWasExpanded) {
    await articleStore.loadCollapsibleFiles(parentDir, { force: true })
  }

  if (assetDirWasExpanded) {
    await articleStore.loadCollapsibleFiles(imageDir, { force: true })
  } else if (!insertedDir || !insertedFile) {
    await articleStore.loadCollapsibleFiles(imageDir, { force: true })
  }
}

/**
 * ，
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    const pathOptions = await getFilePathOptions(dirPath)

    //
    const dirExists = await exists(pathOptions.path, {
      baseDir: pathOptions.baseDir,
    })

    if (!dirExists) {
      // ，
      await mkdir(pathOptions.path, {
        baseDir: pathOptions.baseDir,
        recursive: true,
      })
    }
  } catch {
    // ，
  }
}

/**
 * 
 */
export async function isImageHostingConfigured(): Promise<boolean> {
  const store = await Store.load('store.json')
  const useImageRepo = await store.get<boolean>('useImageRepo')
  const savedMainImageHosting = await store.get<string>('mainImageHosting')
  const normalizedImageHosting = getNormalizedImageHosting(savedMainImageHosting)
  const mainImageHosting = useImageRepo ? normalizedImageHosting.value : savedMainImageHosting
  const isConfigured = !!(useImageRepo && mainImageHosting && mainImageHosting !== 'none')

  if (useImageRepo && normalizedImageHosting.shouldPersist) {
    await store.set('mainImageHosting', normalizedImageHosting.value)
    await store.save()
  }

  return isConfigured
}

/**
 * File base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      resolve(reader.result as string)
    }
    reader.onerror = (error) => {
      reject(error)
    }
  })
}
