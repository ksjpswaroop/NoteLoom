'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Download, ImageDown, LoaderCircle, PencilRuler } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import emitter from '@/lib/emitter'
import { exportExcalidrawScene } from '@/lib/excalidraw/export-scene'
import {
  createEmptyExcalidrawScene,
  type ExcalidrawSceneFile,
} from '@/lib/excalidraw/file-format'
import { readExcalidrawScene, writeExcalidrawScene } from '@/lib/excalidraw/workspace'
import { getFilePathOptions } from '@/lib/workspace'

import '@excalidraw/excalidraw/index.css'

// Loose handle — Excalidraw's published ImperativeAPI is large; we only call a few methods.
type ExcalidrawApiHandle = {
  updateScene: (sceneData: Record<string, unknown>) => void
  getSceneElements: () => readonly unknown[]
  getAppState: () => Record<string, unknown>
  getFiles: () => Record<string, unknown>
  scrollToContent?: (...args: unknown[]) => void
}

const Excalidraw = dynamic(
  async () => {
    const mod = await import('@excalidraw/excalidraw')
    return mod.Excalidraw
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Loading sketch editor…
      </div>
    ),
  },
)

interface ExcalidrawEditorProps {
  filePath: string
}

function sceneFromApi(api: ExcalidrawApiHandle): ExcalidrawSceneFile {
  const appState = api.getAppState()
  const {
    collaborators: _collaborators,
    ...persistableAppState
  } = appState
  return createEmptyExcalidrawScene({
    elements: api.getSceneElements(),
    appState: {
      viewBackgroundColor: persistableAppState.viewBackgroundColor ?? '#ffffff',
      gridSize: persistableAppState.gridSize ?? null,
      currentItemStrokeColor: persistableAppState.currentItemStrokeColor,
      currentItemBackgroundColor: persistableAppState.currentItemBackgroundColor,
    },
    files: api.getFiles(),
  })
}

export function ExcalidrawEditor({ filePath }: ExcalidrawEditorProps) {
  const { resolvedTheme } = useTheme()
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initialScene, setInitialScene] = useState<ExcalidrawSceneFile | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [exporting, setExporting] = useState(false)
  const apiRef = useRef<ExcalidrawApiHandle | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestSceneRef = useRef<ExcalidrawSceneFile | null>(null)
  const filePathRef = useRef(filePath)

  filePathRef.current = filePath

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setLoadError(null)
    setInitialScene(null)
    apiRef.current = null

    void (async () => {
      try {
        await getFilePathOptions(filePath)
        const scene = await readExcalidrawScene(filePath)
        if (cancelled) return
        latestSceneRef.current = scene
        setInitialScene(scene)
        setReady(true)
      } catch (error) {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Failed to open sketch')
      }
    })()

    return () => {
      cancelled = true
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [filePath])

  const persistScene = useCallback(async (scene: ExcalidrawSceneFile, path = filePathRef.current) => {
    setSaveState('saving')
    try {
      await writeExcalidrawScene(path, scene)
      setSaveState('saved')
      window.setTimeout(() => {
        setSaveState((current) => (current === 'saved' ? 'idle' : current))
      }, 1200)
    } catch (error) {
      console.error(error)
      setSaveState('error')
      toast.error('Failed to save sketch')
    }
  }, [])

  const scheduleSave = useCallback((scene: ExcalidrawSceneFile) => {
    latestSceneRef.current = scene
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      void persistScene(scene)
    }, 800)
  }, [persistScene])

  useEffect(() => {
    const handleReplace = (event: { filePath: string; scene: ExcalidrawSceneFile }) => {
      if (!event?.filePath || event.filePath !== filePathRef.current) return
      latestSceneRef.current = event.scene
      const api = apiRef.current
      if (api) {
        api.updateScene({
          elements: event.scene.elements,
          appState: event.scene.appState,
        })
        api.scrollToContent?.()
      } else {
        setInitialScene(event.scene)
      }
    }

    emitter.on('excalidraw-scene-replace', handleReplace as never)
    return () => {
      emitter.off('excalidraw-scene-replace', handleReplace as never)
    }
  }, [])

  const handleChange = useCallback((
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
  ) => {
    const scene = createEmptyExcalidrawScene({
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
        gridSize: appState.gridSize ?? null,
      },
      files,
    })
    scheduleSave(scene)
  }, [scheduleSave])

  const handleExport = useCallback(async (format: 'png' | 'svg') => {
    const api = apiRef.current
    const scene = api ? sceneFromApi(api) : latestSceneRef.current
    if (!scene) {
      toast.error('Sketch is not ready to export')
      return
    }

    setExporting(true)
    try {
      const saved = await exportExcalidrawScene(scene, format, filePath)
      if (saved) {
        toast.success(format === 'png' ? 'Exported PNG' : 'Exported SVG')
      }
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [filePath])

  if (loadError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
        <PencilRuler className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Could not open sketch</p>
        <p className="max-w-md text-xs text-muted-foreground">{loadError}</p>
      </div>
    )
  }

  if (!ready || !initialScene) {
    return (
      <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Opening sketch…
      </div>
    )
  }

  const fileName = filePath.split(/[\\/]/).pop() || filePath

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <PencilRuler className="h-4 w-4 shrink-0 text-[#3b82f6]" />
          <span className="truncate text-sm font-medium">{fileName}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved'}
            {saveState === 'error' && 'Save failed'}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={exporting}
            >
              {exporting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void handleExport('png')}>
              <ImageDown className="mr-2 h-4 w-4" />
              Export PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleExport('svg')}>
              <Download className="mr-2 h-4 w-4" />
              Export SVG
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Excalidraw
          langCode="en"
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          initialData={{
            elements: initialScene.elements as never,
            appState: {
              ...initialScene.appState,
              collaborators: new Map(),
            } as never,
            files: initialScene.files as never,
            scrollToContent: true,
          }}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              export: false,
              saveAsImage: false,
            },
          }}
          excalidrawAPI={(api) => {
            apiRef.current = api as unknown as ExcalidrawApiHandle
          }}
          onChange={handleChange as never}
        />
      </div>
    </div>
  )
}
