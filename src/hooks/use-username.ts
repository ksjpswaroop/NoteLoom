import { useMemo } from "react"
import useSyncStore from "@/stores/sync"
import useSettingStore from "@/stores/setting"
import { Store } from "@tauri-apps/plugin-store"

// ，
function useUsername() {
  const { primaryBackupMethod } = useSettingStore()
  const { userInfo, giteeUserInfo, gitlabUserInfo, giteaUserInfo } = useSyncStore()
  const username = useMemo(() => {
    switch (primaryBackupMethod) {
      case 'github':
        return userInfo?.login
      case 'gitee':
        return giteeUserInfo?.login
      case 'gitlab':
        return gitlabUserInfo?.name
      case 'gitea':
        return giteaUserInfo?.login
      case 's3':
        // S3 bucket
        return null // ，
    }
  }, [userInfo, giteeUserInfo, gitlabUserInfo, giteaUserInfo, primaryBackupMethod])

  return username
}

// S3
export async function getS3BucketName(): Promise<string | null> {
  const store = await Store.load('store.json')
  const s3Config = await store.get<{ bucket: string }>('s3SyncConfig')
  return s3Config?.bucket || null
}

export default useUsername
