import { TooltipButton } from "@/components/tooltip-button"
import { Chat } from "@/db/chats"
import { Copy, Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { writeText } from "tauri-plugin-clipboard-api"

interface CopyControlProps {
  chat: Chat
  translatedContent?: string
}

export function CopyControl({ chat, translatedContent }: CopyControlProps) {
  const t = useTranslations()
  const [isCopied, setIsCopied] = useState(false)
  
  //
  async function handleCopy() {
    if (!chat.content || isCopied) return
    
    try {
      //
      let textToCopy = translatedContent || chat.content
      
      //
      textToCopy = textToCopy.trim()
      
      if (!textToCopy) {
        console.warn('Translated message')
        return
      }
      
      await writeText(textToCopy)
      setIsCopied(true)
      
      // 2
      setTimeout(() => {
        setIsCopied(false)
      }, 2000)
    } catch (error) {
      console.error('Copy failed:', error)
    }
  }

  if (!chat.content || chat.type !== 'chat') {
    return null
  }

  return (
    <>
      <TooltipButton
        icon={
          isCopied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )
        }
        tooltipText={
          isCopied ? t('record.chat.messageControl.copied') : 
          t('record.chat.messageControl.copy')
        }
        onClick={handleCopy}
        variant="ghost"
        size="sm"
        disabled={isCopied}
      />
    </>
  )
}
