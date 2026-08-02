import useSettingStore from '@/stores/setting'
import { resolvePreferredSpeechEngine } from '@/lib/speech/runtime.ts'
import type { SpeechTask } from '@/lib/speech/types.ts'
import { NO_TRANSCRIPTION_MESSAGE } from '@/lib/speech/transcription-fallback.ts'
import { inspectParakeetStt, transcribeWithParakeet } from '@/lib/speech/parakeet.ts'
import { blobToBytes, invokeAiBinary, invokeAiMultipart, resolveAiRequestConfig } from '@/lib/ai/tauri-client'

/**
 * API
 */
export function speakWithSystemVoice(
  text: string, 
  speed: number = 1,
  onStart?: () => void,
  onEnd?: () => void
): void {
  if (!text.trim()) {
    throw new Error('Text content is empty')
  }

  //
  if (!('speechSynthesis' in window)) {
    throw new Error('This browser does not support speech synthesis')
  }

  //
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  
  //
  utterance.rate = Math.max(0.1, Math.min(10, speed)) //
  utterance.volume = 1
  utterance.pitch = 1

  //
  if (onStart) {
    utterance.onstart = onStart
  }
  
  if (onEnd) {
    utterance.onend = onEnd
    utterance.onerror = onEnd
  }

  //
  window.speechSynthesis.speak(utterance)
}

/**
 * 
 */
export function stopSystemVoice(): void {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export interface AudioSpeechRequest {
  model: string
  input: string
  voice?: string
  speed?: number
}

export interface AudioSpeechResponse {
  audio: ArrayBuffer
}

export function resolveCurrentSpeechEngine(task: SpeechTask) {
  const { audioModel, sttModel, textToSpeechMode, speechToTextMode } = useSettingStore.getState()

  return resolvePreferredSpeechEngine(task, {
    audioModel,
    sttModel,
    textToSpeechMode,
    speechToTextMode,
  })
}

/**
 * AI
 */
export async function fetchAudioSpeech(text: string, customVoice?: string, customSpeed?: number): Promise<ArrayBuffer> {
  const { aiModelList, audioModel } = useSettingStore.getState()
  
  if (!audioModel) {
    throw new Error('No audio model is configured')
  }

  //
  let audioConfig = null
  
  // ，ID
  for (const config of aiModelList) {
    // models
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.id === audioModel && model.modelType === 'tts'
      )
      if (targetModel) {
        // AiConfig
        audioConfig = {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream
        }
        break
      }
    } else {
      // ：
      if (config.key === audioModel && config.modelType === 'tts') {
        audioConfig = config
        break
      }
    }
  }
  
  if (!audioConfig) {
    throw new Error('Audio model configuration was not found')
  }

  if (!audioConfig.baseURL || !audioConfig.apiKey) {
    throw new Error('Audio model configuration is incomplete')
  }

  // voicevoice，alloy
  const voice = customVoice || audioConfig.voice || 'alloy'
  // speedspeed，1
  const speed = customSpeed !== undefined ? customSpeed : (audioConfig.speed !== undefined ? audioConfig.speed : 1)

  const requestBody: AudioSpeechRequest = {
    model: audioConfig.model || 'tts-1',
    input: text,
    voice: voice,
    speed: speed
  }

  try {
    return await invokeAiBinary({
      config: await resolveAiRequestConfig(audioConfig),
      path: '/audio/speech',
      method: 'POST',
      body: requestBody,
    })
  } catch (error) {
    console.error('Error', error)
    throw error
  }
}

//
let currentAudioController: AudioController | null = null

/**
 * ，
 */
class AudioController {
  private audioContext: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private isPlaying = false
  private onPlayingChange?: (playing: boolean) => void

  constructor(onPlayingChange?: (playing: boolean) => void) {
    this.onPlayingChange = onPlayingChange
  }

  /**
 * 
 */
  async playAudioBuffer(audioBuffer: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // ，
        this.stop()

        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        
        this.audioContext.decodeAudioData(
          audioBuffer.slice(0), // Duplicatedetached buffer
          (decodedData) => {
            if (!this.audioContext) {
              reject(new Error('Audio context has been destroyed'))
              return
            }

            this.source = this.audioContext.createBufferSource()
            this.source.buffer = decodedData
            this.source.connect(this.audioContext.destination)
            
            this.source.onended = () => {
              this.cleanup()
              this.onPlayingChange?.(false)
              resolve()
            }
            
            this.isPlaying = true
            this.onPlayingChange?.(true)
            this.source.start(0)
          },
          (error) => {
            this.cleanup()
            reject(new Error(`Failed: ${error}`))
          }
        )
      } catch (error) {
        this.cleanup()
        reject(new Error(`Failed: ${error}`))
      }
    })
  }

  /**
 * 
 */
  stop(): void {
    if (this.source && this.isPlaying) {
      try {
        this.source.stop()
      } catch {
        //
      }
    }
    this.cleanup()
    this.onPlayingChange?.(false)
  }

  /**
 * 
 */
  private cleanup(): void {
    this.isPlaying = false
    this.source = null
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }

  /**
 * 
 */
  getIsPlaying(): boolean {
    return this.isPlaying
  }
}

/**
 * （）
 */
export function playAudioBuffer(audioBuffer: ArrayBuffer): Promise<void> {
  const controller = new AudioController()
  return controller.playAudioBuffer(audioBuffer)
}

/**
 * （）
 * AI，
 */
export async function textToSpeechAndPlay(
  text: string, 
  customVoice?: string,
  customSpeed?: number,
  onPlayingChange?: (playing: boolean) => void
): Promise<void> {
  if (!text.trim()) {
    throw new Error('Text content is empty')
  }

  const resolution = resolveCurrentSpeechEngine('tts')

  if (!resolution.available) {
    throw new Error('The current speech mode is unavailable. Check local speech support or model settings.')
  }

  if (resolution.engine === 'local') {
    try {
      //
      stopCurrentAudio()
      stopSystemVoice()
      
      if (onPlayingChange) {
        onPlayingChange(true)
      }
      
      const speed = customSpeed !== undefined ? customSpeed : 1
      
      speakWithSystemVoice(
        text,
        speed,
        () => {
          //
          if (onPlayingChange) {
            onPlayingChange(true)
          }
        },
        () => {
          //
          if (onPlayingChange) {
            onPlayingChange(false)
          }
        }
      )
      
      return
    } catch (error) {
      if (onPlayingChange) {
        onPlayingChange(false)
      }
      throw error
    }
  }

  try {
    //
    stopCurrentAudio()
    stopSystemVoice()
    
    const audioBuffer = await fetchAudioSpeech(text, customVoice, customSpeed)
    
    //
    currentAudioController = new AudioController(onPlayingChange)
    await currentAudioController.playAudioBuffer(audioBuffer)
  } catch (error) {
    console.error('Read aloud failed:', error)
    onPlayingChange?.(false)
    throw error
  }
}

/**
 * （AI）
 */
export function stopCurrentAudio(): void {
  if (currentAudioController) {
    currentAudioController.stop()
    currentAudioController = null
  }
  //
  stopSystemVoice()
}

/**
 * 
 */
export function getCurrentAudioPlayingState(): boolean {
  return currentAudioController?.getIsPlaying() ?? false
}

/**
 * 
 */
export interface AudioTranscriptionRequest {
  file: Blob
  model: string
}

/**
 * 
 */
export interface AudioTranscriptionResponse {
  text: string
}

export { NO_TRANSCRIPTION_MESSAGE }

export async function transcribeRecording(audioBlob: Blob): Promise<string> {
  const {
    sttModel,
    speechToTextMode,
    localSttEngine,
    parakeetModelId,
    parakeetLanguage,
    parakeetAttentionMode,
  } = useSettingStore.getState()

  const preferParakeet =
    localSttEngine === 'parakeet' &&
    (speechToTextMode === 'local' || speechToTextMode === 'auto')

  if (preferParakeet) {
    try {
      const status = await inspectParakeetStt(parakeetModelId)
      if (status.runtimeReady) {
        const result = await transcribeWithParakeet({
          audioBlob,
          fileName: getAudioFileName(audioBlob),
          model: parakeetModelId,
          language: parakeetLanguage || 'en',
          localAttention: parakeetAttentionMode === 'local',
        })
        return result.text
      }

      if (speechToTextMode === 'local') {
        throw new Error(
          status.message ||
            'Local Parakeet is not ready. Open Settings → Audio and install Local Parakeet.',
        )
      }
      // auto mode: fall through to remote STT model when Parakeet is unavailable
    } catch (error) {
      if (speechToTextMode === 'local') {
        throw error
      }
      console.warn('Local Parakeet transcription unavailable, falling back to model STT:', error)
    }
  }

  if (speechToTextMode === 'local' && localSttEngine === 'browser') {
    // Browser SpeechRecognition is live-only; recorded blobs need Parakeet or a remote model.
    throw new Error(
      'Browser speech recognition cannot transcribe saved recordings. Choose Local Parakeet or a remote STT model in Settings → Audio.',
    )
  }

  if (!sttModel) {
    return ''
  }

  if (speechToTextMode === 'local') {
    return ''
  }

  return fetchAudioTranscription(audioBlob)
}

function getAudioFileName(audioBlob: Blob): string {
  const mimeType = audioBlob.type.toLowerCase()

  if (mimeType.includes('wav')) return 'audio.wav'
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'audio.mp3'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'audio.mp4'
  if (mimeType.includes('ogg')) return 'audio.ogg'
  if (mimeType.includes('flac')) return 'audio.flac'
  if (mimeType.includes('aac')) return 'audio.aac'

  return 'audio.webm'
}

/**
 * STT
 */
export async function fetchAudioTranscription(audioBlob: Blob): Promise<string> {
  const { aiModelList, sttModel } = useSettingStore.getState()
  
  if (!sttModel) {
    throw new Error('No speech recognition model is configured')
  }

  // STT
  let sttConfig = null
  
  // ，ID
  for (const config of aiModelList) {
    // models
    if (config.models && config.models.length > 0) {
      const targetModel = config.models.find(model => 
        model.modelType === 'stt' && (model.id === sttModel || `${config.key}-${model.id}` === sttModel)
      )
      if (targetModel) {
        // AiConfig
        sttConfig = {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType
        }
        break
      }
    } else {
      // ：
      if (config.key === sttModel && config.modelType === 'stt') {
        sttConfig = config
        break
      }
    }
  }
  
  if (!sttConfig) {
    throw new Error('Speech recognition model configuration was not found')
  }

  if (!sttConfig.baseURL || !sttConfig.apiKey) {
    throw new Error('Speech recognition model configuration is incomplete')
  }

  try {
    const result = await invokeAiMultipart<AudioTranscriptionResponse>({
      config: await resolveAiRequestConfig(sttConfig),
      path: '/audio/transcriptions',
      fileFieldName: 'file',
      fields: {
        model: sttConfig.model || 'FunAudioLLM/SenseVoiceSmall'
      },
      file: {
        bytes: await blobToBytes(audioBlob),
        fileName: getAudioFileName(audioBlob),
        contentType: audioBlob.type || 'audio/webm',
      }
    })
    return result.text
  } catch (error) {
    console.error('Speech recognition error:', error)
    throw error
  }
}
