'use client'
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { useTranslations } from 'next-intl';
import { ResponsiveSelect } from "@/components/responsive-select";
import useSettingStore from "@/stores/setting";
import { Store } from "@tauri-apps/plugin-store";
import useSyncStore from "@/stores/sync";
import { Badge } from "@/components/ui/badge";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { Button } from "@/components/ui/button";
import { checkSyncRepoState, createSyncRepo, getUserInfo } from "@/lib/sync/gitea";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { GiteaInstanceType, GITEA_INSTANCES } from "@/lib/sync/gitea.types";
import { Globe, Server, Plus, RefreshCcw } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TokenInputControl } from "./components/token-input-control";

dayjs.extend(relativeTime)

export function GiteaSync() {
  const t = useTranslations();
  const {
    giteaInstanceType,
    setGiteaInstanceType,
    giteaCustomUrl,
    setGiteaCustomUrl,
    giteaAccessToken,
    setGiteaAccessToken,
    giteaCustomSyncRepo,
    setGiteaCustomSyncRepo
  } = useSettingStore()
  
  const {
    giteaUserInfo,
    setGiteaUserInfo,
    giteaSyncRepoState,
    setGiteaSyncRepoState,
    giteaSyncRepoInfo,
    setGiteaSyncRepoInfo
  } = useSyncStore()

  const [giteaAccessTokenVisible, setGiteaAccessTokenVisible] = useState<boolean>(false)

  //
  const getRepoName = () => {
    return giteaCustomSyncRepo.trim() || RepoNames.sync
  }


  // Gitea （，）
  async function checkRepoState() {
    try {
      setGiteaSyncRepoState(SyncStateEnum.checking)
      //
      setGiteaSyncRepoInfo(undefined)
      
      //
      const userInfo = await getUserInfo();
      setGiteaUserInfo(userInfo);
      
      //
      const repoName = getRepoName()
      const syncRepo = await checkSyncRepoState(repoName)
      
      if (syncRepo) {
        setGiteaSyncRepoInfo(syncRepo)
        setGiteaSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteaSyncRepoInfo(undefined)
        setGiteaSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check Gitea repos:', err)
      setGiteaSyncRepoInfo(undefined)
      setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }

  //
  async function createGiteaRepo() {
    try {
      setGiteaSyncRepoState(SyncStateEnum.creating)
      const repoName = getRepoName()
      const info = await createSyncRepo(repoName, true)
      if (info) {
        setGiteaSyncRepoInfo(info)
        setGiteaSyncRepoState(SyncStateEnum.success)
      } else {
        setGiteaSyncRepoState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to create Gitea repo:', err)
      setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }

  // Token
  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setGiteaSyncRepoState(SyncStateEnum.fail)
      setGiteaSyncRepoInfo(undefined)
      setGiteaUserInfo(undefined)
    }
    setGiteaAccessToken(value)
    const store = await Store.load('store.json');
    await store.set('giteaAccessToken', value)
    await store.save()
    
    // token ，
    if (value.trim()) {
      // ，
      setTimeout(() => {
        checkRepoState()
      }, 500)
    }
  }

  //
  async function instanceTypeChangeHandler(value: GiteaInstanceType) {
    await setGiteaInstanceType(value)
    // token，
    if (giteaAccessToken.trim()) {
      setTimeout(() => {
        checkRepoState()
      }, 500)
    }
  }

  // URL
  async function customUrlChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    let value = e.target.value
    //
    value = value.replace(/\/+$/, '')
    await setGiteaCustomUrl(value)
    // token，
    if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED && giteaAccessToken.trim() && value.trim()) {
      setTimeout(() => {
        checkRepoState()
      }, 500)
    }
  }

  // Token URL
  function getTokenCreateUrl() {
    if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED) {
      return giteaCustomUrl ? `${giteaCustomUrl}/user/settings/applications` : '#'
    }
    const instance = GITEA_INSTANCES[giteaInstanceType]
    return `${instance.baseUrl}/user/settings/applications`
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      
      //
      const instanceType = await store.get<GiteaInstanceType>('giteaInstanceType')
      if (instanceType) {
        setGiteaInstanceType(instanceType)
      }
      
      // URL
      const customUrl = await store.get<string>('giteaCustomUrl')
      if (customUrl) {
        setGiteaCustomUrl(customUrl)
      }
      
      //
      const token = await store.get<string>('giteaAccessToken')
      if (token) {
        setGiteaAccessToken(token)
        // token，
        checkRepoState()
      } else {
        setGiteaAccessToken('')
      }
    }
    init()
  }, [])



  return (
    <div className="rounded-md border p-4">
      <div className="flex justify-between items-center mb-2">
        <div className="flex gap-2 items-center">
          <span className="font-semibold">Gitea {t('settings.sync.settings')}</span>
        </div>
        <Badge variant={giteaSyncRepoState === SyncStateEnum.success ? 'default' : 'secondary'}>
          {giteaSyncRepoState === SyncStateEnum.success
            ? t('settings.sync.status.connected')
            : giteaSyncRepoState === SyncStateEnum.checking
              ? t('settings.sync.checking')
              : giteaSyncRepoState === SyncStateEnum.creating
                ? t('settings.sync.creating')
                : t('settings.sync.status.disconnected')}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t('settings.sync.platformDesc')}</p>

      {/* */}
      <div className="space-y-2 mb-4">
        <label className="text-sm font-medium">{t('settings.sync.giteaInstanceType')}</label>
        <ResponsiveSelect
          title={t('settings.sync.giteaInstanceType')}
          value={giteaInstanceType}
          onValueChange={value => instanceTypeChangeHandler(value as GiteaInstanceType)}
          placeholder={t('settings.sync.giteaInstanceTypePlaceholder')}
          options={[
            { value: GiteaInstanceType.OFFICIAL, label: <span className="flex items-center gap-2"><Globe />Gitea.com</span> },
            { value: GiteaInstanceType.SELF_HOSTED, label: <span className="flex items-center gap-2"><Server />{t('settings.sync.giteaInstanceTypeOptions.selfHosted')}</span> },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t('settings.sync.giteaInstanceTypeDesc')}</p>
      </div>

      {/* URL（） */}
      {giteaInstanceType === GiteaInstanceType.SELF_HOSTED && (
        <div className="space-y-2 mb-4">
          <label className="text-sm font-medium">Gitea URL</label>
          <Input
            value={giteaCustomUrl}
            onChange={customUrlChangeHandler}
            placeholder="https://gitea.example.com"
            type="url"
          />
          <p className="text-xs text-muted-foreground">{t('settings.sync.giteaInstanceTypeOptions.selfHostedDesc')}</p>
        </div>
      )}

      {/* Token */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Gitea Access Token</label>
        <TokenInputControl
          value={giteaAccessToken}
          onChange={tokenChangeHandler}
          visible={giteaAccessTokenVisible}
          onVisibleChange={setGiteaAccessTokenVisible}
          tokenUrl={getTokenCreateUrl()}
          placeholder={t('settings.sync.enterToken')}
        />
      </div>

      {/* */}
      <div className="mt-4 space-y-2">
        <label className="text-sm font-medium">{t('settings.sync.customSyncRepo')}</label>
        <Input
          value={giteaCustomSyncRepo}
          onChange={(e) => setGiteaCustomSyncRepo(e.target.value)}
          placeholder={RepoNames.sync}
        />
        <p className="text-xs text-muted-foreground">{t('settings.sync.customSyncRepoDesc')}</p>
      </div>

      {/* */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {giteaAccessToken ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={checkRepoState}
              disabled={giteaSyncRepoState === SyncStateEnum.checking || giteaSyncRepoState === SyncStateEnum.creating}
            >
              {giteaSyncRepoState === SyncStateEnum.checking || giteaSyncRepoState === SyncStateEnum.creating ? (
                <>
                  <RefreshCcw className="size-4 mr-1 animate-spin" />
                  {giteaSyncRepoState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.creating')}
                </>
              ) : (
                <>
                  <RefreshCcw className="size-4 mr-1" />
                  {t('settings.sync.checkRepo')}
                </>
              )}
            </Button>
            {giteaSyncRepoState === SyncStateEnum.fail && (
              <Button variant="outline" size="sm" onClick={createGiteaRepo}>
                <Plus className="size-4 mr-1" />
                {t('settings.sync.createRepo')}
              </Button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <RefreshCcw className="size-4" />
            {t('settings.sync.enterTokenHint')}
          </div>
        )}
      </div>

      {/* */}
      {giteaSyncRepoInfo && (
        <div className="border-t mt-4 pt-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-10">
              <AvatarImage src={giteaUserInfo?.avatar_url || ''} alt={giteaUserInfo?.login || 'Gitea'} />
              <AvatarFallback>GA</AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-xl font-bold mb-1">
                <OpenBroswer title={giteaSyncRepoInfo?.full_name || ''} url={giteaSyncRepoInfo?.html_url || ''} />
              </h3>
              <p className="text-sm text-zinc-500">
                {giteaSyncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public')} · {t('settings.sync.createdAt', { time: dayjs(giteaSyncRepoInfo?.created_at).fromNow() })} · {t('settings.sync.updatedAt', { time: dayjs(giteaSyncRepoInfo?.updated_at).fromNow() })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
