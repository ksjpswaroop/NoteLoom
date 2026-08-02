'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs'

interface AudioPlayerProps {
  audioPath: string
  compact?: boolean
}

export function AudioPlayer({ audioPath, compact = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioSrc, setAudioSrc] = useState<string>('')
  const [isReady, setIsReady] = useState(false)

  //
  useEffect(() => {
    let blobUrl: string | null = null
    
    const loadAudio = async () => {
      try {
        //
        const fileData = await readFile(audioPath, { baseDir: BaseDirectory.AppData })
        
        // MIME
        const extension = audioPath.split('.').pop()?.toLowerCase()
        const mimeType = extension === 'mp4' ? 'audio/mp4' :
                        extension === 'webm' ? 'audio/webm' :
                        extension === 'ogg' ? 'audio/ogg' :
                        extension === 'wav' ? 'audio/wav' :
                        extension === 'm4a' ? 'audio/mp4' :
                        extension === 'mp3' ? 'audio/mpeg' :
                        'audio/webm'
        
        // Blob URL
        const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer
        const blob = new Blob([buffer], { type: mimeType })
        blobUrl = URL.createObjectURL(blob)
        
        setAudioSrc(blobUrl)
      } catch (error) {
        console.error('Failed', error, 'Failed', audioPath)
      }
    }
    
    loadAudio()
    
    //
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [audioPath])


  // /
  const togglePlay = async () => {
    if (!audioRef.current || !isReady) return
    
    try {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        await audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    } catch (error) {
      console.error('Playback failed:', error)
      setIsPlaying(false)
    }
  }

  //
  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return
    const newTime = value[0]
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  //
  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) {
      return '0:00'
    }
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // ，
  if (!audioSrc) {
    if (compact) {
      return (
        <Button
          variant="ghost"
          size="icon"
          disabled
          className="size-5 shrink-0"
        >
          <Play className="size-3" />
        </Button>
      )
    }

    return (
      <div className="w-full py-1 px-2 bg-muted/30 rounded text-center text-xs text-muted-foreground">
        Loading audio...
      </div>
    )
  }

  if (compact) {
    return (
      <div className="flex items-center">
        <audio
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const duration = e.currentTarget.duration
            setDuration(duration)
            setIsReady(true)
          }}
          onCanPlay={() => {
            setIsReady(true)
          }}
          onEnded={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={(e) => {
            console.error('Audio load error:', e.currentTarget.error)
            setIsReady(false)
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={togglePlay}
          disabled={!isReady}
          className="size-5 shrink-0"
        >
          {isPlaying ? (
            <Pause className="size-3" />
          ) : (
            <Play className="size-3" />
          )}
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full flex items-center gap-1.5 py-1 pl-2 bg-muted/30 rounded">
      {/* */}
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const duration = e.currentTarget.duration
          setDuration(duration)
          setIsReady(true)
        }}
        onCanPlay={() => {
          setIsReady(true)
        }}
        onEnded={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={(e) => {
          console.error('Audio load error:', e.currentTarget.error)
          setIsReady(false)
        }}
        onLoadStart={() => {}}
        onLoadedData={() => {}}
      />

      {/* / */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlay}
        disabled={!isReady}
        className="size-3 shrink-0"
      >
        {isPlaying ? (
          <Pause className="size-3" />
        ) : (
          <Play className="size-3" />
        )}
      </Button>

      {/* */}
      <span className="text-xs text-muted-foreground shrink-0 w-9 text-right">
        {formatTime(currentTime)}
      </span>

      {/* */}
      <Slider
        value={[currentTime]}
        max={duration || 100}
        step={0.1}
        onValueChange={handleSeek}
        className="flex-1 cursor-pointer"
      />

      {/* */}
      <span className="text-xs text-muted-foreground shrink-0 w-9">
        {formatTime(duration)}
      </span>
    </div>
  )
}
