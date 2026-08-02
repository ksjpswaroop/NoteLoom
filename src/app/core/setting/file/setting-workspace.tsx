'use client'

import { Button } from "@/components/ui/button"
import useSettingStore from "@/stores/setting"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs"
import { useTranslations } from 'next-intl'
import useArticleStore from "@/stores/article"
import { useSkillsStore } from "@/stores/skills"
import { X, FolderOpen, History, Trash2, ChevronDown } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/responsive-popover"
import { useState } from "react"
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field"

export function SettingWorkspace({ showTitle = true }: { showTitle?: boolean }) {
  const {
    workspacePath,
    setWorkspacePath,
    workspaceHistory,
    removeWorkspaceHistory,
    clearWorkspaceHistory
  } = useSettingStore()
  const {loadWorkspaceCollapsibleList, loadFileTree, setActiveFilePath, setCurrentArticle} = useArticleStore()
  const { refreshSkills } = useSkillsStore()
  const t = useTranslations('settings.file')
  const [open, setOpen] = useState(false)

  //
  async function handleSelectWorkspace() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t('workspace.select')
      })
      
      if (selected) {
        const path = selected as string
        await switchWorkspace(path)
      }
    } catch (error) {
      console.error('Failed to select workspace:', error)
    }
  }

  // （）
  async function switchWorkspace(path: string) {
    try {
      await setWorkspacePath(path)
      setActiveFilePath('')
      setCurrentArticle('')
      const lastActivePath = await loadWorkspaceCollapsibleList()
      await loadFileTree()
      if (lastActivePath) await setActiveFilePath(lastActivePath)
      await refreshSkills()
    } catch (error) {
      console.error('Failed to switch workspace:', error)
    }
  }


  //
  async function handleClearHistory() {
    await clearWorkspaceHistory()
  }

  //
  async function handleResetWorkspace() {
    try {
      //
      const exists1 = await exists('article', { baseDir: BaseDirectory.AppData })
      if (!exists1) {
        await mkdir('article', { baseDir: BaseDirectory.AppData })
      }
      await setWorkspacePath('')
      setActiveFilePath('')
      setCurrentArticle('')
      const lastActivePath = await loadWorkspaceCollapsibleList()
      await loadFileTree()
      if (lastActivePath) await setActiveFilePath(lastActivePath)
      await refreshSkills()
    } catch (error) {
      console.error('Failed to reset workspace:', error)
    }
  }

  return (
    <Field>
      {showTitle ? <FieldTitle>{t('workspace.current')}</FieldTitle> : null}
        <div className="flex flex-col gap-3">
          {/* */}
          <ResponsivePopover open={open} onOpenChange={setOpen} mobileTitle={t('workspace.current')}>
            <ResponsivePopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                aria-label={t('workspace.current')}
                className="w-full justify-between p-3 h-auto text-left font-normal"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <FolderOpen className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate text-sm">
                    {workspacePath || t('workspace.default')}
                  </span>
                </div>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </ResponsivePopoverTrigger>
            <ResponsivePopoverContent className="w-full p-0" align="start">
              <Command>
                <CommandInput placeholder={t('workspace.searchPlaceholder')} />
                <CommandList>
                  <CommandEmpty>{t('workspace.noResults')}</CommandEmpty>
                  
                  {/* */}
                  <CommandGroup heading={t('workspace.actions')}>
                    <CommandItem
                      onSelect={() => {
                        setOpen(false)
                        handleSelectWorkspace()
                      }}
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      {t('workspace.select')}
                    </CommandItem>
                    {workspacePath && (
                      <CommandItem
                        onSelect={() => {
                          setOpen(false)
                          handleResetWorkspace()
                        }}
                      >
                        <History className="mr-2 h-4 w-4" />
                        {t('workspace.reset')}
                      </CommandItem>
                    )}
                  </CommandGroup>

                  {/* */}
                  {workspaceHistory.length > 0 && (
                    <>
                      <CommandSeparator />
                      <CommandGroup heading={t('workspace.history')}>
                        {workspaceHistory.map((path, index) => (
                          <CommandItem
                            key={index}
                            onSelect={() => {
                              setOpen(false)
                              switchWorkspace(path)
                            }}
                          >
                            <div className="flex items-center justify-between w-full group">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <FolderOpen className="h-4 w-4 flex-shrink-0" />
                                <span className="truncate" title={path}>
                                  {path}
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-8 p-0 text-destructive md:size-6 md:opacity-0 md:group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeWorkspaceHistory(path)
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </CommandItem>
                        ))}
                        {workspaceHistory.length > 1 && (
                          <CommandItem
                            onSelect={() => {
                              setOpen(false)
                              handleClearHistory()
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('workspace.clearHistory')}
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </ResponsivePopoverContent>
          </ResponsivePopover>
          
        </div>
      <FieldDescription>{t('workspace.desc')}</FieldDescription>
    </Field>
  )
}
