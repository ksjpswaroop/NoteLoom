import { exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from './workspace'

/**
 * 
 * @param parentPath ，
 * @param baseName ， "Untitled"
 * @returns （.md）
 */
export async function generateUniqueFilename(parentPath: string = '', baseName: string = 'Untitled'): Promise<string> {
  const workspace = await getWorkspacePath()

  //
  let filename = `${baseName}.md`
  let counter = 0

  while (true) {
    //
    const fullRelativePath = parentPath ? `${parentPath}/${filename}` : filename
    const pathOptions = await getFilePathOptions(fullRelativePath)

    //
    let fileExists = false
    try {
      if (workspace.isCustom) {
        fileExists = await exists(pathOptions.path)
      } else {
        fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      // ，
      fileExists = false
    }

    if (!fileExists) {
      return filename
    }

    // ，
    counter++
    filename = `${baseName} (${counter}).md`
  }
}

/**
 * 
 * @param parentPath 
 * @param originalName 
 * @returns （）
 */
export async function generateCopyFilename(parentPath: string, originalName: string): Promise<string> {
  const workspace = await getWorkspacePath()

  //
  const lastDotIndex = originalName.lastIndexOf('.')
  const baseName = lastDotIndex > 0 ? originalName.substring(0, lastDotIndex) : originalName
  const extension = lastDotIndex > 0 ? originalName.substring(lastDotIndex) : ''

  //
  let filename = originalName
  let counter = 0

  while (true) {
    //
    const fullRelativePath = parentPath ? `${parentPath}/${filename}` : filename
    const pathOptions = await getFilePathOptions(fullRelativePath)

    //
    let fileExists = false
    try {
      if (workspace.isCustom) {
        fileExists = await exists(pathOptions.path)
      } else {
        fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      // ，
      fileExists = false
    }

    if (!fileExists) {
      return filename
    }

    // ，
    counter++
    if (counter === 1) {
      // ， "_copy"
      filename = `${baseName}_copy${extension}`
    } else {
      // ，
      filename = `${baseName}_copy_${counter}${extension}`
    }
  }
}

/**
 * 
 * @param parentPath 
 * @param originalName 
 * @returns 
 */
export async function generateCopyFoldername(parentPath: string, originalName: string): Promise<string> {
  const workspace = await getWorkspacePath()

  //
  let foldername = originalName
  let counter = 0

  while (true) {
    //
    const fullRelativePath = parentPath ? `${parentPath}/${foldername}` : foldername
    const pathOptions = await getFilePathOptions(fullRelativePath)

    //
    let folderExists = false
    try {
      if (workspace.isCustom) {
        folderExists = await exists(pathOptions.path)
      } else {
        folderExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      // ，
      folderExists = false
    }

    if (!folderExists) {
      return foldername
    }

    // ，
    counter++
    if (counter === 1) {
      // ， "_copy"
      foldername = `${originalName}_copy`
    } else {
      // ，
      foldername = `${originalName}_copy_${counter}`
    }
  }
}


