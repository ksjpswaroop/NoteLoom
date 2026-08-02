import { RepoNames } from './github.types'
import { Store } from '@tauri-apps/plugin-store'

/**
 * 
 * @param type ：'sync' | 'image'
 * @param platform ：'github' | 'gitee' | 'gitlab' | 'gitea'
 * @returns 
 */
export async function getActualRepoName(
  type: 'sync' | 'image',
  platform: 'github' | 'gitee' | 'gitlab' | 'gitea'
): Promise<string> {
  const store = await Store.load('store.json')
  
  //
  let customRepoName = ''
  
  if (type === 'sync') {
    switch (platform) {
      case 'github':
        customRepoName = await store.get<string>('githubCustomSyncRepo') || ''
        break
      case 'gitee':
        customRepoName = await store.get<string>('giteeCustomSyncRepo') || ''
        break
      case 'gitlab':
        customRepoName = await store.get<string>('gitlabCustomSyncRepo') || ''
        break
      case 'gitea':
        customRepoName = await store.get<string>('giteaCustomSyncRepo') || ''
        break
    }
  } else if (type === 'image' && platform === 'github') {
    customRepoName = await store.get<string>('githubCustomImageRepo') || ''
  }
  
  // ，，
  if (customRepoName.trim()) {
    return customRepoName.trim()
  }
  
  //
  return type === 'sync' ? RepoNames.sync : RepoNames.image
}

/**
 * 
 * @param platform ：'github' | 'gitee' | 'gitlab' | 'gitea'
 * @returns 
 */
export async function getSyncRepoName(platform: 'github' | 'gitee' | 'gitlab' | 'gitea'): Promise<string> {
  return getActualRepoName('sync', platform)
}

/**
 * （GitHub）
 * @returns GitHub
 */
export async function getImageRepoName(): Promise<string> {
  return getActualRepoName('image', 'github')
}
