'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Eye,
  EyeOff,
  Globe2,
  GripVertical,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Server,
  Sparkles,
  Square,
} from 'lucide-react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SettingType } from '../components/setting-base'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  CardDescription,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Switch } from '@/components/ui/switch'
import { OpenBroswer } from '@/components/open-broswer'
import { toast } from '@/hooks/use-toast'
import {
  ensureService,
  formatLocalServiceState,
  getLocalServiceFixTip,
  getServiceStatus,
  listenLocalServiceProgress,
  stopService,
  type LocalServiceStatus,
} from '@/lib/local-services'
import {
  checkWebSearchProvider,
  checkWigoloWebSearch,
} from '@/lib/web-search/service'
import {
  DEFAULT_WIGOLO_BASE_URL,
  loadWebSearchSettings,
  saveWebSearchSettings,
  type WebSearchSettings,
} from '@/lib/web-search/settings'
import type { WebSearchApiProvider } from '../config'
import { cn } from '@/lib/utils'

const SEARCH_PROVIDERS: Array<{
  id: WebSearchApiProvider
  name: string
  avatar: string
  apiKeyUrl: string
}> = [
  {
    id: 'zhipu',
    name: 'Zhipu Web Search',
    avatar: 'Zhipu',
    apiKeyUrl: 'https://open.bigmodel.cn/apikey/platform',
  },
  {
    id: 'tavily',
    name: 'Tavily',
    avatar: 'T',
    apiKeyUrl: 'https://app.tavily.com/home',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    avatar: 'B',
    apiKeyUrl: 'https://api-dashboard.search.brave.com/app/keys',
  },
  {
    id: 'exa',
    name: 'Exa',
    avatar: 'E',
    apiKeyUrl: 'https://dashboard.exa.ai/api-keys',
  },
]

type CheckState = 'idle' | 'checking' | 'ok' | 'error'
type SearchProviderConfig = typeof SEARCH_PROVIDERS[number]

interface SortableProviderFieldProps {
  provider: SearchProviderConfig
  apiKey: string
  visible: boolean
  checkState: CheckState
  disabled: boolean
  mobile: boolean
  expanded: boolean
  labels: {
    drag: string
    getApiKey: string
    showApiKey: string
    hideApiKey: string
    placeholder: string
    testConnection: string
    testing: string
  }
  onApiKeyChange: (apiKey: string) => void
  onToggleVisibility: () => void
  onCheckConnection: () => void
  onToggleExpanded: () => void
}

function SortableProviderField({
  provider,
  apiKey,
  visible,
  checkState,
  disabled,
  mobile,
  expanded,
  labels,
  onApiKeyChange,
  onToggleVisibility,
  onCheckConnection,
  onToggleExpanded,
}: SortableProviderFieldProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  function renderCheckIcon() {
    if (checkState === 'checking') {
      return <LoaderCircle className="animate-spin" />
    }
    if (checkState === 'ok') {
      return <CheckCircle2 className="text-primary" />
    }
    if (checkState === 'error') {
      return <CircleX className="text-destructive" />
    }
    return <PlugZap />
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="listitem"
      className={cn('relative', !mobile && 'pl-8')}
    >
      {!mobile ? <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 left-0 -translate-y-1/2 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        disabled={disabled}
        aria-label={labels.drag}
        {...attributes}
        {...listeners}
      >
        <GripVertical />
      </Button> : null}

      <Field className="rounded-lg border p-3" data-disabled={disabled}>
        <div className="flex min-w-0 items-center gap-2">
        {mobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            disabled={disabled}
            aria-label={labels.drag}
            {...attributes}
            {...listeners}
          >
            <GripVertical />
          </Button>
        ) : null}
        <Avatar size="sm">
          <AvatarFallback>{provider.avatar}</AvatarFallback>
        </Avatar>
        <FieldLabel
          htmlFor={`web-search-key-${provider.id}`}
          className="min-w-0 flex-1 truncate"
        >
          {provider.name}
        </FieldLabel>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!apiKey.trim() || checkState === 'checking'}
          aria-label={checkState === 'checking' ? labels.testing : labels.testConnection}
          onClick={onCheckConnection}
        >
          {renderCheckIcon()}
        </Button>
        {mobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={provider.name}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
          </Button>
        ) : null}
        </div>

        {!mobile || expanded ? <div className="flex min-w-0 gap-2">
          <InputGroup className={cn('min-w-0 flex-1', mobile && 'h-11')}>
            <InputGroupAddon><KeyRound /></InputGroupAddon>
            <InputGroupInput
              id={`web-search-key-${provider.id}`}
              type={visible ? 'text' : 'password'}
              value={apiKey}
              disabled={disabled}
              autoComplete="off"
              aria-label={labels.placeholder}
              placeholder={labels.placeholder}
              onChange={(event) => onApiKeyChange(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                disabled={!apiKey}
                aria-label={visible ? labels.hideApiKey : labels.showApiKey}
                onClick={onToggleVisibility}
              >
                {visible ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <OpenBroswer
            type="button"
            url={provider.apiKeyUrl}
            title={labels.getApiKey}
            className={cn('shrink-0', mobile && 'h-11')}
          />
        </div> : null}
      </Field>
    </div>
  )
}

export function WebSearchSettingsPage({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.webSearch')
  const [settings, setSettings] = useState<WebSearchSettings>()
  const [visibleKeys, setVisibleKeys] = useState<Partial<Record<WebSearchApiProvider, boolean>>>({})
  const [checkStates, setCheckStates] = useState<Partial<Record<WebSearchApiProvider, CheckState>>>({})
  const [expandedProviders, setExpandedProviders] = useState<Set<WebSearchApiProvider>>(new Set())
  const [wigoloTokenVisible, setWigoloTokenVisible] = useState(false)
  const [wigoloCheckState, setWigoloCheckState] = useState<CheckState>('idle')
  const [wigoloStatus, setWigoloStatus] = useState<LocalServiceStatus | null>(null)
  const [wigoloBusy, setWigoloBusy] = useState(false)
  const [wigoloProgress, setWigoloProgress] = useState('')
  const settingsRef = useRef<WebSearchSettings | undefined>(undefined)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveTimerRef = useRef<number | undefined>(undefined)
  const checkRequestRef = useRef<{
    provider: WebSearchApiProvider
    controller: AbortController
  } | null>(null)
  const wigoloCheckRef = useRef<AbortController | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  async function refreshWigoloStatus(current = settingsRef.current) {
    try {
      const status = await getServiceStatus('wigolo', {
        baseUrl: current?.wigoloBaseUrl,
        apiToken: current?.wigoloApiToken,
      })
      setWigoloStatus(status)
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setWigoloStatus({
        id: 'wigolo',
        label: 'Wigolo',
        state: 'error',
        managed: true,
        owned: false,
        message,
        packageReady: false,
      })
      return null
    }
  }

  useEffect(() => {
    let cancelled = false
    let unlistenProgress: (() => void) | undefined

    loadWebSearchSettings().then(async (loaded) => {
      if (cancelled) return
      settingsRef.current = loaded
      setSettings(loaded)
      await refreshWigoloStatus(loaded)
      if (cancelled) return
      if (loaded.wigoloEnabled !== false) {
        setWigoloBusy(true)
        try {
          const status = await ensureService('wigolo', {
            baseUrl: loaded.wigoloBaseUrl,
            apiToken: loaded.wigoloApiToken,
            installIfNeeded: true,
            startIfNeeded: true,
          })
          if (!cancelled) setWigoloStatus(status)
        } catch {
          if (!cancelled) await refreshWigoloStatus(loaded)
        } finally {
          if (!cancelled) {
            setWigoloBusy(false)
            setWigoloProgress('')
          }
        }
      }
    })

    void listenLocalServiceProgress((event) => {
      if (event.serviceId !== 'wigolo' || cancelled) return
      setWigoloProgress(event.message)
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenProgress = unlisten
    })

    return () => {
      cancelled = true
      unlistenProgress?.()
      checkRequestRef.current?.controller.abort()
      wigoloCheckRef.current?.abort()
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current)
        const pendingSettings = settingsRef.current
        if (pendingSettings) {
          writeQueueRef.current = writeQueueRef.current.then(
            () => saveWebSearchSettings(pendingSettings)
          )
        }
      }
    }
  }, [])

  function persistSettings(next: WebSearchSettings, delay = false) {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }

    const enqueueSave = () => {
      writeQueueRef.current = writeQueueRef.current.then(() => saveWebSearchSettings(next))
    }
    if (!delay) {
      enqueueSave()
      return
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined
      enqueueSave()
    }, 350)
  }

  function updateSettings(patch: Partial<WebSearchSettings>, delaySave = false) {
    const previousEnabled = settingsRef.current?.wigoloEnabled !== false
    const next = {
      ...(settingsRef.current || {
        nativeEnabled: true,
        thirdPartyEnabled: true,
        wigoloEnabled: true,
        basicEnabled: true,
        provider: 'auto' as const,
        apiKeys: {},
        providerOrder: SEARCH_PROVIDERS.map(provider => provider.id),
        wigoloBaseUrl: DEFAULT_WIGOLO_BASE_URL,
        wigoloApiToken: '',
      }),
      ...patch,
    }
    settingsRef.current = next
    setSettings(next)
    persistSettings(next, delaySave)

    const enabledNow = next.wigoloEnabled !== false
    if (!previousEnabled && enabledNow) {
      void handleStartWigolo()
    } else if (
      enabledNow
      && (patch.wigoloBaseUrl !== undefined || patch.wigoloApiToken !== undefined)
    ) {
      void refreshWigoloStatus(next)
    }
  }

  async function handleStartWigolo() {
    setWigoloBusy(true)
    setWigoloProgress(t('wigoloRefreshing'))
    try {
      const status = await ensureService('wigolo', {
        baseUrl: settingsRef.current?.wigoloBaseUrl,
        apiToken: settingsRef.current?.wigoloApiToken,
        installIfNeeded: true,
        startIfNeeded: true,
      })
      setWigoloStatus(status)
      toast({
        description: t('wigoloStartSuccess', {
          status: formatLocalServiceState(status.state),
        }),
      })
    } catch (error) {
      await refreshWigoloStatus()
      toast({
        variant: 'destructive',
        description: t('wigoloStartFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setWigoloBusy(false)
      setWigoloProgress('')
    }
  }

  async function handleStopWigolo() {
    setWigoloBusy(true)
    try {
      const status = await stopService('wigolo', {
        baseUrl: settingsRef.current?.wigoloBaseUrl,
        apiToken: settingsRef.current?.wigoloApiToken,
      })
      setWigoloStatus(status)
      toast({ description: t('wigoloStopSuccess') })
    } catch (error) {
      await refreshWigoloStatus()
      toast({
        variant: 'destructive',
        description: t('wigoloStopFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setWigoloBusy(false)
      setWigoloProgress('')
    }
  }

  function wigoloStatusLabel(status: LocalServiceStatus | null) {
    if (!status) return t('wigoloRefreshing')
    switch (status.state) {
      case 'running':
        return t('wigoloStatusRunning')
      case 'starting':
        return t('wigoloStatusStarting')
      case 'connected_external':
        return t('wigoloStatusConnectedExternal')
      case 'error':
        return t('wigoloStatusError')
      case 'unavailable':
        return t('wigoloStatusUnavailable')
      case 'ready':
        return formatLocalServiceState('ready')
      case 'stopped':
      default:
        return t('wigoloStatusStopped')
    }
  }

  const wigoloFixTip = getLocalServiceFixTip(wigoloStatus?.message)
    || getLocalServiceFixTip(wigoloStatus?.detail)

  function updateApiKey(provider: WebSearchApiProvider, apiKey: string) {
    setCheckStates(current => ({ ...current, [provider]: 'idle' }))
    updateSettings(
      {
        apiKeys: {
          ...(settingsRef.current?.apiKeys || {}),
          [provider]: apiKey,
        },
      },
      true
    )
  }

  async function handleCheckConnection(provider: WebSearchApiProvider) {
    const apiKey = settingsRef.current?.apiKeys[provider]?.trim()
    if (!apiKey) return

    const previousRequest = checkRequestRef.current
    previousRequest?.controller.abort()
    if (previousRequest) {
      setCheckStates(current => ({ ...current, [previousRequest.provider]: 'idle' }))
    }

    const controller = new AbortController()
    checkRequestRef.current = { provider, controller }
    setCheckStates(current => ({ ...current, [provider]: 'checking' }))

    try {
      const result = await checkWebSearchProvider(provider, apiKey, controller.signal)
      setCheckStates(current => ({ ...current, [provider]: 'ok' }))
      toast({ description: t('testSuccess', { count: result.sources.length }) })
    } catch (error) {
      if (controller.signal.aborted) return
      setCheckStates(current => ({ ...current, [provider]: 'error' }))
      toast({
        variant: 'destructive',
        description: t('testFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      if (checkRequestRef.current?.controller === controller) {
        checkRequestRef.current = null
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const currentOrder = settingsRef.current?.providerOrder
      || SEARCH_PROVIDERS.map(provider => provider.id)
    const oldIndex = currentOrder.indexOf(active.id as WebSearchApiProvider)
    const newIndex = currentOrder.indexOf(over.id as WebSearchApiProvider)
    if (oldIndex < 0 || newIndex < 0) return

    updateSettings({ providerOrder: arrayMove(currentOrder, oldIndex, newIndex) })
  }

  async function handleCheckWigolo() {
    wigoloCheckRef.current?.abort()
    const controller = new AbortController()
    wigoloCheckRef.current = controller
    setWigoloCheckState('checking')
    setWigoloBusy(true)

    try {
      const result = await checkWigoloWebSearch(
        {
          baseUrl: settingsRef.current?.wigoloBaseUrl,
          apiToken: settingsRef.current?.wigoloApiToken,
        },
        controller.signal
      )
      setWigoloCheckState('ok')
      await refreshWigoloStatus()
      toast({ description: t('testSuccess', { count: result.sources.length }) })
    } catch (error) {
      if (controller.signal.aborted) return
      setWigoloCheckState('error')
      await refreshWigoloStatus()
      toast({
        variant: 'destructive',
        description: t('testFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setWigoloBusy(false)
      if (wigoloCheckRef.current === controller) {
        wigoloCheckRef.current = null
      }
    }
  }

  function renderWigoloCheckIcon() {
    if (wigoloCheckState === 'checking') {
      return <LoaderCircle className="animate-spin" />
    }
    if (wigoloCheckState === 'ok') {
      return <CheckCircle2 className="text-primary" />
    }
    if (wigoloCheckState === 'error') {
      return <CircleX className="text-destructive" />
    }
    return <PlugZap />
  }

  const providerOrder = settings?.providerOrder
    || SEARCH_PROVIDERS.map(provider => provider.id)
  const orderedProviders = providerOrder.flatMap(providerId => (
    SEARCH_PROVIDERS.filter(provider => provider.id === providerId)
  ))

  return (
    <SettingType id="webSearch" title={t('title')} desc={t('desc')} icon={<Globe2 />}>
      <div className="flex flex-col">
          <div className="rounded-xl border border-dashed bg-muted/20 p-4 sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t('nativeLayerTitle')}</CardTitle>
                  <CardDescription>{t('nativeLayerDesc')}</CardDescription>
                </div>
              </div>
              <Switch
                aria-label={t('nativeEnabled')}
                checked={settings?.nativeEnabled !== false}
                disabled={!settings}
                onCheckedChange={(nativeEnabled) => updateSettings({ nativeEnabled })}
              />
            </div>
          </div>

          <div className="flex h-14 items-center gap-3 pl-5 text-muted-foreground sm:pl-8">
            <div className="h-full w-px bg-border" />
            <ArrowDown className="size-4 shrink-0" />
            <span className="text-xs font-medium">
              {settings?.nativeEnabled === false
                ? t('fallbackWhenNativeDisabled')
                : t('fallbackWhenUnavailable')}
            </span>
          </div>

          <div className="rounded-xl border border-dashed border-blue-500/30 bg-blue-500/5">
            <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  <Server className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t('wigoloLayerTitle')}</CardTitle>
                  <CardDescription>{t('wigoloLayerDesc')}</CardDescription>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!settings || wigoloCheckState === 'checking' || wigoloBusy}
                  aria-label={wigoloCheckState === 'checking' ? t('testing') : t('testConnection')}
                  onClick={() => void handleCheckWigolo()}
                >
                  {renderWigoloCheckIcon()}
                </Button>
                <Switch
                  aria-label={t('wigoloEnabled')}
                  checked={settings?.wigoloEnabled !== false}
                  disabled={!settings || wigoloBusy}
                  onCheckedChange={(wigoloEnabled) => updateSettings({ wigoloEnabled })}
                />
              </div>
            </div>

            <div className="space-y-3 p-4 pt-0 sm:p-5 sm:pt-0">
              <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t('wigoloManagedBy')}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                        wigoloStatus?.state === 'running' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                        wigoloStatus?.state === 'connected_external' && 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
                        wigoloStatus?.state === 'starting' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                        wigoloStatus?.state === 'error' && 'bg-destructive/15 text-destructive',
                        (!wigoloStatus || wigoloStatus.state === 'stopped' || wigoloStatus.state === 'unavailable')
                          && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {wigoloBusy || wigoloStatus?.state === 'starting' ? (
                        <LoaderCircle className="mr-1 size-3 animate-spin text-[#3b82f6]" />
                      ) : null}
                      {wigoloStatusLabel(wigoloBusy && !wigoloStatus ? null : wigoloStatus)}
                    </span>
                    <span className="min-w-0 text-muted-foreground">
                      {wigoloProgress || wigoloStatus?.message || t('wigoloRefreshing')}
                    </span>
                  </div>
                  {wigoloFixTip ? (
                    <p className="text-xs text-[#3b82f6]">
                      {t('wigoloFixTip', { tip: wigoloFixTip })}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!settings || settings.wigoloEnabled === false || wigoloBusy}
                    onClick={() => void handleStartWigolo()}
                  >
                    {wigoloBusy ? <LoaderCircle className="animate-spin" /> : <Server />}
                    {t('wigoloStart')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !settings
                      || settings.wigoloEnabled === false
                      || wigoloBusy
                      || wigoloStatus?.state !== 'running'
                      || !wigoloStatus.owned
                    }
                    onClick={() => void handleStopWigolo()}
                  >
                    <Square />
                    {t('wigoloStop')}
                  </Button>
                  <OpenBroswer
                    type="button"
                    url="https://github.com/KnockOutEZ/wigolo"
                    title={t('wigoloSetupGuide')}
                    className={cn('shrink-0', mobile && 'h-11')}
                  />
                </div>
              </div>

              <Field>
                <FieldLabel htmlFor="web-search-wigolo-base-url">{t('wigoloBaseUrl')}</FieldLabel>
                <InputGroup className={cn(mobile && 'h-11')}>
                  <InputGroupInput
                    id="web-search-wigolo-base-url"
                    type="url"
                    value={settings?.wigoloBaseUrl ?? DEFAULT_WIGOLO_BASE_URL}
                    disabled={!settings || settings.wigoloEnabled === false || wigoloBusy}
                    autoComplete="off"
                    placeholder={t('wigoloBaseUrlPlaceholder')}
                    onChange={(event) => {
                      setWigoloCheckState('idle')
                      updateSettings({ wigoloBaseUrl: event.target.value }, true)
                    }}
                  />
                </InputGroup>
              </Field>

              <Field>
                <FieldLabel htmlFor="web-search-wigolo-token">{t('wigoloApiToken')}</FieldLabel>
                <InputGroup className={cn(mobile && 'h-11')}>
                  <InputGroupAddon><KeyRound /></InputGroupAddon>
                  <InputGroupInput
                    id="web-search-wigolo-token"
                    type={wigoloTokenVisible ? 'text' : 'password'}
                    value={settings?.wigoloApiToken || ''}
                    disabled={!settings || settings.wigoloEnabled === false || wigoloBusy}
                    autoComplete="off"
                    placeholder={t('wigoloApiTokenPlaceholder')}
                    onChange={(event) => {
                      setWigoloCheckState('idle')
                      updateSettings({ wigoloApiToken: event.target.value }, true)
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      disabled={!settings?.wigoloApiToken}
                      aria-label={wigoloTokenVisible ? t('wigoloHideToken') : t('wigoloShowToken')}
                      onClick={() => setWigoloTokenVisible(current => !current)}
                    >
                      {wigoloTokenVisible ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            </div>
          </div>

          <div className="flex h-14 items-center gap-3 pl-5 text-muted-foreground sm:pl-8">
            <div className="h-full w-px bg-border" />
            <ArrowDown className="size-4 shrink-0" />
            <span className="text-xs font-medium">
              {settings?.wigoloEnabled === false
                ? t('fallbackWhenWigoloDisabled')
                : t('fallbackWhenUnavailable')}
            </span>
          </div>

          <div className="rounded-xl border border-dashed bg-card">
            <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <KeyRound className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t('thirdPartyLayerTitle')}</CardTitle>
                  <CardDescription>{t('thirdPartyLayerDesc')}</CardDescription>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Switch
                  aria-label={t('thirdPartyEnabled')}
                  checked={settings?.thirdPartyEnabled !== false}
                  disabled={!settings}
                  onCheckedChange={(thirdPartyEnabled) => updateSettings({ thirdPartyEnabled })}
                />
              </div>
            </div>

            <div className="p-4 pt-0 sm:p-5 sm:pt-0">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedProviders.map(provider => provider.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <FieldGroup className="gap-2">
                    {orderedProviders.map(provider => (
                      <SortableProviderField
                        key={provider.id}
                        provider={provider}
                        apiKey={settings?.apiKeys[provider.id] || ''}
                        visible={visibleKeys[provider.id] === true}
                        checkState={checkStates[provider.id] || 'idle'}
                        disabled={!settings}
                        mobile={mobile}
                        expanded={expandedProviders.has(provider.id)}
                        labels={{
                          drag: t('dragProvider', { provider: provider.name }),
                          getApiKey: t('getApiKey'),
                          showApiKey: t('showApiKey'),
                          hideApiKey: t('hideApiKey'),
                          placeholder: t('providerApiKeyPlaceholder', { provider: provider.name }),
                          testConnection: t('testConnection'),
                          testing: t('testing'),
                        }}
                        onApiKeyChange={(apiKey) => updateApiKey(provider.id, apiKey)}
                        onToggleVisibility={() => setVisibleKeys(current => ({
                          ...current,
                          [provider.id]: current[provider.id] !== true,
                        }))}
                        onCheckConnection={() => void handleCheckConnection(provider.id)}
                        onToggleExpanded={() => setExpandedProviders(current => {
                          const next = new Set(current)
                          if (next.has(provider.id)) next.delete(provider.id)
                          else next.add(provider.id)
                          return next
                        })}
                      />
                    ))}
                  </FieldGroup>
                </SortableContext>
              </DndContext>
            </div>
          </div>

          <div className="flex h-14 items-center gap-3 pl-5 text-muted-foreground sm:pl-8">
            <div className="h-full w-px bg-border" />
            <ArrowDown className="size-4 shrink-0" />
            <span className="text-xs font-medium">
              {settings?.thirdPartyEnabled === false
                ? t('fallbackWhenDisabled')
                : t('fallbackWhenUnavailable')}
            </span>
          </div>

          <div className="rounded-xl border border-dashed bg-muted/10 p-4 sm:p-5">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Globe2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle>{t('basicLayerTitle')}</CardTitle>
                  <CardDescription>{t('basicLayerDesc')}</CardDescription>
                </div>
              </div>
              <Switch
                aria-label={t('basicEnabled')}
                checked={settings?.basicEnabled !== false}
                disabled={!settings}
                onCheckedChange={(basicEnabled) => updateSettings({ basicEnabled })}
              />
            </div>
          </div>
      </div>
    </SettingType>
  )
}

