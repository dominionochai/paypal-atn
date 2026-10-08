import { useState, useEffect, useRef, useCallback } from 'react'
import { PorcupineWorker } from '@picovoice/porcupine-web'
import type { PorcupineWorker as PorcupineWorkerType } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'

// NOTE
// Porcupine is not going to be used since it does not work in extensions due to blob worker requirements
// also its not free and requires monthly plan.

const ACCESS_KEY = ''

interface UseWakeWordReturn {
  isListening: boolean
  lastDetection: string | null
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
}

export const useWakeWord = (onWakeWordDetected?: () => void): UseWakeWordReturn => {
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
      console.log('[WakeWord] Starting wake word detection...')
      setError(null)

      // Get URLs for wake word files from extension
      const keywordUrl = chrome.runtime.getURL('assets/Hey-Marionette_en_wasm_v3_0_0.ppn')
      const modelUrl = chrome.runtime.getURL('assets/porcupine_params.pv')

      console.log('[WakeWord] Loading keyword from:', keywordUrl)
      console.log('[WakeWord] Loading model from:', modelUrl)

      // Fetch the files
      const [keywordResponse, modelResponse] = await Promise.all([
        fetch(keywordUrl),
        fetch(modelUrl)
      ])

      const keywordArrayBuffer = await keywordResponse.arrayBuffer()
      const modelArrayBuffer = await modelResponse.arrayBuffer()

      console.log('[WakeWord] Files loaded successfully')
      console.log('[WakeWord] Keyword size:', keywordArrayBuffer.byteLength, 'bytes')
      console.log('[WakeWord] Model size:', modelArrayBuffer.byteLength, 'bytes')

      // Create Porcupine worker
      const keywordBase64 = arrayBufferToBase64(keywordArrayBuffer)
      const modelBase64 = arrayBufferToBase64(modelArrayBuffer)

      porcupineRef.current = await PorcupineWorker.create(
        ACCESS_KEY,
        {
          label: 'Hey Marionette',
          base64: keywordBase64,
          sensitivity: 0.7
        },
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
      console.log('[WakeWord] Wake word detection active')
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

