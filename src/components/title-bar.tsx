'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'
import { Search, Settings, Minus, Square, X, PanelLeft, PanelRight, SquarePen, Cog, CalendarDays, LayoutDashboard } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'
import { useSidebarStore } from '@/stores/sidebar'
import { PinToggle } from './pin-toggle'
import { SyncToggle } from './title-bar-toolbars/sync-toggle'
import AppStatus from './app-status'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import useArticleStore from '@/stores/article'
import useUpdateStore from '@/stores/update'
import React from 'react'
import { ControlText } from '@/app/core/main/mark/control-text'
import { ControlRecording } from '@/app/core/main/mark/control-recording'
import { ControlScan } from '@/app/core/main/mark/control-scan'
import { ControlImage } from '@/app/core/main/mark/control-image'
import { ControlLink } from '@/app/core/main/mark/control-link'
import { ControlFile } from '@/app/core/main/mark/control-file'
import { ControlTodo } from '@/app/core/main/mark/control-todo'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { DraggableToolbarItem } from './draggable-toolbar-item'
import { useToolbarShortcuts } from '@/hooks/use-toolbar-shortcuts'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface TitleBarProps {
  onSearchClick?: () => void
  onActivityClick?: () => void
  activityOpen?: boolean
}

export function TitleBar({ onSearchClick, onActivityClick, activityOpen = false }: TitleBarProps) {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)
  const pathname = usePathname()
  const router = useRouter()
  const { open: settingsOpen, openSettings, closeSettings } = useSettingsDialogStore()
  const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible, toggleLeftSidebar, toggleCenterPanel, toggleRightSidebar } = useSidebarStore()
  const isDashboard = pathname === '/core/dashboard'

  async function openDashboard() {
    router.push('/core/dashboard')
    try {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/dashboard')
      await store.save()
    } catch (error) {
      console.debug('Failed to persist dashboard page preference:', error)
    }
  }
  
  // ""
  const wouldCauseLeftOnly = (currentVisible: boolean, panel: 'left' | 'center' | 'right') => {
    // ，（）
    if (!currentVisible) return false
    
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    if (visibleCount === 1) return true //
    
    if (visibleCount === 2) {
      // ""
      if (panel === 'center' && leftSidebarVisible && !rightSidebarVisible) return true
      if (panel === 'right' && leftSidebarVisible && !centerPanelVisible) return true
      // ""（""""），
    }
    
    return false
  }
  const { recordToolbarConfig, setRecordToolbarConfig } = useSettingStore()
  const { activeFilePath } = useArticleStore()
  const { hasUpdate } = useUpdateStore()
  const t = useTranslations()
  const { isModifierPressed } = useToolbarShortcuts()

  const getFileName = () => {
    if (!activeFilePath) return ''
    const parts = activeFilePath.split('/')
    return parts[parts.length - 1]
  }

  const searchPlaceholder = getFileName() || t('navigation.searchPlaceholder')


  //
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  )

  //
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = recordToolbarConfig.findIndex((item) => item.id === active.id)
      const newIndex = recordToolbarConfig.findIndex((item) => item.id === over.id)
      
      const newItems = arrayMove(recordToolbarConfig, oldIndex, newIndex)
      const updatedItems = newItems.map((item, index) => ({
        ...item,
        order: index
      }))
      setRecordToolbarConfig(updatedItems)
    }
  }

  useEffect(() => {
    //
    setIsMobile(isMobileDevice())
    
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch (error) {
      console.error('Error detecting platform:', error)
    }
  }, [])



  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow()
      await window.minimize()
    } catch (error) {
      console.error('Error minimizing window:', error)
    }
  }

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow()
      await window.toggleMaximize()
    } catch (error) {
      console.error('Error maximizing window:', error)
    }
  }

  const handleClose = async () => {
    try {
      const window = getCurrentWindow()
      await window.close()
    } catch (error) {
      console.error('Error closing window:', error)
    }
  }

  //
  if (isMobile) {
    return null
  }

  //
  if (currentPlatform === 'unknown') {
    return null
  }

  // macOS: ，
  // Windows/Linux: ，
  const isMacOS = currentPlatform === 'macos'

  return (
    <TooltipProvider>
      <div
        className="fixed top-0 right-0 left-0 z-40 flex h-[36px] w-full shrink-0 flex-nowrap items-center border-b bg-background select-none"
        style={{
          // macOS ，（ 70px）
          paddingLeft: isMacOS ? '70px' : '0',
        }}
        data-tauri-drag-region
      >
        {/* */}
        <div id="onboarding-target-record-toolbar" className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          <TooltipProvider>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={recordToolbarConfig.filter(item => item.enabled).map(item => item.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex">
                  {recordToolbarConfig
                    .filter(item => item.enabled)
                    .sort((a, b) => a.order - b.order)
                    .map((item, index) => {
                      const renderToolbarItem = () => {
                        switch (item.id) {
                          case 'text':
                            return <ControlText />
                          case 'recording':
                            return <ControlRecording />
                          case 'scan':
                            return <ControlScan />
                          case 'image':
                            return <ControlImage />
                          case 'link':
                            return <ControlLink />
                          case 'file':
                            return <ControlFile />
                          case 'todo':
                            return <ControlTodo />
                          default:
                            return null
                        }
                      }
                      
                      return (
                        <DraggableToolbarItem
                          key={item.id}
                          id={item.id}
                          shortcutNumber={index + 1}
                          showShortcut={isModifierPressed && index < 9}
                        >
                          {renderToolbarItem()}
                        </DraggableToolbarItem>
                      )
                    })}
                </div>
              </SortableContext>
            </DndContext>
          </TooltipProvider>
        </div>

        {/* */}
        <div className="flex-1 flex items-center justify-center px-4 min-w-[200px] max-w-[600px] mx-auto" data-tauri-drag-region>
          <div 
            className="relative w-full h-6 max-w-md group cursor-pointer flex justify-center items-center border rounded-sm"
            onClick={() => onSearchClick?.()}
            data-tauri-drag-region="false"
          >
            <Search className="size-3.5 text-muted-foreground" />
            <div className="pl-2 text-xs text-muted-foreground transition-colors">
              <span className="truncate">{searchPlaceholder}</span>
            </div>
          </div>
        </div>

        {/* */}
        <div className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          {/* */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${wouldCauseLeftOnly(leftSidebarVisible, 'left') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(leftSidebarVisible, 'left')) {
                    toggleLeftSidebar()
                  }
                }}
              >
                <PanelLeft className={`h-4 w-4 ${!leftSidebarVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{leftSidebarVisible ? t('navigation.hideLeftSidebar') : t('navigation.showLeftSidebar')}</p>
            </TooltipContent>
          </Tooltip>

          {/* */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${wouldCauseLeftOnly(centerPanelVisible, 'center') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(centerPanelVisible, 'center')) {
                    toggleCenterPanel()
                  }
                }}
              >
                <SquarePen className={`h-4 w-4 ${!centerPanelVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{centerPanelVisible ? t('navigation.hideCenterPanel') : t('navigation.showCenterPanel')}</p>
            </TooltipContent>
          </Tooltip>

          {/* */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${wouldCauseLeftOnly(rightSidebarVisible, 'right') ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={() => {
                  if (!wouldCauseLeftOnly(rightSidebarVisible, 'right')) {
                    toggleRightSidebar()
                  }
                }}
              >
                <PanelRight className={`h-4 w-4 ${!rightSidebarVisible ? 'opacity-30' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{rightSidebarVisible ? t('navigation.hideRightSidebar') : t('navigation.showRightSidebar')}</p>
            </TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${isDashboard ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''}`}
                onClick={() => void openDashboard()}
                aria-label={t('navigation.dashboard')}
              >
                <LayoutDashboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('navigation.dashboard')}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${activityOpen ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''}`}
                onClick={onActivityClick}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('navigation.activity')}</p>
            </TooltipContent>
          </Tooltip>

          <SyncToggle />
          
          <PinToggle />
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 relative ${settingsOpen ? 'bg-primary/50 hover:bg-primary/60' : ''}`}
                onClick={() => settingsOpen ? closeSettings() : openSettings()}
              >
                {settingsOpen ? (
                  <Cog className="h-4 w-4" />
                ) : (
                  <Settings className="h-4 w-4" />
                )}
                {hasUpdate && !settingsOpen && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{settingsOpen ? t('common.back') : t('common.settings')}</p>
            </TooltipContent>
          </Tooltip>
          
          <AppStatus />
        </div>

        {/* Windows */}
        {!isMacOS && (
          <div className="flex items-center shrink-0 relative z-10">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMinimize}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-accent"
              onClick={handleMaximize}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
