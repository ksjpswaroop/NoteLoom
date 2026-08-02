import { create } from 'zustand'

interface SyncConfirmState {
  isOpen: boolean
  dialogType: 'pull' | 'conflict' | 'shaMismatch'  // ： | | SHA
  fileName: string
  localContent?: string
  remoteContent?: string
  localSha?: string      // SHA（SHA ）
  remoteSha?: string    // SHA（SHA ）
  commitInfo?: {
    sha: string
    message: string
    author: string
    date: Date
    additions?: number
    deletions?: number
  }
  onConfirm?: () => void  // （/Keep remote）
  onCancel?: () => void   // Cancel
  onKeepLocal?: () => void // Keep local（）
  onMerge?: () => void     // （）
  onIgnore?: () => void    // Ignore

  // Actions
  showPullDialog: (data: {
    fileName: string
    commitInfo?: {
      sha: string
      message: string
      author: string
      date: Date
      additions?: number
      deletions?: number
    }
    onConfirm: () => void
    onCancel?: () => void
    onIgnore?: () => void
  }) => void

  showConflictDialog: (data: {
    fileName: string
    localContent: string
    remoteContent: string
    commitInfo?: {
      sha: string
      message: string
      author: string
      date: Date
    }
    onKeepLocal: () => void
    onKeepRemote: () => void
    onMerge?: () => void
    onCancel?: () => void
  }) => void

  // SHA
  showShaMismatchDialog: (data: {
    fileName: string
    localSha?: string
    remoteSha?: string
    onForceUpload: () => void  // （ SHA）
    onCancel: () => void        // Cancel
  }) => void

  hideConfirmDialog: () => void
}

export const useSyncConfirmStore = create<SyncConfirmState>((set) => ({
  isOpen: false,
  dialogType: 'pull',
  fileName: '',
  localContent: undefined,
  remoteContent: undefined,
  commitInfo: undefined,
  onConfirm: undefined,
  onCancel: undefined,
  onKeepLocal: undefined,
  onMerge: undefined,
  onIgnore: undefined,

  showPullDialog: (data) => set({
    isOpen: true,
    dialogType: 'pull',
    fileName: data.fileName,
    commitInfo: data.commitInfo,
    onConfirm: data.onConfirm,
    onCancel: data.onCancel,
    onIgnore: data.onIgnore
  }),

  showConflictDialog: (data) => set({
    isOpen: true,
    dialogType: 'conflict',
    fileName: data.fileName,
    localContent: data.localContent,
    remoteContent: data.remoteContent,
    commitInfo: data.commitInfo,
    onKeepLocal: data.onKeepLocal,
    onConfirm: data.onKeepRemote,  // onConfirm Keep remote
    onMerge: data.onMerge,
    onCancel: data.onCancel
  }),

  showShaMismatchDialog: (data) => set({
    isOpen: true,
    dialogType: 'shaMismatch',
    fileName: data.fileName,
    localSha: data.localSha,
    remoteSha: data.remoteSha,
    onConfirm: data.onForceUpload,  // onConfirm
    onCancel: data.onCancel
  }),

  hideConfirmDialog: () => set({
    isOpen: false,
    dialogType: 'pull',
    fileName: '',
    localContent: undefined,
    remoteContent: undefined,
    localSha: undefined,
    remoteSha: undefined,
    commitInfo: undefined,
    onConfirm: undefined,
    onCancel: undefined,
    onKeepLocal: undefined,
    onMerge: undefined,
    onIgnore: undefined
  })
}))
