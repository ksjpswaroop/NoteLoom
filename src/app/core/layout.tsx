'use client'

import { ThemeProvider } from "@/components/theme-provider"
import { CloseBehaviorGuard } from "@/components/close-behavior-guard"
import useSettingStore from "@/stores/setting"
import { useEffect, useRef, useState } from "react";
import { initAllDatabases } from "@/db"
import dayjs from "dayjs"
import en from "dayjs/locale/en";
import { useI18n } from "@/hooks/useI18n"
import useVectorStore from "@/stores/vector"
import useImageStore from "@/stores/imageHosting"
import useShortcutStore from "@/stores/shortcut"
import useEditorShortcutStore from "@/stores/editor-shortcut"
import useUpdateStore from "@/stores/update"
import initQuickRecordText from "@/lib/shortcut/quick-record-text"
import initQuickRecordVoice from "@/lib/shortcut/quick-record-voice"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import initShowWindow from "@/lib/shortcut/show-window"
import { initMcp } from "@/lib/mcp/init"
import { SearchDialog } from "@/components/search-dialog"
import { ActivityDrawer } from "@/components/activity/activity-drawer"
import { reportAppStart } from "@/lib/event-report"
import { TitleBar } from "@/components/title-bar"
import { Store } from '@tauri-apps/plugin-store'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { TextSizeProvider } from "@/contexts/text-size-context"
import { SyncConfirmDialog } from "@/components/sync-confirm-dialog"
import { AutoDataSyncConflictDialog } from "@/components/auto-data-sync-conflict-dialog"
import { applyThemeColors } from "@/lib/theme-utils"
import { applyAppFontFamily } from "@/lib/font-settings"
import emitter from "@/lib/emitter"
import { isEditableKeyboardTarget } from "@/lib/is-editable-keyboard-target"
import useArticleStore from "@/stores/article"
import { resolveOpenedMarkdownPath } from "@/lib/opened-files"
import { useToast } from "@/hooks/use-toast"
import { initAutoDataSyncRuntime } from "@/lib/sync/auto-data-sync-queue"
import { useSidebarStore } from "@/stores/sidebar"
import { useTranslations } from "next-intl"
import { SettingsDialog } from "./setting/components/settings-dialog"
import { settingSections, type SettingSection, useSettingsDialogStore } from "@/stores/settings-dialog"
import { MemoryAutoNotifications } from "@/components/memories/memory-auto-notifications"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { initSettingData, uiScale, customThemeColors, recordToolbarConfig, appFontFamily } = useSettingStore()
  const { initMainHosting } = useImageStore()
  const { currentLocale } = useI18n()
  const { initShortcut } = useShortcutStore()
  const { initEditorShortcuts } = useEditorShortcutStore()
  const { initVectorDb } = useVectorStore()
  const { initUpdateStore, checkForUpdates } = useUpdateStore()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastContentPathRef = useRef('/core/main')
  const { openSettings } = useSettingsDialogStore()
  const t = useTranslations()
  const { toast } = useToast()
  const [searchOpen, setSearchOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unlistenOpenFiles: (() => void) | undefined

    const openMarkdownFiles = async (paths: string[]) => {
      if (paths.length === 0) {
        return
      }

      const articleStore = useArticleStore.getState()
      let openedCount = 0

      for (const path of paths) {
        const resolvedPath = await resolveOpenedMarkdownPath(path)
        if (!resolvedPath) {
          continue
        }

        await articleStore.setActiveFilePath(resolvedPath)
        openedCount += 1
      }

      if (openedCount > 0 && pathname !== '/core/main') {
        router.replace('/core/main')
      }

      if (openedCount === 0) {
        toast({
          title: 'Unable to open file',
          description: 'Please select an existing Markdown file',
          variant: 'destructive',
        })
      }
    }

    const registerOpenFileListener = async () => {
      const window = getCurrentWindow()
      const unlisten = await window.listen<string[]>('open-files', (event) => {
        void openMarkdownFiles(event.payload)
      })

      if (cancelled) {
        unlisten()
        return
      }
      unlistenOpenFiles = unlisten

      const pendingPaths = await invoke<string[]>('drain_pending_open_files')
      await openMarkdownFiles(pendingPaths)
    }

    void registerOpenFileListener()

    return () => {
      cancelled = true
      unlistenOpenFiles?.()
    }
  }, [pathname, router, toast])

  useEffect(() => {
    const recordToolLabels: Record<string, string> = {
      text: t('record.mark.type.text'),
      recording: t('record.mark.type.recording'),
      scan: t('record.mark.type.screenshot'),
      image: t('record.mark.type.image'),
      link: t('record.mark.type.link'),
      file: t('record.mark.type.file'),
      todo: t('record.mark.type.todo'),
    }

    void invoke('update_tray_record_toolbar_config', {
      config: recordToolbarConfig.map((item) => ({
        ...item,
        label: recordToolLabels[item.id] || item.id,
      })),
      labels: {
        quickRecord: t('tray.quickRecord'),
        moreRecord: t('tray.moreRecord'),
        open: t('tray.open'),
        showMain: t('tray.showMain'),
        newNote: t('tray.newNote'),
        newFolder: t('tray.newFolder'),
        settings: t('tray.settings'),
        window: t('tray.window'),
        pinToggle: t('tray.pinToggle'),
        hideWindow: t('tray.hideWindow'),
        quit: t('tray.quit'),
      },
    }).catch((error) => {
      console.debug('Failed to sync tray record toolbar config:', error)
    })
  }, [recordToolbarConfig, t])

  useEffect(() => {
    let cancelled = false
    let unlistenTrayAction: (() => void) | undefined
    let unlistenOpenSettings: (() => void) | undefined

    const navigateToMain = async () => {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()

      if (pathname !== '/core/main') {
        router.replace('/core/main')
      }
    }

    const showSidebarTab = async (tab: 'files' | 'notes') => {
      await navigateToMain()

      const sidebar = useSidebarStore.getState()
      if (!sidebar.leftSidebarVisible) {
        await sidebar.toggleLeftSidebar()
      }
      await useSidebarStore.getState().setLeftSidebarTab(tab)
    }

    const togglePin = async () => {
      const store = await Store.load('store.json')
      const currentPin = await store.get<boolean>('pin')
      const nextPin = !currentPin

      await getCurrentWindow().setAlwaysOnTop(nextPin)
      await store.set('pin', nextPin)
      await store.save()
      emitter.emit('window-pin-changed', nextPin)
    }

    const ensureFileTreeLoaded = async () => {
      const articleStore = useArticleStore.getState()
      if (articleStore.fileTree.length === 0) {
        await articleStore.loadFileTree()
      }
    }

    const handleTrayAction = async (action: string) => {
      switch (action) {
        case 'new-note':
          await showSidebarTab('files')
          await ensureFileTreeLoaded()
          await useArticleStore.getState().newFile()
          break
        case 'new-folder':
          await showSidebarTab('files')
          await ensureFileTreeLoaded()
          await useArticleStore.getState().newFolder()
          break
        case 'record-audio':
          await showSidebarTab('notes')
          emitter.emit('toolbar-shortcut-recording')
          break
        case 'record-screenshot':
        case 'screenshot':
          await showSidebarTab('notes')
          emitter.emit('toolbar-shortcut-scan')
          break
        case 'record-text':
        case 'text':
          await showSidebarTab('notes')
          emitter.emit('toolbar-shortcut-text')
          break
        case 'record-link':
        case 'link':
          await showSidebarTab('notes')
          emitter.emit('toolbar-shortcut-link')
          break
        case 'record-image':
          await showSidebarTab('notes')
          emitter.emit('toolbar-shortcut-image')
          break
        case 'record-file':
          await showSidebarTab('notes')
          emitter.emit('toolbar-shortcut-file')
          break
        case 'record-todo':
          await showSidebarTab('notes')
          emitter.emit('toolbar-shortcut-todo')
          break
        case 'pin-window':
        case 'pin':
          await togglePin()
          break
        default:
          break
      }
    }

    const registerTrayListeners = async () => {
      const window = getCurrentWindow()
      const trayActionUnlisten = await window.listen<string>('tray-action', (event) => {
        void handleTrayAction(event.payload)
      })
      const openSettingsUnlisten = await window.listen<string>('open-settings', () => {
        openSettings()
      })

      if (cancelled) {
        trayActionUnlisten()
        openSettingsUnlisten()
        return
      }

      unlistenTrayAction = trayActionUnlisten
      unlistenOpenSettings = openSettingsUnlisten
    }

    void registerTrayListeners()

    return () => {
      cancelled = true
      unlistenTrayAction?.()
      unlistenOpenSettings?.()
    }
  }, [openSettings, pathname, router])

  useEffect(() => {
    if (pathname.startsWith('/core/setting')) {
      const pathSection = pathname.split('/')[3]
      const querySection = searchParams.get('anchor')
      const requestedSection = pathSection || querySection
      const normalizedSection = requestedSection === 'dev' ? 'general' : requestedSection
      const section = settingSections.includes(normalizedSection as SettingSection)
        ? normalizedSection as SettingSection
        : undefined

      openSettings(section)
      router.replace(lastContentPathRef.current)
      return
    }

    lastContentPathRef.current = pathname
  }, [openSettings, pathname, router, searchParams])

  // /core/main
  useEffect(() => {
    async function redirectOldPaths() {
      if (pathname === '/core/article' || pathname === '/core/record') {
        const store = await Store.load('store.json')
        await store.set('currentPage', '/core/main')
        await store.save()
        router.replace('/core/main')
      }
    }
    redirectOldPaths()
  }, [pathname, router])

  useEffect(() => {
    let cancelled = false

    void reportAppStart()

    const initializeApp = async () => {
      try {
        await initSettingData()
        initMainHosting()

        //
        await initAllDatabases()
        if (cancelled) return
        const { runMemoryMaintenance } = await import('@/lib/memory/auto-memory')
        void runMemoryMaintenance()
        const {
          reconcileMemoryEmbeddingModel,
          reindexPendingMemories,
        } = await import('@/db/memories')
        await reconcileMemoryEmbeddingModel()
        void reindexPendingMemories()
        await initAutoDataSyncRuntime()
        if (cancelled) return

        initShortcut()
        initEditorShortcuts()
        await initVectorDb()
        if (cancelled) return
        await useArticleStore.getState().initVectorIndexedFiles()
        if (cancelled) return

        initQuickRecordText()
        initQuickRecordVoice()
        initShowWindow()
        initMcp()

        await initUpdateStore()
        if (cancelled) return
        checkForUpdates()
      } catch (error) {
        console.error('Failed to initialize app core:', error)
      }
    }

    void initializeApp()

    return () => {
      cancelled = true
    }
  }, [])

  //
  useEffect(() => {
    if (uiScale && uiScale !== 100) {
      document.documentElement.style.fontSize = `${uiScale}%`
    }
  }, [uiScale])

  //
  useEffect(() => {
    applyAppFontFamily(appFontFamily)
  }, [appFontFamily])

  //
  useEffect(() => {
    applyThemeColors(customThemeColors)
  }, [customThemeColors])

  useEffect(() => {
    void currentLocale
    dayjs.locale(en)
  }, [currentLocale])

  // （Backspace）（Cmd/Ctrl+F）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ：Cmd+F (macOS) Ctrl+F (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        //
        const target = e.target as HTMLElement
        const editorElement = document.getElementById('aritcle-md-editor')
        const isFocusInEditor = editorElement && editorElement.contains(target)

        //
        if (isFocusInEditor) {
          e.preventDefault()
          //
          emitter.emit('editor-search-trigger' as any)
          return
        }

        //
        e.preventDefault()
        setSearchOpen(true)
        return
      }

      // Backspace ，
      if (e.key === 'Backspace') {
        const editableTarget = isEditableKeyboardTarget(e.target)
        if (editableTarget) {
          return
        }

        //
        e.preventDefault()
      }

    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TextSizeProvider>
        <TitleBar
          onSearchClick={() => setSearchOpen(true)}
          onActivityClick={() => setActivityOpen(open => !open)}
          activityOpen={activityOpen}
        />
        <main className="flex flex-1 flex-col overflow-hidden w-full h-[calc(100vh-36px)] mt-9">
          {children}
        </main>
        <ActivityDrawer open={activityOpen} onOpenChange={setActivityOpen} />
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        <SettingsDialog />
        <SyncConfirmDialog />
        <AutoDataSyncConflictDialog />
        <MemoryAutoNotifications />
        <CloseBehaviorGuard />
      </TextSizeProvider>
    </ThemeProvider>
  );
}
