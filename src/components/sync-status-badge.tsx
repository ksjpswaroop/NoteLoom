'use client'

import * as React from 'react'
import { CheckCircle2, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Loader2, CloudOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { VariantProps } from 'class-variance-authority'
import { badgeVariants } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSyncManager } from '@/hooks/use-sync-manager'
import { cn } from '@/lib/utils'

export type SyncStatusType = 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown' | 'syncing' | 'offline'

interface SyncStatusBadgeProps {
  path?: string
  showLabel?: boolean
  className?: string
  badgeProps?: React.ComponentProps<typeof Badge>
}

export function SyncStatusBadge({ path, showLabel = false, className, badgeProps }: SyncStatusBadgeProps) {
  const { status, lastSyncTime, isPending, checkStatus } = useSyncManager(path)
  const [isLoading, setIsLoading] = React.useState(false)

  const refreshStatus = async () => {
    if (!path) return
    setIsLoading(true)
    try {
      await checkStatus(path)
    } finally {
      setIsLoading(false)
    }
  }

  const statusConfig: Record<SyncStatusType, {
    icon: typeof CheckCircle2
    label: string
    variant: VariantProps<typeof badgeVariants>['variant']
    iconClassName: string
  }> = {
    synced: {
      icon: CheckCircle2,
      label: 'Synced',
      variant: 'secondary',
      iconClassName: 'text-primary',
    },
    local_newer: {
      icon: ArrowUpCircle,
      label: 'Pending push',
      variant: 'outline',
      iconClassName: 'text-primary',
    },
    remote_newer: {
      icon: ArrowDownCircle,
      label: 'Updates available',
      variant: 'outline',
      iconClassName: 'text-foreground',
    },
    conflict: {
      icon: AlertTriangle,
      label: 'Conflict',
      variant: 'destructive',
      iconClassName: 'text-destructive',
    },
    unknown: {
      icon: CloudOff,
      label: 'Not synced',
      variant: 'secondary',
      iconClassName: 'text-muted-foreground',
    },
    syncing: {
      icon: Loader2,
      label: 'Syncing',
      variant: 'secondary',
      iconClassName: 'animate-spin text-primary',
    },
    offline: {
      icon: CloudOff,
      label: 'Offline',
      variant: 'outline',
      iconClassName: 'text-muted-foreground',
    },
  }

  const currentStatus = status === 'syncing' ? 'syncing' : status || 'unknown'
  const config = statusConfig[currentStatus]
  const Icon = config.icon

  const formatLastSyncTime = () => {
    if (!lastSyncTime) return 'No sync history'
    const date = new Date(lastSyncTime)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just synced'
    if (diffMins < 60) return `${diffMins} minutes ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`
    return date.toLocaleDateString('en-US')
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={config.variant}
          className={cn(
            'gap-1.5 cursor-pointer',
            className
          )}
          onClick={refreshStatus}
          {...badgeProps}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon className={cn('size-3.5', config.iconClassName)} />
          )}
          {showLabel && <span className="text-xs font-medium">{config.label}</span>}
          {isPending && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="flex flex-col gap-1">
          <p className="font-medium">{config.label}</p>
          {path && <p className="text-xs text-muted-foreground truncate">{path}</p>}
          <p className="text-xs text-muted-foreground">{formatLastSyncTime()}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

// ，
export function SyncStatusIcon({ path, className }: { path?: string; className?: string }) {
  return <SyncStatusBadge path={path} showLabel={false} className={className} />
}

//
export function SyncStatusLabel({ path, className }: { path?: string; className?: string }) {
  return <SyncStatusBadge path={path} showLabel={true} className={className} />
}
