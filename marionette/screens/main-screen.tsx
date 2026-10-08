import React, { useMemo, useState, useEffect, useRef } from "react"
import { Bug, Mic, RotateCcw, Maximize2, Settings as SettingsIcon, Volume2, VolumeX, Square, Paperclip, X } from "lucide-react"
import { useVoiceInput } from "../lib/use-voice-input"
import { useChatContext } from "../lib/chat-context"
import { useTTS } from "../lib/tts-context"
import { useSoundEffects } from "../lib/use-sound-effects"
import { useOnboarding } from "../components/onboarding/onboarding-provider"
import { OnboardingFlow } from "../components/onboarding/onboarding-flow"
import { OnboardingRedirect } from "../components/onboarding/onboarding-redirect"
import { MicSelector } from "../components/mic-selector"
import { VoiceSelector } from "../components/voice-selector"
import { Waveform } from "../components/waveform"
import { RatingButtons } from "../components/rating-buttons"
import { parseToolCall } from "../lib/tools"
import { getSpokenLine } from "../lib/tool-registry"
import { getCompleteSentences } from "../lib/sentence-parser"
import { MAX_CONTEXT_SIZE } from "../lib/summarizer"
import { embedFiles } from "../lib/file-embedder"

interface MainScreenProps {
  onNavigateToDebug: () => void
  onNavigateToSettings: () => void
  fullHeight?: boolean
}

export const MainScreen = ({ onNavigateToDebug, onNavigateToSettings, fullHeight = false }: MainScreenProps) => {
  const { state: onboardingState, isPopup } = useOnboarding()
  const { isListening, transcript, handleMicClick } = useVoiceInput()
  const { state, sendMessage, resetChat, rateMessage, isInitialLoadComplete, interruptChat, dispatch } = useChatContext()
  const { handleNewText, stop, currentSentence, isSpeaking, audioEnabled, setAudioEnabled } = useTTS()
  const soundEffects = useSoundEffects()
  const [textInput, setTextInput] = useState("")
  
  // Track last spoken assistant message to avoid replaying
  const lastSpokenTextRef = useRef<string>('')
  const wasSpeakingRef = useRef(false)
  
  // Track last displayed sentence to keep showing it when queue empties
  const [lastDisplayedSentence, setLastDisplayedSentence] = useState<string>('')
  
  // File embedder state
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [embedSuccess, setEmbedSuccess] = useState<string | null>(null)
  const dragCounterRef = useRef(0)
  
  // Get latest context count
  const latestContextCount = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i]
      if (msg.contextCount !== undefined) {
        return msg.contextCount
      }
    }
    return 0
  }, [state.messages])
  
  // Mark initial load complete and record existing assistant messages
  useEffect(() => {
    if (isInitialLoadComplete && lastSpokenTextRef.current === '') {
      // Find the latest assistant message from storage and mark it as "already spoken"
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i]
        if (msg.role === 'assistant' && !msg.content.startsWith('[TOOL RESULT]')) {
          const toolCall = parseToolCall(msg.content)
          const textBeforeToolCall = msg.content.split('<function_call>')[0].trim()
          const text = getCompleteSentences(textBeforeToolCall || msg.content)
          lastSpokenTextRef.current = text
          console.log('[MainScreen] Marked initial message as spoken:', text.substring(0, 50))
          break
        }
      }
    }
  }, [isInitialLoadComplete, state.messages.length])

  // Get latest assistant message that's not a tool result
  const latestResponse = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i]
      if (msg.role === 'assistant' && !msg.content.startsWith('[TOOL RESULT]')) {
        const toolCall = parseToolCall(msg.content)
        
        // Extract text before tool call, handling code blocks
        let contentToSplit = msg.content
        // Remove code block wrapper if present
        const codeBlockMatch = contentToSplit.match(/```(?:tool_code|tool_call|function_call|json)\s*\n?(.*?)```/s)
        if (codeBlockMatch) {
          contentToSplit = codeBlockMatch[1]
        }
        const textBeforeToolCall = contentToSplit.split('<function_call>')[0].trim()
        
        // If message only contains function call syntax (no text before it), don't display the raw syntax
        let displayText = textBeforeToolCall
        if (!displayText && msg.content.includes('<function_call>')) {
          displayText = '' // Don't show raw function call syntax
        } else if (!displayText) {
          displayText = msg.content // Fallback to full content only if no function call
        }
        
        return {
          id: msg.id,
          text: displayText ? getCompleteSentences(displayText) : '',
          toolCall: toolCall,
          spokenLine: toolCall ? getSpokenLine(toolCall.function, toolCall.arguments) : null,
          rating: msg.rating
        }
      }
    }
    return { id: '', text: '', toolCall: null, spokenLine: null, rating: null }
  }, [state.messages])


  // TTS effect - handle new text (only if it's different from what we've seen before)
  useEffect(() => {
    // Ensure we don't trigger TTS until messages have been restored
    if (!isInitialLoadComplete) {
      return
    }
    // Skip if text is same as last spoken
    if (latestResponse.text === lastSpokenTextRef.current) {
      return
    }
    
    // Update tracking and trigger TTS
    if (latestResponse.text) {
      lastSpokenTextRef.current = latestResponse.text
      handleNewText(latestResponse.text)
    } else if (latestResponse.spokenLine) {
      // Tool call - speak the spoken line (force speak since it might not end with punctuation)
      lastSpokenTextRef.current = latestResponse.spokenLine
      handleNewText(latestResponse.spokenLine, true)
    }
  }, [isInitialLoadComplete, latestResponse.text, latestResponse.spokenLine, handleNewText])

  // Update last displayed sentence when currentSentence changes
  useEffect(() => {
    if (currentSentence) {
      setLastDisplayedSentence(currentSentence)
    }
  }, [currentSentence])

  // Response complete sound - play when TTS finishes speaking
  useEffect(() => {
    // Detect when speaking stops (transition from true to false)
    if (wasSpeakingRef.current && !isSpeaking && !state.isProcessing && audioEnabled) {
      // Only play if we were speaking an actual response (not system message)
      if (latestResponse.text || latestResponse.spokenLine) {
        soundEffects.play('warmup') // Using long-expected-548.ogg
      }
    }
    wasSpeakingRef.current = isSpeaking
  }, [isSpeaking, state.isProcessing, latestResponse.text, latestResponse.spokenLine, audioEnabled, soundEffects])

  // Determine waveform state - follow TTS/speaking state, not backend processing state
  const waveformState = isListening 
    ? 'listening'
    : isSpeaking
    ? 'speaking'  // If TTS is active, always show speaking state
    : state.isSummarizing
    ? 'summarizing'
    : state.isWarmingUp
    ? 'warming'
    : state.executingTool
    ? 'tool'
    : state.isProcessing
    ? 'thinking'
    : 'idle'

  // Match text color to waveform state
  const getTextColor = (state: typeof waveformState) => {
    switch (state) {
      case 'listening': return 'text-red-500'      // Red 500
      case 'speaking': return 'text-green-500'     // Green 500
      case 'warming': return 'text-orange-400'     // Orange 400
      case 'thinking': return 'text-blue-500'      // Blue 500
      case 'tool': return 'text-purple-500'        // Purple 500
      case 'summarizing': return 'text-amber-400'  // Amber 400
      case 'idle': return 'text-gray-600'          // Gray 600
      default: return 'text-gray-200'
    }
  }

  const handleTextSubmit = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && textInput.trim()) {
      // Interrupt any ongoing processing or TTS before sending new message
      if (state.isProcessing || isSpeaking) {
        handleInterrupt()
      }
      
      const input = textInput.trim()
      setTextInput("")
      await sendMessage(input)
    }
  }
  
  // Handle drag events for entire screen
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingFiles(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDraggingFiles(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    setIsDraggingFiles(false)
    dragCounterRef.current = 0
    
    if (isEmbedding) return
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    
    setIsEmbedding(true)
    
    try {
      const results = await embedFiles(files)
      
      const successCount = results.filter(r => r.success).length
      if (successCount > 0) {
        setEmbedSuccess(`Embedded ${successCount} file${successCount > 1 ? 's' : ''}`)
        
        // Auto-hide after 3 seconds
        setTimeout(() => setEmbedSuccess(null), 3000)
      }
    } catch (error) {
      console.error('Error embedding files:', error)
    } finally {
      setIsEmbedding(false)
    }
  }

  const handleOpenSidePanel = async () => {
    try {
      await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id })
      window.close()
    } catch (error) {
      console.error('Failed to open sidepanel:', error)
    }
  }

  const handleInterrupt = () => {
    stop() // Stop TTS immediately
    interruptChat()
    soundEffects.stopAll()
  }

  const handleWaveformClick = () => {
    // Don't allow interaction while summarizing
    if (state.isSummarizing) {
      return
    }
    // Interrupt any ongoing processing or TTS before starting to listen
    if (state.isProcessing || isSpeaking) {
      handleInterrupt()
    }
    // Play listening sound effect
    soundEffects.play('listening')
    // Then toggle listening
    handleMicClick()
  }

  // Show redirect screen in popup when onboarding is needed
  if (isPopup && !onboardingState.isComplete && onboardingState.currentStep) {
    return <OnboardingRedirect />
  }

  return (
    <>
      {/* Show onboarding flow in side panel if not complete */}
      <OnboardingFlow />
      
      {/* Main app - hidden when onboarding is active */}
      <div 
        className="relative w-full bg-black text-white flex flex-col" 
        style={fullHeight ? { height: '100vh' } : { minHeight: '500px', maxHeight: '600px' }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Header */}
      <div className="p-3 border-b border-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="font-mono text-sm">MARIONETTE</div>
          
          {/* Context Indicator */}
          <div 
            className="relative group cursor-help"
            title={`${latestContextCount}/${MAX_CONTEXT_SIZE} tokens`}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" className="transform -rotate-90">
              {/* Background circle */}
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="rgb(31, 41, 55)"
                strokeWidth="2"
              />
              {/* Progress circle */}
              {latestContextCount > 0 && (
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke={latestContextCount > 7372 ? "rgb(239, 68, 68)" : latestContextCount > 4608 ? "rgb(251, 191, 36)" : "rgb(34, 197, 94)"}
                  strokeWidth="2"
                  strokeDasharray={`${(latestContextCount / MAX_CONTEXT_SIZE) * 50.265} 50.265`}
                  strokeLinecap="round"
                  className="transition-all duration-300"
                />
              )}
            </svg>
            
            {/* Tooltip on hover */}
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-[10px] font-mono whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
              {latestContextCount}/{MAX_CONTEXT_SIZE}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className="p-1 hover:bg-gray-800 rounded"
            title={audioEnabled ? "Mute audio" : "Unmute audio"}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-gray-500" />}
          </button>
          <button
            onClick={handleOpenSidePanel}
            className="p-1 hover:bg-gray-800 rounded"
            title="Open Side Panel"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleMicClick}
            disabled={state.isSummarizing}
            className={`p-1 hover:bg-gray-800 rounded ${isListening ? 'text-red-500' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isListening ? 'Stop listening' : 'Start listening'}
          >
            <Mic className="w-4 h-4" />
          </button>
          {(state.isProcessing || state.isSummarizing) && (
            <button
              onClick={handleInterrupt}
              className="p-1 hover:bg-gray-800 rounded text-red-500"
              title="Stop response"
            >
              <Square className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={resetChat}
            className="p-1 hover:bg-gray-800 rounded"
            title="Reset"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={onNavigateToDebug}
            className="p-1 hover:bg-gray-800 rounded"
            title="Debug"
          >
            <Bug className="w-4 h-4" />
          </button>
          <button
            onClick={onNavigateToSettings}
            className="p-1 hover:bg-gray-800 rounded"
            title="Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Waveform 
            state={waveformState} 
            onClick={state.isSummarizing ? undefined : handleWaveformClick} 
          />
        </div>

        {isListening && (
          <div className="mt-3 text-xs text-gray-500 font-mono">listening...</div>
        )}

        {/* Transcript while listening */}
        {transcript && isListening && (
          <div className="mt-4 max-w-md text-center">
            <div className={`text-sm ${getTextColor(waveformState)}`}>
              {transcript}
            </div>
          </div>
        )}

        {/* Spoken text - show current or last sentence */}
        {!isListening && (currentSentence || lastDisplayedSentence) && (
          <div className="mt-4 max-w-md text-center">
            <div className={`text-sm ${getTextColor(waveformState)}`}>
              {currentSentence || lastDisplayedSentence}
            </div>
          </div>
        )}
        
        {/* Rating buttons - show only when response is complete */}
        {!state.isProcessing && !state.isInToolLoop && !state.isSummarizing && latestResponse.text && latestResponse.id && (
          <div className="mt-4 flex flex-col items-center justify-center gap-1">
            <div className="text-[10px] text-gray-500 font-mono">rate last response</div>
            <RatingButtons 
              messageId={latestResponse.id}
              currentRating={latestResponse.rating}
              onRate={rateMessage}
              size="md"
            />
          </div>
        )}
      </div>
      
      {/* Drag & Drop Overlay with Backdrop Blur */}
      {(isDraggingFiles || isEmbedding || embedSuccess) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-black/40 transition-all duration-300">
          <div className="bg-gray-900/90 border-2 border-dashed border-gray-600 rounded-xl p-12 text-center">
            {isEmbedding ? (
              <>
                <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-xl text-gray-300">Embedding files...</p>
              </>
            ) : embedSuccess ? (
              <>
                <svg className="w-16 h-16 text-green-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <p className="text-xl text-gray-300">{embedSuccess}</p>
              </>
            ) : (
              <>
                <svg className="w-16 h-16 text-blue-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-xl text-gray-300">Drop files to embed</p>
                <p className="text-sm text-gray-500 mt-2">PDF, TXT, MD, HTML, JSON</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="p-3 border-t border-gray-800">
        {/* Reference indicator */}
        {state.reference && (
          <div 
            className="mb-2 flex flex-col gap-2 px-3 py-2 bg-blue-900/20 border border-blue-700/30 rounded text-xs font-mono"
            style={{
              animation: 'slideInScale 0.3s ease-out',
            }}
          >
            <div className="flex items-center gap-2">
              <Paperclip size={14} className="text-blue-400" style={{ animation: 'spin 0.5s ease-out' }} />
              <span className="text-gray-400 flex-1 truncate">
                {state.reference.image ? 'Screenshot' : state.reference.audio ? 'Audio Recording' : `"${state.reference.text.substring(0, 50)}${state.reference.text.length > 50 ? '...' : ''}"`}
              </span>
              <button
                onClick={() => {
                  dispatch({ type: 'SET_REFERENCE', payload: null })
                  chrome.storage.local.remove('chat_reference')
                }}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            
            {/* Image preview */}
            {state.reference.image && (
              <img 
                src={state.reference.image} 
                alt="Reference screenshot" 
                className="max-w-full max-h-32 rounded border border-blue-700/30"
              />
            )}
            
            {/* Audio preview */}
            {state.reference.audio && (
              <audio 
                src={state.reference.audio} 
                controls 
                className="w-full h-8"
                style={{ maxWidth: '300px' }}
              />
            )}
            
            {/* Explanation */}
            {state.reference.explanation && (
              <div className="text-gray-500 text-xs italic border-t border-blue-700/20 pt-2">
                {state.reference.explanation.substring(0, 100)}{state.reference.explanation.length > 100 ? '...' : ''}
              </div>
            )}
          </div>
        )}
        
        <style>{`
          @keyframes slideInScale {
            0% {
              opacity: 0;
              transform: translateY(-10px) scale(0.95);
            }
            100% {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          
          @keyframes spin {
            0% {
              transform: rotate(0deg) scale(1);
            }
            50% {
              transform: rotate(180deg) scale(1.2);
            }
            100% {
              transform: rotate(360deg) scale(1);
            }
          }
        `}</style>
        
        <div className="flex items-center justify-center gap-4 mb-2">
          <div className="flex-1 flex justify-end">
            <MicSelector />
          </div>
          <div className="flex-1 flex justify-start">
            <VoiceSelector />
          </div>
        </div>
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={handleTextSubmit}
          disabled={state.isProcessing || state.isSummarizing}
          placeholder="type here..."
          className="w-full bg-transparent border-none text-sm font-mono text-gray-300 placeholder-gray-600 focus:outline-none disabled:opacity-50 text-center"
        />
      </div>
      </div>
    </>
  )
}
