'use client'

import { useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  ArchiveIcon,
  BrushCleaningIcon,
  BugIcon,
  CircleAlertIcon,
  ClipboardIcon,
  DatabaseIcon,
  FolderOpenIcon,
  InfoIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from 'lucide-react'
import { Store } from '@tauri-apps/plugin-store'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { appConfigDir, appDataDir, join } from '@tauri-apps/api/path'
import { exists, remove } from '@tauri-apps/plugin-fs'
import { platform, version as osVersion } from '@tauri-apps/plugin-os'
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import { save } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { isMobileDevice } from '@/lib/check'

type RecoveryAction =
  | 'exit'
  | 'clear-cache'
  | 'open-data'
  | 'delete-canvas'
  | 'clear-canvases'
  | 'reset-settings'
  | 'export-backup'
  | 'reset-database'
  | 'report-issue'

interface StoredTab {
  id: string
  path: string
  canvasId?: string
}

interface CanvasRecoveryContext {
  id: string
  title?: string
}

interface DiagnosticContext {
  appVersion?: string
  platform?: string
  osVersion?: string
  page?: string
}

const CANVAS_TAB_PREFIX = 'canvas://project/'
const TEMPORARY_DIRECTORIES = ['canvas-thumbnails', 'temp_screenshot'] as const
const LAYOUT_STORAGE_KEYS = [
  'leftSidebarVisible',
  'centerPanelVisible',
  'rightSidebarVisible',
  'leftSidebarTab',
  'canvas-manager-view-mode',
  'canvas-manager-sort-mode',
] as const
const LAYOUT_STORAGE_PREFIX = 'react-resizable-panels:main-layout:'
const DATABASE_RESET_PHRASE = 'Delete database'
const GITHUB_BUG_REPORT_URL = 'https://github.com/ksjpswaroop/NoteLoom/issues/new'

function getCanvasIdFromTab(tab?: StoredTab) {
  if (!tab) return null
  if (tab.canvasId) return tab.canvasId
  return tab.path.startsWith(CANVAS_TAB_PREFIX)
    ? tab.path.slice(CANVAS_TAB_PREFIX.length) || null
    : null
}

function getSafeRoute() {
  return isMobileDevice() ? '/mobile/chat' : '/core/main'
}

async function clearStartupState() {
  const store = await Store.load('store.json')
  await store.set('openTabs', [])
  await store.set('activeTabId', '')
  await store.set('activeFilePath', '')
  await store.set('currentPage', getSafeRoute())
  await store.save()
}

function openSafeRoute() {
  window.location.replace('/')
}

export function ErrorRecovery({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [activeAction, setActiveAction] = useState<RecoveryAction | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [canvasContext, setCanvasContext] = useState<CanvasRecoveryContext | null>(null)
  const [diagnosticContext, setDiagnosticContext] = useState<DiagnosticContext>({})
  const [databaseResetOpen, setDatabaseResetOpen] = useState(false)
  const [databaseResetAcknowledged, setDatabaseResetAcknowledged] = useState(false)
  const [databaseResetPhrase, setDatabaseResetPhrase] = useState('')

  useEffect(() => {
    console.error('App error:', error)
  }, [error])

  useEffect(() => {
    let cancelled = false

    async function resolveRecoveryContext() {
      const nextDiagnosticContext: DiagnosticContext = {
        page: `${window.location.pathname}${window.location.search}`,
      }
      try {
        nextDiagnosticContext.appVersion = await getVersion()
        nextDiagnosticContext.platform = platform()
        nextDiagnosticContext.osVersion = osVersion()
      } catch (diagnosticError) {
        console.error('Failed to read diagnostic environment:', diagnosticError)
      }
      if (!cancelled) setDiagnosticContext(nextDiagnosticContext)

      try {
        const routeCanvasId = window.location.pathname.includes('/canvas/editor')
          ? new URLSearchParams(window.location.search).get('id')
          : null
        const store = await Store.load('store.json')
        const tabs = await store.get<StoredTab[]>('openTabs') || []
        const activeTabId = await store.get<string>('activeTabId')
        const activeTab = tabs.find(tab => tab.id === activeTabId)
        const canvasId = routeCanvasId || getCanvasIdFromTab(activeTab)
        if (!canvasId || cancelled) return

        let title: string | undefined
        try {
          const { getCanvasProject } = await import('@/db/canvases')
          title = (await getCanvasProject(canvasId))?.title
        } catch (contextError) {
          console.error('Failed to read abnormal canvas info:', contextError)
        }
        if (!cancelled) setCanvasContext({ id: canvasId, title })
      } catch (contextError) {
        console.error('Failed to identify abnormal canvas:', contextError)
      }
    }

    void resolveRecoveryContext()
    return () => {
      cancelled = true
    }
  }, [])

  async function runRecovery(action: RecoveryAction, task: () => Promise<void>) {
    setActiveAction(action)
    setActionError('')
    setActionMessage('')
    try {
      await task()
    } catch (recoveryError) {
      console.error('Restore failed:', recoveryError)
      setActionError(recoveryError instanceof globalThis.Error ? recoveryError.message : 'Restore failed; please retry')
      setActiveAction(null)
    }
  }

  function exitErrorPage() {
    void runRecovery('exit', async () => {
      await clearStartupState()
      openSafeRoute()
    })
  }

  function clearTemporaryData() {
    void runRecovery('clear-cache', async () => {
      const dataDirectory = await appDataDir()
      for (const directory of TEMPORARY_DIRECTORIES) {
        const path = await join(dataDirectory, directory)
        if (await exists(path)) {
          await remove(path, { recursive: true })
        }
      }
      for (const key of LAYOUT_STORAGE_KEYS) {
        window.localStorage.removeItem(key)
      }
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index)
        if (key?.startsWith(LAYOUT_STORAGE_PREFIX)) {
          window.localStorage.removeItem(key)
        }
      }
      setActionMessage('Temporary cache and UI layout cleared; you can reload or return to the app.')
      setActiveAction(null)
    })
  }

  function openDataDirectory() {
    void runRecovery('open-data', async () => {
      const configDirectory = await appConfigDir()
      const databasePath = await join(configDirectory, 'note.db')
      if (await exists(databasePath)) {
        await revealItemInDir(databasePath)
      } else {
        await openPath(configDirectory)
      }
      setActionMessage('Opened the data directory in the file manager. Quit NoteLoom and back up before modifying files.')
      setActiveAction(null)
    })
  }

  function deleteCurrentCanvas() {
    if (!canvasContext) return
    void runRecovery('delete-canvas', async () => {
      const { getCanvasProject, softDeleteCanvasProject } = await import('@/db/canvases')
      const project = await getCanvasProject(canvasContext.id)
      await softDeleteCanvasProject(canvasContext.id)
      if (project?.thumbnailPath) {
        const { removeCanvasThumbnail } = await import('@/lib/canvas/thumbnail')
        await removeCanvasThumbnail(project.thumbnailPath)
      }
      await clearStartupState()
      openSafeRoute()
    })
  }

  function clearAllCanvases() {
    void runRecovery('clear-canvases', async () => {
      const { clearCanvasProjects } = await import('@/db/canvases')
      await clearCanvasProjects()
      const thumbnailDirectory = await join(await appDataDir(), 'canvas-thumbnails')
      if (await exists(thumbnailDirectory)) {
        await remove(thumbnailDirectory, { recursive: true })
      }
      await clearStartupState()
      openSafeRoute()
    })
  }

  function resetSettings() {
    void runRecovery('reset-settings', async () => {
      const store = await Store.load('store.json')
      await store.clear()
      await store.set('currentPage', getSafeRoute())
      await store.save()
      openSafeRoute()
    })
  }

  function resetLocalDatabase() {
    if (!databaseResetAcknowledged || databaseResetPhrase !== DATABASE_RESET_PHRASE) return
    void runRecovery('reset-database', async () => {
      try {
        await clearStartupState()
      } catch (startupStateError) {
        console.warn('Failed to clear startup state; will continue resetting the database:', startupStateError)
      }

      try {
        const { db } = await import('@/db')
        await db.close()
      } catch (databaseCloseError) {
        console.warn('Database connection was not open or failed to close; will keep trying to delete:', databaseCloseError)
      }

      await invoke('delete_local_database')
      await relaunch()
    })
  }

  function exportFullBackup() {
    void runRecovery('export-backup', async () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const outputPath = await save({
        title: 'Export a full NoteLoom data backup',
        defaultPath: `noteloom-full-backup-${timestamp}.zip`,
        filters: [{
          name: 'ZIP Files',
          extensions: ['zip'],
        }],
      })

      if (!outputPath) {
        setActiveAction(null)
        return
      }

      const savedPath = await invoke<string>('export_app_data', { outputPath })
      setActionMessage(`Full data backup exported to: ${savedPath}`)
      setActiveAction(null)
    })
  }

  function handleDatabaseResetOpenChange(open: boolean) {
    setDatabaseResetOpen(open)
    if (!open) {
      setDatabaseResetAcknowledged(false)
      setDatabaseResetPhrase('')
    }
  }

  function getErrorDetails() {
    return [
      `Error: ${error.message || 'Unknown error'}`,
      error.digest ? `Error ID: ${error.digest}` : '',
      diagnosticContext.appVersion ? `NoteLoom: ${diagnosticContext.appVersion}` : '',
      diagnosticContext.platform ? `System: ${diagnosticContext.platform} ${diagnosticContext.osVersion || ''}`.trim() : '',
      `Page: ${diagnosticContext.page || window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      error.stack ? `\n${error.stack}` : '',
    ].filter(Boolean).join('\n')
  }

  async function copyErrorDetails() {
    try {
      await navigator.clipboard.writeText(getErrorDetails())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (clipboardError) {
      console.error('Failed to copy error details:', clipboardError)
      setActionError('Unable to copy error details; check clipboard permission')
    }
  }

  const busy = activeAction !== null
  const mobile = isMobileDevice()

  function reportGitHubIssue() {
    void runRecovery('report-issue', async () => {
      let diagnosticsCopied = false
      try {
        await navigator.clipboard.writeText(getErrorDetails())
        diagnosticsCopied = true
      } catch (clipboardError) {
        console.error('Failed to copy GitHub feedback details:', clipboardError)
      }

      const issueUrl = new URL(GITHUB_BUG_REPORT_URL)
      issueUrl.searchParams.set('template', 'bug_report.yml')
      issueUrl.searchParams.set('title', '[bug] App entered error recovery mode')
      await openUrl(issueUrl)
      setActionMessage(
        diagnosticsCopied
          ? 'Opened the GitHub bug report page and copied the error details. Paste them into the report and add repro steps.'
          : 'Opened the GitHub bug report page; please add error details and repro steps.'
      )
      setActiveAction(null)
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <CircleAlertIcon />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Badge variant="secondary" className="self-start">Recovery mode</Badge>
              <CardTitle>This page failed to open</CardTitle>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Error details</AlertTitle>
            <AlertDescription className="max-h-24 overflow-auto break-words font-mono text-xs">
              {error.message || 'Unknown error'}
            </AlertDescription>
          </Alert>

          {actionError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Failed</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          {actionMessage ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Done</AlertTitle>
              <AlertDescription>{actionMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Try recovery steps in order</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion
                type="single"
                collapsible
                defaultValue="level-1"
                className="rounded-lg border px-3"
              >
                <AccordionItem value="level-1">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">1</Badge>
                      Re-enter the app
                      <Badge variant="outline">Safest</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    <Alert>
                      <InfoIcon />
                      <AlertTitle>What this level clears</AlertTitle>
                      <AlertDescription>
                        &quot;Reload&quot; does not clear content; &quot;Leave broken page&quot; only clears the last opened page, active tab, and file location state.
                      </AlertDescription>
                    </Alert>
                    <Alert>
                      <InfoIcon />
                      <AlertTitle>What this level does not clear</AlertTitle>
                      <AlertDescription>
                        Does not delete notes, records, canvases, chats, the database, attachments, or app settings.
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={reset} disabled={busy}>
                        <RefreshCwIcon data-icon="inline-start" />
                        Reload current page
                      </Button>
                      <Button onClick={exitErrorPage} disabled={busy}>
                        {activeAction === 'exit'
                          ? <Spinner data-icon="inline-start" />
                          : <ArrowLeftIcon data-icon="inline-start" />}
                        Leave broken page
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="level-2">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">2</Badge>
                      Clear cache and layout
                      <Badge variant="outline">Low risk</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    <Alert>
                      <BrushCleaningIcon />
                      <AlertTitle>What this level clears</AlertTitle>
                      <AlertDescription>
                        Clears canvas thumbnails, temp screenshots, and layout caches such as sidebars, panel widths, and canvas list view. These can be regenerated.
                      </AlertDescription>
                    </Alert>
                    <Alert>
                      <InfoIcon />
                      <AlertTitle>What this level does not clear</AlertTitle>
                      <AlertDescription>
                        Does not delete note bodies, records, canvas projects, chats, model config, sync config, or the database.
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={clearTemporaryData} disabled={busy}>
                        {activeAction === 'clear-cache'
                          ? <Spinner data-icon="inline-start" />
                          : <BrushCleaningIcon data-icon="inline-start" />}
                        Clear cache and layout
                      </Button>
                      {!mobile ? (
                        <Button variant="ghost" onClick={openDataDirectory} disabled={busy}>
                          {activeAction === 'open-data'
                            ? <Spinner data-icon="inline-start" />
                            : <FolderOpenIcon data-icon="inline-start" />}
                          Open data directory
                        </Button>
                      ) : null}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="level-3">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">3</Badge>
                      Reset selected data
                      <Badge variant="outline">Needs confirmation</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    {canvasContext ? (
                      <Alert>
                        <Trash2Icon />
                        <AlertTitle>Broken canvas</AlertTitle>
                        <AlertDescription>
                          Only moves the current canvas to the canvas trash and deletes its thumbnail; other canvases, notes, records, and settings are unaffected.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <Alert>
                      <DatabaseIcon />
                      <AlertTitle>Local</AlertTitle>
                      <AlertDescription>
                        Permanently clears all local canvas projects and thumbnails; does not delete Markdown notes, records, chats, settings, or other database content.
                      </AlertDescription>
                    </Alert>
                    <Alert>
                      <RotateCcwIcon />
                      <AlertTitle>App settings</AlertTitle>
                      <AlertDescription>
                        Clears UI, model, sync, workspace, and startup settings; does not delete note files, record files, or the canvas database.
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      {canvasContext ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" disabled={busy}>
                              {activeAction === 'delete-canvas'
                                ? <Spinner data-icon="inline-start" />
                                : <Trash2Icon data-icon="inline-start" />}
                              Delete the broken canvas
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this canvas?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {canvasContext.title
                                  ? `“${canvasContext.title}” will be moved to the canvas trash; other canvases and notes are unaffected.`
                                  : 'The current canvas will be moved to the canvas trash; other canvases and notes are unaffected.'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={deleteCurrentCanvas}>
                                Move to trash
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" disabled={busy}>
                            {activeAction === 'clear-canvases'
                              ? <Spinner data-icon="inline-start" />
                              : <DatabaseIcon data-icon="inline-start" />}
                            Clear all local canvases
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear all local canvases?</AlertDialogTitle>
                            <AlertDialogDescription>
                              All local canvases and thumbnails will be permanently deleted. Notes and records are unaffected. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={clearAllCanvases}>
                              Confirm clear
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" disabled={busy}>
                            {activeAction === 'reset-settings'
                              ? <Spinner data-icon="inline-start" />
                              : <RotateCcwIcon data-icon="inline-start" />}
                            Reset app settings
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Reset app settings?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Clears UI, model, sync, and workspace settings, but does not delete local notes, records, or the canvas database.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={resetSettings}>
                              Confirm reset
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {!mobile ? (
                  <AccordionItem value="level-4">
                    <AccordionTrigger>
                      <span className="flex items-center gap-2">
                        <Badge variant="destructive">4</Badge>
                        Delete local database
                        <Badge variant="destructive">Irreversible</Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="flex flex-col gap-3">
                      <Alert variant="destructive">
                        <CircleAlertIcon />
                        <AlertTitle>What this level permanently clears</AlertTitle>
                        <AlertDescription>
                          Deletes local database content such as canvases, chats, record indexes, tags, vectors, memories, and activity, then restarts NoteLoom.
                        </AlertDescription>
                      </Alert>
                      <Alert>
                        <InfoIcon />
                        <AlertTitle>What this level does not clear</AlertTitle>
                        <AlertDescription>
                          Does not delete Markdown files, attachment folders, or recording folders.
                        </AlertDescription>
                      </Alert>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={exportFullBackup} disabled={busy}>
                          {activeAction === 'export-backup'
                            ? <Spinner data-icon="inline-start" />
                            : <ArchiveIcon data-icon="inline-start" />}
                          Export full data backup
                        </Button>
                        <AlertDialog open={databaseResetOpen} onOpenChange={handleDatabaseResetOpenChange}>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" disabled={busy}>
                              {activeAction === 'reset-database'
                                ? <Spinner data-icon="inline-start" />
                                : <DatabaseIcon data-icon="inline-start" />}
                              Continue to database delete confirmation
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Permanently delete the local database?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This is the final recovery step. NoteLoom will close the database, delete database files, and restart. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>

                            <Alert variant="destructive">
                              <CircleAlertIcon />
                              <AlertTitle>Will permanently delete</AlertTitle>
                              <AlertDescription>
                                Database content such as canvases, chats, record indexes, tags, vectors, memories, and activity. Markdown files, attachments, and recording folders are not deleted.
                              </AlertDescription>
                            </Alert>

                            <Field orientation="horizontal">
                              <Checkbox
                                id="database-reset-acknowledgement"
                                checked={databaseResetAcknowledged}
                                onCheckedChange={checked => setDatabaseResetAcknowledged(checked === true)}
                              />
                              <FieldLabel htmlFor="database-reset-acknowledgement">
                                I confirm important data does not need to be kept or is already backed up
                              </FieldLabel>
                            </Field>

                            <Field>
                              <FieldLabel htmlFor="database-reset-phrase">
                                Type &quot;{DATABASE_RESET_PHRASE}&quot; to confirm
                              </FieldLabel>
                              <Input
                                id="database-reset-phrase"
                                value={databaseResetPhrase}
                                onChange={event => setDatabaseResetPhrase(event.target.value)}
                                autoComplete="off"
                                placeholder={DATABASE_RESET_PHRASE}
                              />
                              <FieldDescription>
                                You must check the box above and type the exact phrase.
                              </FieldDescription>
                            </Field>

                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                disabled={!databaseResetAcknowledged || databaseResetPhrase !== DATABASE_RESET_PHRASE}
                                onClick={resetLocalDatabase}
                              >
                                Permanently delete and restart
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ) : null}
              </Accordion>
            </CardContent>
          </Card>
        </CardContent>

        <CardFooter className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void copyErrorDetails()}>
              <ClipboardIcon data-icon="inline-start" />
              {copied ? 'Copied' : 'Copy error details'}
            </Button>
            <Button variant="ghost" size="sm" onClick={reportGitHubIssue} disabled={busy}>
              {activeAction === 'report-issue'
                ? <Spinner data-icon="inline-start" />
                : <BugIcon data-icon="inline-start" />}
              Report GitHub Issue
            </Button>
          </div>
        </CardFooter>
      </Card>
    </main>
  )
}
