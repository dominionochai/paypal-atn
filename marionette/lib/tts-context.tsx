import React, { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { splitIntoSentences } from './sentence-parser'

interface TTSContextValue {
  selectedVoiceUri: string | null
  availableVoices: SpeechSynthesisVoice[]
  setSelectedVoiceUri: (uri: string) => void
  speak: (text: string) => void
  stop: () => void
  isSpeaking: boolean
  previewVoice: (uri: string) => Promise<boolean>
  handleNewText: (text: string, forceSpeak?: boolean) => void
  currentSentence: string
  queueLength: number
  audioEnabled: boolean
  setAudioEnabled: (enabled: boolean) => void
  isReady: boolean
  waitUntilReady: () => Promise<void>
}

const TTSContext = createContext<TTSContextValue | null>(null)

// Estimate speaking duration in ms based on text length
// Average speaking rate: ~150 words/min = 2.5 words/sec
// Average word length: ~5 chars, so ~12.5 chars/sec
// Add buffer for safety: ~10 chars/sec = 100ms per char
const estimateSpeakingDuration = (text: string): number => {
  const baseTime = text.length * 100 // 100ms per character
  const minTime = 1000 // Minimum 1 second
  const maxTime = 30000 // Maximum 30 seconds
  return Math.min(Math.max(baseTime, minTime), maxTime)
}


export const TTSProvider = ({ children }: { children: ReactNode }) => {
  const [selectedVoiceUri, setSelectedVoiceUri] = useState<string | null>(null)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentSentence, setCurrentSentence] = useState<string>('')
  const [queueLength, setQueueLength] = useState(0)
  const [audioEnabled, setAudioEnabled] = useState(true)
  
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const sentenceQueueRef = useRef<string[]>([])
  const isProcessingQueueRef = useRef(false)
  const timeoutRef = useRef<number | null>(null)
  const lastSpokenSentencesRef = useRef<string[]>([])
  const currentTextRef = useRef<string>('')
  const isInitialMount = useRef(true)

  const loadVoices = useCallback(() => {
    console.log('[TTS] Loading voices...')
    const voices = window.speechSynthesis.getVoices()
    console.log('[TTS] Available voices:', voices.length, voices.map(v => v.name))
    setAvailableVoices(voices)
    
    // Load from storage or set default
    chrome.storage.local.get(['tts_voice_uri'], (result) => {
      if (result.tts_voice_uri) {
        console.log('[TTS] Stored voice URI:', result.tts_voice_uri)
        const voiceExists = voices.find(v => v.voiceURI === result.tts_voice_uri)
        if (voiceExists) {
          console.log('[TTS] Using stored voice:', voiceExists.name)
          setSelectedVoiceUri(result.tts_voice_uri)
        } else if (voices.length > 0) {
          console.log('[TTS] Stored voice not found, using first available:', voices[0].name)
          setSelectedVoiceUri(voices[0].voiceURI)
        }
      } else if (voices.length > 0) {
        console.log('[TTS] No stored voice, using first available:', voices[0].name)
        setSelectedVoiceUri(voices[0].voiceURI)
      }
    })
  }, [])

  // Load audio preference immediately on mount
  useEffect(() => {
    chrome.storage.local.get(['tts_audio_enabled'], (result) => {
      if (result.tts_audio_enabled !== undefined) {
        console.log('[TTS] Loaded audio enabled from storage:', result.tts_audio_enabled)
        setAudioEnabled(result.tts_audio_enabled)
      }
    })
  }, [])

  useEffect(() => {
    console.log('[TTS] TTSProvider mounted')
    console.log('[TTS] speechSynthesis available:', 'speechSynthesis' in window)
    loadVoices()
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices)
    return () => {
      console.log('[TTS] TTSProvider unmounting')
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices)
    }
  }, [loadVoices])

  // Save to storage when voice changes
  useEffect(() => {
    if (selectedVoiceUri) {
      chrome.storage.local.set({ tts_voice_uri: selectedVoiceUri })
    }
  }, [selectedVoiceUri])

  // Save to storage when audio enabled changes (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    console.log('[TTS] Saving audio enabled to storage:', audioEnabled)
    chrome.storage.local.set({ tts_audio_enabled: audioEnabled })
  }, [audioEnabled])

  const stop = useCallback(() => {
    console.log('[TTS] Stopping all speech and clearing queue')
    window.speechSynthesis.cancel()
    
    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    
    // Clear queue and state
    sentenceQueueRef.current = []
    isProcessingQueueRef.current = false
    setIsSpeaking(false)
    setCurrentSentence('')
    setQueueLength(0)
    utteranceRef.current = null
  }, [])

  const processNextInQueue = useCallback(() => {
    console.log('[TTS] processNextInQueue - Queue length:', sentenceQueueRef.current.length)
    
    // If already processing or queue is empty, exit
    if (isProcessingQueueRef.current || sentenceQueueRef.current.length === 0) {
      console.log('[TTS] Queue empty or already processing')
      isProcessingQueueRef.current = false
      setIsSpeaking(false)
      setCurrentSentence('')
      setQueueLength(0)
      return
    }
    
    // Get next sentence
    let sentence = sentenceQueueRef.current.shift()!
    setQueueLength(sentenceQueueRef.current.length)
    isProcessingQueueRef.current = true
    
    console.log('[TTS] Speaking sentence:', sentence.substring(0, 50))
    
    // Clean text for TTS - remove markdown and special characters that shouldn't be spoken
    const cleanedSentence = sentence
      .replace(/`/g, '') // Remove backticks
      .replace(/\*\*/g, '') // Remove bold markers
      .replace(/\*/g, '') // Remove italic markers/bullets
      .replace(/_/g, '') // Remove underscores
      .replace(/~/g, '') // Remove strikethrough
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Convert [text](url) to just text
      .replace(/#{1,6}\s/g, '') // Remove markdown headers
      .replace(/```[^`]*```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Convert inline code to plain text
      .trim()
    
    setCurrentSentence(cleanedSentence)
    setIsSpeaking(true)
    
    const utterance = new SpeechSynthesisUtterance(cleanedSentence)
    
    // Set volume based on audioEnabled (0 = muted, 1 = full volume)
    utterance.volume = audioEnabled ? 1 : 0
    
    // Set voice
    if (selectedVoiceUri) {
      const voice = availableVoices.find(v => v.voiceURI === selectedVoiceUri)
      if (voice) {
        utterance.voice = voice
      } else {
        console.warn('[TTS] Selected voice not found:', selectedVoiceUri)
      }
    }
    
    // Calculate timeout fallback
    const estimatedDuration = estimateSpeakingDuration(sentence)
    const timeoutDuration = estimatedDuration + 500 // Add 500ms buffer
    
    console.log('[TTS] Estimated duration:', estimatedDuration, 'ms, timeout:', timeoutDuration, 'ms')
    
    // Setup timeout fallback in case onend doesn't fire
    timeoutRef.current = window.setTimeout(() => {
      console.warn('[TTS] Timeout reached - TTS may have failed, moving to next sentence')
      isProcessingQueueRef.current = false
      processNextInQueue()
    }, timeoutDuration)
    
    utterance.onend = () => {
      console.log('[TTS] Utterance ended successfully')
      
      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      
      isProcessingQueueRef.current = false
      processNextInQueue()
    }
    
    utterance.onerror = (event) => {
      console.error('[TTS] Utterance error:', event.error, event)
      
      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      
      // Move to next sentence even on error
      isProcessingQueueRef.current = false
      processNextInQueue()
    }
    
    utteranceRef.current = utterance
    
    try {
      window.speechSynthesis.speak(utterance)
      console.log('[TTS] speechSynthesis.speak() called')
    } catch (error) {
      console.error('[TTS] Failed to call speak():', error)
      
      // Clear timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      
      isProcessingQueueRef.current = false
      processNextInQueue()
    }
  }, [selectedVoiceUri, availableVoices, audioEnabled])

  const speak = useCallback((text: string) => {
    console.log('[TTS] speak() called (legacy support) - redirecting to queue')
    
    if (!text.trim()) {
      console.log('[TTS] Empty text, not speaking')
      return
    }
    
    // Stop current speech and clear queue
    stop()
    
    // Split into sentences and add to queue
    const sentences = splitIntoSentences(text)
    sentenceQueueRef.current = sentences
    setQueueLength(sentences.length)
    
    console.log('[TTS] Added', sentences.length, 'sentences to queue')
    
    // Start processing
    processNextInQueue()
  }, [stop, processNextInQueue])

  const previewVoice = useCallback((uri: string): Promise<boolean> => {
    return new Promise((resolve) => {
      console.log('[TTS] previewVoice() called with URI:', uri)
      const voice = availableVoices.find(v => v.voiceURI === uri)
      if (!voice) {
        console.error('[TTS] Voice not found:', uri)
        resolve(false)
        return
      }

      console.log('[TTS] Previewing voice:', voice.name)
      stop()

      const utterance = new SpeechSynthesisUtterance("Hello, this is a voice preview.")
      utterance.voice = voice
      
      utterance.onstart = () => {
        console.log('[TTS] Preview started')
        setIsSpeaking(true)
      }
      
      utterance.onend = () => {
        console.log('[TTS] Preview ended')
        setIsSpeaking(false)
        resolve(true)
      }
      
      utterance.onerror = (event) => {
        console.error('[TTS] Preview error:', event)
        setIsSpeaking(false)
        resolve(false)
      }

      utteranceRef.current = utterance
      
      try {
        console.log('[TTS] Calling speechSynthesis.speak() for preview')
        window.speechSynthesis.speak(utterance)
        console.log('[TTS] Preview speak() call completed')
        
        // Timeout fallback in case neither onend nor onerror fire
        setTimeout(() => {
          if (utteranceRef.current === utterance) {
            console.error('[TTS] Preview timeout - no response from speech synthesis')
            setIsSpeaking(false)
            resolve(false)
          }
        }, 5000)
      } catch (error) {
        console.error('[TTS] Failed to call speak() for preview:', error)
        setIsSpeaking(false)
        resolve(false)
      }
    })
  }, [availableVoices, stop])

  const handleNewText = useCallback((text: string, forceSpeak: boolean = false) => {
    console.log('[TTS] handleNewText() called with:', text.substring(0, 100), 'forceSpeak:', forceSpeak)
    console.log('[TTS] currentTextRef.current:', currentTextRef.current.substring(0, 100))
    
    // If text is empty or same as current, do nothing
    if (!text || text === currentTextRef.current) {
      console.log('[TTS] Text empty or unchanged, skipping')
      return
    }

    currentTextRef.current = text
    
    // If forceSpeak is true, skip sentence extraction and speak immediately
    if (forceSpeak) {
      console.log('[TTS] Force speak mode - adding text directly to queue')
      sentenceQueueRef.current.push(text)
      setQueueLength(sentenceQueueRef.current.length)
      
      // Update tracking to prevent re-speaking
      lastSpokenSentencesRef.current = [text]
      
      // If not already processing, start the queue
      if (!isProcessingQueueRef.current) {
        console.log('[TTS] Starting queue processing')
        processNextInQueue()
      }
      return
    }
    
    const newSentences = splitIntoSentences(text)
    console.log('[TTS] Extracted sentences:', newSentences.length)
    console.log('[TTS] Last spoken sentences:', lastSpokenSentencesRef.current.length)
    
    // Find new sentences that haven't been spoken yet or queued
    const unspokenSentences = newSentences.filter(
      sentence => !lastSpokenSentencesRef.current.includes(sentence)
    )
    
    console.log('[TTS] New unspoken sentences:', unspokenSentences.length)

    if (unspokenSentences.length > 0) {
      // Add new sentences to the queue
      console.log('[TTS] Adding', unspokenSentences.length, 'sentences to queue')
      sentenceQueueRef.current.push(...unspokenSentences)
      setQueueLength(sentenceQueueRef.current.length)
      
      // Update tracking
      lastSpokenSentencesRef.current = newSentences
      
      // If not already processing, start the queue
      if (!isProcessingQueueRef.current) {
        console.log('[TTS] Starting queue processing')
        processNextInQueue()
      } else {
        console.log('[TTS] Queue already processing, sentences added')
      }
    } else {
      console.log('[TTS] No new sentences to add to queue')
    }
  }, [processNextInQueue])

  // Reset tracking when text becomes empty (new conversation)
  useEffect(() => {
    if (currentTextRef.current === '') {
      lastSpokenSentencesRef.current = []
    }
  }, [])

  // Compute ready state - true when nothing is speaking or queued
  const isReady = !isSpeaking && queueLength === 0

  // Function to wait until TTS is ready - uses closure to capture CURRENT state
  const waitUntilReady = useCallback((): Promise<void> => {
    return new Promise<void>((resolve) => {
      // Check current state - this gets the LATEST value from React state
      const checkReady = () => {
        // Access current refs/state to avoid stale closure
        const currentlyReady = sentenceQueueRef.current.length === 0 && !isProcessingQueueRef.current
        
        if (currentlyReady) {
          console.log('[TTS] Ready - queue empty and not processing')
          resolve()
          return true
        }
        return false
      }
      
      // Immediate check
      if (checkReady()) {
        return
      }
      
      console.log('[TTS] Not ready - will poll until queue clears')
      
      // Poll every 100ms, each time checking CURRENT ref values
      const interval = setInterval(() => {
        if (checkReady()) {
          clearInterval(interval)
        }
      }, 100)
    })
  }, []) // Empty deps - refs are always current

  return (
    <TTSContext.Provider value={{ 
      selectedVoiceUri, 
      availableVoices, 
      setSelectedVoiceUri, 
      speak, 
      stop,
      isSpeaking,
      previewVoice,
      handleNewText,
      currentSentence,
      queueLength,
      audioEnabled,
      setAudioEnabled,
      isReady,
      waitUntilReady
    }}>
      {children}
    </TTSContext.Provider>
  )
}

export const useTTS = () => {
  const context = useContext(TTSContext)
  if (!context) {
    throw new Error('useTTS must be used within TTSProvider')
  }
  return context
}

