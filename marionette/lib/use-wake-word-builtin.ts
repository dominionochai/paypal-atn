import { useState, useEffect, useRef, useCallback } from 'react'
import { PorcupineWorker, BuiltInKeyword } from '@picovoice/porcupine-web'
import type { PorcupineWorker as PorcupineWorkerType } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'

const ACCESS_KEY = 'VNzkIw2YFHJzFnvFk3k1VzRkzQfE5cUmnSxpK3vhMHV9Pa/zqnDbtg=='

interface UseWakeWordReturn {
  isListening: boolean
  lastDetection: string | null
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
}

// Using built-in "Porcupine" keyword for testing (free, doesn't count against quota)
export const useWakeWordBuiltIn = (onWakeWordDetected?: () => void): UseWakeWordReturn => {
  const [isListening, setIsListening] = useState(false)
  const [lastDetection, setLastDetection] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const porcupineRef = useRef<PorcupineWorkerType | null>(null)
  const isInitializingRef = useRef(false)

  const start = useCallback(async () => {
    // Prevent duplicate initializations
    if (isInitializingRef.current || porcupineRef.current) {
      console.log('[WakeWord] Already initializing or running')
      return
    }

    try {
      isInitializingRef.current = true
      console.log('[WakeWord] Starting wake word detection with built-in keyword...')
      setError(null)

      // Load the model file
      const modelUrl = chrome.runtime.getURL('assets/porcupine_params.pv')
      console.log('[WakeWord] Loading model from:', modelUrl)
      
      const modelResponse = await fetch(modelUrl)
      const modelArrayBuffer = await modelResponse.arrayBuffer()
      const modelBase64 = arrayBufferToBase64(modelArrayBuffer)
      
      console.log('[WakeWord] Model loaded, size:', modelArrayBuffer.byteLength, 'bytes')

      // Use built-in Porcupine keyword (doesn't count against custom quota)
      porcupineRef.current = await PorcupineWorker.create(
        ACCESS_KEY,
        [BuiltInKeyword.Porcupine], // Say "Porcupine" to trigger (must be array)
        (detection) => {
          console.log('[WakeWord] Wake word detected!', detection)
          setLastDetection(detection.label)
          onWakeWordDetected?.()
        },
        { base64: modelBase64 }
      )

      console.log('[WakeWord] Porcupine worker created successfully')

      // Start WebVoiceProcessor
      await WebVoiceProcessor.subscribe(porcupineRef.current)
      
      setIsListening(true)
      isInitializingRef.current = false
      console.log('[WakeWord] Wake word detection active - say "Porcupine"')
    } catch (err: any) {
      console.error('[WakeWord] Error starting wake word detection:', err)
      setError(err.message || 'Failed to start wake word detection')
      setIsListening(false)
      isInitializingRef.current = false
    }
  }, [onWakeWordDetected])

  const stop = useCallback(async () => {
    try {
      console.log('[WakeWord] Stopping wake word detection...')
      
      if (porcupineRef.current) {
        await WebVoiceProcessor.unsubscribe(porcupineRef.current)
        porcupineRef.current.terminate()
        porcupineRef.current = null
      }
      
      isInitializingRef.current = false
      setIsListening(false)
      console.log('[WakeWord] Wake word detection stopped')
    } catch (err: any) {
      console.error('[WakeWord] Error stopping wake word detection:', err)
      setError(err.message || 'Failed to stop wake word detection')
      isInitializingRef.current = false
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (porcupineRef.current) {
        WebVoiceProcessor.unsubscribe(porcupineRef.current).catch(console.error)
        porcupineRef.current.terminate()
      }
    }
  }, [])

  return {
    isListening,
    lastDetection,
    error,
    start,
    stop
  }
}

// Helper function to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
