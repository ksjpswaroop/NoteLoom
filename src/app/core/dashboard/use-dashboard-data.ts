'use client'

import { useEffect, useState } from 'react'
import { format, startOfDay, subDays } from 'date-fns'

import { getAllActivityEvents, type ActivityEvent } from '@/db/activity'
import { getCanvasProjects } from '@/db/canvases'
import { getAllMarks, type Mark } from '@/db/marks'
import { getTags } from '@/db/tags'
import { getAllMarkdownFiles, type MarkdownFile } from '@/lib/files'

export interface DashboardKpis {
  notesCount: number
  recordsCount: number
  canvasesCount: number
  tagsCount: number
  activeDays7: number
}

export interface ActivityChartPoint {
  day: string
  label: string
  records: number
  writing: number
  chats: number
  total: number
}

export interface DashboardData {
  loading: boolean
  kpis: DashboardKpis
  chart: ActivityChartPoint[]
  recentActivity: ActivityEvent[]
  recentMarks: Mark[]
  recentNotes: MarkdownFile[]
}

const EMPTY: DashboardData = {
  loading: true,
  kpis: {
    notesCount: 0,
    recordsCount: 0,
    canvasesCount: 0,
    tagsCount: 0,
    activeDays7: 0,
  },
  chart: [],
  recentActivity: [],
  recentMarks: [],
  recentNotes: [],
}

function buildChart(events: ActivityEvent[]): { chart: ActivityChartPoint[]; activeDays7: number } {
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = startOfDay(subDays(new Date(), 13 - index))
    return {
      key: format(date, 'yyyy-MM-dd'),
      label: format(date, 'MMM d'),
      start: date.getTime(),
      end: date.getTime() + 24 * 60 * 60 * 1000 - 1,
    }
  })

  const chart = days.map((day) => {
    const dayEvents = events.filter(
      (event) => event.createdAt >= day.start && event.createdAt <= day.end
    )
    const records = dayEvents.filter((event) => event.source === 'record').length
    const writing = dayEvents.filter((event) => event.source === 'writing').length
    const chats = dayEvents.filter((event) => event.source === 'chat').length
    return {
      day: day.key,
      label: day.label,
      records,
      writing,
      chats,
      total: records + writing + chats,
    }
  })

  const activeDays7 = chart.slice(-7).filter((point) => point.total > 0).length
  return { chart, activeDays7 }
}

export function useDashboardData(): DashboardData {
  const [data, setData] = useState<DashboardData>(EMPTY)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [marks, notes, canvases, tags, activity] = await Promise.all([
          getAllMarks().catch(() => [] as Mark[]),
          getAllMarkdownFiles(true).catch(() => [] as MarkdownFile[]),
          getCanvasProjects().catch(() => []),
          getTags().catch(() => []),
          getAllActivityEvents().catch(() => [] as ActivityEvent[]),
        ])

        if (cancelled) return

        const activeMarks = marks.filter((mark) => mark.deleted === 0)
        const { chart, activeDays7 } = buildChart(activity)

        setData({
          loading: false,
          kpis: {
            notesCount: notes.length,
            recordsCount: activeMarks.length,
            canvasesCount: canvases.length,
            tagsCount: tags.length,
            activeDays7,
          },
          chart,
          recentActivity: activity.slice(0, 12),
          recentMarks: activeMarks.slice(0, 8),
          recentNotes: [...notes]
            .sort((a, b) => {
              const aTime = a.modifiedAt?.getTime() ?? a.metadata?.modifiedAt?.getTime() ?? 0
              const bTime = b.modifiedAt?.getTime() ?? b.metadata?.modifiedAt?.getTime() ?? 0
              return bTime - aTime
            })
            .slice(0, 6),
        })
      } catch (error) {
        console.error('Failed to load dashboard data:', error)
        if (!cancelled) {
          setData((current) => ({ ...current, loading: false }))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  return data
}
