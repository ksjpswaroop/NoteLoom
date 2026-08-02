'use client'

import { History, ExternalLink, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { Editor } from '@tiptap/react'
import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getFileCommits as getGithubFileCommits, getFiles as getGithubFiles, decodeBase64ToString } from '@/lib/sync/github'
import { getFileCommits as getGiteeFileCommits, getFiles as getGiteeFiles, decodeBase64ToString as decodeGiteeBase64 } from '@/lib/sync/gitee'
import { getFileCommits as getGitlabFileCommits, getFileContent as getGitlabFileContent } from '@/lib/sync/gitlab'
import { getFileCommits as getGiteaFileCommits, getFileContentFromCommit as getGiteaFileContentFromCommit, getGiteaApiBaseUrl } from '@/lib/sync/gitea'
import { saveLocalFile } from '@/lib/sync/auto-sync'
import { updateFileSyncTime, updateFileRestoreTime } from '@/lib/sync/conflict-resolution'
import { toast } from '@/hooks/use-toast'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { isMobileDevice } from '@/lib/check'

interface CommitInfo {
  sha: string
  fullSha?: string // Full SHA for restore
  message: string
  author: string
  date: Date
  url: string
}

type SyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

interface HistorySheetProps {
  editor: Editor
}

export function HistorySheet({ editor }: HistorySheetProps) {
  const { activeFilePath } = useArticleStore()
  const [isOpen, setIsOpen] = useState(false)
  const [history, setHistory] = useState<CommitInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [restoringSha, setRestoringSha] = useState<string | null>(null)
  const [provider, setProvider] = useState<SyncProvider | null>(null)
  const [repoInfo, setRepoInfo] = useState<{ username?: string; projectId?: string; baseUrl?: string; repo?: string }>({})
  const isMobile = isMobileDevice()

  // Get the sync provider
  const getProvider = useCallback(async (): Promise<SyncProvider | null> => {
    try {
      const store = await Store.load('store.json')
      const provider = await store.get<string>('primaryBackupMethod') || 'github'
      return provider as SyncProvider
    } catch {
      return null
    }
  }, [])

  // Load history
  const loadHistory = useCallback(async () => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      const provider = await getProvider()
      if (!provider) return

      const repo = await getSyncRepoName(provider)
      let commits: any[] = []

      switch (provider) {
        case 'github': {
          const result = await getGithubFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
        case 'gitee': {
          const result = await getGiteeFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
        case 'gitlab': {
          const result = await getGitlabFileCommits({ path: activeFilePath, repo })
          // GitLab { data } ，
          commits = (result && result.data) ? result.data : []
          break
        }
        case 'gitea': {
          const result = await getGiteaFileCommits({ path: activeFilePath, repo })
          // Gitea { data } ，
          commits = (result && result.data) ? result.data : []
          break
        }
      }

      const store = await Store.load('store.json')
      let githubUsername: string | undefined
      let giteeUsername: string | undefined
      let gitlabProjectId: string | undefined
      let giteaUsername: string | undefined
      let giteaBaseUrl: string | undefined

      switch (provider) {
        case 'github':
          githubUsername = await store.get('githubUsername')
          break
        case 'gitee':
          giteeUsername = await store.get('giteeUsername')
          break
        case 'gitlab':
          gitlabProjectId = await store.get<string>(`gitlab_${repo}_project_id`)
          break
        case 'gitea':
          giteaUsername = await store.get('giteaUsername')
          giteaBaseUrl = await getGiteaApiBaseUrl()
          break
      }

      const getCommitUrl = (sha: string): string => {
        switch (provider) {
          case 'github':
            return `https://github.com/${githubUsername}/${repo}/commit/${sha}`
          case 'gitee':
            return `https://gitee.com/${giteeUsername}/${repo}/commit/${sha}`
          case 'gitlab':
            return `https://gitlab.com/${gitlabProjectId?.split('/').pop()}/-/commit/${sha}`
          case 'gitea':
            return `${giteaBaseUrl?.replace('/api/v1', '')}/${giteaUsername}/${repo}/commit/${sha}`
          default:
            return ''
        }
      }

      const historyData = commits.slice(0, 10).map((commit: any) => {
        const sha = commit.sha || commit.id || ''
        return {
          sha: sha.slice(0, 7),
          fullSha: sha, // Persist full SHA for restore
          message: commit.commit?.message || commit.message || 'No message',
          author: commit.commit?.author?.name || commit.author?.name || commit.author_name || 'Unknown',
          date: new Date(commit.commit?.author?.date || commit.created_at || commit.committed_date || Date.now()),
          url: getCommitUrl(sha)
        }
      })

      setHistory(historyData)
      setProvider(provider)
      setRepoInfo({
        username: provider === 'github' ? githubUsername : provider === 'gitee' ? giteeUsername : provider === 'gitea' ? giteaUsername : undefined,
        projectId: provider === 'gitlab' ? gitlabProjectId : undefined,
        baseUrl: provider === 'gitea' ? giteaBaseUrl : undefined,
        repo
      })
    } catch (error) {
      console.error('Failed to load history:', error)
      toast({
        title: 'Failed to load',
        description: 'None',
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, getProvider])

  // Restore file from specific commit
  const restoreVersion = useCallback(async (commitSha: string) => {
    if (!activeFilePath || restoringSha) return

    setRestoringSha(commitSha)
    try {
      const provider = await getProvider()
      if (!provider) return

      const repo = await getSyncRepoName(provider)
      let content = ''

      switch (provider) {
        case 'github': {
          const fileInfo = await getGithubFiles({ path: activeFilePath, repo, ref: commitSha })
          if (fileInfo?.content) {
            content = decodeBase64ToString(fileInfo.content)
          }
          break
        }
        case 'gitee': {
          const fileInfo = await getGiteeFiles({ path: activeFilePath, repo, ref: commitSha })
          if (fileInfo?.content) {
            // Gitee base64
            content = decodeGiteeBase64(fileInfo.content)
          }
          break
        }
        case 'gitlab': {
          try {
            const fileInfo = await getGitlabFileContent({ path: activeFilePath, ref: commitSha, repo })
            if (fileInfo?.content) {
              // GitLab base64 ，
              content = decodeBase64ToString(fileInfo.content)
            }
          } catch (e) {
            console.error('[HistorySheet] GitLab Failed', e)
          }
          break
        }
        case 'gitea': {
          try {
            // getFileContentFromCommit Git tree API commit
            const fileInfo = await getGiteaFileContentFromCommit({ path: activeFilePath, ref: commitSha, repo })
            if (fileInfo && fileInfo.content) {
              // Gitea base64 ，
              content = decodeGiteeBase64(fileInfo.content)
            }
          } catch (e) {
            console.error('[HistorySheet] Gitea Failed', e)
          }
          break
        }
      }


      if (content) {
        //
        await saveLocalFile(activeFilePath, content)

        //
        editor.commands.clearContent()
        editor.commands.setContent(content, { contentType: 'markdown' })

        //
        await updateFileSyncTime(activeFilePath)
        await updateFileRestoreTime(activeFilePath)

        toast({
          title: 'Restored',
          description: 'File'
        })

        setIsOpen(false)
      }
    } catch (error) {
      console.error('Failed to restore version:', error)
      toast({
        title: 'Restore failed',
        description: 'None File',
        variant: 'destructive'
      })
    } finally {
      setRestoringSha(null)
    }
  }, [activeFilePath, editor, getProvider, restoringSha])

  // Load history when sheet opens
  useEffect(() => {
    if (isOpen && activeFilePath) {
      loadHistory()
    }
  }, [isOpen, activeFilePath, loadHistory])

  if (!activeFilePath) return null

  const trigger = (
    <button
      className={cn(
        'p-0.5 rounded transition-colors hover:bg-[hsl(var(--muted))]',
        isOpen && 'bg-[hsl(var(--muted))]'
      )}
      title="History"
    >
      <History size={14} />
    </button>
  )

  const content = (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-sm">Commit history</div>
        {activeFilePath && provider && repoInfo.repo && (
          <a
            href={(() => {
              switch (provider) {
                case 'github': return `https://github.com/${repoInfo.username}/${repoInfo.repo}/blob/main/${activeFilePath}`
                case 'gitee': return `https://gitee.com/${repoInfo.username}/${repoInfo.repo}/blob/master/${activeFilePath}`
                case 'gitlab': return `https://gitlab.com/${repoInfo.projectId?.split('/').pop()}/-/blob/main/${activeFilePath}`
                case 'gitea': return `${repoInfo.baseUrl?.replace('/api/v1', '')}/${repoInfo.username}/${repoInfo.repo}/src/branch/main/${activeFilePath}`
                default: return '#'
              }
            })()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            title="Open in repository"
          >
            <ExternalLink size={10} />
            <span className="truncate max-w-30">{activeFilePath.split('/').pop()}</span>
          </a>
        )}
      </div>
      <div className="flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            Loading...
          </div>
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No commits yet
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((commit, index) => (
              <li
                key={commit.sha + index}
                className="p-2 border rounded hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <a
                    href={commit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                  >
                    {commit.sha}
                    <ExternalLink size={10} />
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {commit.date.toLocaleString()}
                  </span>
                </div>
                <p className="text-sm truncate" title={commit.message}>
                  {commit.message}
                </p>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-muted-foreground">
                    {commit.author}
                  </p>
                  <button
                    onClick={() => restoreVersion(commit.fullSha || commit.sha)}
                    disabled={restoringSha === commit.sha}
                    className={cn(
                      'text-xs text-blue-500 hover:text-blue-600 inline-flex items-center gap-1',
                      restoringSha === commit.sha && 'opacity-50'
                    )}
                    title="Restore this version"
                  >
                    <RotateCcw size={12} />
                    {restoringSha === commit.sha ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent className="max-h-[80vh] rounded-t-[24px]">
          <DrawerHeader className="pb-2">
            <DrawerTitle>Commit history</DrawerTitle>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 overflow-hidden">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-90 max-h-100 overflow-hidden flex flex-col">
        {content}
      </PopoverContent>
    </Popover>
  )
}

export default HistorySheet
