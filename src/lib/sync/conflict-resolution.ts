import { Store } from '@tauri-apps/plugin-store'
import { confirm } from '@tauri-apps/plugin-dialog'

/**
 * 
 */
export type ConflictResolutionStrategy = 'local' | 'remote' | 'manual'

export interface ConflictResolution {
  action: 'keep_local' | 'keep_remote' | 'merge' | 'manual'
  reason?: string
}

export interface SyncLock {
  filePath: string
  deviceId: string
  timestamp: number
  userName: string
}

/**
 * 
 */
export async function getDeviceId(): Promise<string> {
  const store = await Store.load('store.json')
  let deviceId = await store.get<string>('deviceId')
  
  if (!deviceId) {
    //
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    await store.set('deviceId', deviceId)
    await store.save()
  }
  
  return deviceId
}

/**
 * 
 */
export async function getUserName(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('username') || 'Unknown User'
}

/**
 * 
 */
export async function checkFileLock(filePath: string): Promise<SyncLock | null> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  const lock = locks[filePath]
  if (!lock) {
    return null
  }
  
  // （5）
  const now = Date.now()
  if (now - lock.timestamp > 5 * 60 * 1000) {
    // ，
    delete locks[filePath]
    await store.set('fileLocks', locks)
    await store.save()
    return null
  }
  
  // ，
  const currentDeviceId = await getDeviceId()
  if (lock.deviceId === currentDeviceId) {
    return null
  }
  
  return lock
}

/**
 * 
 */
export async function acquireFileLock(filePath: string): Promise<boolean> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  //
  const existingLock = locks[filePath]
  if (existingLock) {
    const currentDeviceId = await getDeviceId()
    if (existingLock.deviceId !== currentDeviceId) {
      //
      const now = Date.now()
      if (now - existingLock.timestamp <= 5 * 60 * 1000) {
        return false //
      }
    }
  }
  
  //
  const deviceId = await getDeviceId()
  const userName = await getUserName()
  
  locks[filePath] = {
    filePath,
    deviceId,
    timestamp: Date.now(),
    userName
  }
  
  await store.set('fileLocks', locks)
  await store.save()
  
  return true
}

/**
 * 
 */
export async function releaseFileLock(filePath: string): Promise<void> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  const currentDeviceId = await getDeviceId()
  const lock = locks[filePath]
  
  if (lock && lock.deviceId === currentDeviceId) {
    delete locks[filePath]
    await store.set('fileLocks', locks)
    await store.save()
  }
}

/**
 * 
 * @param filePath 
 * @param localContent 
 * @param remoteContent 
 * @param strategy ，
 */
export async function detectAndHandleConflict(
  filePath: string,
  localContent: string,
  remoteContent: string,
  strategy?: ConflictResolutionStrategy
): Promise<ConflictResolution> {
  // ，
  if (localContent === remoteContent) {
    return { action: 'keep_local', reason: '，None' }
  }

  // ，
  if (strategy) {
    const result = await resolveConflict(filePath, localContent, remoteContent, strategy)
    if (result.resolved) {
      return {
        action: strategy === 'local' ? 'keep_local' : strategy === 'remote' ? 'keep_remote' : 'manual',
        reason: `${strategy} Conflict`
      }
    } else {
      return { action: 'manual', reason: 'Translated message' }
    }
  }

  //
  const conflictType = analyzeConflictType(localContent, remoteContent)

  switch (conflictType) {
    case 'simple_addition':
      // ，
      return { action: 'merge', reason: '，' }

    case 'significant_change':
      // ，
      return await promptUserForResolution(filePath, localContent, remoteContent)

    case 'format_only':
      // ，
      return { action: 'keep_remote', reason: 'Format ，Use remote version' }

    default:
      return await promptUserForResolution(filePath, localContent, remoteContent)
  }
}

/**
 * 
 */
function analyzeConflictType(localContent: string, remoteContent: string): 'simple_addition' | 'significant_change' | 'format_only' {
  const localLines = localContent.split('\n')
  const remoteLines = remoteContent.split('\n')

  //
  if (localLines.length < remoteLines.length) {
    const localPrefix = remoteLines.slice(0, localLines.length).join('\n')
    if (localContent === localPrefix) {
      return 'simple_addition'
    }
  }

  // （）
  const normalizedLocal = localContent.replace(/\s+/g, ' ').trim()
  const normalizedRemote = remoteContent.replace(/\s+/g, ' ').trim()

  if (normalizedLocal === normalizedRemote) {
    return 'format_only'
  }

  return 'significant_change'
}

/**
 * 
 */
export function analyzeConflictTypeExported(localContent: string, remoteContent: string): 'simple_addition' | 'significant_change' | 'format_only' {
  return analyzeConflictType(localContent, remoteContent)
}

/**
 * 
 * @param filePath 
 * @param localContent 
 * @param remoteContent 
 * @param strategy 
 * @returns 
 */
export async function resolveConflict(
  filePath: string,
  localContent: string,
  remoteContent: string,
  strategy: ConflictResolutionStrategy
): Promise<{ content: string; resolved: boolean }> {
  switch (strategy) {
    case 'local':
      return { content: localContent, resolved: true }
    case 'remote':
      return { content: remoteContent, resolved: true }
    case 'manual':
      // ，
      return { content: localContent, resolved: false }
  }
}

/**
 * 
 */
async function promptUserForResolution(
  filePath: string,
  localContent: string,
  remoteContent: string
): Promise<ConflictResolution> {
  const choice = await confirm(
    `File ${filePath} Conflict\n\n` +
    `Local ：${localContent.length} \n` +
    `：${remoteContent.length} \n\n` +
    `：\n` +
    `• ：Keep local version\n` +
    `• Cancel：`,
    { 
      title: 'Sync conflict',
      okLabel: 'Keep local',
      cancelLabel: 'Keep remote'
    }
  )
  
  return {
    action: choice ? 'keep_local' : 'keep_remote',
    reason: choice ? 'Keep local version' : 'Translated message'
  }
}

/**
 * 
 */
export function mergeSimpleContent(localContent: string, remoteContent: string): string {
  const localLines = localContent.split('\n')
  const remoteLines = remoteContent.split('\n')
  
  // ，
  if (remoteLines.length >= localLines.length) {
    const localPrefix = remoteLines.slice(0, localLines.length).join('\n')
    if (localContent === localPrefix) {
      return remoteContent
    }
  }
  
  // ，
  if (localLines.length >= remoteLines.length) {
    const remotePrefix = localLines.slice(0, remoteLines.length).join('\n')
    if (remoteContent === remotePrefix) {
      return localContent
    }
  }
  
  //
  const mergedLines = [...localLines]
  for (const line of remoteLines) {
    if (!localLines.includes(line)) {
      mergedLines.push(line)
    }
  }
  
  return mergedLines.join('\n')
}

/**
 * 
 */
export async function cleanupExpiredLocks(): Promise<void> {
  const store = await Store.load('store.json')
  const locks = await store.get<Record<string, SyncLock>>('fileLocks') || {}
  
  const now = Date.now()
  const expiredKeys: string[] = []
  
  for (const [filePath, lock] of Object.entries(locks)) {
    if (now - lock.timestamp > 5 * 60 * 1000) { // 5
      expiredKeys.push(filePath)
    }
  }
  
  if (expiredKeys.length > 0) {
    for (const key of expiredKeys) {
      delete locks[key]
    }
    await store.set('fileLocks', locks)
    await store.save()
  }
}

/**
 * 
 */
export async function getFileSyncStatus(filePath: string): Promise<{
  isLocked: boolean
  lockInfo?: SyncLock
  lastSyncTime?: number
}> {
  const store = await Store.load('store.json')
  
  //
  const lockInfo = await checkFileLock(filePath)
  
  //
  const syncTimes = await store.get<Record<string, number>>('lastSyncTimes') || {}
  const lastSyncTime = syncTimes[filePath]
  
  return {
    isLocked: !!lockInfo,
    lockInfo: lockInfo || undefined,
    lastSyncTime
  }
}

/**
 * 
 */
export async function updateFileSyncTime(filePath: string): Promise<void> {
  const store = await Store.load('store.json')
  const syncTimes = await store.get<Record<string, number>>('lastSyncTimes') || {}

  syncTimes[filePath] = Date.now()
  await store.set('lastSyncTimes', syncTimes)
  await store.save()
}

/**
 * 
 */
export async function getFileRestoreTime(filePath: string): Promise<number | undefined> {
  const store = await Store.load('store.json')
  const restoreTimes = await store.get<Record<string, number>>('lastRestoreTimes') || {}
  return restoreTimes[filePath]
}

/**
 * 
 */
export async function updateFileRestoreTime(filePath: string): Promise<void> {
  const store = await Store.load('store.json')
  const restoreTimes = await store.get<Record<string, number>>('lastRestoreTimes') || {}

  restoreTimes[filePath] = Date.now()
  await store.set('lastRestoreTimes', restoreTimes)
  await store.save()
}
