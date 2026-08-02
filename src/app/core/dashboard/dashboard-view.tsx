'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  MessageSquare,
  NotebookPen,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  StickyNote,
  Tags,
} from 'lucide-react'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { formatDistanceToNow } from 'date-fns'

import { ActivityDrawer } from '@/components/activity/activity-drawer'
import { SearchDialog } from '@/components/search-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useSyncStore from '@/stores/sync'
import { useSidebarStore } from '@/stores/sidebar'
import emitter from '@/lib/emitter'
import { useDashboardData } from './use-dashboard-data'

const chartConfig = {
  total: {
    label: 'Activity',
    color: 'hsl(var(--primary))',
  },
  records: {
    label: 'Records',
    color: 'hsl(var(--chart-1))',
  },
  writing: {
    label: 'Writing',
    color: 'hsl(var(--chart-3))',
  },
} satisfies ChartConfig

const navItems = [
  { id: 'dashboard', href: '/core/dashboard', icon: LayoutDashboard, labelKey: 'dashboard' as const },
  { id: 'write', href: '/core/main', icon: SquarePen, labelKey: 'write' as const },
] as const

function sourceLabel(source: string) {
  switch (source) {
    case 'record':
      return 'Record'
    case 'writing':
      return 'Writing'
    case 'chat':
      return 'Chat'
    default:
      return source
  }
}

export function DashboardView() {
  const t = useTranslations('navigation')
  const tDash = useTranslations('dashboard')
  const router = useRouter()
  const pathname = usePathname()
  const data = useDashboardData()
  const { openSettings } = useSettingsDialogStore()
  const { userInfo } = useSyncStore()
  const { setLeftSidebarTab, showCenterPanel } = useSidebarStore()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const displayName = userInfo?.name || userInfo?.login || tDash('guestUser')
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  async function navigateTo(href: string) {
    setMobileNavOpen(false)
    router.push(href)
    const store = await Store.load('store.json')
    await store.set('currentPage', href)
    await store.save()
  }

  async function goToWrite(tab?: 'files' | 'notes') {
    await navigateTo('/core/main')
    if (tab) {
      await setLeftSidebarTab(tab)
    }
    await showCenterPanel()
  }

  function triggerQuickRecord(type: 'text' | 'recording' | 'todo') {
    void goToWrite('notes').then(() => {
      if (type === 'text') emitter.emit('toolbar-shortcut-text')
      if (type === 'recording') emitter.emit('toolbar-shortcut-recording')
      if (type === 'todo') emitter.emit('toolbar-shortcut-todo')
    })
  }

  const kpis = [
    {
      label: tDash('kpis.notes'),
      value: data.kpis.notesCount,
      hint: tDash('kpis.notesHint'),
      icon: FileText,
    },
    {
      label: tDash('kpis.records'),
      value: data.kpis.recordsCount,
      hint: tDash('kpis.recordsHint'),
      icon: StickyNote,
    },
    {
      label: tDash('kpis.canvases'),
      value: data.kpis.canvasesCount,
      hint: tDash('kpis.canvasesHint'),
      icon: Sparkles,
    },
    {
      label: tDash('kpis.activeDays'),
      value: data.kpis.activeDays7,
      hint: tDash('kpis.activeDaysHint'),
      icon: Activity,
    },
  ]

  const renderNav = (collapsed: boolean, showCollapseToggle: boolean) => (
    <nav aria-label={tDash('navLabel')} className="flex h-full flex-col">
      <div className={cn('px-4 pb-6 pt-2', collapsed && 'px-2')}>
        <p
          className={cn(
            'noteloom-brand-wordmark text-lg tracking-tight text-foreground',
            collapsed && 'sr-only'
          )}
        >
          NoteLoom
        </p>
        {!collapsed && (
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {tDash('eyebrow')}
          </p>
        )}
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void navigateTo(item.href)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-200',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  collapsed && 'justify-center px-2'
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className={cn(collapsed && 'sr-only')}>{t(item.labelKey)}</span>
              </button>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={() => {
              setMobileNavOpen(false)
              openSettings()
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground',
              collapsed && 'justify-center px-2'
            )}
          >
            <Settings className="size-4 shrink-0" aria-hidden="true" />
            <span className={cn(collapsed && 'sr-only')}>{t('setting')}</span>
          </button>
        </li>
      </ul>

      {showCollapseToggle && (
        <div className={cn('border-t px-3 py-4', collapsed && 'px-2')}>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-expanded={!collapsed}
            aria-controls="dashboard-sidebar"
          >
            {collapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <>
                <ChevronLeft className="size-4" aria-hidden="true" />
                <span>{tDash('collapseSidebar')}</span>
              </>
            )}
          </button>
        </div>
      )}
    </nav>
  )

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <motion.aside
        id="dashboard-sidebar"
        initial={false}
        animate={{ width: sidebarCollapsed ? 72 : 220 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="relative z-20 hidden h-full shrink-0 border-r border-border/70 bg-background md:block"
      >
        {renderNav(sidebarCollapsed, true)}
      </motion.aside>

      {/* Mobile nav drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[280px] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{tDash('navLabel')}</SheetTitle>
            <SheetDescription>{tDash('navDescription')}</SheetDescription>
          </SheetHeader>
          <div className="h-full pt-2">{renderNav(false, false)}</div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Page top bar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-4 lg:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label={tDash('openNav')}
          >
            <PanelLeft className="size-4" />
          </Button>

          <div className="relative min-w-0 flex-1 max-w-xl">
            <label htmlFor="dashboard-search" className="sr-only">
              {t('search')}
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="dashboard-search"
              readOnly
              placeholder={t('searchPlaceholder')}
              className="h-9 cursor-pointer border-border/70 bg-muted/40 pl-9 text-sm shadow-none transition-colors hover:bg-muted/70"
              onClick={() => setSearchOpen(true)}
              onFocus={() => setSearchOpen(true)}
            />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={t('activity')}
              onClick={() => setActivityOpen(true)}
            >
              <Bell className="size-4" />
              {data.recentActivity.length > 0 && (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 gap-2 px-2"
                  aria-label={tDash('userMenu')}
                >
                  <Avatar size="sm">
                    {userInfo?.avatar_url ? (
                      <AvatarImage src={userInfo.avatar_url} alt={displayName} />
                    ) : null}
                    <AvatarFallback className="text-[10px]">{initials || 'NL'}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[120px] truncate text-xs text-muted-foreground sm:inline">
                    {displayName}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {userInfo?.login ? `@${userInfo.login}` : tDash('localWorkspace')}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void goToWrite('files')}>
                  <NotebookPen className="size-4" />
                  {tDash('actions.openNotes')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openSettings()}>
                  <Settings className="size-4" />
                  {t('setting')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="min-w-0 flex-1">
            <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 lg:px-8">
              <div className="space-y-1">
                <h1 className="text-2xl font-medium tracking-tight text-foreground">
                  {tDash('title')}
                </h1>
                <p className="max-w-xl text-sm text-muted-foreground">{tDash('subtitle')}</p>
              </div>

              {/* KPI cards */}
              <section aria-label={tDash('kpis.label')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {kpis.map((kpi, index) => {
                  const Icon = kpi.icon
                  return (
                    <motion.div
                      key={kpi.label}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05, duration: 0.35 }}
                    >
                      <Card
                        size="sm"
                        className="border-0 bg-card/80 shadow-none ring-1 ring-border/60 transition-colors duration-200 hover:ring-primary/30"
                      >
                        <CardHeader className="gap-3">
                          <div className="flex items-center justify-between">
                            <CardDescription className="text-[11px] uppercase tracking-[0.16em]">
                              {kpi.label}
                            </CardDescription>
                            <Icon className="size-3.5 text-primary/80" aria-hidden="true" />
                          </div>
                          <CardTitle className="text-3xl font-medium tabular-nums tracking-tight">
                            {data.loading ? '—' : kpi.value}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-xs text-muted-foreground">{kpi.hint}</p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )
                })}
              </section>

              <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                {/* Primary chart */}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.45 }}
                >
                  <Card className="border-0 shadow-none ring-1 ring-border/60">
                    <CardHeader>
                      <CardTitle className="text-base">{tDash('chart.title')}</CardTitle>
                      <CardDescription>{tDash('chart.description')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={chartConfig} className="aspect-[16/9] w-full">
                        <AreaChart
                          accessibilityLayer
                          data={data.chart}
                          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="dashboardActivityFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--color-total)" stopOpacity={0.28} />
                              <stop offset="100%" stopColor="var(--color-total)" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tickMargin={8}
                            minTickGap={24}
                          />
                          <YAxis
                            allowDecimals={false}
                            tickLine={false}
                            axisLine={false}
                            width={28}
                          />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Area
                            type="monotone"
                            dataKey="total"
                            stroke="var(--color-total)"
                            fill="url(#dashboardActivityFill)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Compact tags / records summary for mid layouts */}
                <Card className="border-0 shadow-none ring-1 ring-border/60 xl:hidden">
                  <CardHeader>
                    <CardTitle className="text-base">{tDash('quickActions.title')}</CardTitle>
                    <CardDescription>{tDash('quickActions.description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <QuickActionButtons
                      onNewNote={() => void goToWrite('files')}
                      onCapture={() => triggerQuickRecord('text')}
                      onRecord={() => triggerQuickRecord('recording')}
                      onTodo={() => triggerQuickRecord('todo')}
                      onTags={() => void goToWrite('notes')}
                      labels={{
                        newNote: tDash('actions.newNote'),
                        capture: tDash('actions.captureText'),
                        record: tDash('actions.recordVoice'),
                        todo: tDash('actions.addTodo'),
                        tags: tDash('actions.browseTags'),
                      }}
                    />
                  </CardContent>
                </Card>
              </section>

              {/* Recent activity table */}
              <section aria-label={tDash('activity.title')}>
                <Card className="border-0 shadow-none ring-1 ring-border/60">
                  <CardHeader>
                    <CardTitle className="text-base">{tDash('activity.title')}</CardTitle>
                    <CardDescription>{tDash('activity.description')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {data.recentActivity.length === 0 && !data.loading ? (
                      <p className="py-10 text-center text-sm text-muted-foreground">
                        {tDash('activity.empty')}
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[110px] text-[11px] uppercase tracking-[0.14em]">
                              {tDash('activity.columns.type')}
                            </TableHead>
                            <TableHead className="text-[11px] uppercase tracking-[0.14em]">
                              {tDash('activity.columns.title')}
                            </TableHead>
                            <TableHead className="hidden text-[11px] uppercase tracking-[0.14em] md:table-cell">
                              {tDash('activity.columns.detail')}
                            </TableHead>
                            <TableHead className="w-[140px] text-right text-[11px] uppercase tracking-[0.14em]">
                              {tDash('activity.columns.when')}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.recentActivity.map((event) => (
                            <TableRow key={event.id} className="hover:bg-muted/40">
                              <TableCell>
                                <span className="inline-flex items-center rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary">
                                  {sourceLabel(event.source)}
                                </span>
                              </TableCell>
                              <TableCell className="max-w-[220px] truncate font-medium">
                                {event.title}
                              </TableCell>
                              <TableCell className="hidden max-w-[280px] truncate text-muted-foreground md:table-cell">
                                {event.description || event.path || '—'}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {formatDistanceToNow(event.createdAt, { addSuffix: true })}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </section>
            </main>
          </ScrollArea>

          {/* Right rail — desktop */}
          <aside
            aria-label={tDash('quickActions.title')}
            className="hidden w-64 shrink-0 border-l border-border/70 bg-background xl:flex xl:flex-col"
          >
            <div className="border-b border-border/70 px-5 py-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {tDash('quickActions.title')}
              </p>
              <p className="mt-1 text-sm text-foreground">{tDash('quickActions.description')}</p>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <QuickActionButtons
                onNewNote={() => void goToWrite('files')}
                onCapture={() => triggerQuickRecord('text')}
                onRecord={() => triggerQuickRecord('recording')}
                onTodo={() => triggerQuickRecord('todo')}
                onTags={() => void goToWrite('notes')}
                labels={{
                  newNote: tDash('actions.newNote'),
                  capture: tDash('actions.captureText'),
                  record: tDash('actions.recordVoice'),
                  todo: tDash('actions.addTodo'),
                  tags: tDash('actions.browseTags'),
                }}
              />
            </div>
            <div className="border-t border-border/70 px-5 py-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {tDash('workspace')}
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{tDash('kpis.tags')}</dt>
                  <dd className="tabular-nums">{data.loading ? '—' : data.kpis.tagsCount}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{tDash('kpis.records')}</dt>
                  <dd className="tabular-nums">{data.loading ? '—' : data.kpis.recordsCount}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <ActivityDrawer open={activityOpen} onOpenChange={setActivityOpen} />
    </div>
  )
}

function QuickActionButtons({
  onNewNote,
  onCapture,
  onRecord,
  onTodo,
  onTags,
  labels,
}: {
  onNewNote: () => void
  onCapture: () => void
  onRecord: () => void
  onTodo: () => void
  onTags: () => void
  labels: {
    newNote: string
    capture: string
    record: string
    todo: string
    tags: string
  }
}) {
  const actions = [
    { label: labels.newNote, icon: Plus, onClick: onNewNote, primary: true },
    { label: labels.capture, icon: NotebookPen, onClick: onCapture },
    { label: labels.record, icon: MessageSquare, onClick: onRecord },
    { label: labels.todo, icon: StickyNote, onClick: onTodo },
    { label: labels.tags, icon: Tags, onClick: onTags },
  ]

  return (
    <>
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <Button
            key={action.label}
            type="button"
            variant={action.primary ? 'default' : 'outline'}
            className={cn(
              'h-10 justify-start gap-2 text-sm transition-all duration-200',
              !action.primary && 'border-border/70 bg-transparent hover:bg-muted/60'
            )}
            onClick={action.onClick}
          >
            <Icon className="size-4" aria-hidden="true" />
            {action.label}
          </Button>
        )
      })}
    </>
  )
}
