//

// ==================== ====================

export interface SyncExcludePattern {
  pattern: string
  description: string
}

//
export const DEFAULT_SYNC_EXCLUDE_PATTERNS: SyncExcludePattern[] = [
  { pattern: '.notegen/', description: 'App config directory' },
  { pattern: '*.tmp', description: 'Temporary files' },
  { pattern: '*.bak', description: 'Backup files' },
  { pattern: '*.swp', description: 'Editor temp files' },
  { pattern: 'Thumbs.db', description: 'Windows thumbnail cache' },
  { pattern: '.DS_Store', description: 'macOS system file' },
  { pattern: '*.lock', description: 'Lock files' },
]

//
export function shouldExclude(path: string): boolean {
  const excludePatterns = getExcludePatterns()

  for (const pattern of excludePatterns) {
    if (matchPattern(pattern, path)) {
      return true
    }
  }

  return false
}

//
function matchPattern(pattern: string, path: string): boolean {
  // （ / ）
  if (pattern.endsWith('/')) {
    return path.startsWith(pattern)
  }

  //
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1) // *.tmp -> .tmp
    return path.endsWith(ext) || path.includes(`.tmp${ext}`) // .tmp.txt
  }

  //
  return path === pattern || path.includes(pattern)
}

// （）
export function getExcludePatterns(): string[] {
  // TODO:
  return DEFAULT_SYNC_EXCLUDE_PATTERNS.map(p => p.pattern)
}

// ==================== ====================

export interface SyncExclusionOptions {
  excludeSensitiveConfig?: boolean
}

export const ALWAYS_SYNC_EXCLUDED_FIELDS: string[] = [
  'autoDataSyncEnabled',
  'autoVectorEnabled',
  'closeBehavior',
  'excludeSensitiveConfig',
  'syncedFileShas',
  'syncQueue',
  'lastAppliedRemoteRev',
  'deviceId',
  'autoDataSyncDirtyDomains',
  'autoDataSyncLastLocalUploadMetaUpdatedAtMs',
  'autoDataSyncLastAppliedRemoteMetaUpdatedAtMs',
  'autoDataSyncLastLocalUploadMeta',
  'autoDataSyncLastAppliedRemoteMeta',
  'autoDataSyncRecordSnapshots',
  'autoDataSyncBaselineFingerprints',
  'lastRecordTagId',
]

export const SENSITIVE_SYNC_EXCLUDED_FIELDS: string[] = [
  'workspacePath',
  'workspaceHistory',
  'assetsPath',
  'appFontFamily',
  'uiScale',
  'contentTextScale',
  'customCss',
  'primaryBackupMethod',
  'aiModelList',
  's3SyncConfig',
  'webdavSyncConfig',
  'imageHostingConfig',
  's3Config',
  'smms',
  'picgo',
  'lskyImageConfig',
  'webdavImageConfig',
  'customHttpImageConfig',
  'cloudinaryImageConfig',
  'imageKitImageConfig',
  'qiniuImageConfig',
  'upyunImageConfig',
  'mcpServers',
]

export const SYNC_EXCLUDED_FIELDS: string[] = [
  ...ALWAYS_SYNC_EXCLUDED_FIELDS,
  ...SENSITIVE_SYNC_EXCLUDED_FIELDS,
]

const SENSITIVE_SYNC_FIELD_PATTERNS = [
  'apikey',
  'accesskey',
  'accesskeyid',
  'accesstoken',
  'password',
  'secret',
  'token',
  'credential',
]

//
export function shouldExcludeFromSync(fieldName: string, options: SyncExclusionOptions = {}): boolean {
  const normalizedFieldName = fieldName.toLowerCase()
  const excludeSensitiveConfig = options.excludeSensitiveConfig !== false

  if (ALWAYS_SYNC_EXCLUDED_FIELDS.includes(fieldName)) {
    return true
  }

  if (!excludeSensitiveConfig) {
    return false
  }

  return (
    SENSITIVE_SYNC_EXCLUDED_FIELDS.includes(fieldName) ||
    SENSITIVE_SYNC_FIELD_PATTERNS.some((pattern) => normalizedFieldName.includes(pattern))
  )
}

//
export function filterSyncData<T extends Record<string, unknown>>(
  data: T,
  options: SyncExclusionOptions = {}
): Partial<T> {
  const filtered: Partial<T> = {}
  
  for (const key in data) {
    if (!shouldExcludeFromSync(key, options)) {
      filtered[key] = data[key]
    }
  }
  
  return filtered
}

// ，
export function mergeSyncData<T extends Record<string, unknown>>(
  localData: T,
  remoteData: Partial<T>,
  options: SyncExclusionOptions = {}
): T {
  const merged = { ...localData } as T
  
  for (const [key, value] of Object.entries(remoteData)) {
    if (!shouldExcludeFromSync(key, options)) {
      merged[key as keyof T] = value as T[keyof T]
    }
  }
  
  return merged
}
