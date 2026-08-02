import { create } from 'zustand'

// API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onerror: ((event: any) => void) | null
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition
    webkitSpeechRecognition: new () => SpeechRecognition
  }
}

interface SpeechRecognitionState {
  //
  isRecognizing: boolean
  transcript: string //
  interimTranscript: string // （）
  lastError: string | null //
  
  //
  recognition: SpeechRecognition | null
  
  //
  startRecognition: (language?: string) => Promise<void>
  stopRecognition: () => Promise<string>
  
  //
  resetState: () => void
  
  //
  isSupported: () => boolean
}

const useSpeechRecognitionStore = create<SpeechRecognitionState>((set, get) => ({
  isRecognizing: false,
  transcript: '',
  interimTranscript: '',
  lastError: null,
  recognition: null,

  isSupported: () => {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  },

  startRecognition: async (language = 'en-US') => {
    try {
      //
      if (!get().isSupported()) {
        throw new Error('Speech recognition is not supported in this browser. Use Chrome, Edge, or Safari.')
      }

      //
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognition = new SpeechRecognitionAPI()

      //
      recognition.continuous = true //
      recognition.interimResults = true //
      recognition.lang = language //
      recognition.maxAlternatives = 1 // 1

      let startupPending = true

      //
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = ''
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const transcript = result[0].transcript

          if (result.isFinal) {
            finalTranscript += transcript
          } else {
            interimTranscript += transcript
          }
        }

        set({
          transcript: get().transcript + finalTranscript,
          interimTranscript
        })
      }

      //
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error, event)
        
        //
        get().resetState()
        
        // ，
        set({ 
          isRecognizing: false,
          lastError: event.error 
        })
      }

      //
      recognition.onend = () => {
        set({ isRecognizing: false })
      }

      await new Promise<void>((resolve, reject) => {
        set({
          recognition,
          isRecognizing: true,
          transcript: '',
          interimTranscript: '',
          lastError: null,
        })

        recognition.onstart = () => {
          startupPending = false
          resolve()
        }

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error, event)

          get().resetState()

          set({
            isRecognizing: false,
            lastError: event.error
          })

          if (startupPending) {
            reject(new Error(event.error || 'speech-recognition-error'))
            return
          }
        }

        try {
          recognition.start()
        } catch (startError) {
          console.error('Failed', startError)
          reject(startError)
        }
      })

    } catch (error) {
      console.error('Failed', error)
      throw error
    }
  },

  stopRecognition: async () => {
    const { recognition } = get()

    if (!recognition) {
      return `${get().transcript}${get().interimTranscript}`.trim()
    }

    return new Promise((resolve) => {
      const originalOnEnd = recognition.onend

      recognition.onend = () => {
        originalOnEnd?.()

        const finalTranscript = `${get().transcript}${get().interimTranscript}`.trim()

        set({
          isRecognizing: false,
          interimTranscript: ''
        })

        resolve(finalTranscript)
      }

      recognition.stop()
    })
  },

  resetState: () => {
    const { recognition } = get()
    
    if (recognition) {
      recognition.abort()
    }
    
    set({
      isRecognizing: false,
      transcript: '',
      interimTranscript: '',
      recognition: null
    })
  }
}))

export default useSpeechRecognitionStore
