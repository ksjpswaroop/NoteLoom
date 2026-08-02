import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import { appDataDir } from '@tauri-apps/api/path';
import { openPath } from "@tauri-apps/plugin-opener";
import { FolderOpen } from "lucide-react"

interface ViewDirectoryProps {
  item: DirTree;
}

export function ViewDirectory({ item }: ViewDirectoryProps) {
  const t = useTranslations('article.file');
  const path = computedParentPath(item);

  async function handleShowFileManager() {
    //
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace');
    const workspace = await getWorkspacePath();
    
    //
    if (workspace.isCustom) {
      // -
      const pathOptions = await getFilePathOptions(path);
      openPath(pathOptions.path);
    } else {
      // - AppData
      const appDir = await appDataDir();
      openPath(`${appDir}/article/${path}`);
    }
  }

  return (
    <ContextMenuItem inset onClick={handleShowFileManager} menuType="file">
      <FolderOpen className="mr-2 h-4 w-4" />
      {t('context.viewDirectory')}
    </ContextMenuItem>
  );
}
