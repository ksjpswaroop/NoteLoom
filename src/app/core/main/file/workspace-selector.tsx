'use client'

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { FolderOpen } from "lucide-react"
import useSettingStore from "@/stores/setting"
import useArticleStore from "@/stores/article"
import { useTranslations } from 'next-intl'
import { useMemo } from "react"
import { getWorkspaceDisplayName } from "@/lib/workspace-name"

export function WorkspaceSelector() {
  const { workspacePath, workspaceHistory, setWorkspacePath } = useSettingStore()
  const { loadWorkspaceCollapsibleList, loadFileTree, setActiveFilePath, setCurrentArticle } = useArticleStore()
  const t = useTranslations('settings.file')

  //
  const currentWorkspaceName = useMemo(() => {
    return getWorkspaceDisplayName(workspacePath, t('workspace.defaultPath'))
  }, [workspacePath, t])

  //
  async function handleWorkspaceChange(path: string) {
    //
    const targetPath = path === '__default__' ? '' : path
    if (targetPath === workspacePath) return
    
    try {
      await setWorkspacePath(targetPath)
      setActiveFilePath('')
      setCurrentArticle('')
      const lastActivePath = await loadWorkspaceCollapsibleList()
      await loadFileTree()
      if (lastActivePath) await setActiveFilePath(lastActivePath)
    } catch (error) {
      console.error('Failed to switch workspace:', error)
    }
  }

  return (
    <div className="border-t bg-muted/30 h-6 flex items-center">
      <Select value={workspacePath} onValueChange={handleWorkspaceChange}>
        <SelectTrigger className="h-6 border-0 bg-transparent text-sm hover:bg-transparent focus-visible:border-transparent focus-visible:ring-0">
          <span className="truncate text-xs text-right">{currentWorkspaceName}</span>
        </SelectTrigger>
        <SelectContent>
          {/* */}
          <SelectItem value="__default__">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              <span>{t('workspace.defaultPath')}</span>
            </div>
          </SelectItem>
          {/* */}
          {workspaceHistory.map((path, index) => (
            <SelectItem key={index} value={path}>
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4" />
                <span>{getWorkspaceDisplayName(path, t('workspace.defaultPath'))}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
