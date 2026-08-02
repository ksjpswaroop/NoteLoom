'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Shield,
} from 'lucide-react'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SettingSection } from '../components/setting-base'
import {
  ensureService,
  formatLocalServiceState,
  getLocalServiceFixTip,
  getServiceStatus,
  type LocalServiceStatus,
} from '@/lib/local-services'
import {
  formatMidsceneState,
  inspectMidscene,
  listenMidsceneProgress,
  loadMidsceneSettings,
  midsceneDocumentFlow,
  midsceneRunTest,
  promptMidscenePermissions,
  saveMidsceneSettings,
  type MidsceneSettings,
  type MidsceneStatus,
} from '@/lib/midscene'
import { importMidsceneNoteToWorkspace } from '@/lib/midscene/workspace-import'
import { isMobileDevice } from '@/lib/check'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const ACCENT = '#3b82f6'

export function AutomationsSettings() {
  const t = useTranslations('settings.automations')
  const isMobile = isMobileDevice()
  const [settings, setSettings] = useState<MidsceneSettings | null>(null)
  const [status, setStatus] = useState<MidsceneStatus | null>(null)
  const [serviceStatus, setServiceStatus] = useState<LocalServiceStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [docStepsText, setDocStepsText] = useState(
    'Open NoteLoom\nOpen Settings\nOpen the Automations section',
  )
  const [testStepsText, setTestStepsText] = useState(
    'assert: NoteLoom window is visible\nact: Open Settings if it is not already open\nassert: a settings panel or dialog is visible',
  )
  const installingRef = useRef(false)

  const refreshStatus = useCallback(async (model = settings?.model) => {
    try {
      const [next, managed] = await Promise.all([
        inspectMidscene(model),
        getServiceStatus('midscene'),
      ])
      setStatus(next)
      setServiceStatus(managed)
    } catch (error) {
      setStatus({
        supportedPlatform: false,
        platform: 'unknown',
        nodeAvailable: false,
        npmAvailable: false,
        packageReady: false,
        runtimeDir: '',
        accessibilityOk: false,
        screenRecordingOk: false,
        modelConfigured: false,
        busy: false,
        state: 'error',
        message: error instanceof Error ? error.message : t('statusError'),
        displays: [],
      })
      setServiceStatus(null)
    }
  }, [settings?.model, t])

  useEffect(() => {
    void (async () => {
      const loaded = await loadMidsceneSettings()
      setSettings(loaded)
      await refreshStatus(loaded.model)
    })()
  }, [refreshStatus])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listenMidsceneProgress((event) => {
      if (event.message) setProgress(event.message)
    }).then((fn) => {
      unlisten = fn
    })
    return () => unlisten?.()
  }, [])

  async function persist(next: MidsceneSettings) {
    const saved = await saveMidsceneSettings(next)
    setSettings(saved)
    return saved
  }

  async function handleEnableChange(enabled: boolean) {
    if (!settings) return
    if (enabled && !settings.optInAccepted) {
      toast({
        title: t('optInRequiredTitle'),
        description: t('optInRequiredDesc'),
      })
      return
    }
    const saved = await persist({ ...settings, enabled })
    if (!enabled) {
      toast({ title: t('disabledToast') })
    } else {
      toast({ title: t('enabledToast') })
      await refreshStatus(saved.model)
    }
  }

  async function handleAcceptOptIn() {
    if (!settings) return
    const saved = await persist({
      ...settings,
      optInAccepted: true,
      enabled: true,
    })
    toast({ title: t('optInAcceptedToast') })
    await refreshStatus(saved.model)
  }

  async function handleInstall() {
    if (!settings || installingRef.current) return
    installingRef.current = true
    setInstalling(true)
    setProgress(t('progress.preparing'))
    try {
      // Same ensure path as other managed local services (app-data sidecar).
      const managed = await ensureService('midscene')
      setServiceStatus(managed)
      if (managed.packageReady || managed.state === 'ready' || managed.state === 'running') {
        toast({ title: t('installSuccess') })
      } else {
        const tip = getLocalServiceFixTip(managed.message) || getLocalServiceFixTip(managed.detail)
        toast({
          title: t('installFailed'),
          description: tip || managed.message,
          variant: 'destructive',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast({
        title: t('installFailed'),
        description: getLocalServiceFixTip(message) || message,
        variant: 'destructive',
      })
    } finally {
      installingRef.current = false
      setInstalling(false)
      setProgress(null)
      await refreshStatus()
    }
  }

  async function handleSaveModel() {
    if (!settings) return
    const saved = await persist(settings)
    toast({ title: t('modelSaved') })
    await refreshStatus(saved.model)
  }

  function parseLineSteps(text: string, mode: 'document' | 'test') {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        if (mode === 'test') {
          const match = /^(act|assert|query|wait)\s*:\s*(.+)$/i.exec(line)
          if (match) {
            return {
              type: match[1].toLowerCase() as 'act' | 'assert' | 'query' | 'wait',
              prompt: match[2],
              description: match[2],
            }
          }
        }
        return { prompt: line, description: line, type: 'act' as const }
      })
  }

  async function handleRunDoc() {
    if (!settings?.enabled || !settings.optInAccepted) {
      toast({ title: t('optInRequiredTitle'), description: t('optInRequiredDesc') })
      return
    }
    setBusy(true)
    setProgress(t('progress.runningDoc'))
    try {
      const result = await midsceneDocumentFlow({
        title: 'NoteLoom automation guide',
        steps: parseLineSteps(docStepsText, 'document'),
        noteFileName: 'automation-guide',
      })
      if (result.ok) {
        let description = String(result.data.notePath || '')
        try {
          const notePath = String(result.data.notePath || '')
          const noteFileName = String(result.data.noteFileName || 'automation-guide.md')
          if (notePath) {
            const imported = await importMidsceneNoteToWorkspace({
              notePath,
              noteFileName,
              steps: Array.isArray(result.data.steps)
                ? result.data.steps as Array<{ screenshotPath?: string; screenshotRelativePath?: string }>
                : [],
            })
            description = imported.workspaceNotePath
          }
        } catch {
          // Keep app-data path if workspace import fails.
        }
        toast({
          title: t('docSuccess'),
          description,
        })
      } else {
        toast({
          title: t('docFailed'),
          description: String(result.data.error || result.stderr || ''),
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: t('docFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
      setProgress(null)
      await refreshStatus()
    }
  }

  async function handleRunTest() {
    if (!settings?.enabled || !settings.optInAccepted) {
      toast({ title: t('optInRequiredTitle'), description: t('optInRequiredDesc') })
      return
    }
    setBusy(true)
    setProgress(t('progress.runningTest'))
    try {
      const result = await midsceneRunTest({
        title: 'NoteLoom smoke test',
        steps: parseLineSteps(testStepsText, 'test'),
      })
      const report = result.data.report as { status?: string; reportMarkdownPath?: string } | undefined
      toast({
        title: report?.status === 'passed' ? t('testPassed') : t('testFailed'),
        description: report?.reportMarkdownPath || String(result.data.error || ''),
        variant: report?.status === 'passed' ? 'default' : 'destructive',
      })
    } catch (error) {
      toast({
        title: t('testFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
      setProgress(null)
      await refreshStatus()
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" style={{ color: ACCENT }} />
        {t('loading')}
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
        {t('desktopOnly')}
      </div>
    )
  }

  const managedState = serviceStatus?.state || 'stopped'
  const stateLabel = !settings.enabled
    ? t('optionalOff')
    : serviceStatus
      ? formatLocalServiceState(managedState)
      : formatMidsceneState(status?.state || 'stopped')
  const fixTip = getLocalServiceFixTip(status?.message)
    || getLocalServiceFixTip(serviceStatus?.message)
    || getLocalServiceFixTip(serviceStatus?.detail)

  return (
    <div className="flex flex-col gap-6">
      <div
        className="rounded-lg border px-4 py-3 text-sm"
        style={{ borderColor: `${ACCENT}55`, background: `${ACCENT}0f` }}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: ACCENT }} />
          <div className="space-y-1">
            <p className="font-medium text-foreground">{t('privacyTitle')}</p>
            <p className="text-muted-foreground">{t('privacyDesc')}</p>
            <p className="text-xs text-muted-foreground">{t('managedHint')}</p>
          </div>
        </div>
      </div>

      <SettingSection title={t('enableTitle')} desc={t('enableDesc')}>
        <ItemGroup className="gap-3">
          <Item variant="outline">
            <ItemMedia variant="icon">
              <Shield className="size-4" style={{ color: ACCENT }} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('optInTitle')}</ItemTitle>
              <ItemDescription>{t('optInDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              {settings.optInAccepted ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CheckCircle2 className="size-3.5" style={{ color: ACCENT }} />
                  {t('optInAccepted')}
                </span>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void handleAcceptOptIn()}
                  style={{ backgroundColor: ACCENT }}
                  className="text-white hover:opacity-90"
                >
                  {t('acceptOptIn')}
                </Button>
              )}
            </ItemActions>
          </Item>

          <Item variant="outline">
            <ItemMedia variant="icon">
              <MonitorSmartphone className="size-4" style={{ color: ACCENT }} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('toggleTitle')}</ItemTitle>
              <ItemDescription>{t('toggleDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => void handleEnableChange(checked)}
                disabled={!settings.optInAccepted}
              />
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingSection>

      <SettingSection
        title={t('runtimeTitle')}
        desc={t('runtimeDesc')}
        actions={(
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refreshStatus()}
            disabled={installing || busy}
          >
            <RefreshCw className="size-3.5" />
            {t('refresh')}
          </Button>
        )}
      >
        <ItemGroup className="gap-3">
          <Item variant="outline">
            <ItemContent>
              <ItemTitle className="flex flex-wrap items-center gap-2">
                <span>{t('statusLabel')}</span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                    managedState === 'ready' || managedState === 'running'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                      : managedState === 'starting'
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                        : managedState === 'error'
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-muted text-muted-foreground',
                  )}
                >
                  {(installing || busy || managedState === 'starting') ? (
                    <Loader2 className="mr-1 size-3 animate-spin" style={{ color: ACCENT }} />
                  ) : null}
                  {stateLabel}
                </span>
              </ItemTitle>
              <ItemDescription>
                {progress || status?.message || serviceStatus?.message || t('statusUnknown')}
              </ItemDescription>
              {fixTip ? (
                <p className="mt-1 text-xs" style={{ color: ACCENT }}>
                  {t('fixTip', { tip: fixTip })}
                </p>
              ) : null}
              {status?.runtimeDir ? (
                <p className="mt-1 text-xs text-muted-foreground break-all">
                  {t('runtimeDir')}: {status.runtimeDir}
                </p>
              ) : null}
            </ItemContent>
            <ItemActions className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="sm"
                onClick={() => void handleInstall()}
                disabled={installing}
                style={{ backgroundColor: ACCENT }}
                className="text-white hover:opacity-90"
              >
                {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                {status?.packageReady ? t('reinstall') : t('install')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void promptMidscenePermissions()}
              >
                {t('openPermissions')}
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingSection>

      <SettingSection title={t('modelTitle')} desc={t('modelDesc')}>
        <div className="grid gap-3 rounded-lg border p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="midscene-model-name">{t('modelName')}</Label>
            <Input
              id="midscene-model-name"
              value={settings.model.modelName}
              onChange={(event) => setSettings({
                ...settings,
                model: { ...settings.model, modelName: event.target.value },
              })}
              placeholder="gemini-3-flash"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="midscene-model-family">{t('modelFamily')}</Label>
            <Input
              id="midscene-model-family"
              value={settings.model.family}
              onChange={(event) => setSettings({
                ...settings,
                model: { ...settings.model, family: event.target.value },
              })}
              placeholder="gemini"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="midscene-model-base">{t('modelBaseUrl')}</Label>
            <Input
              id="midscene-model-base"
              value={settings.model.baseUrl}
              onChange={(event) => setSettings({
                ...settings,
                model: { ...settings.model, baseUrl: event.target.value },
              })}
              placeholder="https://generativelanguage.googleapis.com/v1beta/openai/"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="midscene-model-key">{t('modelApiKey')}</Label>
            <div className="flex gap-2">
              <Input
                id="midscene-model-key"
                type={showApiKey ? 'text' : 'password'}
                value={settings.model.apiKey}
                onChange={(event) => setSettings({
                  ...settings,
                  model: { ...settings.model, apiKey: event.target.value },
                })}
                placeholder="MIDSCENE_MODEL_API_KEY"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => setShowApiKey((value) => !value)}
                aria-label={showApiKey ? t('hideKey') : t('showKey')}
              >
                {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>
          <div>
            <Button
              size="sm"
              onClick={() => void handleSaveModel()}
              style={{ backgroundColor: ACCENT }}
              className="text-white hover:opacity-90"
            >
              {t('saveModel')}
            </Button>
          </div>
        </div>
      </SettingSection>

      <SettingSection title={t('quickDocTitle')} desc={t('quickDocDesc')}>
        <div className="grid gap-3">
          <Textarea
            value={docStepsText}
            onChange={(event) => setDocStepsText(event.target.value)}
            rows={5}
            placeholder={t('quickDocPlaceholder')}
          />
          <Button
            size="sm"
            disabled={busy || !settings.enabled}
            onClick={() => void handleRunDoc()}
            style={{ backgroundColor: ACCENT }}
            className="w-fit text-white hover:opacity-90"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('runDoc')}
          </Button>
        </div>
      </SettingSection>

      <SettingSection title={t('quickTestTitle')} desc={t('quickTestDesc')}>
        <div className="grid gap-3">
          <Textarea
            value={testStepsText}
            onChange={(event) => setTestStepsText(event.target.value)}
            rows={5}
            placeholder={t('quickTestPlaceholder')}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !settings.enabled}
            onClick={() => void handleRunTest()}
            className="w-fit"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('runTest')}
          </Button>
        </div>
      </SettingSection>
    </div>
  )
}
