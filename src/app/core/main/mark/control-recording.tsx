import { insertMark } from "@/db/marks"
import useMarkStore from "@/stores/mark"
import useSettingStore from "@/stores/setting"
import useRecordingStore from "@/stores/recording"
import { Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { transcribeRecording } from '@/lib/audio'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile, BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs'
import { useRef } from 'react'
import { isMobileDevice } from '@/lib/check'
import { convertToWav } from '@/lib/audio-converter'
import { useEffect } from 'react'
import emitter from '@/lib/emitter'
import { getTranscriptionFallbackMessage } from '@/lib/speech/transcription-fallback.ts'
import { useRecordCompletion } from './use-record-completion'
import { getDefaultRecordSaveTagId } from '@/lib/record-save-target'

export function ControlRecording() {
  const t = useTranslations();
  const { sttModel } = useSettingStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();
  const lastClickTime = useRef<number>(0);
  const clickTimer = useRef<NodeJS.Timeout | null>(null);
  const completeRecord = useRecordCompletion();

  const { addQueue, removeQueue } = useMarkStore()
  
  //
  const {
    isRecording,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useRecordingStore()
  
  //
  useEffect(() => {
    const handleToggleRecording = () => {
      if (useRecordingStore.getState().isRecording) {
        void handleStop()
      } else {
        void handleStart()
      }
    }
    
    emitter.on('toolbar-shortcut-recording', handleToggleRecording)
    return () => {
      emitter.off('toolbar-shortcut-recording', handleToggleRecording)
    }
  })

  //
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  //
  const handleStart = async () => {
    try {
      await startRecording()
    } catch (error) {
      cancelRecording()
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.startError'),
        variant: 'destructive'
      })
    }
  }
  
  //
  const handleStop = async () => {
    try {
      const audioBlob = await stopRecording()
      if (!audioBlob) {
        throw new Error(t('recording.noAudioData'))
      }
      
      // WAV
      const wavBlob = await convertToWav(audioBlob)
      
      // ID
      const queueId = `recording-${Date.now()}`
      const tagId = await getDefaultRecordSaveTagId()
      
      //
      addQueue({
        queueId,
        tagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })

      // （ WAV）
      processTranscription(wavBlob, queueId, tagId)
      
    } catch (error) {
      console.error('Failed', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.startError'),
        variant: 'destructive'
      })
    }
  }
  
  //
  const saveAudioFile = async (audioBlob: Blob): Promise<string> => {
    const timestamp = Date.now()
    // MIME
    const extension = audioBlob.type.includes('wav') ? 'wav' :
                      audioBlob.type.includes('mpeg') || audioBlob.type.includes('mp3') ? 'mp3' :
                      audioBlob.type.includes('mp4') || audioBlob.type.includes('m4a') ? 'mp4' : 
                      audioBlob.type.includes('webm') ? 'webm' : 
                      audioBlob.type.includes('ogg') ? 'ogg' :
                      audioBlob.type.includes('flac') ? 'flac' :
                      audioBlob.type.includes('aac') ? 'aac' : 'webm'
    const filename = `recording_${timestamp}.${extension}`
    const audioDir = 'recordings'
    
    //
    const dirExists = await exists(audioDir, { baseDir: BaseDirectory.AppData })
    if (!dirExists) {
      await mkdir(audioDir, { baseDir: BaseDirectory.AppData, recursive: true })
    }
    
    // Blob ArrayBuffer
    const arrayBuffer = await audioBlob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    //
    const filePath = `${audioDir}/${filename}`
    await writeFile(filePath, uint8Array, { baseDir: BaseDirectory.AppData })
    
    return filePath
  }
  
  //
  const processTranscription = async (
    audioBlob: Blob,
    queueId: string,
    tagId: number,
  ) => {
    let audioPath = ''
    try {
      // Blob
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('Audio data is empty')
      }
      
      //
      audioPath = await saveAudioFile(audioBlob)
      
      let transcription = ''
      let transcriptionError: string | null = null
      try {
        transcription = await transcribeRecording(audioBlob)
      } catch (error) {
        console.error('STT', error)
        transcriptionError =
          error instanceof Error ? error.message : t('recording.transcriptionError')
      }

      const noContent = !transcription || !transcription.trim()
      const {
        speechToTextMode,
        localSttEngine,
      } = useSettingStore.getState()
      const fallbackMessage = getTranscriptionFallbackMessage({
        sttModel,
        speechToTextMode,
        localSttEngine,
      })
      // Keep a stable fallback string in the mark so retry UI can detect it.
      const displayContent = noContent
        ? (fallbackMessage || t('recording.noContentDetected'))
        : transcription

      const result = await insertMark({
        tagId,
        type: 'recording',
        desc: displayContent.substring(0, 100),
        content: displayContent,
        url: audioPath  // Save
      })
      const markId = Number(result.lastInsertId || 0) || null

      removeQueue(queueId)

      if (noContent) {
        toast({
          title: t('recording.audioSavedTitle'),
          description: transcriptionError || fallbackMessage || t('recording.audioSavedDesc'),
          variant: 'destructive',
        })
        // Refresh the list so the saved audio record is visible; skip the success toast.
        await completeRecord({
          markId,
          tagId,
          typeLabel: t('record.mark.type.recording'),
          silentToast: true,
        })
      } else {
        await completeRecord({
          markId,
          tagId,
          typeLabel: t('record.mark.type.recording'),
        })
      }
    } catch (error) {
      console.error('Recognition failed:', error)
      
      //
      removeQueue(queueId)
      
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : t('recording.transcriptionError'),
        variant: 'destructive'
      })
    } finally {
    }
  }
  
  //
  const handleFileSelect = async () => {
    try {
      // HTML5 file input
      if (isMobile) {
        fileInputRef.current?.click()
        return
      }

      // PC Tauri dialog
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Audio',
          extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'wma', 'webm']
        }]
      })

      if (!selected) return

      //
      const filePath = selected as string
      const fileData = await readFile(filePath)
      
      // MIME
      const extension = filePath.split('.').pop()?.toLowerCase()
      const mimeType = extension === 'wav' ? 'audio/wav' :
                      extension === 'mp3' ? 'audio/mpeg' :
                      extension === 'm4a' ? 'audio/mp4' :
                      extension === 'mp4' ? 'audio/mp4' :
                      extension === 'ogg' ? 'audio/ogg' :
                      extension === 'webm' ? 'audio/webm' :
                      'audio/mpeg'
      
      // Uint8Array ArrayBuffer
      const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
      const audioBlob = new Blob([buffer], { type: mimeType })

      // ID
      const queueId = `recording-${Date.now()}`
      const tagId = await getDefaultRecordSaveTagId()
      
      //
      addQueue({
        queueId,
        tagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      //
      processTranscription(audioBlob, queueId, tagId)
      
    } catch (error) {
      console.error('File Failed', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : 'File Failed',
        variant: 'destructive'
      })
    }
  }
  
  //
  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      // ID
      const queueId = `recording-${Date.now()}`
      const tagId = await getDefaultRecordSaveTagId()
      
      //
      addQueue({
        queueId,
        tagId,
        type: 'recording',
        progress: t('recording.processing'),
        startTime: Date.now()
      })
      
      // （File Blob，）
      processTranscription(file, queueId, tagId)
      
      // input
      event.target.value = ''
    } catch (error) {
      console.error('File Failed', error)
      toast({
        title: t('recording.error'),
        description: error instanceof Error ? error.message : 'File Failed',
        variant: 'destructive'
      })
    }
  }

  // （，）
  const handleClick = () => {
    const now = Date.now()
    const timeSinceLastClick = now - lastClickTime.current
    
    // ：300ms
    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
      // ：，
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
        clickTimer.current = null
      }
      lastClickTime.current = 0 // Reset，
      void handleFileSelect()
    } else {
      // ：，
      lastClickTime.current = now
      
      //
      if (clickTimer.current) {
        clearTimeout(clickTimer.current)
      }
      
      // 300ms，
      clickTimer.current = setTimeout(() => {
        if (isRecording) {
          void handleStop()
        } else {
          void handleStart()
        }
        clickTimer.current = null
      }, 300)
    }
  }
  
  // tooltip
  const getTooltipText = () => {
    if (isRecording) {
      return `${t('recording.recording')} ${formatDuration(recordingDuration)}`
    }
    return `${t('record.mark.type.recording')} (${t('recording.doubleClickToSelectFile')})`
  }

  return (
    <>
      {/* */}
      {isMobile && (
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.wma,.webm"
          onChange={handleFileInputChange}
          className="hidden"
        />
      )}
      
      <Tooltip>
        <TooltipTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={handleClick}
          className={`relative ${isRecording ? 'text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950' : ''}`}
        >
          <Mic className="size-4" />
          {isRecording && (
            <span className="absolute top-1 right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{getTooltipText()}</p>
      </TooltipContent>
      </Tooltip>
    </>
  )
}
