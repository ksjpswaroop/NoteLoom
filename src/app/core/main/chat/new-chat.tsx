"use client"
import * as React from "react"
import { MessageSquarePlus } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore from "@/stores/chat"
import { useTranslations } from 'next-intl'

export function NewChat() {
  const { startNewConversation, chats } = useChatStore()
  const t = useTranslations()

  function newChatHandler() {
    startNewConversation()
  }

  //
  const isDisabled = chats.length === 0

  return (
    <div>
      <TooltipButton icon={<MessageSquarePlus />} tooltipText={t('record.chat.input.newChat')} side="bottom" onClick={newChatHandler} disabled={isDisabled}/>
    </div>
  )
}
