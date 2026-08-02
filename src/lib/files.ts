import { readDir, BaseDirectory, DirEntry } from "@tauri-apps/plugin-fs";
import { getFilePathOptions, getWorkspacePath } from "./workspace";
import { join } from "@tauri-apps/api/path";

export interface MarkdownFile {
  name: string;
  path: string;
  relativePath: string;
  modifiedAt?: Date;
  /** （ includeMetadata=true ） */
  metadata?: {
    size?: number;           // （）
    modifiedAt?: Date;       //
    createdAt?: Date;        //
    accessedAt?: Date;       //
    isReadOnly?: boolean;    //
  };
}

//
export interface LinkedFolder {
  name: string;           //
  path: string;           //
  relativePath: string;   //
  fileCount: number;      // markdown
  indexedCount: number;   //
}

//
export type LinkedResource = MarkdownFile | LinkedFolder;

// ：
export function isLinkedFolder(resource: LinkedResource): resource is LinkedFolder {
  return 'fileCount' in resource;
}

// Markdown
export async function collectMarkdownFiles(folderPath: string): Promise<Array<{path: string, name: string}>> {
  const files: Array<{path: string, name: string}> = [];
  
  const processDirectory = async (dirPath: string) => {
    try {
      const workspace = await getWorkspacePath();
      const pathOptions = await getFilePathOptions(dirPath);
      
      let entries;
      if (workspace.isCustom) {
        entries = await readDir(pathOptions.path);
      } else {
        entries = await readDir(pathOptions.path, { baseDir: pathOptions.baseDir });
      }
      
      for (const entry of entries) {
        const entryPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
        
        //
        if (entry.name.startsWith('.')) {
          continue;
        }
        
        if (entry.isDirectory) {
          //
          await processDirectory(entryPath);
        } else if (entry.name.endsWith('.md')) {
          // Markdown
          files.push({
            path: entryPath,
            name: entry.name
          });
        }
      }
    } catch (error) {
      console.error(`${dirPath} Failed`, error);
    }
  };
  
  await processDirectory(folderPath);
  return files;
}

/**
 * Markdown（）
 * @param includeMetadata （）， false
 */
export async function getAllMarkdownFiles(includeMetadata: boolean = false): Promise<MarkdownFile[]> {
  const workspace = await getWorkspacePath();


  const files: MarkdownFile[] = [];

  //
  async function processDirectory(dirPath: string, useCustomPath: boolean, relativePath: string = "", depth: number = 0): Promise<void> {
    let entries: DirEntry[];

    try {
      if (useCustomPath) {
        entries = await readDir(dirPath);
      } else {
        entries = await readDir(dirPath, { baseDir: BaseDirectory.AppData });
      }

      for (const entry of entries) {
        //
        if (entry.name === '.DS_Store' || entry.name.startsWith('.')) {
          continue;
        }

        const currentRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          //
          const childPath = await join(dirPath, entry.name);
          await processDirectory(childPath, useCustomPath, currentRelativePath, depth + 1);
        } else if (entry.name.endsWith('.md')) {
          // Markdown
          const fullPath = useCustomPath
            ? await join(dirPath, entry.name)
            : currentRelativePath;

          const fileInfo: MarkdownFile = {
            name: entry.name,
            path: fullPath,
            relativePath: currentRelativePath
          };

          // ，
          if (includeMetadata) {
            try {
              const { stat } = await import('@tauri-apps/plugin-fs');
              // getFilePathOptions （）
              const pathOptions = await getFilePathOptions(currentRelativePath);
              const metadata = pathOptions.baseDir
                ? await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
                : await stat(pathOptions.path);

              // modifiedAt
              fileInfo.modifiedAt = metadata.mtime ?? undefined;

              //
              fileInfo.metadata = {
                size: metadata.size,
                modifiedAt: metadata.mtime ?? undefined,
                createdAt: metadata.birthtime ?? undefined,
                accessedAt: metadata.atime ?? undefined,
                isReadOnly: metadata.readonly,
              };
            } catch (error) {
              console.warn(`[getAllMarkdownFiles] File Failed: ${currentRelativePath}`, error);
            }
          }

          files.push(fileInfo);
        }
      }
    } catch (error) {
      console.error(`Failed to process directory`, {
        dirPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  //
  const rootPath = workspace.isCustom ? workspace.path : 'article';

  await processDirectory(rootPath, workspace.isCustom);

  return files;
}