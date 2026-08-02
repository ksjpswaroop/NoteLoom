"use client"

import React from "react"
import { AlignVerticalJustifyCenter } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import { useTranslations } from 'next-intl'

export function ClearContext() {
  const { insert } = useChatStore()
  const { currentTagId } = useTagStore()
  const t = useTranslations('record.chat.input.clearContext')

  const handleClearContext = async () => {
    // ，
    await insert({
      tagId: currentTagId,
      role: 'system',
      content: 'Context cleared. Later messages will only carry content after this point.',
      type: 'clear',
      inserted: true,
      image: undefined,
    })
  }

  return (
    <div>
      <TooltipButton
        variant="ghost"
        size="icon"
        icon={<AlignVerticalJustifyCenter className="size-4" />}
        tooltipText={t('tooltip')}
        side="bottom"
        onClick={handleClearContext}
      />
    </div>
  )
}
