import { getFiles as getGithubFiles } from '@/lib/sync/github'
import { GithubContent } from '@/lib/sync/github.types'
import { getFiles as getGiteeFiles } from '@/lib/sync/gitee'
import { getFiles as getGiteaFiles } from '@/lib/sync/gitea'
import { getFiles as getGitlabFiles } from '@/lib/sync/gitlab'
import { GiteeFile } from '@/lib/sync/gitee'
import { GiteaDirectoryItem } from '@/lib/sync/gitea.types'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { s3ListObjects } from '@/lib/sync/s3'
import { webdavListObjects } from '@/lib/sync/webdav'
import { S3Config, WebDAVConfig } from '@/types/sync'
import { hasNetworkConnection, ensureDirectoryExists, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { syncOnOpen } from '@/lib/sync/sync-manager'
import { sanitizeFilePath, hasInvalidFileNameChars } from '@/lib/sync/filename-utils'
import { getCurrentFolder, computedParentPath } from '@/lib/path'
import useVectorStore from './vector'
import { join, appDataDir } from '@tauri-apps/api/path'
import { BaseDirectory, DirEntry, exists, mkdir, readDir, readTextFile, writeTextFile, stat } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { cloneDeep, uniq } from 'lodash-es'
import { create } from 'zustand'
import { getFilePathOptions, getWorkspacePath, isAbsoluteFsPath, toWorkspaceRelativePath } from '@/lib/workspace'
import emitter from '@/lib/emitter'
import type { Events } from '@/lib/emitter'
import { isSkillsFolder } from '@/lib/skills/utils'
import { buildVectorIndexedMap, getVectorDocumentKey } from '@/lib/vector-document-key'
import { buildRemotePathsToLoad } from './article-remote-sync'
import { debugSyncPath } from '@/lib/sync/remote-file'
import type { Mark } from '@/db/marks'
import { getRecordTabName } from '@/app/core/main/mark/mark-record-tab'

type SyncPushCompletedEvent = Events['sync-push-completed']
type SyncPushCompletedListener = (event: SyncPushCompletedEvent) => void

type ArticleSyncListenerGlobal = typeof globalThis & {
  __noteGenArticleSyncPushCompletedListener?: SyncPushCompletedListener
}

// Store ，
let storeInstance: Store | null = null
const pendingArticleSaves = new Map<string, {
  timer: ReturnType<typeof setTimeout> | null
  content: string
}>()
let vectorCalculationTimer: ReturnType<typeof setTimeout> | null = null
let pendingVectorCalculation: { path: string; content: string } | null = null
let vectorIndexedFilesInitPromise: Promise<void> | null = null
const remoteFolderLoadPromises = new Map<string, Promise<void>>()
const REMOTE_FOLDER_TIMEOUT_MS = 20_000

async function withRemoteTimeout<T>(promise: Promise<T>, path: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Remote directory request timed out: ${path}`))
        }, REMOTE_FOLDER_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load('store.json')
  }
  return storeInstance
}

async function getCollapsibleStoreKey(): Promise<string> {
  const workspace = await getWorkspacePath()
  return `collapsibleList:${workspace.isCustom ? workspace.path : '__default__'}`
}

async function getWorkspaceStoreKey(name: string): Promise<string> {
  const workspace = await getWorkspacePath()
  return `${name}:${workspace.isCustom ? workspace.path : '__default__'}`
}

export type SortType = 'name' | 'created' | 'modified' | 'none'
export type SortDirection = 'asc' | 'desc'

export interface DirTree extends DirEntry {
  children?: DirTree[]
  childrenLoaded?: boolean
  parent?: DirTree
  sha?: string
  size?: number
  isEditing?: boolean
  isLocale: boolean
  createdAt?: string
  modifiedAt?: string
  loading?: boolean  //
  syncDirty?: boolean
  syncError?: string
  vectorCalcStatus?: 'idle' | 'calculating' | 'completed'  // Status
}

function copyCachedEntry(entry: DirTree, parent?: DirTree): DirTree {
  const copy: DirTree = {
    ...entry,
    parent,
  }
  if (copy.isDirectory) {
    copy.children = (entry.children ?? []).map(child => copyCachedEntry(child, copy))
  }
  return copy
}

function mergeRefreshedLocalEntries(
  localEntries: DirTree[],
  cachedEntries: DirTree[],
  parent?: DirTree
): DirTree[] {
  const cachedByKey = new Map(
    cachedEntries.map(entry => [`${entry.isDirectory ? 'directory' : 'file'}:${entry.name}`, entry])
  )
  const matchedKeys = new Set<string>()

  const mergedLocalEntries = localEntries.map(localEntry => {
    const key = `${localEntry.isDirectory ? 'directory' : 'file'}:${localEntry.name}`
    const cachedEntry = cachedByKey.get(key)
    if (cachedEntry) matchedKeys.add(key)

    const mergedEntry: DirTree = {
      ...cachedEntry,
      ...localEntry,
      parent,
      isLocale: true,
      sha: cachedEntry?.sha ?? localEntry.sha,
      size: cachedEntry?.size ?? localEntry.size,
      createdAt: localEntry.createdAt ?? cachedEntry?.createdAt,
      modifiedAt: localEntry.modifiedAt ?? cachedEntry?.modifiedAt,
      loading: cachedEntry?.loading,
      syncDirty: cachedEntry?.syncDirty,
      syncError: cachedEntry?.syncError,
    }

    if (mergedEntry.isDirectory) {
      if (localEntry.childrenLoaded) {
        mergedEntry.children = mergeRefreshedLocalEntries(
          localEntry.children ?? [],
          cachedEntry?.children ?? [],
          mergedEntry
        )
        mergedEntry.childrenLoaded = true
      } else if (cachedEntry?.childrenLoaded) {
        mergedEntry.children = (cachedEntry.children ?? [])
          .map(child => copyCachedEntry(child, mergedEntry))
        mergedEntry.childrenLoaded = true
      } else {
        mergedEntry.children = []
        mergedEntry.childrenLoaded = false
      }
    } else {
      mergedEntry.children = undefined
      mergedEntry.childrenLoaded = undefined
    }

    return mergedEntry
  })

  const remoteOnlyEntries = cachedEntries
    .filter(entry => !entry.isLocale)
    .filter(entry => !matchedKeys.has(`${entry.isDirectory ? 'directory' : 'file'}:${entry.name}`))
    .map(entry => copyCachedEntry(entry, parent))

  return [...mergedLocalEntries, ...remoteOnlyEntries]
}

export interface Article {
  article: string
  path: string
}

export interface EditorViewState {
  selectionFrom: number
  selectionTo: number
  scrollTop: number
}

export type EditorTabKind = 'file' | 'record' | 'canvas'

export interface OpenTabInfo {
  id: string
  path: string
  name: string
  isFolder: boolean
  kind?: EditorTabKind
  markId?: number
  markType?: Mark['type']
  canvasId?: string
}

const RECORD_TAB_PATH_PREFIX = 'record://mark/'

function isRecordOpenTabPath(path: string): boolean {
  return path.startsWith(RECORD_TAB_PATH_PREFIX)
}

function isCanvasOpenTabPath(path: string): boolean {
  return path.startsWith('canvas://project/')
}

function isRecordOpenTab(tab?: OpenTabInfo | null): boolean {
  return !!tab && (tab.kind === 'record' || isRecordOpenTabPath(tab.path))
}

function getActiveFilePathForTab(tab?: OpenTabInfo | null): string {
  return tab && !isRecordOpenTab(tab) && !isCanvasOpenTabPath(tab.path) ? tab.path : ''
}

//
export const findFolderInTree = (path: string, tree: DirTree[]): DirTree | null => {
  for (const item of tree) {
    const itemPath = computedParentPath(item)
    if (itemPath === path && item.isDirectory) {
      return item
    }
    if (item.children && item.children.length > 0) {
      const found = findFolderInTree(path, item.children)
      if (found) return found
    }
  }
  return null
}

function isLikelyFilePath(path: string): boolean {
  const name = path.split('/').pop() || path
  return name.includes('.')
}

function getFolderPathsToExpand(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  const folderSegments = isLikelyFilePath(path) ? segments.slice(0, -1) : segments

  return folderSegments.map((_, index) => folderSegments.slice(0, index + 1).join('/'))
}

function createLocalTreeNode(name: string, isDirectory: boolean, parent?: DirTree): DirTree {
  return {
    name,
    isDirectory,
    isFile: !isDirectory,
    isSymlink: false,
    children: isDirectory ? [] : undefined,
    parent,
    isEditing: false,
    isLocale: true,
    sha: '',
    createdAt: undefined,
    modifiedAt: undefined,
  }
}

function insertNodeIntoTree(tree: DirTree[], relativePath: string, isDirectory: boolean): boolean {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath

  if (!parentPath) {
    if (tree.some(item => item.name === name)) {
      return true
    }
    tree.unshift(createLocalTreeNode(name, isDirectory))
    return true
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder || !parentFolder.isDirectory) {
    return false
  }

  if (!parentFolder.children) {
    parentFolder.children = []
  }

  if (parentFolder.children.some(item => item.name === name)) {
    return true
  }

  parentFolder.children.unshift(createLocalTreeNode(name, isDirectory, parentFolder))
  return true
}

function removeNodeFromTree(tree: DirTree[], relativePath: string): DirTree | null {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath

  if (!parentPath) {
    const index = tree.findIndex(item => item.name === name)
    if (index === -1) {
      return null
    }
    return tree.splice(index, 1)[0] || null
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder?.children) {
    return null
  }

  const index = parentFolder.children.findIndex(item => item.name === name)
  if (index === -1) {
    return null
  }

  return parentFolder.children.splice(index, 1)[0] || null
}

function attachNodeToTree(tree: DirTree[], relativePath: string, node: DirTree): boolean {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath
  node.name = name

  if (!parentPath) {
    node.parent = undefined
    if (!tree.some(item => item.name === name)) {
      tree.unshift(node)
    }
    return true
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder || !parentFolder.isDirectory) {
    return false
  }

  if (!parentFolder.children) {
    parentFolder.children = []
  }

  node.parent = parentFolder
  if (!parentFolder.children.some(item => item.name === name)) {
    parentFolder.children.unshift(node)
  }
  return true
}

function updateTreeEntryByPath(
  tree: DirTree[],
  relativePath: string,
  updater: (entry: DirTree) => DirTree | null,
  markAncestorsLocal = false
): DirTree[] | null {
  const segments = relativePath.split('/').filter(Boolean)
  if (segments.length === 0) return null

  function updateLevel(items: DirTree[], depth: number, parent?: DirTree): DirTree[] | null {
    const index = items.findIndex(item => item.name === segments[depth])
    if (index === -1) return null

    const current = items[index]
    const nextItems = [...items]
    if (depth === segments.length - 1) {
      const nextEntry = updater(current)
      if (nextEntry) {
        nextItems[index] = { ...nextEntry, parent }
      } else {
        nextItems.splice(index, 1)
      }
      return nextItems
    }

    if (!current.children) return null
    const nextParent: DirTree = {
      ...current,
      isLocale: markAncestorsLocal ? true : current.isLocale,
    }
    const nextChildren = updateLevel(current.children, depth + 1, nextParent)
    if (!nextChildren) return null

    nextParent.children = nextChildren
    nextItems[index] = nextParent
    return nextItems
  }

  return updateLevel(tree, 0)
}

interface NoteState {
  loading: boolean
  setLoading: (loading: boolean) => void

  activeFilePath: string
  setActiveFilePath: (name: string) => void
  selectedFilePaths: string[]
  setSelectedFilePaths: (paths: string[]) => void
  clearSelectedFilePaths: () => void

  // ，
  readFilePath: string
  setReadFilePath: (path: string) => void

  // Tabs for multi-file editing
  openTabs: OpenTabInfo[]
  setOpenTabs: (tabs: OpenTabInfo[]) => void
  activeTabId: string
  setActiveTabId: (id: string) => void
  addTab: (tab: OpenTabInfo) => void
  updateRecordTab: (mark: Mark) => Promise<void>
  removeTab: (id: string) => void
  editorViewStates: Record<string, EditorViewState>
  setEditorViewState: (path: string, state: EditorViewState) => void
  getEditorViewState: (path: string) => EditorViewState | null
  removeEditorViewState: (path: string) => void
  moveEditorViewState: (oldPath: string, newPath: string) => void
  cleanTabsByDeletedFile: (deletedPath: string) => Promise<void>
  cleanTabsByDeletedFolder: (deletedFolderPath: string) => Promise<void>
  clearTabs: () => void

  matchPosition: number | null
  setMatchPosition: (position: number | null) => void
  pendingSearchKeyword: string
  setPendingSearchKeyword: (keyword: string) => void

  html2md: boolean
  initHtml2md: () => Promise<void>
  setHtml2md: (html2md: boolean) => Promise<void>

  showCloudFiles: boolean
  initShowCloudFiles: () => Promise<void>
  setShowCloudFiles: (show: boolean) => Promise<void>
  syncStaticAssets: boolean
  initSyncStaticAssets: () => Promise<void>
  setSyncStaticAssets: (enabled: boolean) => Promise<void>
  showKnowledgeBaseStatus: boolean
  initShowKnowledgeBaseStatus: () => Promise<void>
  setShowKnowledgeBaseStatus: (show: boolean) => Promise<void>

  // Initialize tabs from store
  initOpenTabs: () => Promise<void>

  sortType: SortType
  sortDirection: SortDirection
  initSortSettings: () => Promise<void>
  initEventListeners: () => void
  setSortType: (sortType: SortType) => Promise<void>
  setSortDirection: (direction: SortDirection) => Promise<void>
  sortFileTree: (tree: DirTree[]) => DirTree[]
  updateFileStats: (path: string, tree: DirTree[]) => Promise<DirTree[]>
  loadFileStatsIfNeeded: () => Promise<void>

  fileTree: DirTree[]
  fileTreeLoading: boolean
  fileTreeInitialized: boolean
  setFileTree: (tree: DirTree[]) => void
  setEntryLoading: (relativePath: string, loading: boolean) => boolean
  setEntrySyncError: (relativePath: string, error?: string) => boolean
  markFileRemote: (relativePath: string, sha: string) => boolean
  markFileLocal: (relativePath: string) => boolean
  markFileDirty: (relativePath: string) => boolean
  reconcileLocalFile: (relativePath: string, isPresent: boolean) => boolean
  clearFileRemoteState: (relativePath: string) => boolean
  addFile: (file: DirTree) => void
  ensurePathExpanded: (path: string) => Promise<void>
  insertLocalEntry: (relativePath: string, isDirectory: boolean) => boolean
  removeLocalEntry: (relativePath: string) => boolean
  moveLocalEntry: (oldPath: string, newPath: string) => boolean
  syncOpenTabsForPathChange: (oldPath: string, newPath: string) => Promise<void>
  loadFileTree: (options?: { skipRemoteSync?: boolean }) => Promise<void>
  loadRemoteSyncFiles: () => Promise<void>
  loadCollapsibleFiles: (folderName: string, options?: { force?: boolean; skipRemoteSync?: boolean }) => Promise<void>
  loadFolderRemoteFiles: (folderName: string) => Promise<void>
  newFolder: () => void
  newFile: () => void
  newFileOnFolder: (path: string) => void
  newFolderInFolder: (path: string) => void

  collapsibleList: string[]
  collapsibleListInitialized: boolean
  initCollapsibleList: () => Promise<void>
  setCollapsibleList: (name: string, value: boolean) => Promise<void>
  expandAllFolders: () => Promise<void>
  collapseAllFolders: () => Promise<void>
  toggleAllFolders: () => Promise<void>
  clearCollapsibleList: () => Promise<void>
  loadWorkspaceCollapsibleList: () => Promise<string>

  currentArticle: string
  isPulling: boolean // added：Status
  justPulledFile: boolean // （）
  skipSyncOnSave: boolean // （）
  aiGeneratingFilePath: string | null // AI
  aiTerminateFn: (() => void) | null // AI
  readArticle: (path: string, sha?: string, isLocale?: boolean, autoSync?: boolean) => Promise<void>
  setCurrentArticle: (content: string) => void
  setIsPulling: (pulling: boolean) => void
  setJustPulledFile: (justPulled: boolean) => void
  setSkipSyncOnSave: (skip: boolean) => void
  setAiGeneratingFilePath: (path: string | null) => void
  setAiTerminateFn: (fn: (() => void) | null) => void
  saveCurrentArticle: (content: string, pathOverride?: string) => Promise<void>
  // sha （）
  updateFileSha: (path: string, sha: string) => void

  //
  isVectorCalculating: boolean
  scheduleVectorCalculation: (path: string, content: string) => void
  executeVectorCalculation: (options?: { force?: boolean }) => Promise<void>
  cancelVectorCalculation: () => void
  triggerVectorCalculation: () => Promise<void> //
  //
  vectorIndexedFiles: Map<string, number> // ->
  checkFileVectorIndexed: (filePath: string) => Promise<boolean>
  clearFileVector: (filePath: string) => Promise<void>
  initVectorIndexedFiles: () => Promise<void> // Status
  //
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => void

  allArticle: Article[]
  loadAllArticle: () => Promise<void>
}

const useArticleStore = create<NoteState>((set, get) => ({
  loading: false,

  setLoading: (loading: boolean) => { set({ loading }) },

  sortType: 'none',
  sortDirection: 'asc',
  initSortSettings: async () => {
    const store = await getStore()
    const sortType = await store.get<SortType>('sortType')
    const sortDirection = await store.get<SortDirection>('sortDirection')
    if (sortType) set({ sortType })
    if (sortDirection) set({ sortDirection })

    // ，
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }

    //
    get().initEventListeners()
  },

  //
  initEventListeners: () => {
    const globalState = globalThis as ArticleSyncListenerGlobal
    if (globalState.__noteGenArticleSyncPushCompletedListener) {
      emitter.off('sync-push-completed', globalState.__noteGenArticleSyncPushCompletedListener)
    }

    // ， sha
    const syncPushCompletedListener: SyncPushCompletedListener = (event) => {
      const { path, success, sha } = event
      debugSyncPath('article.syncPushCompleted', {
        path,
        success,
        sha,
        hasSha: Boolean(sha),
      })
      if (success && sha) {
        get().updateFileSha(path, sha)
      }
    }

    emitter.on('sync-push-completed', syncPushCompletedListener)
    globalState.__noteGenArticleSyncPushCompletedListener = syncPushCompletedListener
  },
  setSortType: async (sortType: SortType) => {
    set({ sortType })
    const store = await getStore()
    await store.set('sortType', sortType)
    
    // ，
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  setSortDirection: async (direction: SortDirection) => {
    set({ sortDirection: direction })
    const store = await getStore()
    await store.set('sortDirection', direction)
    
    // ，
    const sortType = get().sortType
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  
  sortFileTree: (tree: DirTree[]) => {
    const sortType = get().sortType
    const sortDirection = get().sortDirection

    // ，
    const sortedTree = cloneDeep(tree)

    // skills （， sortType 'none' ）
    const sortFunction = (a: DirTree, b: DirTree) => {
      const aIsSkills = a.isDirectory && isSkillsFolder(a.name)
      const bIsSkills = b.isDirectory && isSkillsFolder(b.name)
      if (aIsSkills && !bIsSkills) return -1
      if (!aIsSkills && bIsSkills) return 1

      // 'none'， skills ，
      if (sortType === 'none') {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return 0
      }

      //
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      //
      let result = 0
      switch (sortType) {
        case 'name':
          result = a.name.localeCompare(b.name)
          break
        case 'created':
          if (a.createdAt && b.createdAt) {
            result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        case 'modified':
          if (a.modifiedAt && b.modifiedAt) {
            result = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        default:
          result = 0
      }
      return sortDirection === 'asc' ? result : -result
    }

    sortedTree.sort(sortFunction)

    const sortChildren = (items: DirTree[]) => {
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          item.children.sort(sortFunction)
          sortChildren(item.children)
        }
      }
    }

    sortChildren(sortedTree)
    return sortedTree
  },

  activeFilePath: '',
  setActiveFilePath: async (path: string) => {
    const nextPath = isRecordOpenTabPath(path) || isCanvasOpenTabPath(path) ? '' : path
    // ， currentArticle，
    set({ currentArticle: '', activeFilePath: nextPath, selectedFilePaths: [] })
    const store = await getStore();
    await store.set('activeFilePath', nextPath)
    await store.set(await getWorkspaceStoreKey('activeFilePath'), nextPath)
    // ，
    emitter.emit('article-opened', { path: nextPath })

    // （）
    //
    const fileName = nextPath.split('/').pop() || ''
    if (fileName && fileName.includes('.')) {
      get().readArticle(nextPath)
    }
  },
  selectedFilePaths: [],
  setSelectedFilePaths: (paths: string[]) => {
    const nextPaths = Array.from(new Set(paths))
    set((state) => {
      const isSameSelection = state.selectedFilePaths.length === nextPaths.length
        && state.selectedFilePaths.every((path, index) => path === nextPaths[index])

      return isSameSelection ? state : { selectedFilePaths: nextPaths }
    })
  },
  clearSelectedFilePaths: () => {
    set((state) => state.selectedFilePaths.length === 0 ? state : { selectedFilePaths: [] })
  },

  // Tabs initialization - load from store
  openTabs: [],
  activeTabId: '',
  editorViewStates: {},
  setOpenTabs: async (tabs) => {
    const keptPaths = new Set(tabs.map(tab => tab.path))
    const nextEditorViewStates = Object.fromEntries(
      Object.entries(get().editorViewStates).filter(([path]) => keptPaths.has(path))
    )
    set({ openTabs: tabs, editorViewStates: nextEditorViewStates })
    const store = await getStore();
    await store.set('openTabs', tabs)
  },
  setActiveTabId: async (id) => {
    set({ activeTabId: id })
    const store = await getStore();
    await store.set('activeTabId', id)
  },
  addTab: async (tab) => {
    const currentTabs = get().openTabs
    // Check if tab already exists
    const existingTab = currentTabs.find(t => t.path === tab.path)
    if (existingTab) {
      await get().setActiveTabId(existingTab.id)
      return
    }
    const newTabs = [...currentTabs, tab].slice(-10) // Limit to 10 tabs
    set({ openTabs: newTabs, activeTabId: tab.id })
    const store = await getStore();
    await store.set('openTabs', newTabs)
    await store.set('activeTabId', tab.id)
  },
  updateRecordTab: async (mark) => {
    const currentTabs = get().openTabs
    const newTabs = currentTabs.map((tab) => {
      const isSameRecord = tab.markId === mark.id || tab.path === `${RECORD_TAB_PATH_PREFIX}${mark.id}`

      if (!isSameRecord) {
        return tab
      }

      return {
        ...tab,
        name: getRecordTabName(mark, mark.type),
        markType: mark.type,
      }
    })

    if (newTabs === currentTabs || newTabs.every((tab, index) => tab === currentTabs[index])) {
      return
    }

    set({ openTabs: newTabs })
    const store = await getStore()
    await store.set('openTabs', newTabs)
  },
  removeTab: async (id) => {
    const currentTabs = get().openTabs
    const removedTab = currentTabs.find(t => t.id === id)
    const newTabs = currentTabs.filter(t => t.id !== id)
    const nextEditorViewStates = { ...get().editorViewStates }
    if (removedTab) {
      delete nextEditorViewStates[removedTab.path]
    }
    set({ openTabs: newTabs, editorViewStates: nextEditorViewStates })
    const store = await getStore();
    await store.set('openTabs', newTabs)
  },
  setEditorViewState: (path, state) => {
    if (!path) {
      return
    }
    set(current => ({
      editorViewStates: {
        ...current.editorViewStates,
        [path]: state,
      }
    }))
  },
  getEditorViewState: (path) => {
    if (!path) {
      return null
    }
    return get().editorViewStates[path] || null
  },
  removeEditorViewState: (path) => {
    if (!path) {
      return
    }
    const nextEditorViewStates = { ...get().editorViewStates }
    delete nextEditorViewStates[path]
    set({ editorViewStates: nextEditorViewStates })
  },
  moveEditorViewState: (oldPath, newPath) => {
    if (!oldPath || !newPath || oldPath === newPath) {
      return
    }
    const currentState = get().editorViewStates[oldPath]
    if (!currentState) {
      return
    }
    const nextEditorViewStates = { ...get().editorViewStates }
    delete nextEditorViewStates[oldPath]
    nextEditorViewStates[newPath] = currentState
    set({ editorViewStates: nextEditorViewStates })
  },

  // tabs（）
  cleanTabsByDeletedFile: async (deletedPath: string) => {
    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const currentActiveFilePath = get().activeFilePath
    const newTabs = currentTabs.filter(t => t.path !== deletedPath)
    const nextSelectedFilePaths = get().selectedFilePaths.filter(path => path !== deletedPath)
    const deletedTab = currentTabs.find(t => t.path === deletedPath)
    const tabsChanged = newTabs.length !== currentTabs.length

    let newActiveTabId = currentActiveTabId
    let newActiveFilePath = currentActiveFilePath
    if (deletedTab && currentActiveTabId === deletedTab.id && newTabs.length > 0) {
      const targetTab = newTabs[newTabs.length - 1]
      newActiveTabId = targetTab.id
      newActiveFilePath = getActiveFilePathForTab(targetTab)
    } else if (deletedTab && currentActiveTabId === deletedTab.id) {
      newActiveTabId = ''
      newActiveFilePath = ''
    } else if (currentActiveFilePath === deletedPath) {
      newActiveFilePath = ''
    }

    const activeChanged = newActiveTabId !== currentActiveTabId
      || newActiveFilePath !== currentActiveFilePath
    const selectionChanged = nextSelectedFilePaths.length !== get().selectedFilePaths.length
    if (!tabsChanged && !activeChanged && !selectionChanged) return

    const nextEditorViewStates = { ...get().editorViewStates }
    delete nextEditorViewStates[deletedPath]
    set({
      openTabs: newTabs,
      activeTabId: newActiveTabId,
      activeFilePath: newActiveFilePath,
      selectedFilePaths: nextSelectedFilePaths,
      currentArticle: activeChanged ? '' : get().currentArticle,
      editorViewStates: nextEditorViewStates,
    })

    const store = await getStore()
    if (tabsChanged) {
      await store.set('openTabs', newTabs)
    }
    if (activeChanged) {
      await store.set('activeTabId', newActiveTabId)
      await store.set('activeFilePath', newActiveFilePath)
      await store.set(await getWorkspaceStoreKey('activeFilePath'), newActiveFilePath)
    }
  },

  // tabs（ tabs）
  cleanTabsByDeletedFolder: async (deletedFolderPath: string) => {
    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const currentActiveFilePath = get().activeFilePath
    const folderPrefix = deletedFolderPath.endsWith('/') ? deletedFolderPath : deletedFolderPath + '/'
    const newTabs = currentTabs.filter(t => !t.path.startsWith(folderPrefix))

    // ，
    if (newTabs.length !== currentTabs.length) {
      // tab， tab
      const deletedTab = currentTabs.find(t => t.path.startsWith(folderPrefix))
      let newActiveTabId = currentActiveTabId
      let newActiveFilePath = currentActiveFilePath

      if (deletedTab && currentActiveTabId === deletedTab.id && newTabs.length > 0) {
        // tab
        const targetTab = newTabs[newTabs.length - 1]
        newActiveTabId = targetTab.id
        newActiveFilePath = getActiveFilePathForTab(targetTab)
      } else if (deletedTab && currentActiveTabId === deletedTab.id) {
        // tab
        newActiveTabId = ''
        newActiveFilePath = ''
      }

      const nextEditorViewStates = { ...get().editorViewStates }
      Object.keys(nextEditorViewStates).forEach(path => {
        if (path.startsWith(folderPrefix)) {
          delete nextEditorViewStates[path]
        }
      })
      set({ openTabs: newTabs, activeTabId: newActiveTabId, activeFilePath: newActiveFilePath, currentArticle: '', editorViewStates: nextEditorViewStates })
      const store = await getStore();
      await store.set('openTabs', newTabs)
      await store.set('activeTabId', newActiveTabId)
      await store.set('activeFilePath', newActiveFilePath)
    }
  },

  clearTabs: async () => {
    set({ openTabs: [], activeTabId: '', editorViewStates: {} })
    const store = await getStore();
    await store.set('openTabs', [])
    await store.set('activeTabId', '')
  },

  matchPosition: null,
  setMatchPosition: (position: number | null) => {
    set({ matchPosition: position })
  },
  pendingSearchKeyword: '',
  setPendingSearchKeyword: (keyword: string) => {
    set({ pendingSearchKeyword: keyword })
  },

  html2md: false,
  initHtml2md: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('html2md')
    set({ html2md: res || false })
  },
  setHtml2md: async (html2md: boolean) => {
    set({ html2md })
    const store = await getStore();
    store.set('html2md', html2md)
  },

  showCloudFiles: true,
  initShowCloudFiles: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('showCloudFiles')
    set({ showCloudFiles: res ?? true })
  },

  // Initialize open tabs from store
  initOpenTabs: async () => {
    const store = await getStore();
    const tabs = await store.get<OpenTabInfo[]>('openTabs')
    const activeTabId = await store.get<string>('activeTabId')
    const nextTabs = tabs || []
    const nextActiveTabId = activeTabId || ''
    const activeTab = nextTabs.find(tab => tab.id === nextActiveTabId)
    const nextActiveFilePath = getActiveFilePathForTab(activeTab)

    set({
      openTabs: nextTabs,
      activeTabId: nextActiveTabId,
      activeFilePath: nextActiveFilePath,
      currentArticle: '',
    })

    await store.set('activeFilePath', nextActiveFilePath)

    if (nextActiveFilePath && isLikelyFilePath(nextActiveFilePath)) {
      get().readArticle(nextActiveFilePath)
    }
  },
  setShowCloudFiles: async (show: boolean) => {
    set({ showCloudFiles: show })
    const store = await getStore();
    await store.set('showCloudFiles', show)
  },
  syncStaticAssets: true,
  initSyncStaticAssets: async () => {
    const store = await getStore()
    const enabled = await store.get<boolean>('syncStaticAssets')
    set({ syncStaticAssets: enabled ?? true })
  },
  setSyncStaticAssets: async (enabled: boolean) => {
    set({ syncStaticAssets: enabled })
    const store = await getStore()
    await store.set('syncStaticAssets', enabled)
  },
  showKnowledgeBaseStatus: true,
  initShowKnowledgeBaseStatus: async () => {
    const store = await getStore()
    const show = await store.get<boolean>('showKnowledgeBaseStatus')
    set({ showKnowledgeBaseStatus: show ?? true })
  },
  setShowKnowledgeBaseStatus: async (show: boolean) => {
    set({ showKnowledgeBaseStatus: show })
    const store = await getStore()
    await store.set('showKnowledgeBaseStatus', show)
  },

  fileTree: [],
  fileTreeInitialized: false,
  setFileTree: (tree: DirTree[]) => {
    const sortedTree = get().sortFileTree(tree)
    set({ fileTree: sortedTree, fileTreeInitialized: true })
  },
  setEntryLoading: (relativePath: string, loading: boolean) => {
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => ({
      ...entry,
      loading: loading || undefined,
    }))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  setEntrySyncError: (relativePath: string, error?: string) => {
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => ({
      ...entry,
      syncError: error,
    }))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  markFileRemote: (relativePath: string, sha: string) => {
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => {
      if (!entry.isFile) return entry
      return {
        ...entry,
        sha,
        syncDirty: false,
        syncError: undefined,
      }
    })
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  markFileLocal: (relativePath: string) => {
    const nextTree = updateTreeEntryByPath(
      get().fileTree,
      relativePath,
      entry => entry.isFile
        ? { ...entry, isLocale: true, loading: undefined }
        : entry,
      true
    )
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  markFileDirty: (relativePath: string) => {
    const current = getCurrentFolder(relativePath, get().fileTree)
    if (!current?.isFile || !current.sha || current.syncDirty) return false
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => ({
      ...entry,
      syncDirty: true,
    }))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  reconcileLocalFile: (relativePath: string, isPresent: boolean) => {
    const currentTree = get().fileTree
    const current = getCurrentFolder(relativePath, currentTree)

    if (isPresent) {
      if (current) {
        if (!current.isFile) return false
        return get().markFileLocal(relativePath)
      }
      return get().insertLocalEntry(relativePath, false)
    }

    if (!current) return true
    if (!current.isFile) return false

    if (current.sha) {
      const nextTree = updateTreeEntryByPath(currentTree, relativePath, entry => ({
        ...entry,
        isLocale: false,
        loading: undefined,
        syncDirty: false,
      }))
      if (!nextTree) return false
      set({ fileTree: nextTree })
      return true
    }

    return get().removeLocalEntry(relativePath)
  },
  clearFileRemoteState: (relativePath: string) => {
    const current = getCurrentFolder(relativePath, get().fileTree)
    if (!current?.isFile) return false

    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => (
      entry.isLocale
        ? {
            ...entry,
            sha: undefined,
            loading: undefined,
            syncDirty: false,
            syncError: undefined,
          }
        : null
    ))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  addFile: (file: DirTree) => {
    set({ fileTree: [file, ...get().fileTree] })
  },
  ensurePathExpanded: async (path: string) => {
    const folderPaths = getFolderPathsToExpand(path)
    if (folderPaths.length === 0) {
      return
    }

    const collapsibleList = uniq([...get().collapsibleList, ...folderPaths])
    const store = await getStore()
    await store.set('collapsibleList', collapsibleList)
    set({ collapsibleList })
  },
  insertLocalEntry: (relativePath: string, isDirectory: boolean) => {
    const cacheTree = cloneDeep(get().fileTree)
    const inserted = insertNodeIntoTree(cacheTree, relativePath, isDirectory)

    if (!inserted) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  removeLocalEntry: (relativePath: string) => {
    const cacheTree = cloneDeep(get().fileTree)
    const removed = removeNodeFromTree(cacheTree, relativePath)

    if (!removed) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  moveLocalEntry: (oldPath: string, newPath: string) => {
    const cacheTree = cloneDeep(get().fileTree)
    const removedNode = removeNodeFromTree(cacheTree, oldPath)

    if (!removedNode) {
      return false
    }

    const attached = attachNodeToTree(cacheTree, newPath, removedNode)
    if (!attached) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  syncOpenTabsForPathChange: async (oldPath: string, newPath: string) => {
    const mapMovedPath = (path: string) => {
      if (path === oldPath) {
        return newPath
      }

      if (path.startsWith(`${oldPath}/`)) {
        return `${newPath}${path.slice(oldPath.length)}`
      }

      return path
    }

    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const newTabs = currentTabs.map(tab => {
      if (isRecordOpenTab(tab)) {
        return tab
      }

      const nextPath = mapMovedPath(tab.path)
      if (nextPath === tab.path) {
        return tab
      }

      return {
        ...tab,
        path: nextPath,
        name: nextPath.split('/').pop() || nextPath,
      }
    })

    const nextActiveTabId = currentTabs.some(tab => mapMovedPath(tab.path) !== tab.path)
      ? currentActiveTabId
      : get().activeTabId

    const nextEditorViewStates = Object.entries(get().editorViewStates).reduce<Record<string, EditorViewState>>((states, [path, viewState]) => {
      states[mapMovedPath(path)] = viewState
      return states
    }, {})

    set({ openTabs: newTabs, activeTabId: nextActiveTabId, editorViewStates: nextEditorViewStates })
    const store = await getStore()
    await store.set('openTabs', newTabs)
    await store.set('activeTabId', nextActiveTabId)
  },
  fileTreeLoading: false,
  updateFileStats: async (basePath: string, tree: DirTree[]) => {
    const workspace = await getWorkspacePath()
    
    for (const entry of tree) {
      // （）
      if (entry.isFile && entry.isLocale) {
        const filePath = await join(basePath, entry.name)
        try {
          let fileStat
          if (workspace.isCustom) {
            // ，
            fileStat = await stat(filePath)
          } else {
            // ，AppData
            const relPath = await toWorkspaceRelativePath(filePath)
            const pathOptions = await getFilePathOptions(relPath)
            fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          entry.createdAt = fileStat.birthtime?.toISOString()
          entry.modifiedAt = fileStat.mtime?.toISOString()
          entry.size = fileStat.size
        } catch {
          // ，
        }
      } else if (entry.isDirectory && entry.children) {
        const dirPath = await join(basePath, entry.name)
        await get().updateFileStats(dirPath, entry.children)
      }
    }
    return tree
  },
  
  // （）
  loadFileStatsIfNeeded: async () => {
    const fileTree = get().fileTree
    
    // （）
    const hasStats = fileTree.some(entry => 
      entry.isFile && (entry.createdAt !== undefined || entry.modifiedAt !== undefined)
    )
    
    if (hasStats) {
      // ，
      return
    }
    
    //
    const workspace = await getWorkspacePath()
    //
    const basePath = workspace.isCustom ? workspace.path : await join(await appDataDir(), 'article')
    await get().updateFileStats(basePath, fileTree)
    set({ fileTree: [...fileTree] }) //
  },
  
  loadFileTree: async (options) => {
    set({ fileTreeLoading: true })
    const cachedTree = get().fileTree
    // ；。
    void get().initVectorIndexedFiles()

    // collapsibleList
    if (!get().collapsibleListInitialized) {
      await get().initCollapsibleList()
    }

    //
    const workspace = await getWorkspacePath()
    
    //
    if (workspace.isCustom) {
      //
      const isWorkspaceExists = await exists(workspace.path)
      if (!isWorkspaceExists) {
        await mkdir(workspace.path)
      }
    } else {
      //
      const isArticleDir = await exists('article', { baseDir: BaseDirectory.AppData })
      if (!isArticleDir) {
        await mkdir('article', { baseDir: BaseDirectory.AppData })
      }
    }

    // （）
    let dirs: DirTree[] = []
    if (workspace.isCustom) {
      //
      dirs = (await readDir(workspace.path))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined,
          childrenLoaded: file.isDirectory ? false : undefined
        }))
    } else {
      //
      dirs = (await readDir('article', { baseDir: BaseDirectory.AppData }))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined,
          childrenLoaded: file.isDirectory ? false : undefined
        }))
    }
    
    //
    const collapsibleList = get().collapsibleList
    if (collapsibleList.length > 0) {
      //
      const rootExpandedFolders = dirs.filter(dir => dir.isDirectory && collapsibleList.includes(dir.name))
      for (const folder of rootExpandedFolders) {
        await loadFolderChildren(workspace, folder)
      }
    }
    
    //
    async function loadFolderChildren(workspace: any, folder: DirTree, parentPath: string = '') {
      const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name
      const fullPath = await join(workspace.path, folderPath)
      
      let children: DirTree[] = []
      
      //
      let dirExists = false
      try {
        if (workspace.isCustom) {
          dirExists = await exists(fullPath)
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
      } catch {
        dirExists = false
      }
      
      // ，
      if (dirExists) {
        try {
          if (workspace.isCustom) {
            children = (await readDir(fullPath))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined,
                childrenLoaded: file.isDirectory ? false : undefined
              })) as DirTree[]
          } else {
            const dirRelative = await toWorkspaceRelativePath(fullPath)
            const pathOptions = await getFilePathOptions(dirRelative)
            children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined,
                childrenLoaded: file.isDirectory ? false : undefined
              })) as DirTree[]
          }
        } catch {
          // ，
        }
      }
      
      folder.children = children
      folder.childrenLoaded = true
      
      //
      for (const child of children) {
        if (child.isDirectory && collapsibleList.includes(`${folderPath}/${child.name}`)) {
          await loadFolderChildren(workspace, child, folderPath)
        }
      }
    }
        
    //
    const sortedDirs = get().sortFileTree(
      mergeRefreshedLocalEntries(dirs, cachedTree)
    )
    set({
      fileTree: sortedDirs,
      fileTreeInitialized: true,
      fileTreeLoading: false,
    })

    // （）
    if (!options?.skipRemoteSync) {
      void get().loadRemoteSyncFiles().catch(() => undefined)
    }
  },
  
  // （）
  loadRemoteSyncFiles: async () => {
    try {
      const store = await getStore();
      const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
      
      if (primaryBackupMethod === 'github') {
        const accessToken = await store.get<string>('accessToken')
        if (!accessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitee') {
        const giteeAccessToken = await store.get<string>('giteeAccessToken')
        if (!giteeAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitlab') {
        const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
        if (!gitlabAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitea') {
        const giteaAccessToken = await store.get<string>('giteaAccessToken')
        if (!giteaAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 's3') {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) {
          return
        }
      } else if (primaryBackupMethod === 'webdav') {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) {
          return
        }
      }

    // 。
    // ，，。
    const collapsibleList = get().collapsibleList
    const pathsToLoad = buildRemotePathsToLoad(collapsibleList)
    let firstRemoteLoadError: unknown
    
    // ，。
    // ，。
    for (const path of pathsToLoad) {
      try {
        let files;
        switch (primaryBackupMethod) {
          case 'github':
            const githubRepo = await getSyncRepoName('github');
            files = await withRemoteTimeout(getGithubFiles({ path, repo: githubRepo }), path);
            break;
          case 'gitee':
            const giteeRepo = await getSyncRepoName('gitee');
            files = await withRemoteTimeout(getGiteeFiles({ path, repo: giteeRepo }), path);
            break;
          case 'gitlab':
            const gitlabRepo = await getSyncRepoName('gitlab');
            files = await withRemoteTimeout(getGitlabFiles({ path, repo: gitlabRepo }), path);
            break;
          case 'gitea':
            const giteaRepo = await getSyncRepoName('gitea');
            files = await withRemoteTimeout(getGiteaFiles({ path, repo: giteaRepo }), path);
            break;
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (s3Config) {
              files = await withRemoteTimeout(s3ListObjects(s3Config, path), path)
            }
            break;
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (webdavConfig) {
              files = await withRemoteTimeout(webdavListObjects(webdavConfig, path), path)
            }
            break;
          }
        }

        if (files) {
          const dirs = get().fileTree

          // S3 WebDAV
          if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') {
            const s3Files = files as Array<{ key: string; etag: string; lastModified: string; size: number }>
            let prefix = ''
            if (primaryBackupMethod === 's3') {
              const config = await store.get<S3Config>('s3SyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            } else {
              const config = await store.get<WebDAVConfig>('webdavSyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            }
            const fullPrefix = prefix ? `${prefix}/${path}` : path

            s3Files.forEach((file) => {
              const fileName = file.key.split('/').pop() || file.key
              if (fileName.startsWith('.')) {
                return;
              }

              //
              const relativePath = fullPrefix ? file.key.substring(fullPrefix.length + 1) : file.key
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return
              }

              const isDirectory = file.key.endsWith('/')

              // pathPrefix ，
              let localItemPath = file.key
              if (prefix && localItemPath.startsWith(prefix + '/')) {
                localItemPath = localItemPath.substring(prefix.length + 1)
              }

              let currentFolder: DirTree | undefined
              if (isDirectory) {
                currentFolder = getCurrentFolder(localItemPath, dirs)?.parent
              } else {
                const filePath = localItemPath.split('/').slice(0, -1).join('/')
                currentFolder = getCurrentFolder(filePath, dirs)
              }

              if (localItemPath.includes('/')) {
                const index = currentFolder?.children?.findIndex(item => item.name === fileName)
                if (index !== -1 && index !== undefined && currentFolder?.children) {
                  currentFolder.children[index].sha = file.etag
                  currentFolder.children[index].size = file.size
                  currentFolder.children[index].modifiedAt = file.lastModified
                } else {
                  currentFolder?.children?.push({
                    name: fileName,
                    isFile: !isDirectory,
                    isSymlink: false,
                    parent: currentFolder,
                    isEditing: false,
                    isDirectory: isDirectory,
                    sha: file.etag,
                    size: file.size,
                    isLocale: false,
                    modifiedAt: file.lastModified,
                    children: isDirectory ? [] : undefined
                  })
                }
              } else {
                const index = dirs.findIndex(item => item.name === fileName)
                if (index !== -1 && index !== undefined) {
                  dirs[index].sha = file.etag
                  dirs[index].size = file.size
                  dirs[index].modifiedAt = file.lastModified
                } else {
                  (dirs as any).push({
                    name: fileName,
                    isFile: !isDirectory,
                    isSymlink: false,
                    parent: undefined,
                    isEditing: false,
                    isDirectory: isDirectory,
                    sha: file.etag,
                    size: file.size,
                    isLocale: false,
                    modifiedAt: file.lastModified,
                    children: isDirectory ? [] : undefined
                  })
                }
              }
            })
          } else {
            // Git
            files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
              // "."
              if (file.name.startsWith('.')) {
                return;
              }

              // ，
              const relativePath = path ? file.path.substring(path.length + 1) : file.path
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return //
              }

              const itemPath = file.path;
              let currentFolder: DirTree | undefined
              if (file.type === 'dir') {
                currentFolder = getCurrentFolder(itemPath, dirs)?.parent
              } else {
                const filePath = itemPath.split('/').slice(0, -1).join('/')
                currentFolder = getCurrentFolder(filePath, dirs)
              }
              if (itemPath.includes('/')) {
                const index = currentFolder?.children?.findIndex(item => item.name === file.name)
                if (index !== -1 && index !== undefined && currentFolder?.children) {
                  currentFolder.children[index].sha = file.sha
                  currentFolder.children[index].size = (file as any).size
                } else {
                  currentFolder?.children?.push({
                    name: file.name,
                    isFile: file.type === 'file',
                    isSymlink: false,
                    parent: currentFolder,
                    isEditing: false,
                    isDirectory: file.type === 'dir',
                    sha: file.sha,
                    size: (file as any).size,
                    isLocale: false,
                    children: file.type === 'dir' ? [] : undefined
                  })
                }
              } else {
                const index = dirs.findIndex(item => item.name === file.name)
                if (index !== -1 && index !== undefined) {
                  dirs[index].sha = file.sha
                  dirs[index].size = (file as any).size
                } else {
                  (dirs as any).push({
                    name: file.name,
                    isFile: file.type === 'file',
                    isSymlink: false,
                    parent: undefined,
                    isEditing: false,
                    isDirectory: file.type === 'dir',
                    sha: file.sha,
                    size: (file as any).size,
                    isLocale: false,
                    children: file.type === 'dir' ? [] : undefined
                  })
                }
              }
            });
          }
          set({ fileTree: [...dirs] })
        }
      } catch (error) {
        firstRemoteLoadError ??= error
      }
    }
    if (firstRemoteLoadError) throw firstRemoteLoadError
  } catch (error) {
    throw error
  }
},
  // （）
  loadCollapsibleFiles: async (fullpath: string, options?: { force?: boolean; skipRemoteSync?: boolean }) => {
    const cacheTree: DirTree[] = get().fileTree
    const currentFolder = getCurrentFolder(fullpath, cacheTree)

    if (!currentFolder) {
      return
    }

    // （）
    if (!currentFolder.isDirectory) {
      return
    }

    // ，
    if (!options?.force && currentFolder.childrenLoaded) {
      //
      if (!options?.skipRemoteSync) {
        void get().loadFolderRemoteFiles(fullpath).catch(() => undefined)
      }
      return
    }
    
    //
    const workspace = await getWorkspacePath()
    const fullFolderPath = await join(workspace.path, fullpath)
    
    let children: DirTree[] = []
    
    //
    let dirExists = false
    try {
      if (workspace.isCustom) {
        dirExists = await exists(fullFolderPath)
      } else {
        const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
        const pathOptions = await getFilePathOptions(dirRelative)
        dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      dirExists = false
    }
    
    // ，
    if (dirExists) {
      try {
        if (workspace.isCustom) {
          children = (await readDir(fullFolderPath))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.'))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined,
              childrenLoaded: file.isDirectory ? false : undefined
            })) as DirTree[]
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.'))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined,
              childrenLoaded: file.isDirectory ? false : undefined
            })) as DirTree[]
        }
      } catch {
        // ，
      }
    }

    // ，，
    // 。
    currentFolder.children = get().sortFileTree(
      mergeRefreshedLocalEntries(children, currentFolder.children ?? [], currentFolder)
    )
    currentFolder.childrenLoaded = true
    set({ fileTree: [...cacheTree] })
    
    // （）
    //
    if (!options?.skipRemoteSync) {
      void get().loadFolderRemoteFiles(fullpath).catch(() => undefined)
    }
  },
  
  // （）
  loadFolderRemoteFiles: async (fullpath: string) => {
    const pending = remoteFolderLoadPromises.get(fullpath)
    if (pending) return pending

    const task = (async () => {
    const store = await getStore();
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    //
    if (primaryBackupMethod === 'github') {
      const accessToken = await store.get<string>('accessToken')
      if (!accessToken) return
    } else if (primaryBackupMethod === 'gitee') {
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      if (!giteeAccessToken) return
    } else if (primaryBackupMethod === 'gitlab') {
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      if (!gitlabAccessToken) return
    } else if (primaryBackupMethod === 'gitea') {
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      if (!giteaAccessToken) return
    } else if (primaryBackupMethod === 's3') {
      const s3Config = await store.get<S3Config>('s3SyncConfig')
      if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) return
    } else if (primaryBackupMethod === 'webdav') {
      const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) return
    }

    // loading 。（）
    // 。
    const loadingTree = get().fileTree
    const loadingFolder = getCurrentFolder(fullpath, loadingTree)
    if (loadingFolder && !loadingFolder.loading) {
      loadingFolder.loading = true
      set({ fileTree: [...loadingTree] })
    }

    try {
      let files;
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo1 = await getSyncRepoName('github');
          files = await withRemoteTimeout(
            getGithubFiles({ path: fullpath, repo: githubRepo1 }),
            fullpath
          );
          break;
        case 'gitee':
          const giteeRepo1 = await getSyncRepoName('gitee');
          files = await withRemoteTimeout(
            getGiteeFiles({ path: fullpath, repo: giteeRepo1 }),
            fullpath
          );
          break;
        case 'gitlab':
          const gitlabRepo1 = await getSyncRepoName('gitlab');
          files = await withRemoteTimeout(
            getGitlabFiles({ path: fullpath, repo: gitlabRepo1 }),
            fullpath
          );
          break;
        case 'gitea':
          const giteaRepo1 = await getSyncRepoName('gitea');
          files = await withRemoteTimeout(
            getGiteaFiles({ path: fullpath, repo: giteaRepo1 }),
            fullpath
          );
          break;
        case 's3': {
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          if (s3Config) {
            files = await withRemoteTimeout(s3ListObjects(s3Config, fullpath), fullpath)
          }
          break;
        }
        case 'webdav': {
          const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
          if (webdavConfig) {
            files = await withRemoteTimeout(webdavListObjects(webdavConfig, fullpath), fullpath)
          }
          break;
        }
      }

      if (files) {
        const cacheTree = get().fileTree
        const currentFolder = getCurrentFolder(fullpath, cacheTree)

        if (currentFolder) {
          // S3 WebDAV ，
          if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') {
            const s3Files = files as Array<{ key: string; etag: string; lastModified: string; size: number }>
            let prefix = ''
            if (primaryBackupMethod === 's3') {
              const config = await store.get<S3Config>('s3SyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            } else {
              const config = await store.get<WebDAVConfig>('webdavSyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            }
            const fullPrefix = prefix ? `${prefix}/${fullpath}` : fullpath

            s3Files.forEach((file) => {
              // （key ）
              const fileName = file.key.split('/').pop() || file.key
              // "."
              if (fileName.startsWith('.')) {
                return;
              }

              // ，
              // : fullPrefix='test', file.key='test/file.md' →
              // fullPrefix='test', file.key='test/sub/file.md' →
              const relativePath = fullPrefix ? file.key.substring(fullPrefix.length + 1) : file.key
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return //
              }

              // S3 ， key / ""
              const isDirectory = file.key.endsWith('/')

              const index = currentFolder.children?.findIndex(item => item.name === fileName)
              if (index !== undefined && index !== -1 && currentFolder.children) {
                currentFolder.children[index].sha = file.etag
                currentFolder.children[index].size = file.size
                currentFolder.children[index].modifiedAt = file.lastModified
              } else {
                currentFolder.children?.push({
                  name: fileName,
                  isFile: !isDirectory,
                  isSymlink: false,
                  parent: currentFolder,
                  isEditing: false,
                  isDirectory: isDirectory,
                  sha: file.etag,
                  size: file.size,
                  isLocale: false,
                  modifiedAt: file.lastModified,
                  children: isDirectory ? [] : undefined
                })
              }
            })
          } else {
            // Git
            files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
              // "."
              if (file.name.startsWith('.')) {
                return;
              }

              // ，
              // : fullpath='test', file.path='test/file.md' →
              // fullpath='test', file.path='test/sub/file.md' →
              const relativePath = fullpath ? file.path.substring(fullpath.length + 1) : file.path
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return //
              }

              const index = currentFolder.children?.findIndex(item => item.name === file.name)
              if (index !== undefined && index !== -1 && currentFolder.children) {
                currentFolder.children[index].sha = file.sha
                currentFolder.children[index].size = (file as any).size
              } else {
                currentFolder.children?.push({
                  name: file.name,
                  isFile: file.type === 'file',
                  isSymlink: false,
                  parent: currentFolder,
                  isEditing: false,
                  isDirectory: file.type === 'dir',
                  sha: file.sha,
                  size: (file as any).size,
                  isLocale: false,
                  children: file.type === 'file' ? undefined : []
                })
              }
            });
          }

          set({ fileTree: [...cacheTree] })
        }
      }
      get().setEntrySyncError(fullpath, undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      get().setEntrySyncError(fullpath, message)
      throw error
    } finally {
      // 、。
      const cacheTree = get().fileTree
      const currentFolder = getCurrentFolder(fullpath, cacheTree)
      if (currentFolder?.loading) {
        currentFolder.loading = false
        set({ fileTree: [...cacheTree] })
      }
    }
    })()

    remoteFolderLoadPromises.set(fullpath, task)
    try {
      await task
    } finally {
      if (remoteFolderLoadPromises.get(fullpath) === task) {
        remoteFolderLoadPromises.delete(fullpath)
      }
    }
  },
  newFolder: async () => {
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isDirectory)
    if (exists) {
      return
    }
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      children: [],
      childrenLoaded: true
    }

    try {
      cacheTree.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },
  newFile: async () => {
    // （）
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isFile)
    if (exists) {
      return
    }
  
    // activeFilePath parent
    const path = get().activeFilePath;
    if (path.includes('/')) {
      //
      const folderPath = path.split('/').slice(0, -1).join('/')
      const currentFolder = getCurrentFolder(folderPath, cacheTree)
      
      // ，
      if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
        return
      }
      
      //
      const collapsibleList = get().collapsibleList
      if (!collapsibleList.includes(folderPath)) {
        collapsibleList.push(folderPath)
        set({ collapsibleList })
      }
      
      if (currentFolder) {
        const newFile: DirTree = {
          name: '',
          isFile: true,
          isSymlink: false,
          parent: currentFolder,
          isEditing: true,
          isDirectory: false,
          isLocale: true,
          sha: '',
          children: []
        }
        currentFolder.children?.unshift(newFile)
        set({ fileTree: cacheTree })
      }
    } else {
      // parent，
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: undefined,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: []
      }
      cacheTree.unshift(newFile)
      set({ fileTree: cacheTree })
    }
  },

  newFileOnFolder: async (path: string) => {
    // parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    //
    const workspace = await getWorkspacePath()
    
    //
    const file = `File-${new Date().getTime()}.md`
    const fullPath = `${path}/${file}`
    const pathOptions = await getFilePathOptions(fullPath)
    
    //
    if (workspace.isCustom) {
      await writeTextFile(pathOptions.path, '')
    } else {
      await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
    }

    //
    const node = {
      name: file,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      isEditing: false,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: [],
      childrenLoaded: true
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
      get().setActiveFilePath(fullPath)
    } catch {
    }
  },
  newFolderInFolder: async (path: string) => {
    // parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    // ，
    const hasEmptyFolder = currentFolder?.children?.find(item => item.name === '' && item.isDirectory)
    if (hasEmptyFolder) {
      return
    }

    //
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: []
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },

  collapsibleList: [],
  collapsibleListInitialized: false,
  initCollapsibleList: async () => {
    //
    if (get().collapsibleListInitialized) {
      return
    }

    const store = await getStore();
    const key = await getCollapsibleStoreKey()
    const scopedList = await store.get<string[]>(key)
    const legacyList = key.endsWith('__default__')
      ? await store.get<string[]>('collapsibleList')
      : undefined
    const res = scopedList ?? legacyList
    if (!scopedList && legacyList) {
      await store.set(key, legacyList)
    }
    const activeFilePath = await store.get<string>(await getWorkspaceStoreKey('activeFilePath'))
      ?? await store.get<string>('activeFilePath')
    set({
      collapsibleList: res ? uniq(res.filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i))) : [],
      collapsibleListInitialized: true
    })

    if (activeFilePath && !isRecordOpenTabPath(activeFilePath)) {
      set({ activeFilePath })

      // （，）
      if (!activeFilePath.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
        // ：
        if (!get().collapsibleList.includes(activeFilePath)) {
          await get().setCollapsibleList(activeFilePath, true)
        }
        await get().loadCollapsibleFiles(activeFilePath)
      } else {
        // ：
        get().readArticle(activeFilePath)
      }
    }
  },
  
  setCollapsibleList: async (path: string, value: boolean) => {
    const collapsibleList = cloneDeep(get().collapsibleList)
    if (value) {
      collapsibleList.push(path)
    } else {
      const index = collapsibleList.indexOf(path)
      if (index !== -1) {
        collapsibleList.splice(index, 1)
      }
    }
    const store = await getStore();
    await store.set(await getCollapsibleStoreKey(), collapsibleList)
    set({ collapsibleList: uniq(collapsibleList).filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) })
  },
  
  expandAllFolders: async () => {
    const getAllFolderPaths = (tree: DirTree[], parentPath: string = ''): string[] => {
      let paths: string[] = []
      for (const item of tree) {
        if (!item.isFile) {
          const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name
          paths.push(currentPath)
          if (item.children && item.children.length > 0) {
            paths = [...paths, ...getAllFolderPaths(item.children, currentPath)]
          }
        }
      }
      return paths
    }

    const loadedPaths = new Set<string>()
    while (true) {
      const pendingPaths = getAllFolderPaths(get().fileTree)
        .filter(path => !loadedPaths.has(path))
      if (pendingPaths.length === 0) break

      for (let index = 0; index < pendingPaths.length; index += 4) {
        const batch = pendingPaths.slice(index, index + 4)
        batch.forEach(path => loadedPaths.add(path))
        await Promise.all(batch.map(path => (
          get().loadCollapsibleFiles(path, { skipRemoteSync: true })
        )))
      }
    }

    const folderPaths = getAllFolderPaths(get().fileTree)
    const store = await getStore()
    await store.set(await getCollapsibleStoreKey(), folderPaths)
    set({ collapsibleList: uniq(folderPaths) })
  },
  
  collapseAllFolders: async () => {
    const store = await getStore()
    await store.set(await getCollapsibleStoreKey(), [])
    set({ collapsibleList: [] })
  },
  
  toggleAllFolders: async () => {
    // If there are any expanded folders, collapse all; otherwise, expand all
    if (get().collapsibleList.length > 0) {
      await get().collapseAllFolders()
    } else {
      await get().expandAllFolders()
    }
  },
  clearCollapsibleList: async () => {
    set({ collapsibleList: [] })
    const store = await getStore()
    await store.set(await getCollapsibleStoreKey(), [])
  },
  loadWorkspaceCollapsibleList: async () => {
    const store = await getStore()
    const key = await getCollapsibleStoreKey()
    const scopedList = await store.get<string[]>(key)
    set({
      collapsibleList: uniq(scopedList ?? []).filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)),
      collapsibleListInitialized: true
    })
    return await store.get<string>(await getWorkspaceStoreKey('activeFilePath')) ?? ''
  },

  currentArticle: '',
  readFilePath: '',
  isPulling: false, // added：Status
  justPulledFile: false, //
  skipSyncOnSave: false, //
  aiGeneratingFilePath: null, // AI
  aiTerminateFn: null, // AI

  setReadFilePath: (path: string) => {
    set({ readFilePath: path })
  },

  readArticle: async (path: string, sha?: string, autoSync = true) => {
    get().setLoading(true)

    // ，
    set({ readFilePath: path })

    //
    let actualPath = path
    if (!isAbsoluteFsPath(path) && hasInvalidFileNameChars(path)) {
      actualPath = sanitizeFilePath(path)
      //
      await get().setActiveFilePath(actualPath)
    }

    // （）
    let localContent = ''

    // ：
    const findFileInTree = (tree: DirTree[], targetPath: string): DirTree | null => {
      for (const item of tree) {
        const itemPath = computedParentPath(item)
        if (itemPath === targetPath && item.isFile) {
          return item
        }
        if (item.children && item.children.length > 0) {
          const found = findFileInTree(item.children, targetPath)
          if (found) return found
        }
      }
      return null
    }

    try {
      const pathOptions = await getFilePathOptions(actualPath)
      if (!pathOptions.baseDir) {
        localContent = await readTextFile(pathOptions.path)
      } else {
        localContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }

      //
      const fileTree = get().fileTree
      const fileInfo = findFileInTree(fileTree, actualPath)
      const isRemoteFile = fileInfo && !fileInfo.isLocale

      // ，（），
      if (isRemoteFile && (!localContent || localContent.trim() === '')) {
        // ，
        set({ currentArticle: '', loading: true })

        //
        get().setIsPulling(true)
        get().setJustPulledFile(true)

        //
        setTimeout(async () => {
          try {
            const remoteContent = await pullRemoteFile(actualPath)
            await saveLocalFile(actualPath, remoteContent)

            //
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: remoteContent })
              emitter.emit('editor-content-from-remote', { content: remoteContent })
            }

            // ， isLocale
            const cacheTree = cloneDeep(get().fileTree)
            const fileNode = findFileInTree(cacheTree, actualPath)
            if (fileNode) {
              fileNode.isLocale = true
              set({ fileTree: cacheTree })
            }
          } catch {
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: '' })
            }
          } finally {
            get().setIsPulling(false)
            get().setLoading(false)
            setTimeout(() => {
              get().setJustPulledFile(false)
            }, 1000)
          }
        }, 0)

        return
      }

      // ，（）
      set({ currentArticle: localContent })
      // ，
      get().setLoading(false)
      //
      if (!isAbsoluteFsPath(actualPath)) {
        get().checkFileVectorIndexed(actualPath)
      }
    } catch (error) {
      // ，

      // （ fileTree ）
      const fileInfo = findFileInTree(get().fileTree, actualPath)

      // "File does not exist"（）
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isFileNotFound = errorMsg.toLowerCase().includes('no such file') ||
                            errorMsg.toLowerCase().includes('not found') ||
                            errorMsg.toLowerCase().includes('Translated message')

      if (isFileNotFound && fileInfo && !fileInfo.isLocale) {
        // ，
        set({ currentArticle: '', loading: true })

        //
        get().setIsPulling(true)
        get().setJustPulledFile(true)

        //
        setTimeout(async () => {
          try {
            const remoteContent = await pullRemoteFile(actualPath)
            await saveLocalFile(actualPath, remoteContent)

            //
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: remoteContent })
              emitter.emit('editor-content-from-remote', { content: remoteContent })
            }

            // ， isLocale
            const cacheTree = cloneDeep(get().fileTree)
            const fileNode = findFileInTree(cacheTree, actualPath)
            if (fileNode) {
              fileNode.isLocale = true
              set({ fileTree: cacheTree })
            }
          } catch {
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: '' })
            }
          } finally {
            get().setIsPulling(false)
            get().setLoading(false)
            setTimeout(() => {
              get().setJustPulledFile(false)
            }, 1000)
          }
        }, 0)
      } else if (isFileNotFound) {
        // ，
        await ensureDirectoryExists(actualPath)
        const pathOptions = await getFilePathOptions(actualPath)

        try {
          if (!pathOptions.baseDir) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
          set({ currentArticle: '' })
          get().setLoading(false)
        } catch {
          get().setLoading(false)
        }
      } else {
        set({ currentArticle: '' })
        get().setLoading(false)
      }
    }

    // （ SyncManager）
    // actualPath
    // activeFilePath ，
    if (autoSync && !isAbsoluteFsPath(actualPath) && await hasNetworkConnection()) {
      try {
        //
        const currentReadPath = get().readFilePath
        const currentActivePath = get().activeFilePath
        if (currentReadPath === actualPath && currentActivePath === actualPath) {
          const result = await syncOnOpen(actualPath)
          // content
          if (result?.updated && result.content && get().activeFilePath === actualPath) {
            // ， currentArticle
            set({ currentArticle: result.content })
          }
        }
      } catch {
      }
    }

    // readFilePath（ readArticle ）
    // activeFilePath
    if (get().activeFilePath === actualPath) {
      set({ readFilePath: '' })
    }
  },

  //
  isVectorCalculating: false,
  //
  vectorIndexedFiles: new Map<string, number>(), // ->

  setCurrentArticle: (content: string) => {
    set({ currentArticle: content })
  },

  setIsPulling: (pulling: boolean) => {
    set({ isPulling: pulling })
  },

  setJustPulledFile: (justPulled: boolean) => {
    set({ justPulledFile: justPulled })
  },

  setSkipSyncOnSave: (skip: boolean) => {
    set({ skipSyncOnSave: skip })
  },

  setAiGeneratingFilePath: (path: string | null) => {
    set({ aiGeneratingFilePath: path })
  },

  setAiTerminateFn: (fn: (() => void) | null) => {
    set({ aiTerminateFn: fn })
  },

  // sha （）
  updateFileSha: (path: string, sha: string) => {
    const cacheTree = cloneDeep(get().fileTree)

    // sha
    const updateShaInTree = (items: DirTree[], depth: number = 0): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path && item.isFile) {
          item.sha = sha
          debugSyncPath('article.updateFileSha.match', {
            path,
            itemPath,
            name: item.name,
            depth,
            sha,
          })
          return true
        }
        if (item.children && updateShaInTree(item.children, depth + 1)) {
          return true
        }
      }
      return false
    }

    if (updateShaInTree(cacheTree)) {
      const sortedTree = get().sortFileTree(cacheTree)
      set({ fileTree: sortedTree })
    } else {
      debugSyncPath('article.updateFileSha.miss', {
        path,
        sha,
      })
    }
  },

  saveCurrentArticle: async (content: string, pathOverride?: string) => {
    const path = pathOverride ?? get().activeFilePath
    const justPulled = get().justPulledFile

    if (path && content !== undefined && content !== null) {
      // ，（ SHA ）
      if (justPulled) {
        //
        get().setJustPulledFile(false)
        // ，
        const pathOptions = await getFilePathOptions(path)
        if (!pathOptions.baseDir) {
          await writeTextFile(pathOptions.path, content)
        } else {
          await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
        }
        set({ currentArticle: content })
        return
      }

      // UI ， store 。
      const existingSave = pendingArticleSaves.get(path)
      if (existingSave?.timer) {
        clearTimeout(existingSave.timer)
      }

      // ，500ms
      // content change
      const pendingSave = {
        content,
        timer: null as ReturnType<typeof setTimeout> | null,
      }
      pendingSave.timer = setTimeout(async () => {
        if (pendingArticleSaves.get(path) !== pendingSave) {
          return
        }
        pendingArticleSaves.delete(path)

        //
        const savePath = path
        const saveContent = pendingSave.content
        //
        let isLocale = false
        const pathOptions = await getFilePathOptions(savePath)
        if (!pathOptions.baseDir) {
          isLocale = await exists(pathOptions.path)
        } else {
          isLocale = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        //
        if (savePath.includes('/')) {
          let dir = ''
          const dirPath = savePath.split('/')
          for (let index = 0; index < dirPath.length - 1; index += 1) {
            dir += `${dirPath[index]}/`
            const dirOptions = await getFilePathOptions(dir)
            let dirExists = false
            if (!dirOptions.baseDir) {
              dirExists = await exists(dirOptions.path)
            } else {
              dirExists = await exists(dirOptions.path, { baseDir: dirOptions.baseDir })
            }
            if (!dirExists) {
              if (!dirOptions.baseDir) {
                await mkdir(dirOptions.path)
              } else {
                await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir })
              }
            }
          }
        }

        //
        if (!pathOptions.baseDir) {
          await writeTextFile(pathOptions.path, saveContent)
        } else {
          await writeTextFile(pathOptions.path, saveContent, { baseDir: pathOptions.baseDir })
        }
        get().markFileDirty(savePath)

        //
        if (!isLocale) {
          const cacheTree = cloneDeep(get().fileTree)
          const current = savePath.includes('/') ? getCurrentFolder(savePath, cacheTree) : cacheTree.find(item => item.name === savePath)
          if (current) {
            current.isLocale = true

            // isLocale
            const updateParentFolders = async (node: DirTree | undefined) => {
              let parent = node
              const pathParts = savePath.split('/')
              let currentDepth = pathParts.length - 1

              while (parent && currentDepth > 0) {
                if (parent.isLocale) {
                  break
                }
                const parentPath = pathParts.slice(0, currentDepth).join('/')
                const parentOptions = await getFilePathOptions(parentPath)
                let parentExists = false
                try {
                  if (!parentOptions.baseDir) {
                    parentExists = await exists(parentOptions.path)
                  } else {
                    parentExists = await exists(parentOptions.path, { baseDir: parentOptions.baseDir })
                  }
                } catch {
                  parentExists = false
                }
                if (parentExists) {
                  parent.isLocale = true
                  parent = parent.parent
                  currentDepth--
                } else {
                  break
                }
              }
            }

            await updateParentFolders(current.parent)
          }
          set({ fileTree: cacheTree })
        }

        //
        if (!isAbsoluteFsPath(savePath) && savePath.endsWith('.md')) {
          get().scheduleVectorCalculation(savePath, saveContent)
        }

        // currentArticle
        set({ currentArticle: saveContent })

        // （，）
        try {
          const { recordWritingActivity } = await import('@/db/activity')
          const fileName = savePath.split('/').pop() || savePath
          await recordWritingActivity({
            path: savePath,
            title: fileName,
            description: savePath,
          })
        } catch (error) {
          console.error('Failed', error)
        }

        // ，（ skipSyncOnSave）
        const shouldSkipSync = get().skipSyncOnSave
        if (!shouldSkipSync && !isAbsoluteFsPath(savePath)) {
          emitter.emit('article-saved', { path: savePath, content: saveContent })
        }
      }, 500)
      pendingArticleSaves.set(path, pendingSave)
    }
  },

  // （5）
  scheduleVectorCalculation: (path: string, content: string) => {
    if (!useVectorStore.getState().isAutoVectorEnabled) {
      get().cancelVectorCalculation()
      return
    }

    if (vectorCalculationTimer) {
      clearTimeout(vectorCalculationTimer)
    }

    pendingVectorCalculation = { path, content }
    
    // 5
    vectorCalculationTimer = setTimeout(() => {
      vectorCalculationTimer = null
      void get().executeVectorCalculation()
    }, 5000)
  },

  //
  executeVectorCalculation: async (options = {}) => {
    // ，
    if (!pendingVectorCalculation || get().isVectorCalculating) {
      return
    }

    const calculation = pendingVectorCalculation

    if (!options.force) {
      if (!useVectorStore.getState().isAutoVectorEnabled) {
        get().cancelVectorCalculation()
        return
      }

      const store = await getStore()
      const disabledFiles = await store.get<string[]>('vectorAutoCalcDisabled') || []
      if (disabledFiles.includes(calculation.path)) {
        get().cancelVectorCalculation()
        return
      }
    }
    
    try {
      set({ isVectorCalculating: true })
      
      const { path, content } = calculation
      const vectorStore = useVectorStore.getState()

      //
      await vectorStore.processDocument(path, content)
      //
      const vectorKey = getVectorDocumentKey(path)
      const newMap = new Map(get().vectorIndexedFiles)
      newMap.set(vectorKey, Date.now())
      set({ vectorIndexedFiles: newMap })

      if (pendingVectorCalculation === calculation) {
        pendingVectorCalculation = null
      }
      set({ isVectorCalculating: false })
    } catch {
      set({ isVectorCalculating: false })
    }
  },

  //
  cancelVectorCalculation: () => {
    if (vectorCalculationTimer) {
      clearTimeout(vectorCalculationTimer)
      vectorCalculationTimer = null
    }
    pendingVectorCalculation = null
  },

  //
  checkFileVectorIndexed: async (filePath: string) => {
    const { checkVectorDocumentExists, getVectorDocumentsByFilename } = await import('@/db/vector')
    const vectorKey = getVectorDocumentKey(filePath)
    const hasVector = await checkVectorDocumentExists(vectorKey)
    if (hasVector) {
      //
      const docs = await getVectorDocumentsByFilename(vectorKey)
      if (docs.length > 0) {
        const latestTime = Math.max(...docs.map(d => d.updated_at))
        const newMap = new Map(get().vectorIndexedFiles)
        newMap.set(vectorKey, latestTime)
        set({ vectorIndexedFiles: newMap })
        return true
      }
    }
    // ，
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(vectorKey)
    set({ vectorIndexedFiles: newMap })
    return false
  },

  //
  clearFileVector: async (filePath: string) => {
    const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
    const vectorKey = getVectorDocumentKey(filePath)
    await deleteVectorDocumentsByFilename(vectorKey)
    //
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(vectorKey)
    set({ vectorIndexedFiles: newMap })
  },

  // -
  initVectorIndexedFiles: async () => {
    if (!vectorIndexedFilesInitPromise) {
      vectorIndexedFilesInitPromise = (async () => {
        const { getVectorIndexSummaries } = await import('@/db/vector')
        const vectorIndexedDocs = await getVectorIndexSummaries()
        const vectorIndexedMap = buildVectorIndexedMap(vectorIndexedDocs)

        set({ vectorIndexedFiles: vectorIndexedMap })
      })().catch(() => {
      }).finally(() => {
        vectorIndexedFilesInitPromise = null
      })
    }

    await vectorIndexedFilesInitPromise
  },

  // （）
  triggerVectorCalculation: async () => {
    const state = get()
    if (!state.activeFilePath || state.isVectorCalculating) {
      return
    }

    //
    const content = state.currentArticle
    if (!content) {
      return
    }

    pendingVectorCalculation = {
      path: state.activeFilePath,
      content
    }

    await get().executeVectorCalculation({ force: true })
  },

  //
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => {
    const fileTree = get().fileTree

    // /
    const updateStatus = (items: DirTree[]): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path) {
          item.vectorCalcStatus = status
          return true
        }
        if (item.children && updateStatus(item.children)) {
          return true
        }
      }
      return false
    }

    updateStatus(fileTree)
    set({ fileTree: [...fileTree] })
  },

  allArticle: [],
  loadAllArticle: async () => {
    const workspace = await getWorkspacePath()
    let allArticle: Article[] = []
    
    const readDirRecursively = async (dirPath: string, basePath: string, isCustomWorkspace: boolean): Promise<Article[]> => {
      let allArticles: Article[] = []
      
      //
      const res = isCustomWorkspace 
        ? await readDir(dirPath)
        : await readDir(dirPath, { baseDir: BaseDirectory.AppData })
      
      //
      const files = res.filter(file => 
        file.isFile && 
        file.name !== '.DS_Store' && 
        !file.name.startsWith('.') && 
        file.name.endsWith('.md')
      )
      
      //
      for (const file of files) {
        //
        const relativePath = await join(basePath, file.name)
        
        //
        let article = ''
        if (isCustomWorkspace) {
          const fullPath = await join(dirPath, file.name)
          article = await readTextFile(fullPath)
        } else {
          article = await readTextFile(`${dirPath}/${file.name}`, { baseDir: BaseDirectory.AppData })
        }
        
        allArticles.push({ article, path: relativePath })
      }
      
      //
      const directories = res.filter(entry => 
        entry.isDirectory && 
        !entry.name.startsWith('.')
      )
      
      for (const dir of directories) {
        const newDirPath = await join(dirPath, dir.name)
        const newBasePath = await join(basePath, dir.name)
        const subDirArticles = await readDirRecursively(newDirPath, newBasePath, isCustomWorkspace)
        allArticles = [...allArticles, ...subDirArticles]
      }
      
      return allArticles
    }

    if (workspace.isCustom) {
      //
      allArticle = await readDirRecursively(workspace.path, '', true)
    } else {
      //
      allArticle = await readDirRecursively('article', '', false)
    }

    set({ allArticle })
  }
}))

export default useArticleStore
