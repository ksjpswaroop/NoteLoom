import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import { DirTree } from "@/stores/article";
import { computedParentPath } from "@/lib/path";
import { Copy } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { BaseDirectory, mkdir, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "@/hooks/use-toast";

interface DuplicateFolderProps {
  item: DirTree;
  shortcut?: string;
}

export function DuplicateFolder({ item, shortcut }: DuplicateFolderProps) {
  const path = computedParentPath(item);

  async function handleDuplicateFolder() {
    try {
      const { generateCopyFoldername } = await import('@/lib/default-filename')
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()

      //
      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''

      // （ _copy ）
      const targetName = await generateCopyFoldername(parentPath, item.name)
      const targetPath = parentPath ? `${parentPath}/${targetName}` : targetName

      //
      const sourcePathOptions = await getFilePathOptions(path)
      const targetPathOptions = await getFilePathOptions(targetPath)

      //
      if (workspace.isCustom) {
        await mkdir(targetPathOptions.path)
      } else {
        await mkdir(targetPathOptions.path, { baseDir: targetPathOptions.baseDir })
      }

      //
      const copyDirRecursively = async (srcRelative: string, destRelative: string) => {
        const entries = await readDir(
          srcRelative,
          workspace.isCustom ? {} : { baseDir: BaseDirectory.AppData }
        )

        for (const entry of entries) {
          const srcEntryPath = `${srcRelative}/${entry.name}`
          const destEntryPath = `${destRelative}/${entry.name}`

          if (entry.isDirectory) {
            //
            if (workspace.isCustom) {
              await mkdir(destEntryPath)
            } else {
              await mkdir(destEntryPath, { baseDir: BaseDirectory.AppData })
            }
            await copyDirRecursively(srcEntryPath, destEntryPath)
          } else {
            //
            try {
              let content = ''
              if (workspace.isCustom) {
                content = await readTextFile(srcEntryPath)
                await writeTextFile(destEntryPath, content)
              } else {
                content = await readTextFile(srcEntryPath, { baseDir: BaseDirectory.AppData })
                await writeTextFile(destEntryPath, content, { baseDir: BaseDirectory.AppData })
              }
            } catch (err) {
              console.error(`Error copying file ${srcEntryPath}:`, err)
            }
          }
        }
      }

      await copyDirRecursively(sourcePathOptions.path, targetPathOptions.path)

      //
      const useArticleStore = (await import('@/stores/article')).default
      useArticleStore.getState().loadFileTree()

      toast({ title: `FolderCopied ${targetName}` })
    } catch (error) {
      console.error('Duplicate folder failed:', error)
      toast({ title: 'FolderFailed', variant: 'destructive' })
    }
  }

  return (
    <ContextMenuItem inset onClick={handleDuplicateFolder} menuType="file">
      <Copy className="mr-2 h-4 w-4" />
      Duplicate
      {shortcut && (
        <ContextMenuShortcut menuType="file">
          <Kbd>{shortcut}</Kbd>
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}
