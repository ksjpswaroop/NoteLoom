'use client'

import { useTranslations } from 'next-intl'
import useChatStore from '@/stores/chat'
import { useMemo } from 'react'
import { Trash2, FileEdit, FileText, Lightbulb, ArrowRight, MessageCircle, MessageSquareDashed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import emitter from '@/lib/emitter'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/en'

// dayjs
dayjs.extend(relativeTime)

//
function formatRelativeTime(timestamp: number): string {
  const dayjsLocale = 'en'
  return dayjs(timestamp).locale(dayjsLocale).fromNow()
}

export default function ChatEmpty() {
  const t = useTranslations('record.chat.empty')

  const {
    conversations,
    currentConversationId,
    switchConversation,
    deleteConversation,
    isTemporaryConversation,
  } = useChatStore()

  // prompt -
  const quickPrompts = useMemo(() => [
    { id: 1, icon: <FileEdit className="w-4 h-4" />, text: t('quickPrompts.writeNote') || 'Help me write a note' },
    { id: 2, icon: <FileText className="w-4 h-4" />, text: t('quickPrompts.summarize') || 'Help me summarize this content' },
    { id: 3, icon: <Lightbulb className="w-4 h-4" />, text: t('quickPrompts.brainstorm') || 'Help me brainstorm some ideas' },
  ], [t])

  const handleQuickPrompt = (prompt: string) => {
    //
    emitter.emit('quick-prompt-insert', prompt)
  }

  // 3 （）
  const recentConversations = useMemo(() => {
    return conversations
      .filter(c => c.id !== currentConversationId && c.messageCount > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
  }, [conversations, currentConversationId])

  const handleSwitchConversation = async (id: number) => {
    await switchConversation(id)
  }

  const handleDelete = async (id: number) => {
    await deleteConversation(id)
  }

  if (isTemporaryConversation) {
    return (
      <Empty className="absolute inset-0 rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareDashed />
          </EmptyMedia>
          <EmptyTitle>{t('temporary.title')}</EmptyTitle>
          <EmptyDescription>{t('temporary.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="absolute top-0 right-0 w-full flex flex-col items-center justify-center h-full overflow-hidden">
      {/* Dashed background pattern - only visible when empty */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          backgroundPosition: 'center center'
        }}
      />

      {/* Gradient fade overlay on edges */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(to right, var(--background) 0%, transparent 15%, transparent 85%, var(--background) 100%),
            linear-gradient(to bottom, var(--background) 0%, transparent 15%, transparent 85%, var(--background) 100%)
          `
        }}
      />

      <div className="relative max-w-[340px] w-full px-2 space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">
              {t('title')}
            </h2>
          </div>
          <p className="text-muted-foreground text-sm">
            {t('subtitle')}
          </p>
        </div>

        {/* Quick Prompts */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground px-1">{t('quickPrompts.title') || 'Quick start'}</p>
          {quickPrompts.map((prompt) => (
            <button
              type="button"
              key={prompt.id}
              onClick={() => handleQuickPrompt(prompt.text)}
              className="group flex h-11 w-full cursor-pointer items-center rounded-lg border bg-primary-foreground px-4 text-left transition-colors hover:border-primary/50"
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-muted-foreground">{prompt.icon}</span>
                  <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {prompt.text}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100" />
              </div>
            </button>
          ))}
        </div>

        {/* Recent Conversations */}
        {recentConversations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground px-1">{t('recentConversations')}</p>
            {recentConversations.map(conv => (
              <div
                key={conv.id}
                className="group flex min-h-11 w-full items-stretch rounded-lg px-1 text-left transition-colors md:min-h-5"
              >
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 items-center text-left md:min-h-5"
                  onClick={() => void handleSwitchConversation(conv.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs font-medium truncate group-hover:text-primary transition-colors pr-14">
                      {conv.title}
                    </span>
                  </div>
                </button>
                <div className="relative ml-auto flex shrink-0 items-center justify-end">
                    {/* - */}
                    <span className="absolute right-0 hidden whitespace-nowrap text-xs text-muted-foreground opacity-100 transition-opacity duration-200 ease-out md:inline md:group-hover:opacity-0">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                    {/* - */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDelete(conv.id)
                      }}
                      className="z-50 size-8 opacity-100 transition-all duration-200 ease-out hover:text-destructive md:size-6 md:opacity-0 md:group-hover:opacity-100"
                      aria-label={t('deleteConversation')}
                      title={t('deleteConversation')}
                    >
                      <Trash2 className="w-3 h-3 transition-transform duration-150 group-hover/button:scale-110" />
                    </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
