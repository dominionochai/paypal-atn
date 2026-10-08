import { useState, useRef, useCallback } from 'react'
import { MicrophonePermissionError, SpeechRecognitionUnavailableError } from './errors'
import { useMediaDevice } from './media-device-context'
import { E2E_TEST_CONFIG } from './e2e-config'

interface UseSpeechRecognitionReturn {
  isListening: boolean
  transcript: string
  startListening: (onAutoEnd?: (transcript: string) => void) => void
  stopListening: () => Promise<string>
}

let testPhraseIndex = 0

export const useSpeechRecognition = (): UseSpeechRecognitionReturn => {
  const { selectedMicId } = useMediaDevice()
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const recognitionRef = useRef<any>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const onAutoEndRef = useRef<((transcript: string) => void) | null>(null)
  const transcriptRef = useRef<string>("")
  const selectedMicIdRef = useRef<string | null>(null)
  
  // Keep ref in sync with latest selectedMicId
  selectedMicIdRef.current = selectedMicId

  const startListening = useCallback(async (onAutoEnd?: (transcript: string) => void) => {
    // Store the callback
    onAutoEndRef.current = onAutoEnd || null
    
    // Request microphone access with selected device (still needed in debug mode for testing)
    // Use ref to ensure we always get the latest mic selection
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedMicIdRef.current ? { deviceId: { exact: selectedMicIdRef.current } } : true
      }
      console.log('[Speech Recognition] Using microphone:', selectedMicIdRef.current || 'default')
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error: any) {
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new MicrophonePermissionError()
      }
      throw error
    }

    // TEST MODE: Use predefined phrases for e2e testing
    if (E2E_TEST_CONFIG.TEST_MODE_ENABLED) {
      setIsListening(true)
      setTranscript("")
      transcriptRef.current = ""
      
      // Get the next test phrase
      let currentPhrase = E2E_TEST_CONFIG.TEST_PHRASES[testPhraseIndex % E2E_TEST_CONFIG.TEST_PHRASES.length]
      testPhraseIndex++
      
      // Normalize phrase like real STT: lowercase, remove special chars except spaces
      currentPhrase = currentPhrase.toLowerCase().replace(/[^a-z0-9\s]/g, '')
      
      console.log(`[E2E Test Mode] Using test phrase: "${currentPhrase}"`)
      
      // Store test recognition in ref BEFORE starting async operations
      // This allows stopListening to check if we're in test mode
      recognitionRef.current = { 
        isTestMode: true,
        phrase: currentPhrase,
        stopped: false
      }
      
      // Wait before starting (simulates processing time)
      await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.INITIAL_DELAY))
      
      // Check if stopped during initial delay
      if (!recognitionRef.current || recognitionRef.current.stopped) {
        return
      }
      
      // Simulate progressive recognition by streaming words
      const words = currentPhrase.split(' ').filter(w => w.length > 0)
      let accumulatedText = ''
      
      // Stream words one by one
      for (let i = 0; i < words.length; i++) {
        await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.WORD_DELAY))
        
        // Stop if recognition was stopped
        if (!recognitionRef.current || recognitionRef.current.stopped) break
        
        accumulatedText += (i > 0 ? ' ' : '') + words[i]
        setTranscript(accumulatedText)
        transcriptRef.current = accumulatedText
      }
      
      // Auto-end after the phrase is complete (simulate speech stopping)
      await new Promise(resolve => setTimeout(resolve, E2E_TEST_CONFIG.AUTO_END_DELAY))
      
      // Only auto-end if we're still listening (user didn't manually stop)
      if (recognitionRef.current && !recognitionRef.current.stopped) {
        setIsListening(false)
        
        // Clean up media stream
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop())
          mediaStreamRef.current = null
        }
        
        // Call the auto-end callback
        if (onAutoEndRef.current && transcriptRef.current) {
          onAutoEndRef.current(transcriptRef.current)
          setTranscript("")
          transcriptRef.current = ""
          onAutoEndRef.current = null
        }
        
        recognitionRef.current = null
      }
      
      return
    }
    
    // PRODUCTION MODE: Use Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    
    if (!SpeechRecognition) {
      throw new SpeechRecognitionUnavailableError()
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      setIsListening(true)
      setTranscript("")
      transcriptRef.current = ""
    }

    recognition.onresult = (event: any) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' '
        } else {
          interimTranscript += transcript
        }
      }

      const currentTranscript = (finalTranscript || interimTranscript).trim()
      setTranscript(currentTranscript)
      transcriptRef.current = currentTranscript
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      setIsListening(false)
      
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        throw new MicrophonePermissionError()
      }
      // For other errors like 'no-speech', just log them
    }

    recognition.onend = () => {
      setIsListening(false)
      
      // Clean up media stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop())
        mediaStreamRef.current = null
      }
      
      // If recognition auto-ended and we have a callback, call it with the current transcript
      if (onAutoEndRef.current && transcriptRef.current) {
        onAutoEndRef.current(transcriptRef.current)
        setTranscript("")
        transcriptRef.current = ""
        onAutoEndRef.current = null
      }
    }

    recognitionRef.current = recognition
    recognition.start()
  }, []) // No dependencies - we use refs for all dynamic values

  const stopListening = useCallback(async (): Promise<string> => {
    if (recognitionRef.current) {
      // In test mode, mark as stopped so the async loop stops
      if (recognitionRef.current.isTestMode) {
        recognitionRef.current.stopped = true
        recognitionRef.current = null
      } else {
        // Production mode: stop the speech recognition
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
    }
    
    // Clean up media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    
    const currentTranscript = transcript
    setTranscript("")
    setIsListening(false)
    return currentTranscript
  }, [transcript])

  return {
    isListening,
    transcript,
    startListening,
    stopListening
  }
}

