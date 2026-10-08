import React, { createContext, useContext, useReducer, type ReactNode } from 'react'
import { type Message, createUserMessage, createAssistantMessage } from './messages'
import { streamResponse, getTokenUsage, destroySession as destroyAISession, interrupt as interruptAI, getFilledSystemPrompt } from './ai'
import { parseToolCall, executeTool, detectInvalidToolFormat } from './tools'
import { shouldSummarize, summarizeConversation, formatSummaryMessage } from './summarizer'
import { executeUITool, validateUITools } from './ui-tools'
import { getToolSpec, getSpokenLine } from './tool-registry'
import { isAIModelError, isWriterAPIError } from './errors'
import { type AlertAction, openAIFlagsPage, openWriterAPIFlagsPage } from './alert-context'
import { useTTS } from './tts-context'
import { storeRating } from './rating-database'
import { useSoundEffects } from './use-sound-effects'
import { getMemoryReminder } from './prompts/system-prompt'
import { checkForTestTrigger, getNextTestChunk, getTestStepDelay } from './ui-test-runner'

// Validate UI tools on module load
validateUITools()

// Global error handler reference - set by AlertProvider
let globalAlertHandler: ((type: 'error' | 'info', title: string, message: string, action?: AlertAction) => void) | null = null

export const setGlobalAlertHandler = (handler: (type: 'error' | 'info', title: string, message: string, action?: AlertAction) => void) => {
  globalAlertHandler = handler
}

interface ChatReference {
  text: string
  explanation: string
  image?: string // base64 image data
  audio?: string // base64 audio data
  timestamp: number
}

interface ChatState {
  messages: Message[]
  isProcessing: boolean
  isWaitingForFirstChunk: boolean
  isSummarizing: boolean
  isWarmingUp: boolean
  executingTool: string | null
  isInToolLoop: boolean
  reference: ChatReference | null
}

type ChatAction =
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; content: string } }
  | { type: 'UPDATE_MESSAGE_CONTEXT'; payload: { id: string; contextCount: number } }
  | { type: 'UPDATE_MESSAGE_RATING'; payload: { id: string; rating: 'up' | 'down' } }
  | { type: 'SET_PROCESSING'; payload: boolean }
  | { type: 'SET_WAITING'; payload: boolean }
  | { type: 'SET_SUMMARIZING'; payload: boolean }
  | { type: 'SET_WARMING_UP'; payload: boolean }
  | { type: 'SET_EXECUTING_TOOL'; payload: string | null }
  | { type: 'SET_IN_TOOL_LOOP'; payload: boolean }
  | { type: 'APPLY_SUMMARY'; payload: { summaryMessage: Message } }
  | { type: 'MARK_MESSAGES_VISUAL_ONLY' }
  | { type: 'SET_REFERENCE'; payload: ChatReference | null }
  | { type: 'RESET' }

const chatReducer = (state: ChatState, action: ChatAction): ChatState => {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] }
    
    case 'UPDATE_MESSAGE':
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.payload.id
            ? { ...msg, content: action.payload.content }
            : msg
        )
      }
    
    case 'UPDATE_MESSAGE_CONTEXT':
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.payload.id
            ? { ...msg, contextCount: action.payload.contextCount }
            : msg
        )
      }
    
    case 'UPDATE_MESSAGE_RATING':
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.payload.id
            ? { ...msg, rating: action.payload.rating }
            : msg
        )
      }
    
    case 'SET_PROCESSING':
      console.log('[STOPBTN-REDUCER] SET_PROCESSING:', action.payload)
      return { ...state, isProcessing: action.payload }
    
    case 'SET_WAITING':
      return { ...state, isWaitingForFirstChunk: action.payload }
    
    case 'SET_SUMMARIZING':
      return { ...state, isSummarizing: action.payload }
    
    case 'SET_WARMING_UP':
      return { ...state, isWarmingUp: action.payload }
    
    case 'SET_EXECUTING_TOOL':
      return { ...state, executingTool: action.payload }
    
    case 'SET_IN_TOOL_LOOP':
      console.log('[STOPBTN-REDUCER] SET_IN_TOOL_LOOP:', action.payload)
      return { ...state, isInToolLoop: action.payload }
    
    case 'SET_REFERENCE':
      return { ...state, reference: action.payload }
    
    case 'MARK_MESSAGES_VISUAL_ONLY':
      // Mark all existing messages as visual only (keep in UI but exclude from AI context)
      return {
        ...state,
        messages: state.messages.map(msg => ({ ...msg, visualOnly: true }))
      }
    
    case 'APPLY_SUMMARY':
      // Add summary message after marking old messages as visual only
      return {
        ...state,
        messages: [...state.messages, action.payload.summaryMessage]
      }
    
    case 'RESET':
      console.log('[STOPBTN-REDUCER] RESET - clearing all state')
      return { messages: [], isProcessing: false, isWaitingForFirstChunk: false, isSummarizing: false, isWarmingUp: false, executingTool: null, isInToolLoop: false, reference: null }
    
    default:
      return state
  }
}

interface ChatContextValue {
  state: ChatState
  dispatch: React.Dispatch<ChatAction>
  sendMessage: (userInput: string) => Promise<void>
  resetChat: () => void
  interruptChat: () => void
  copyContext: () => Promise<string>
  rateMessage: (messageId: string, rating: 'up' | 'down') => void
  isInitialLoadComplete: boolean
}

const ChatContext = createContext<ChatContextValue | null>(null)

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    isProcessing: false,
    isWaitingForFirstChunk: false,
    isSummarizing: false,
    isWarmingUp: false,
    executingTool: null,
    isInToolLoop: false,
    reference: null
  })

  // Get TTS context to wait for readiness before tool execution and to queue system messages
  const { waitUntilReady: waitForTTS, handleNewText: speakText } = useTTS()
  
  // Get sound effects for tool execution
  const soundEffects = useSoundEffects()

  // Track if we need to rebuild AI context from restored messages
  const [needsContextRebuild, setNeedsContextRebuild] = React.useState(false)
  
  // Track if initial load from storage is complete
  const [isInitialLoadComplete, setIsInitialLoadComplete] = React.useState(false)
  
  // Track if we're currently syncing to avoid loops
  const isSyncingRef = React.useRef(false)
  // Track processing state in refs so storage listener has current values
  const isProcessingRef = React.useRef(false)
  const isInToolLoopRef = React.useRef(false)

  // Keep refs in sync with state
  React.useEffect(() => {
    isProcessingRef.current = state.isProcessing
    isInToolLoopRef.current = state.isInToolLoop
  }, [state.isProcessing, state.isInToolLoop])

  // Restore messages and reference on mount
  React.useEffect(() => {
    chrome.storage.local.get(['chat_messages', 'chat_reference'], (result) => {
      if (result.chat_messages && Array.isArray(result.chat_messages) && result.chat_messages.length > 0) {
        console.log('Restored', result.chat_messages.length, 'messages from storage')
        result.chat_messages.forEach((msg: Message) => {
          dispatch({ type: 'ADD_MESSAGE', payload: msg })
        })
        // Mark that we need to rebuild context on next user message
        setNeedsContextRebuild(true)
      }
      
      // Load any existing reference
      if (result.chat_reference) {
        console.log('[REFERENCE] Restored reference from storage:', result.chat_reference)
        dispatch({ type: 'SET_REFERENCE', payload: result.chat_reference })
      }
      
      // Mark initial load as complete (whether we restored messages or not)
      setIsInitialLoadComplete(true)
    })

    // Listen for storage changes from other instances
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return
      
      // Handle reference changes
      if (changes.chat_reference) {
        const newReference = changes.chat_reference.newValue
        if (newReference) {
          console.log('[REFERENCE] Received new reference from content script:', newReference)
          dispatch({ type: 'SET_REFERENCE', payload: newReference })
        } else {
          console.log('[REFERENCE] Reference cleared from storage')
          dispatch({ type: 'SET_REFERENCE', payload: null })
        }
      }
      
      if (!changes.chat_messages) return
      if (isSyncingRef.current) return

      // CRITICAL: Never sync during active workflows - it clears isProcessing/isInToolLoop!
      // Only sync when idle (not processing and not in tool loop)
      if (isProcessingRef.current || isInToolLoopRef.current) {
        console.log('[STOPBTN] Ignoring storage sync - workflow in progress (isProcessing=' + isProcessingRef.current + ', isInToolLoop=' + isInToolLoopRef.current + ')')
        return
      }

      const newMessages = changes.chat_messages.newValue

      // Handle reset (messages cleared)
      if (!newMessages || (Array.isArray(newMessages) && newMessages.length === 0)) {
        console.log('Syncing reset from another instance')
        dispatch({ type: 'RESET' })
        return
      }

      // Handle message updates
      if (Array.isArray(newMessages)) {
        console.log('Syncing', newMessages.length, 'messages from another instance')
        // Reset and rebuild with new messages
        dispatch({ type: 'RESET' })
        newMessages.forEach((msg: Message) => {
          dispatch({ type: 'ADD_MESSAGE', payload: msg })
        })
        setNeedsContextRebuild(true)
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  // Save messages to storage whenever they change
  React.useEffect(() => {
    isSyncingRef.current = true
    
    if (state.messages.length > 0) {
      chrome.storage.local.set({ chat_messages: state.messages })
    } else {
      // Clear storage when no messages
      chrome.storage.local.remove(['chat_messages'])
    }
    
    // Reset sync flag after a brief delay to allow storage to update
    setTimeout(() => {
      isSyncingRef.current = false
    }, 100)
  }, [state.messages])

  // Helper to call streamResponse with warming up callbacks
  const streamWithWarmup = async (
    message: string, 
    onChunk: (chunk: string) => void,
    toolResult?: any
  ) => {
    return streamResponse(
      message,
      onChunk,
      toolResult,
      () => {
        // onWarmingUp callback
        console.log('[PROCESSING] Model warming up...')
        dispatch({ type: 'SET_WARMING_UP', payload: true })
        // Speak warmup message
        waitForTTS().then(() => speakText('Loading model...', true))
      },
      () => {
        // onWarmupComplete callback  
        console.log('[PROCESSING] Model warmup complete')
        dispatch({ type: 'SET_WARMING_UP', payload: false })
      }
    )
  }

  const checkAndSummarize = async (): Promise<boolean> => {
    const tokenUsage = getTokenUsage()
    
    if (shouldSummarize(tokenUsage.usage)) {
      console.log('Context threshold reached, summarizing conversation...')
      dispatch({ type: 'SET_SUMMARIZING', payload: true })
      
      try {
        // Wait for any ongoing TTS to finish before announcing
        await waitForTTS()
        
        // Speak "Summarizing context..." message and play sound
        speakText('Summarizing context...', true)
        soundEffects.play('summarizing')
        
        // Wait for TTS queue to clear before starting summarization
        console.log('[SUMMARIZER] Waiting for TTS to finish speaking summarization message...')
        await waitForTTS()
        
        // Summarize current conversation (only non-visual messages)
        const messagesForSummary = state.messages.filter(msg => !msg.visualOnly)
        const summary = await summarizeConversation(messagesForSummary)
        
        // Reset session
        destroyAISession()
        
        // Mark all current messages as visual only (keep in UI but not sent to AI)
        dispatch({ type: 'MARK_MESSAGES_VISUAL_ONLY' })
        
        // Add summary message
        const summaryMessage = createAssistantMessage(formatSummaryMessage(summary), 0)
        dispatch({ type: 'APPLY_SUMMARY', payload: { summaryMessage } })
        
        console.log('Conversation summarized, old messages marked as visual-only')
        return true // Indicate that summarization occurred
      } catch (error: any) {
        console.error('Summarization failed:', error)
        const errorMsg = createAssistantMessage(`Failed to summarize: ${error.message}`, 0)
        dispatch({ type: 'ADD_MESSAGE', payload: errorMsg })
      } finally {
        dispatch({ type: 'SET_SUMMARIZING', payload: false })
      }
    }
    
    return false // No summarization occurred
  }

  const sendMessage = async (userInput: string) => {
    // CRITICAL: Check user activation immediately while we have it
    const hasUserActivation = (navigator as any).userActivation?.isActive
    console.log('sendMessage called - User activation at start:', hasUserActivation)
    
    console.log('[STOPBTN] ========== SETTING TO TRUE ==========')
    dispatch({ type: 'SET_PROCESSING', payload: true })
    dispatch({ type: 'SET_WAITING', payload: true })
    console.log('[STOPBTN] isProcessing=true, isWaitingForFirstChunk=true')
    
    // Speak "Thinking..." message and play sound
    waitForTTS().then(() => {
      speakText('Thinking...', true)
      soundEffects.play('thinking')
    })
    
    // Append reference if it exists
    let messageToSend = userInput
    let referenceImage: string | undefined
    let referenceAudio: string | undefined
    const hadReference = state.reference // Save for UI display
    if (state.reference) {
      console.log('[REFERENCE] Appending reference to message:', state.reference)
      
      if (state.reference.image) {
        // If reference has an image, we'll send it separately
        referenceImage = state.reference.image
        messageToSend = `${userInput}\n\n[REFERENCE IMAGE]\nExplanation: ${state.reference.explanation}`
      } else if (state.reference.audio) {
        // If reference has audio, we'll send it separately
        referenceAudio = state.reference.audio
        messageToSend = `${userInput}\n\n[REFERENCE AUDIO]\nExplanation: ${state.reference.explanation}`
      } else {
        messageToSend = `${userInput}\n\n[REFERENCE]\nSelected text: "${state.reference.text}"\nExplanation: ${state.reference.explanation}`
      }
      
      console.log('[REFERENCE] Message with reference:', messageToSend)
      
      // Clear the reference from state and storage
      dispatch({ type: 'SET_REFERENCE', payload: null })
      chrome.storage.local.remove('chat_reference')
    }
    
    // If we restored messages and haven't rebuilt context yet, prepend conversation history BEFORE adding new message
    if (needsContextRebuild && state.messages.length > 0) {
      // Only include non-visual messages in AI context
      const messagesForAI = state.messages.filter(msg => !msg.visualOnly)
      console.log('Rebuilding AI context from', messagesForAI.length, 'non-visual messages (out of', state.messages.length, 'total)')
      
      const history = messagesForAI.map(msg => {
        let content = msg.content
        
        // Truncate base64 images
        if (content.includes('data:image/')) {
          content = content.replace(
            /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
            (match) => {
              const preview = match.substring(0, 50)
              return `${preview}... [IMAGE_TRUNCATED_${match.length}_CHARS]`
            }
          )
        }
        
        // Truncate base64 audio
        if (content.includes('data:audio/')) {
          content = content.replace(
            /data:audio\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
            (match) => {
              const preview = match.substring(0, 50)
              return `${preview}... [AUDIO_TRUNCATED_${match.length}_CHARS]`
            }
          )
        }
        
        return `${msg.role.toUpperCase()}: ${content}`
      }).join('\n\n')
      messageToSend = `[Previous conversation history]\n\n${history}\n\n[Current message]\nUSER: ${messageToSend}`
      setNeedsContextRebuild(false)
    }
    
    // Add user message AFTER building history
    // If reference was appended, show it in the UI message too
    const displayMessage = hadReference 
      ? `${userInput}\n\n📎 Reference: "${hadReference.text.substring(0, 100)}${hadReference.text.length > 100 ? '...' : ''}"`
      : userInput
    const userMessage = createUserMessage(displayMessage)
    dispatch({ type: 'ADD_MESSAGE', payload: userMessage })
    
    // Check if this triggers a UI test case
    const isTestMode = checkForTestTrigger(userInput)
    
    // Stream AI response (or test response)
    let assistantContent = ""
    let assistantMessageId = Date.now() + '_assistant'
    
    try {
      console.log('[PROCESSING] Starting initial stream...')
      
      let contextCount = 0
      
      if (isTestMode) {
        // Test mode: Get first chunk from test runner
        console.log('[UI Test] Getting first test chunk')
        const testChunk = getNextTestChunk()
        if (testChunk) {
          assistantContent = testChunk
          dispatch({ type: 'SET_WAITING', payload: false })
          const assistantMessage = createAssistantMessage(assistantContent)
          assistantMessageId = assistantMessage.id
          dispatch({ type: 'ADD_MESSAGE', payload: assistantMessage })
        }
      } else {
        // Normal mode: Stream from LLM
        contextCount = await streamWithWarmup(
          messageToSend, 
          (chunk: string) => {
            assistantContent += chunk
            
            if (assistantContent.length === chunk.length) {
              // First chunk - add message
              console.log('[PROCESSING] First chunk received')
              dispatch({ type: 'SET_WAITING', payload: false })
              const assistantMessage = createAssistantMessage(assistantContent)
              assistantMessageId = assistantMessage.id
              dispatch({ type: 'ADD_MESSAGE', payload: assistantMessage })
            } else {
              // Update existing message
              dispatch({ type: 'UPDATE_MESSAGE', payload: { id: assistantMessageId, content: assistantContent } })
            }
          },
          referenceImage || referenceAudio // Pass image or audio as tool result if present
        )
      }
      
      console.log('[PROCESSING] Initial stream complete, content length:', assistantContent.length)
      
      // Update message with context count
      dispatch({ type: 'UPDATE_MESSAGE_CONTEXT', payload: { id: assistantMessageId, contextCount } })
      
      // Check if summarization is needed before tool loop
      const summarizedBefore = await checkAndSummarize()
      
      // Tool execution loop
      console.log('[PROCESSING] Entering tool execution loop')
      let currentContent = assistantContent
      let loopCount = 0
      const MAX_LOOPS = 60
      
      // Track recent tool calls to detect infinite loops
      const recentToolCalls: Array<{name: string, args: string}> = []
      
      // Set flag to indicate we're in tool loop
      console.log('[STOPBTN] ========== ENTERING TOOL LOOP ==========')
      dispatch({ type: 'SET_IN_TOOL_LOOP', payload: true })
      console.log('[STOPBTN] isInToolLoop=true, isProcessing=true (should remain true)')
      
      while (loopCount < MAX_LOOPS) {
        console.log(`[PROCESSING] Loop ${loopCount + 1} - Checking for tool calls...`)
        
        // Check for invalid format
        const invalidFormat = detectInvalidToolFormat(currentContent)
        if (invalidFormat) {
          console.error('[PROCESSING] Invalid tool format detected:', invalidFormat)
          
          // Check if we've already shown this error recently (prevent loops)
          const recentMessages = state.messages.slice(-3)
          const hasRecentFormatError = recentMessages.some(m => 
            m.content.includes('STOP using code blocks') || 
            m.content.includes('Invalid format detected')
          )
          
          if (hasRecentFormatError) {
            // Stop the loop - agent is stuck
            console.error('[PROCESSING] Format error loop detected - stopping')
            dispatch({ type: 'SET_PROCESSING', payload: false })
            dispatch({ type: 'SET_WAITING', payload: false })
            dispatch({ type: 'SET_IN_TOOL_LOOP', payload: false })
            
            const finalError = createAssistantMessage(
              'I apologize, but I\'m having trouble with the tool format. Please try rephrasing your request or contact support.',
              0
            )
            dispatch({ type: 'ADD_MESSAGE', payload: { ...finalError, id: Date.now() + '_loop_stopped' } })
            return
          }
          
          // First time showing this error - provide corrective feedback
          const correctionMessage = `[TOOL RESULT]\nError: ${invalidFormat}`
          
          const errorResultMessage = createAssistantMessage(correctionMessage, 0)
          dispatch({ type: 'ADD_MESSAGE', payload: { ...errorResultMessage, id: Date.now() + '_formaterror' } })
          
          // Get AI response with correction
          let correctionResponseContent = ""
          const correctionResponseId = Date.now() + '_correction_' + loopCount
          
          const correctionContextCount = await streamWithWarmup(correctionMessage, (chunk: string) => {
            correctionResponseContent += chunk
            
            if (correctionResponseContent.length === chunk.length) {
              const correctionResponseMessage = createAssistantMessage(correctionResponseContent, 0)
              dispatch({ type: 'ADD_MESSAGE', payload: { ...correctionResponseMessage, id: correctionResponseId } })
            } else {
              dispatch({ type: 'UPDATE_MESSAGE', payload: { id: correctionResponseId, content: correctionResponseContent } })
            }
          })
          
          // Update context count for the correction response
          dispatch({ type: 'UPDATE_MESSAGE_CONTEXT', payload: { id: correctionResponseId, contextCount: correctionContextCount } })
          
          // Update current content and continue loop
          currentContent = correctionResponseContent
          loopCount++
          continue
        }
        
        const toolCall = parseToolCall(currentContent)
        
        if (!toolCall) {
          console.log('[PROCESSING] No tool call found, ending loop')
          break
        }
        
        console.log(`[PROCESSING] Loop ${loopCount + 1} - Tool call found:`, toolCall.function)
        
        // Detect infinite loops - same tool called 3+ times consecutively OR cyclic patterns
        // EXCLUDE certain tools from loop detection:
        // - 'think' is just internal reasoning
        // - 'fillInput' is expected to be called multiple times when filling forms
        // - 'findElements' is expected to be called multiple times when locating different form fields
        // - 'scrollDown'/'scrollUp' may be called many times on long pages
        const excludedTools = ['think', 'fillInput', 'findElements', 'scrollDown', 'scrollUp']
        if (!excludedTools.includes(toolCall.function)) {
          recentToolCalls.push({ name: toolCall.function, args: JSON.stringify(toolCall.arguments) })
          
          // Keep only last 9 tool calls (to detect patterns up to 3 cycles of 3 tools)
          if (recentToolCalls.length > 9) {
            recentToolCalls.shift()
          }
          
          // Check for loop: last 3 calls are the same tool
          if (recentToolCalls.length >= 3) {
            const lastThree = recentToolCalls.slice(-3)
            const allSameTool = lastThree.every(call => call.name === lastThree[0].name)
            
            if (allSameTool) {
              const toolName = lastThree[0].name
              console.error(`[PROCESSING] INFINITE LOOP DETECTED: ${toolName} called 3 times consecutively`)
              
              // Inject loop warning as a tool result and let agent continue
              const loopWarning = `LOOP DETECTED: You've called ${toolName} three times in a row. ` +
                `Stop calling tools and provide your final answer based on the information you already have. ` +
                `Describe what you see or learned from the previous tool results.`
              
              const loopMessage = createAssistantMessage(`[TOOL RESULT]\n${loopWarning}`, 0)
              dispatch({ type: 'ADD_MESSAGE', payload: { ...loopMessage, id: Date.now() + '_loopwarning_' + loopCount } })
              
              // Clear recent calls to prevent re-triggering
              recentToolCalls.length = 0
              
              // Get agent's response to the loop warning and continue
              let loopResponseContent = ""
              const loopResponseId = Date.now() + '_loopresponse_' + loopCount
              
              const loopResponseCount = await streamWithWarmup('Continue based on the warning above.', (chunk: string) => {
                loopResponseContent += chunk
                
                if (loopResponseContent.length === chunk.length) {
                  const loopResponseMessage = createAssistantMessage(loopResponseContent, 0)
                  dispatch({ type: 'ADD_MESSAGE', payload: { ...loopResponseMessage, id: loopResponseId } })
                } else {
                  dispatch({ type: 'UPDATE_MESSAGE', payload: { id: loopResponseId, content: loopResponseContent } })
                }
              }, loopWarning)
              
              dispatch({ type: 'UPDATE_MESSAGE_CONTEXT', payload: { id: loopResponseId, contextCount: loopResponseCount } })
              
              currentContent = loopResponseContent
              loopCount++
              continue
            }
          }
          
          // Check for cyclic patterns: same sequence of tools repeated
          if (recentToolCalls.length >= 6) {
            const last6 = recentToolCalls.slice(-6)
            const pattern1 = last6.slice(0, 3).map(c => c.name).join(',')
            const pattern2 = last6.slice(3, 6).map(c => c.name).join(',')
            
            if (pattern1 === pattern2) {
              console.error(`[PROCESSING] CYCLIC LOOP DETECTED: Pattern [${pattern1}] repeated`)
              
              // Inject cycle warning as a tool result and let agent continue
              const cycleWarning = `LOOP DETECTED: You're repeating the same sequence of tools (${pattern1}) without making progress. ` +
                `Stop calling tools and provide your final answer based on the information you already have.`
              
              const cycleMessage = createAssistantMessage(`[TOOL RESULT]\n${cycleWarning}`, 0)
              dispatch({ type: 'ADD_MESSAGE', payload: { ...cycleMessage, id: Date.now() + '_cyclewarning_' + loopCount } })
              
              // Clear recent calls to prevent re-triggering
              recentToolCalls.length = 0
              
              // Get agent's response to the cycle warning and continue
              let cycleResponseContent = ""
              const cycleResponseId = Date.now() + '_cycleresponse_' + loopCount
              
              const cycleResponseCount = await streamWithWarmup('Continue based on the warning above.', (chunk: string) => {
                cycleResponseContent += chunk
                
                if (cycleResponseContent.length === chunk.length) {
                  const cycleResponseMessage = createAssistantMessage(cycleResponseContent, 0)
                  dispatch({ type: 'ADD_MESSAGE', payload: { ...cycleResponseMessage, id: cycleResponseId } })
                } else {
                  dispatch({ type: 'UPDATE_MESSAGE', payload: { id: cycleResponseId, content: cycleResponseContent } })
                }
              }, cycleWarning)
              
              dispatch({ type: 'UPDATE_MESSAGE_CONTEXT', payload: { id: cycleResponseId, contextCount: cycleResponseCount } })
              
              currentContent = cycleResponseContent
              loopCount++
              continue
            }
          }
        }
        
        // Show which tool is executing
        console.log('[PROCESSING] Setting executingTool to:', toolCall.function)
        dispatch({ type: 'SET_EXECUTING_TOOL', payload: toolCall.function })
        
        // Speak tool execution message and play sound
        const spokenLine = getSpokenLine(toolCall.function, toolCall.arguments)
        await waitForTTS()
        speakText(spokenLine, true)
        
        // Wait for TTS queue to clear before executing tool
        console.log('[TOOL] Waiting for TTS to finish speaking tool message...')
        await waitForTTS()

        // Play specific sound effects for certain tools
        if (toolCall.function === 'listen') {
          soundEffects.play('audioCapture')
        } else if (toolCall.function === 'captureScreenshot') {
          soundEffects.play('screenshot')
        } else {
          soundEffects.play('tool')
        }
        
        // Check if tool requires user gesture
        const toolSpec = getToolSpec(toolCall.function)
        let toolResult: any
        
        if (toolSpec?.requiresUserGesture) {
          console.log('[PROCESSING] Executing UI tool (user gesture required):', toolCall.function)
          console.log('User activation before UI tool:', (navigator as any).userActivation?.isActive)
          toolResult = await executeUITool(toolCall)
        } else {
          console.log('[PROCESSING] Executing background tool:', toolCall.function)
          toolResult = await executeTool(toolCall)
        }
        
        console.log('[PROCESSING] Tool execution complete, result:', toolResult?.success ? 'SUCCESS' : 'FAILED')
        
        // Add 1 second delay for fancy visual effect
        await new Promise(resolve => setTimeout(resolve, 1000))
        console.log('[TOOL] Visual delay complete, executing tool now')

        // Clear executing tool indicator
        console.log('[PROCESSING] Clearing executingTool')
        dispatch({ type: 'SET_EXECUTING_TOOL', payload: null })
        
        // If tool failed, add context to help AI not retry
        if (!toolResult?.success) {
          console.log('Tool failed, AI should not retry this exact call')
        }
        
        // Add tool result as message
        const resultToPass = toolResult?.success ? toolResult.result : `Error: ${toolResult?.error || 'Tool failed'}`
        const toolResultMessage = createAssistantMessage(`[TOOL RESULT]\n${resultToPass}`, 0)
        dispatch({ type: 'ADD_MESSAGE', payload: { ...toolResultMessage, id: Date.now() + '_toolresult_' + loopCount } })
        
        // Get agent's response to tool result (loopback)
        console.log(`[PROCESSING] Starting loopback ${loopCount + 1} - still processing...`)
        let followupContent = ""
        const followupMessageId = Date.now() + '_followup_' + loopCount
        let followupContextCount = 0
        
        console.log(`[STOPBTN] ========== LOOPBACK ${loopCount + 1} START ==========`)
        console.log(`[STOPBTN] isProcessing=true, isInToolLoop=true (STOP button should be visible)`)
        
        if (isTestMode) {
          console.log('[UI Test] Getting next test chunk after tool execution')
          const delay = getTestStepDelay()
          await new Promise(resolve => setTimeout(resolve, delay))
          const testChunk = getNextTestChunk(toolResult)
          if (testChunk) {
            followupContent = testChunk
            const followupMessage = createAssistantMessage(followupContent, 0)
            dispatch({ type: 'ADD_MESSAGE', payload: { ...followupMessage, id: followupMessageId } })
            
            // If this is a respond (not a tool call), speak it
            if (!testChunk.includes('<function_call>')) {
              await waitForTTS()
              speakText(testChunk, false)
            }
          } else {
            // Test is complete
            console.log('[UI Test] Test sequence complete')
            break
          }
        } else {
          // Normal mode: Stream from LLM
          console.log(`[STOPBTN] About to call streamResponse...`)
          // IMPORTANT: Use a continuation prompt so the agent knows to keep executing
          // Inject memory reminder to keep user info fresh in context
          const memoryReminder = await getMemoryReminder()
          const continuationPrompt = `${memoryReminder}Continue executing the workflow based on the last tool result. Do not conclude. If the playbook has more steps, perform the next step.`
          followupContextCount = await streamWithWarmup(continuationPrompt, (chunk: string) => {
            followupContent += chunk
            
            if (followupContent.length === chunk.length) {
              console.log(`[STOPBTN] Loopback ${loopCount + 1} FIRST CHUNK received`)
              const followupMessage = createAssistantMessage(followupContent, 0)
              dispatch({ type: 'ADD_MESSAGE', payload: { ...followupMessage, id: followupMessageId } })
            } else {
              dispatch({ type: 'UPDATE_MESSAGE', payload: { id: followupMessageId, content: followupContent } })
            }
          }, resultToPass)
        }
        
        console.log(`[STOPBTN] ========== LOOPBACK ${loopCount + 1} STREAM COMPLETE ==========`)
        console.log(`[STOPBTN] Stream finished, content length:`, followupContent.length)
        
        dispatch({ type: 'UPDATE_MESSAGE_CONTEXT', payload: { id: followupMessageId, contextCount: followupContextCount } })
        
        // Check if summarization is needed during tool loop
        const summarizedDuringLoop = await checkAndSummarize()
        
        // If summarization occurred during loopback, continue the workflow
        if (summarizedDuringLoop) {
          console.log('[PROCESSING] Summarization occurred mid-loopback, prompting agent to continue workflow...')
          
          // Get agent's response to continue after summarization
          let continueContent = ""
          const continueMessageId = Date.now() + '_continue_' + loopCount
          
          const memoryReminderAfterSummary = await getMemoryReminder()
          const continuePrompt = `${memoryReminderAfterSummary}Please continue with your workflow based on the context summary above.`
          const continueContextCount = await streamWithWarmup(continuePrompt, (chunk: string) => {
            continueContent += chunk
            
            if (continueContent.length === chunk.length) {
              console.log('[PROCESSING] Continue after summarization - first chunk received')
              const continueMessage = createAssistantMessage(continueContent, 0)
              dispatch({ type: 'ADD_MESSAGE', payload: { ...continueMessage, id: continueMessageId } })
            } else {
              dispatch({ type: 'UPDATE_MESSAGE', payload: { id: continueMessageId, content: continueContent } })
            }
          })
          
          dispatch({ type: 'UPDATE_MESSAGE_CONTEXT', payload: { id: continueMessageId, contextCount: continueContextCount } })
          currentContent = continueContent
        } else {
          currentContent = followupContent
        }
        
        loopCount++
        console.log(`[PROCESSING] Loop ${loopCount} complete, checking for next tool call...`)
      }
      
      if (loopCount >= MAX_LOOPS) {
        console.warn('[PROCESSING] Reached max tool execution loops')
      }
      
      console.log('[STOPBTN] ========== EXITING TOOL LOOP after', loopCount, 'iterations ==========')
      
      // Wait for TTS to finish speaking before completing
      console.log('[TTS] Waiting for final TTS to complete...')
      await waitForTTS()
      
      // Clear the tool loop flag - workflow is complete
      dispatch({ type: 'SET_IN_TOOL_LOOP', payload: false })
      console.log('[STOPBTN] isInToolLoop=false, isProcessing=true (workflow complete, about to finish)')
      
    } catch (error: any) {
      // Clear tool loop flag on error too
      console.log('[STOPBTN] ========== EXCEPTION IN TOOL LOOP ==========')
      console.log('[STOPBTN] Error:', error.name, error.message)
      dispatch({ type: 'SET_IN_TOOL_LOOP', payload: false })
      dispatch({ type: 'SET_WAITING', payload: false })
      const currentContextCount = getTokenUsage().usage
      
      if (error.name === 'AbortError') {
        const interruptMessage = createAssistantMessage('[INTERRUPTED]', currentContextCount)
        dispatch({ type: 'ADD_MESSAGE', payload: interruptMessage })
      } else {
        const errorMessage = createAssistantMessage(`ERROR: ${error.message}`, currentContextCount)
        dispatch({ type: 'ADD_MESSAGE', payload: errorMessage })
        
        // Show alert for AI model errors using proper type checking
        if (globalAlertHandler && isAIModelError(error)) {
          globalAlertHandler('error', 'AI Model Not Available',
            'Enable Gemini Nano in Chrome flags and relaunch browser.',
            {
              label: 'Open Flags',
              onClick: openAIFlagsPage
            })
        }
        
        // Show alert for Writer API errors
        if (globalAlertHandler && isWriterAPIError(error)) {
          globalAlertHandler('error', 'Writer API Not Available',
            'Enable the Writer API in Chrome flags and relaunch browser.',
            {
              label: 'Open Flags',
              onClick: openWriterAPIFlagsPage
            })
        }
      }
      console.log('[STOPBTN] ========== ERROR PATH - SETTING TO FALSE ==========')
      console.log('[STOPBTN] Error:', error)
      dispatch({ type: 'SET_PROCESSING', payload: false })
      return
    }
    
    console.log('[STOPBTN] ========== COMPLETION PATH - SETTING TO FALSE ==========')
    console.log('[STOPBTN] Workflow complete, now safe to set isProcessing=false')
    dispatch({ type: 'SET_PROCESSING', payload: false })
  }

  const resetChat = () => {
    interruptAI()
    destroyAISession()
    dispatch({ type: 'RESET' })
    // Clear storage
    chrome.storage.local.remove(['chat_messages', 'chat_reference'])
  }

  const interruptChat = () => {
    console.log('[STOPBTN] ========== INTERRUPT CALLED ==========')
    console.log('[STOPBTN] User clicked STOP button')
    interruptAI()
    dispatch({ type: 'SET_PROCESSING', payload: false })
    dispatch({ type: 'SET_WAITING', payload: false })
    dispatch({ type: 'SET_IN_TOOL_LOOP', payload: false })
    dispatch({ type: 'SET_SUMMARIZING', payload: false })
  }

  const copyContext = async (): Promise<string> => {
    const systemPrompt = getFilledSystemPrompt()
    
    let contextText = ''
    
    // Include system prompt if available
    if (systemPrompt) {
      contextText += '=== SYSTEM PROMPT ===\n\n'
      contextText += systemPrompt
      contextText += '\n\n=== CONVERSATION ===\n\n'
    }
    
    // Add messages with truncated media
    contextText += state.messages.map(msg => {
      let content = msg.content
      
      // Truncate base64 images
      if (content.includes('data:image/')) {
        content = content.replace(
          /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
          (match) => {
            const preview = match.substring(0, 50)
            return `${preview}... [IMAGE_TRUNCATED_${match.length}_CHARS]`
          }
        )
      }
      
      // Truncate base64 audio
      if (content.includes('data:audio/')) {
        content = content.replace(
          /data:audio\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
          (match) => {
            const preview = match.substring(0, 50)
            return `${preview}... [AUDIO_TRUNCATED_${match.length}_CHARS]`
          }
        )
      }
      
      return `${msg.role.toUpperCase()}: ${content}`
    }).join('\n\n')
    
    return contextText
  }

  const rateMessage = async (messageId: string, rating: 'up' | 'down') => {
    // Update message rating in state
    dispatch({ type: 'UPDATE_MESSAGE_RATING', payload: { id: messageId, rating } })
    
    // Store rating with full chat context in database
    try {
      const systemPrompt = getFilledSystemPrompt()
      
      let chatContext = ''
      
      // Include system prompt if available
      if (systemPrompt) {
        chatContext += '=== SYSTEM PROMPT ===\n\n'
        chatContext += systemPrompt
        chatContext += '\n\n=== CONVERSATION ===\n\n'
      }
      
      // Add messages with truncated media
      chatContext += state.messages.map(msg => {
        let content = msg.content
        
        // Truncate base64 images
        if (content.includes('data:image/')) {
          content = content.replace(
            /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
            (match) => {
              const preview = match.substring(0, 50)
              return `${preview}... [IMAGE_TRUNCATED_${match.length}_CHARS]`
            }
          )
        }
        
        // Truncate base64 audio
        if (content.includes('data:audio/')) {
          content = content.replace(
            /data:audio\/[^;]+;base64,[A-Za-z0-9+/=]+/g,
            (match) => {
              const preview = match.substring(0, 50)
              return `${preview}... [AUDIO_TRUNCATED_${match.length}_CHARS]`
            }
          )
        }
        
        return `${msg.role.toUpperCase()}: ${content}`
      }).join('\n\n')
      
      // Store in database
      await storeRating({
        messageId,
        rating,
        chatContext,
        systemPrompt
      })
      
      console.log('[Rating] Saved rating with chat context:', { messageId, rating })
    } catch (error) {
      console.error('[Rating] Error storing rating:', error)
      // Don't fail the UI if database storage fails
    }
  }

  return (
    <ChatContext.Provider value={{ state, dispatch, sendMessage, resetChat, interruptChat, copyContext, rateMessage, isInitialLoadComplete }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider')
  }
  return context
}
