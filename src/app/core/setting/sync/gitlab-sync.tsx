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
import { checkSyncProjectState, createSyncProject, getUserInfo } from "@/lib/sync/gitlab";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { GitlabInstanceType, GITLAB_INSTANCES } from "@/lib/sync/gitlab.types";
import { Globe, Server, Plus, RefreshCcw } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TokenInputControl } from "./components/token-input-control";

dayjs.extend(relativeTime)

export function GitlabSync() {
  const t = useTranslations();
  const {
    gitlabInstanceType,
    setGitlabInstanceType,
    gitlabCustomUrl,
    setGitlabCustomUrl,
    gitlabAccessToken,
    setGitlabAccessToken,
    gitlabCustomSyncRepo,
    setGitlabCustomSyncRepo
  } = useSettingStore()
  
  const {
    gitlabUserInfo,
    gitlabSyncProjectState,
    setGitlabSyncProjectState,
    gitlabSyncProjectInfo,
    setGitlabSyncProjectInfo
  } = useSyncStore()

  const [gitlabAccessTokenVisible, setGitlabAccessTokenVisible] = useState<boolean>(false)

  //
  const getRepoName = () => {
    return gitlabCustomSyncRepo.trim() || RepoNames.sync
  }


  // Gitlab （，）
  async function checkProjectState() {
    try {
      setGitlabSyncProjectState(SyncStateEnum.checking)
      //
      setGitlabSyncProjectInfo(undefined)
      
      await getUserInfo();
      //
      const repoName = getRepoName()
      const syncProject = await checkSyncProjectState(repoName)
      
      if (syncProject) {
        setGitlabSyncProjectInfo(syncProject)
        setGitlabSyncProjectState(SyncStateEnum.success)
      } else {
        setGitlabSyncProjectInfo(undefined)
        setGitlabSyncProjectState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to check GitLab projects:', err)
      setGitlabSyncProjectInfo(undefined)
      setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }

  //
  async function createGitlabProject() {
    try {
      setGitlabSyncProjectState(SyncStateEnum.creating)
      const repoName = getRepoName()
      const info = await createSyncProject(repoName, true)
      if (info) {
        setGitlabSyncProjectInfo(info)
        setGitlabSyncProjectState(SyncStateEnum.success)
      } else {
        setGitlabSyncProjectState(SyncStateEnum.fail)
      }
    } catch (err) {
      console.error('Failed to create Gitlab project:', err)
      setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }

  // Token
  async function tokenChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    if (value === '') {
      setGitlabSyncProjectState(SyncStateEnum.fail)
      setGitlabSyncProjectInfo(undefined)
    }
    setGitlabAccessToken(value)
    const store = await Store.load('store.json');
    await store.set('gitlabAccessToken', value)
    await store.save()
  }

  //
  async function instanceTypeChangeHandler(value: GitlabInstanceType) {
    await setGitlabInstanceType(value)
  }

  // URL
  async function customUrlChangeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    await setGitlabCustomUrl(value)
  }

  // Token URL
  function getTokenCreateUrl() {
    const query = '?name=NoteLoom&description=NoteLoom+sync&scopes=api'
    if (gitlabInstanceType === GitlabInstanceType.SELF_HOSTED) {
      const baseUrl = gitlabCustomUrl.replace(/\/+$/, '')
      return baseUrl ? `${baseUrl}/-/user_settings/personal_access_tokens${query}` : '#'
    }
    const instance = GITLAB_INSTANCES[gitlabInstanceType]
    return `${instance.baseUrl}/-/user_settings/personal_access_tokens${query}`
  }

  useEffect(() => {
    async function init() {
      const store = await Store.load('store.json');
      
      //
      const instanceType = await store.get<GitlabInstanceType>('gitlabInstanceType')
      if (instanceType) {
        setGitlabInstanceType(instanceType)
      }
      
      // URL
      const customUrl = await store.get<string>('gitlabCustomUrl')
      if (customUrl) {
        setGitlabCustomUrl(customUrl)
      }
      
      //
      const token = await store.get<string>('gitlabAccessToken')
      if (token) {
        setGitlabAccessToken(token)
      } else {
        setGitlabAccessToken('')
      }
    }
    init()
  }, [])



  return (
    <div className="rounded-md border p-4">
      <div className="flex justify-between items-center mb-2">
        <div className="flex gap-2 items-center">
          <span className="font-semibold">GitLab {t('settings.sync.settings')}</span>
        </div>
        <Badge variant={gitlabSyncProjectState === SyncStateEnum.success ? 'default' : 'secondary'}>
          {gitlabSyncProjectState === SyncStateEnum.success
            ? t('settings.sync.status.connected')
            : gitlabSyncProjectState === SyncStateEnum.checking
              ? t('settings.sync.checking')
              : gitlabSyncProjectState === SyncStateEnum.creating
                ? t('settings.sync.creating')
                : t('settings.sync.status.disconnected')}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t('settings.sync.platformDesc')}</p>

      {/* */}
      <div className="space-y-2 mb-4">
        <label className="text-sm font-medium">{t('settings.sync.gitlabInstanceType')}</label>
        <ResponsiveSelect
          title={t('settings.sync.gitlabInstanceType')}
          value={gitlabInstanceType}
          onValueChange={value => instanceTypeChangeHandler(value as GitlabInstanceType)}
          placeholder={t('settings.sync.gitlabInstanceTypePlaceholder')}
          options={[
            { value: GitlabInstanceType.OFFICIAL, label: <span className="flex items-center gap-2"><Globe />GitLab.com</span> },
            { value: GitlabInstanceType.JIHULAB, label: <span className="flex items-center gap-2"><Globe />JiHu</span> },
            { value: GitlabInstanceType.SELF_HOSTED, label: <span className="flex items-center gap-2"><Server />{t('settings.sync.gitlabInstanceTypeOptions.selfHosted')}</span> },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t('settings.sync.gitlabInstanceTypeDesc')}</p>
      </div>

      {/* URL（） */}
      {gitlabInstanceType === GitlabInstanceType.SELF_HOSTED && (
        <div className="space-y-2 mb-4">
          <label className="text-sm font-medium">GitLab URL</label>
          <Input
            value={gitlabCustomUrl}
            onChange={customUrlChangeHandler}
            placeholder="https://gitlab.example.com"
            type="url"
          />
          <p className="text-xs text-muted-foreground">{t('settings.sync.gitlabInstanceTypeOptions.selfHostedDesc')}</p>
        </div>
      )}

      {/* Token */}
      <div className="space-y-2">
        <label className="text-sm font-medium">GitLab Access Token</label>
        <TokenInputControl
          value={gitlabAccessToken}
          onChange={tokenChangeHandler}
          visible={gitlabAccessTokenVisible}
          onVisibleChange={setGitlabAccessTokenVisible}
          tokenUrl={getTokenCreateUrl()}
          placeholder={t('settings.sync.enterToken')}
        />
      </div>

      {/* */}
      <div className="mt-4 space-y-2">
        <label className="text-sm font-medium">{t('settings.sync.customSyncRepo')}</label>
        <Input
          value={gitlabCustomSyncRepo}
          onChange={(e) => setGitlabCustomSyncRepo(e.target.value)}
          placeholder={RepoNames.sync}
        />
        <p className="text-xs text-muted-foreground">{t('settings.sync.customSyncRepoDesc')}</p>
      </div>

      {/* */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {gitlabAccessToken ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={checkProjectState}
              disabled={gitlabSyncProjectState === SyncStateEnum.checking || gitlabSyncProjectState === SyncStateEnum.creating}
            >
              {gitlabSyncProjectState === SyncStateEnum.checking || gitlabSyncProjectState === SyncStateEnum.creating ? (
                <>
                  <RefreshCcw className="size-4 mr-1 animate-spin" />
                  {gitlabSyncProjectState === SyncStateEnum.checking ? t('settings.sync.checking') : t('settings.sync.creating')}
                </>
              ) : (
                <>
                  <RefreshCcw className="size-4 mr-1" />
                  {t('settings.sync.checkRepo')}
                </>
              )}
            </Button>
            {gitlabSyncProjectState === SyncStateEnum.fail && (
              <Button variant="outline" size="sm" onClick={createGitlabProject}>
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
      {gitlabSyncProjectInfo && (
        <div className="border-t mt-4 pt-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-10">
              <AvatarImage src={gitlabUserInfo?.avatar_url || ''} alt={gitlabUserInfo?.username || 'GitLab'} />
              <AvatarFallback>GL</AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-xl font-bold mb-1">
                <OpenBroswer title={gitlabSyncProjectInfo?.name_with_namespace || ''} url={gitlabSyncProjectInfo?.web_url || ''} />
              </h3>
              <p className="text-sm text-zinc-500">
                {gitlabSyncProjectInfo?.visibility === 'public' ? t('settings.sync.public') : t('settings.sync.private')} · {t('settings.sync.createdAt', { time: dayjs(gitlabSyncProjectInfo?.created_at).fromNow() })} · {t('settings.sync.updatedAt', { time: dayjs(gitlabSyncProjectInfo?.updated_at).fromNow() })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
