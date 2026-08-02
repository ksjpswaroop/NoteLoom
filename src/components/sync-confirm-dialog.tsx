'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Calendar, User, GitMerge, ArrowDownToLine, ArrowUpFromLine, X } from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/en'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt-br'
import { useI18n } from '@/hooks/useI18n'
import { useSyncConfirmStore } from '@/stores/sync-confirm'
import { useIsMobile } from '@/hooks/use-mobile'
import { isMobileDevice as checkIsMobileDevice } from '@/lib/check'
import emitter from '@/lib/emitter'
import { getSyncPushQueue } from '@/lib/sync/sync-push-queue'
import { useEffect } from 'react'

// dayjs
dayjs.extend(relativeTime)

export function SyncConfirmDialog() {
  const { currentLocale } = useI18n()
  const isMobile = useIsMobile() || checkIsMobileDevice()
  const {
    isOpen,
    dialogType,
    fileName,
    commitInfo,
    localSha,
    remoteSha,
    onConfirm,
    onCancel,
    onKeepLocal,
    onMerge,
    onIgnore,
    hideConfirmDialog,
    showShaMismatchDialog
  } = useSyncConfirmStore()

  // SHA ，
  useEffect(() => {
    const handleShaMismatch = async (data: { path: string; localSha?: string; remoteSha?: string }) => {
      const fileName = data.path.split('/').pop() || data.path
      const syncPushQueue = getSyncPushQueue()

      showShaMismatchDialog({
        fileName,
        localSha: data.localSha,
        remoteSha: data.remoteSha,
        onForceUpload: async () => {
          //
          await syncPushQueue.forcePush(data.path)
        },
        onCancel: () => {
          // ，
        }
      })
    }

    emitter.on('sync-sha-mismatch', handleShaMismatch)

    return () => {
      emitter.off('sync-sha-mismatch', handleShaMismatch)
    }
  }, [showShaMismatchDialog])

  const formatDate = (date: Date) => {
    void currentLocale
    return dayjs(date).locale('en').fromNow()
  }

  const handleConfirm = () => {
    onConfirm?.()
    hideConfirmDialog()
  }

  const handleCancel = () => {
    onCancel?.()
    hideConfirmDialog()
  }

  const handleKeepLocal = () => {
    onKeepLocal?.()
    hideConfirmDialog()
  }

  const handleMerge = () => {
    onMerge?.()
    hideConfirmDialog()
  }

  const handleIgnore = () => {
    onIgnore?.()
    hideConfirmDialog()
  }

  const isPullDialog = dialogType === 'pull'
  const isConflictDialog = dialogType === 'conflict'
  const isShaMismatchDialog = dialogType === 'shaMismatch'

  return (
    <>
      {isMobile ? (
        <Drawer open={isOpen} onOpenChange={hideConfirmDialog}>
          <DrawerContent className="max-h-[85vh]">
            {isPullDialog && (
              <>
                <DrawerHeader>
                  <DrawerTitle className="flex items-center gap-2">
                    <ArrowDownToLine className="h-5 w-5" />
                    Remote file update detected
                  </DrawerTitle>
                  <DrawerDescription>
                    File <span className="font-mono bg-muted px-1 rounded">{fileName}</span> has remote updates
                  </DrawerDescription>
                </DrawerHeader>

                <div className="flex flex-col gap-4 overflow-y-auto px-4">
                  {commitInfo && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">Latest commit</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-3 rounded-lg bg-muted/30 p-4">
                        <div>
                          <p className="text-sm font-medium mb-1">Commit message</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground gap-2">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              {commitInfo.author}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {formatDate(commitInfo.date)}
                            </div>
                          </div>

                          {(commitInfo.additions !== undefined || commitInfo.deletions !== undefined) && (
                            <div className="flex items-center gap-2">
                              {commitInfo.additions !== undefined && commitInfo.additions > 0 && (
                                <Badge variant="secondary">
                                  +{commitInfo.additions}
                                </Badge>
                              )}
                              {commitInfo.deletions !== undefined && commitInfo.deletions > 0 && (
                                <Badge variant="destructive" className="text-xs">
                                  -{commitInfo.deletions}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <DrawerFooter className="flex-row gap-2">
                  {onIgnore && (
                    <Button variant="outline" onClick={handleIgnore} className="flex-1">
                      Ignore
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleCancel} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handleConfirm} className="flex-1">
                    Confirm pull
                  </Button>
                </DrawerFooter>
              </>
            )}

            {isConflictDialog && (
              <>
                <DrawerHeader>
                  <DrawerTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    File conflict detected
                  </DrawerTitle>
                  <DrawerDescription>
                    File <span className="font-mono bg-muted px-1 rounded">{fileName}</span> has a conflict
                  </DrawerDescription>
                </DrawerHeader>

                <div className="flex flex-col gap-4 overflow-y-auto px-4">
                  {commitInfo && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">Remote</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-2 rounded-lg bg-muted/30 p-4">
                        <div>
                          <p className="text-sm font-medium mb-1">Commit message</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            {commitInfo.author}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDate(commitInfo.date)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <Alert>
                    <AlertDescription>
                      Choose how to resolve this conflict: keep local, keep remote, or cancel and merge manually.
                    </AlertDescription>
                  </Alert>
                </div>

                <DrawerFooter className="flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2 w-full">
                    <Button variant="outline" onClick={handleKeepLocal} className="gap-2">
                      <ArrowUpFromLine className="h-4 w-4" />
                      Keep local
                    </Button>
                    <Button variant="default" onClick={handleConfirm} className="gap-2">
                      <ArrowDownToLine className="h-4 w-4" />
                      Keep remote
                    </Button>
                  </div>
                  {onMerge && (
                    <Button variant="secondary" onClick={handleMerge} className="w-full gap-2">
                      <GitMerge className="h-4 w-4" />
                      Merge both
                    </Button>
                  )}
                  <Button variant="ghost" onClick={handleCancel} className="w-full gap-2">
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                </DrawerFooter>
              </>
            )}

            {isShaMismatchDialog && (
              <>
                <DrawerHeader>
                  <DrawerTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    Sync conflict detected
                  </DrawerTitle>
                  <DrawerDescription>
                    File <span className="font-mono bg-muted px-1 rounded">{fileName}</span> Push failed
                  </DrawerDescription>
                </DrawerHeader>

                <div className="flex flex-col gap-4 overflow-y-auto px-4">
                  <Alert variant="destructive">
                    <AlertDescription>
                      The remote file SHA does not match the local record; it may have been changed on another device.
                    </AlertDescription>
                  </Alert>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Local SHA:</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {localSha ? localSha.slice(0, 7) : 'N/A'}
                      </code>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Remote file SHA:</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {remoteSha ? remoteSha.slice(0, 7) : 'N/A'}
                      </code>
                    </div>
                  </div>
                </div>

                <DrawerFooter className="flex-row gap-2">
                  <Button variant="outline" onClick={handleCancel} className="flex-1">
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleConfirm} className="flex-1 gap-2">
                    <ArrowUpFromLine className="h-4 w-4" />
                    Force upload
                  </Button>
                </DrawerFooter>
              </>
            )}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={isOpen} onOpenChange={hideConfirmDialog}>
          <DialogContent className="max-w-2xl">
            {isPullDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ArrowDownToLine className="h-5 w-5" />
                    Remote file update detected
                  </DialogTitle>
                  <DialogDescription>
                    File <span className="font-mono bg-muted px-1 rounded">{fileName}</span> has remote updates
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-4">
                  {commitInfo && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">Latest commit</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-3 rounded-lg bg-muted/30 p-4">
                        <div>
                          <p className="text-sm font-medium mb-1">Commit message</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>

                        <div className="flex items-center justify-between text-sm text-muted-foreground">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                              <User className="h-4 w-4" />
                              {commitInfo.author}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              {formatDate(commitInfo.date)}
                            </div>
                          </div>

                          {(commitInfo.additions !== undefined || commitInfo.deletions !== undefined) && (
                            <div className="flex items-center gap-2">
                              {commitInfo.additions !== undefined && commitInfo.additions > 0 && (
                                <Badge variant="secondary">
                                  +{commitInfo.additions}
                                </Badge>
                              )}
                              {commitInfo.deletions !== undefined && commitInfo.deletions > 0 && (
                                <Badge variant="destructive" className="text-xs">
                                  -{commitInfo.deletions}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  {onIgnore && (
                    <Button variant="outline" onClick={handleIgnore}>
                      Ignore
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                  <Button onClick={handleConfirm}>
                    Confirm pull
                  </Button>
                </DialogFooter>
              </>
            )}

            {isConflictDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    File conflict detected
                  </DialogTitle>
                  <DialogDescription>
                    File <span className="font-mono bg-muted px-1 rounded">{fileName}</span> has a conflict
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-4">
                  {commitInfo && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">Remote</h4>
                        <Badge variant="outline" className="text-xs">
                          {commitInfo.sha.slice(0, 7)}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-2 rounded-lg bg-muted/30 p-4">
                        <div>
                          <p className="text-sm font-medium mb-1">Commit message</p>
                          <p className="text-sm">{commitInfo.message}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-4 w-4" />
                            {commitInfo.author}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {formatDate(commitInfo.date)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <Alert>
                    <AlertDescription>
                      Choose how to resolve this conflict: keep local, keep remote, or cancel and merge manually.
                    </AlertDescription>
                  </Alert>
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={handleKeepLocal} className="gap-2">
                    <ArrowUpFromLine className="h-4 w-4" />
                    Keep local
                  </Button>
                  {onMerge && (
                    <Button variant="secondary" onClick={handleMerge} className="gap-2">
                      <GitMerge className="h-4 w-4" />
                      Merge both
                    </Button>
                  )}
                  <Button variant="default" onClick={handleConfirm} className="gap-2">
                    <ArrowDownToLine className="h-4 w-4" />
                    Keep remote
                  </Button>
                  <Button variant="ghost" onClick={handleCancel} className="gap-2">
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                </DialogFooter>
              </>
            )}

            {isShaMismatchDialog && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <GitMerge className="h-5 w-5" />
                    Sync conflict detected
                  </DialogTitle>
                  <DialogDescription>
                    File <span className="font-mono bg-muted px-1 rounded">{fileName}</span> Push failed
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-4">
                  <Alert variant="destructive">
                    <AlertDescription>
                      The remote file SHA does not match the local record; it may have been changed on another device.
                    </AlertDescription>
                  </Alert>

                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Local SHA:</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {localSha ? localSha.slice(0, 7) : 'N/A'}
                      </code>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Remote file SHA:</span>
                      <code className="bg-muted px-2 py-1 rounded text-xs">
                        {remoteSha ? remoteSha.slice(0, 7) : 'N/A'}
                      </code>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={handleConfirm} className="gap-2">
                    <ArrowUpFromLine className="h-4 w-4" />
                    Force upload (overwrite remote)
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
