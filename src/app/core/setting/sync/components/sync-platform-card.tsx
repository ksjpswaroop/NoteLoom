'use client'

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useEffect, useState, useCallback } from "react"
import { useTranslations } from 'next-intl'
import { Store } from "@tauri-apps/plugin-store"
import { SyncStateEnum } from "@/lib/sync/github.types"
import { SyncPlatform } from "@/types/sync"
import { RefreshCcw, Loader2, AlertCircle, CheckCircle2, XCircle } from "lucide-react"
import { TokenInputControl } from "./token-input-control"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"

export interface SyncPlatformConfig {
  platform: SyncPlatform
  tokenKey: string
  tokenLabel: string
  tokenDesc: string
  tokenUrl: string
  tokenUrlText: string
}

interface SyncPlatformCardProps {
  config: SyncPlatformConfig
  accessToken: string
  setAccessToken: (token: string) => void
  syncRepoState: SyncStateEnum
  syncRepoInfo?: any
  customRepo: string
  setCustomRepo: (repo: string) => void
  defaultRepoName: string
  onCheckRepo: () => void
  onCreateRepo: () => void
  children?: React.ReactNode
}

export function SyncPlatformCard({
  config,
  accessToken,
  setAccessToken,
  syncRepoState,
  syncRepoInfo,
  customRepo,
  setCustomRepo,
  defaultRepoName,
  onCheckRepo,
  onCreateRepo,
  children,
}: SyncPlatformCardProps) {
  const t = useTranslations()
  const [tokenVisible, setTokenVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  // token
  useEffect(() => {
    const init = async () => {
      try {
        const store = await Store.load('store.json')
        const token = await store.get<string>(config.tokenKey)
        if (token) {
          setAccessToken(token)
        }
      } catch (err) {
        console.error(`Failed to load ${config.platform} token:`, err)
      } finally {
        setIsInitializing(false)
      }
    }
    init()
  }, [config.tokenKey, setAccessToken])

  // syncRepoState
  useEffect(() => {
    if (syncRepoState === SyncStateEnum.fail && accessToken) {
      // ，
    }
  }, [syncRepoState, accessToken])

  const handleTokenChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setAccessToken(value)
    setError(null)

    try {
      const store = await Store.load('store.json')
      await store.set(config.tokenKey, value)
      await store.save()
    } catch (err) {
      console.error('Failed to save token:', err)
    }
  }, [config.tokenKey, setAccessToken])

  const isLoading = syncRepoState === SyncStateEnum.checking || syncRepoState === SyncStateEnum.creating

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {config.platform.charAt(0).toUpperCase() + config.platform.slice(1)} {t('settings.sync.settings')}
        </CardTitle>
        <CardDescription>{t('settings.sync.platformDesc')}</CardDescription>
        <CardAction><StatusBadge state={syncRepoState} /></CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel>{config.tokenLabel}</FieldLabel>
            <TokenInputControl
              value={accessToken}
              onChange={handleTokenChange}
              visible={tokenVisible}
              onVisibleChange={setTokenVisible}
              tokenUrl={config.tokenUrl}
              placeholder={t('settings.sync.enterToken')}
              disabled={isInitializing}
            />
          </Field>
          <Field>
            <FieldLabel>{t('settings.sync.customSyncRepo')}</FieldLabel>
            <Input
              value={customRepo}
              onChange={(e) => setCustomRepo(e.target.value)}
              placeholder={defaultRepoName}
            />
            <FieldDescription>{t('settings.sync.customSyncRepoDesc')}</FieldDescription>
          </Field>
        </FieldGroup>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{t('settings.sync.settings')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {syncRepoInfo && (
          <>
            <Separator />
            {children}
          </>
        )}
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        {accessToken ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onCheckRepo}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                  {syncRepoState === SyncStateEnum.checking
                    ? t('settings.sync.checking')
                    : t('settings.sync.creating')}
                </>
              ) : (
                <>
                  <RefreshCcw data-icon="inline-start" />
                  {t('settings.sync.checkRepo')}
                </>
              )}
            </Button>
            {syncRepoState === SyncStateEnum.fail && (
              <Button variant="outline" size="sm" onClick={onCreateRepo} disabled={isLoading}>
                <Loader2 data-icon="inline-start" className={isLoading ? 'animate-spin' : undefined} />
                {t('settings.sync.createRepo')}
              </Button>
            )}
          </>
        ) : (
          <Alert>
            <AlertCircle />
            <AlertDescription>{t('settings.sync.enterTokenHint')}</AlertDescription>
          </Alert>
        )}
      </CardFooter>
    </Card>
  )
}

//
function StatusBadge({ state }: { state: SyncStateEnum }) {
  const t = useTranslations()

  if (state === SyncStateEnum.success) {
    return (
      <Badge>
        <CheckCircle2 data-icon="inline-start" />
        {t('settings.sync.status.connected')}
      </Badge>
    )
  }

  if (state === SyncStateEnum.checking || state === SyncStateEnum.creating) {
    return (
      <Badge variant="secondary">
        <Loader2 data-icon="inline-start" className="animate-spin" />
        {state === SyncStateEnum.checking
          ? t('settings.sync.checking')
          : t('settings.sync.creating')}
      </Badge>
    )
  }

  if (state === SyncStateEnum.fail) {
    return (
      <Badge variant="outline">
        <XCircle data-icon="inline-start" />
        {t('settings.sync.status.disconnected')}
      </Badge>
    )
  }

  return null
}

export { StatusBadge }
