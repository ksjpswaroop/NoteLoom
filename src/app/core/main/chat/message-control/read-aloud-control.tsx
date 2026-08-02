import { TooltipButton } from "@/components/tooltip-button"
import { Chat } from "@/db/chats"
import { Volume2, VolumeX, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { textToSpeechAndPlay, stopCurrentAudio } from "@/lib/audio"
import useSettingStore from "@/stores/setting"

interface ReadAloudControlProps {
  chat: Chat
  translatedContent?: string
}

export function ReadAloudControl({ chat, translatedContent }: ReadAloudControlProps) {
  const t = useTranslations()
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // /
  async function handleTextToSpeech() {
    // ，
    if (isPlaying) {
      stopCurrentAudio()
      setIsPlaying(false)
      setIsLoading(false)
      return
    }
    
    // ，
    if (!chat.content || isLoading) return
    
    setIsLoading(true)
    
    try {
      //
      let textToRead = translatedContent || chat.content
      
      //
      textToRead = textToRead.trim()
      
      if (!textToRead) {
        console.warn('Nothing to read aloud')
        return
      }
      
      // speed
      const { aiModelList, audioModel } = useSettingStore.getState()
      const audioConfig = aiModelList.find(config => config.key === audioModel)
      const speed = audioConfig?.speed
      
      // API，voice、speed
      await textToSpeechAndPlay(textToRead, undefined, speed, (playing: boolean) => {
        setIsPlaying(playing)
        if (playing) {
          setIsLoading(false) // loadingStatus
        }
      })
    } catch (error) {
      console.error('Read aloud failed:', error)
      //
    } finally {
      setIsLoading(false)
      setIsPlaying(false)
    }
  }

  if (chat.type !== 'chat') {
    return null
  }

  return (
    <>
      <TooltipButton
        icon={
          isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )
        }
        tooltipText={
          isLoading ? t('record.chat.messageControl.loading') : 
          isPlaying ? t('record.chat.messageControl.stop') : 
          t('record.chat.messageControl.readAloud')
        }
        onClick={handleTextToSpeech}
        variant="ghost"
        size="sm"
        disabled={isLoading}
      />
    </>
  )
}
