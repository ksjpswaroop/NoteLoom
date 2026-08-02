import { useState, useCallback, useRef } from 'react'
import { fetchCompletion } from '@/lib/ai/completion'

interface UseAiCompletionOptions {
  onAccept?: (completion: string) => void
  onCancel?: () => void
}

export function useAiCompletion(options: UseAiCompletionOptions = {}) {
  const [completion, setCompletion] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const completionRef = useRef<string>('') // ref completion

  //
  const generateCompletion = useCallback(async (fullContent: string, cursorPosition: number) => {
    //
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // （ 300 ）
    const contextStart = Math.max(0, cursorPosition - 300)
    const context = fullContent.substring(contextStart, cursorPosition)
    
    // ，
    if (context.trim().length < 10) {
      return
    }

    setIsLoading(true)
    abortControllerRef.current = new AbortController()

    try {
      const result = await fetchCompletion(context, abortControllerRef.current.signal)
      
      if (result) {
        completionRef.current = result
        setCompletion(result)
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[useAiCompletion] Error:', error)
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [])

  //
  const acceptCompletion = useCallback(() => {
    const currentCompletion = completionRef.current
    if (currentCompletion) {
      //
      const previews = document.querySelectorAll('.ai-completion-preview')
      previews.forEach(preview => preview.remove())
      
      //
      options.onAccept?.(currentCompletion)
      
      //
      completionRef.current = ''
      setCompletion('')
    }
  }, [options])

  //
  const cancelCompletion = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    //
    const previews = document.querySelectorAll('.ai-completion-preview')
    previews.forEach(preview => preview.remove())
    
    completionRef.current = ''
    setCompletion('')
    setIsLoading(false)
    options.onCancel?.()
  }, [options])

  return {
    completion,
    isLoading,
    generateCompletion,
    acceptCompletion,
    cancelCompletion,
  }
}
