'use client'
import { useCallback, useEffect } from "react";
import { useTranslations } from 'next-intl';
import useSettingStore from "@/stores/setting";
import useSyncStore from "@/stores/sync";
import { OpenBroswer } from "@/components/open-broswer";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { checkSyncRepoState, createSyncRepo, getUserInfo } from "@/lib/sync/gitee";
import { RepoNames, SyncStateEnum } from "@/lib/sync/github.types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SyncPlatformCard } from "./components/sync-platform-card";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";

dayjs.extend(relativeTime)

const GITEE_CONFIG = {
  platform: 'gitee' as const,
  tokenKey: 'giteeAccessToken',
  tokenLabel: 'Gitee private token',
  tokenDesc: '',
  tokenUrl: 'https://gitee.com/profile/personal_access_tokens/new',
  tokenUrlText: '',
}

export function GiteeSync() {
  const t = useTranslations();
  const {
    giteeAccessToken,
    setGiteeAccessToken,
    giteeCustomSyncRepo,
    setGiteeCustomSyncRepo
  } = useSettingStore()
  
  const {
    giteeSyncRepoState,
    setGiteeSyncRepoState,
    giteeSyncRepoInfo,
    setGiteeSyncRepoInfo
  } = useSyncStore()

  //
  const getRepoName = () => {
    return giteeCustomSyncRepo.trim() || RepoNames.sync
  }

  const handleAccessTokenChange = useCallback((token: string) => {
    void setGiteeAccessToken(token)
    if (!token) {
      setGiteeSyncRepoState(SyncStateEnum.fail)
      setGiteeSyncRepoInfo(undefined)
    }
  }, [setGiteeAccessToken, setGiteeSyncRepoInfo, setGiteeSyncRepoState])


  // Gitee （，）
  async function checkRepoState() {
    try {
      setGiteeSyncRepoState(SyncStateEnum.checking)
      //
      setGiteeSyncRepoInfo(undefined)
      
      // ，
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Check timed out')), 15000) // 15s timeout
      })
      
      // Promise.race
      await Promise.race([
        (async () => {
          //
          if (!navigator.onLine) {
            throw new Error('Network unavailable')
          }
          
          await getUserInfo();
          const repoName = getRepoName()
          const syncRepo = await checkSyncRepoState(repoName)
          
          if (syncRepo) {
            setGiteeSyncRepoInfo(syncRepo)
            setGiteeSyncRepoState(SyncStateEnum.success)
          } else {
            setGiteeSyncRepoInfo(undefined)
            setGiteeSyncRepoState(SyncStateEnum.fail)
          }
        })(),
        timeoutPromise
      ])
      
    } catch (err) {
      console.error('Failed to check Gitee repos:', err)
      setGiteeSyncRepoInfo(undefined)
      setGiteeSyncRepoState(SyncStateEnum.fail)
      
      // ，
      if (err instanceof Error) {
        if (err.message === 'Check timed out') {
          console.warn('Gitee repository check timed out; this may be a network issue')
        } else if (err.message === 'Network unavailable') {
          console.warn('Network unavailable. Check your connection settings.')
        }
      }
    }
  }

  //
  async function createGiteeRepo() {
    try {
      setGiteeSyncRepoState(SyncStateEnum.creating)
      const repoName = getRepoName()
      
      //
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Creation timed out')), 20000) // 20s timeout
      })
      
      await Promise.race([
        (async () => {
          const info = await createSyncRepo(repoName, true)
          if (info) {
            setGiteeSyncRepoInfo(info)
            setGiteeSyncRepoState(SyncStateEnum.success)
          } else {
            setGiteeSyncRepoState(SyncStateEnum.fail)
          }
        })(),
        timeoutPromise
      ])
      
    } catch (err) {
      console.error('Failed to create Gitee repo:', err)
      setGiteeSyncRepoState(SyncStateEnum.fail)
      
      if (err instanceof Error && err.message === 'Creation timed out') {
        console.warn('Gitee repository creation timed out; this may be a network issue')
      }
    }
  }

  useEffect(() => {
    //
    const handleOnline = () => {
      // Network connected
    }

    const handleOffline = () => {
      // Network disconnected
      setGiteeSyncRepoState(SyncStateEnum.fail)
      setGiteeSyncRepoInfo(undefined)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])


  return (
    <SyncPlatformCard
      config={GITEE_CONFIG}
      accessToken={giteeAccessToken}
      setAccessToken={handleAccessTokenChange}
      syncRepoState={giteeSyncRepoState}
      syncRepoInfo={giteeSyncRepoInfo}
      customRepo={giteeCustomSyncRepo}
      setCustomRepo={setGiteeCustomSyncRepo}
      defaultRepoName={RepoNames.sync}
      onCheckRepo={checkRepoState}
      onCreateRepo={createGiteeRepo}
    >
      {giteeSyncRepoInfo && (
          <Item>
            <ItemMedia>
            <Avatar className="size-10">
              <AvatarImage src={giteeSyncRepoInfo?.owner?.avatar_url || ''} alt={giteeSyncRepoInfo?.owner?.login || 'Gitee'} />
              <AvatarFallback>GT</AvatarFallback>
            </Avatar>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                <OpenBroswer title={giteeSyncRepoInfo?.full_name || ''} url={giteeSyncRepoInfo?.html_url || ''} />
              </ItemTitle>
              <ItemDescription>
                {giteeSyncRepoInfo?.private ? t('settings.sync.private') : t('settings.sync.public')} · {t('settings.sync.createdAt', { time: dayjs(giteeSyncRepoInfo?.created_at).fromNow() })} · {t('settings.sync.updatedAt', { time: dayjs(giteeSyncRepoInfo?.updated_at).fromNow() })}
              </ItemDescription>
            </ItemContent>
          </Item>
      )}
    </SyncPlatformCard>
  )
}
