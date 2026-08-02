import { create } from 'zustand'

interface RecordingState {
  //
  isRecording: boolean
  isPaused: boolean
  recordingDuration: number // （）

  //
  audioChunks: Blob[]
  mediaRecorder: MediaRecorder | null

  //
  timerId?: NodeJS.Timeout

  //
  startRecording: () => Promise<void>
  pauseRecording: () => void
  resumeRecording: () => void
  stopRecording: () => Promise<Blob | null>
  cancelRecording: () => void
  
  //
  setRecordingDuration: (duration: number) => void
  resetState: () => void
}

const useRecordingStore = create<RecordingState>((set, get) => ({
  isRecording: false,
  isPaused: false,
  recordingDuration: 0,
  audioChunks: [],
  mediaRecorder: null,

  setRecordingDuration: (duration) => set({ recordingDuration: duration }),

  startRecording: async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone recording is not supported in this environment. Check Android WebView or app permission settings.')
      }

      //
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      //
      let mimeType = 'audio/webm'
      const supportedTypes = [
        'audio/wav',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm'
      ]
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          break
        }
      }
      
      // MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      
      const chunks: Blob[] = []
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      
      mediaRecorder.start()
      
      // ， state
      const timerId = setInterval(() => {
        const state = get()
        if (state.isRecording && !state.isPaused) {
          set({ recordingDuration: state.recordingDuration + 1 })
        } else {
          //
          clearInterval(state.timerId)
          set({ timerId: undefined })
        }
      }, 1000)

      set({
        isRecording: true,
        isPaused: false,
        audioChunks: chunks,
        mediaRecorder,
        recordingDuration: 0,
        timerId
      })
      
    } catch (error) {
      console.error('Failed', error)
      
      //
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          throw new Error('Microphone permission was denied. Allow NoteLoom to access the microphone in system settings.')
        } else if (error.name === 'NotFoundError') {
          throw new Error('No microphone was found. Connect a microphone and try again.')
        } else if (error.name === 'NotReadableError') {
          throw new Error('The microphone is in use by another app. Close other apps and try again.')
        }
      }
      
      throw new Error('Could not start recording. Check the microphone and permission settings.')
    }
  },

  pauseRecording: () => {
    const { mediaRecorder, timerId } = get()
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
      //
      if (timerId) {
        clearInterval(timerId)
      }
      set({ isPaused: true, timerId: undefined })
    }
  },

  resumeRecording: () => {
    const { mediaRecorder } = get()
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume()
      set({ isPaused: false })
    }
  },

  stopRecording: async (): Promise<Blob | null> => {
    const { mediaRecorder, audioChunks, timerId } = get()

    //
    if (timerId) {
      clearInterval(timerId)
    }

    if (!mediaRecorder) {
      return null
    }
    
    return new Promise((resolve) => {
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || audioChunks[0]?.type || 'audio/webm' })
        mediaRecorder.stream.getTracks().forEach(track => track.stop())
        get().resetState()
        resolve(audioBlob)
      }
      
      mediaRecorder.stop()
    })
  },

  cancelRecording: () => {
    const { mediaRecorder } = get()
    
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }
    
    get().resetState()
  },

  resetState: () => {
    const { timerId } = get()
    //
    if (timerId) {
      clearInterval(timerId)
    }
    set({
      isRecording: false,
      isPaused: false,
      recordingDuration: 0,
      audioChunks: [],
      mediaRecorder: null,
      timerId: undefined
    })
  }
}))

export default useRecordingStore
