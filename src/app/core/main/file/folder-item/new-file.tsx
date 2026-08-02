import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { cloneDeep } from "lodash-es";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { FilePlus } from "lucide-react"

interface NewFileProps {
  item: DirTree;
}

export function NewFile({ item }: NewFileProps) {
  const t = useTranslations('article.file');
  const { 
    fileTree,
    setFileTree,
    collapsibleList,
    setCollapsibleList
  } = useArticleStore();

  const path = computedParentPath(item);

  function newFileHandler(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation();
    
    // ，， newFile
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // ，
    if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
      return;
    }
    
    //
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
    }
    
    if (currentFolder) {
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: currentFolder,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: []
      };
      currentFolder.children?.unshift(newFile);
      setFileTree(cacheTree);
    }
  }

  return (
    <ContextMenuItem
      inset
      disabled={!!item.sha && !item.isLocale}
      onClick={newFileHandler}
      menuType="file"
    >
      <FilePlus className="mr-2 h-4 w-4" />
      {t('context.newFile')}
    </ContextMenuItem>
  );
}
