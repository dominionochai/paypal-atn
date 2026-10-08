import { useCallback } from 'react'
import { useChatContext } from './chat-context'
import { useAlert, openPermissionsPage, openAIFlagsPage } from './alert-context'
import { useSpeechRecognition } from './use-speech-recognition'
import { 
  isAIModelError, 
  isMicrophoneError, 
  isSpeechRecognitionError 
} from './errors'

interface UseVoiceInputReturn {
  isListening: boolean
  transcript: string
  handleMicClick: () => void
}

export const useVoiceInput = (): UseVoiceInputReturn => {
  const { sendMessage } = useChatContext()
  const { showAlert } = useAlert()
  const { isListening, transcript, startListening, stopListening } = useSpeechRecognition()

  const handleMicClick = useCallback(async () => {
    try {
      if (isListening) {
        const finalTranscript = await stopListening()
        
        if (finalTranscript.trim()) {
          await sendMessage(finalTranscript)
        }
      } else {
        // Pass callback to handle auto-end (when recognition stops due to silence)
        startListening(async (autoTranscript: string) => {
          if (autoTranscript.trim()) {
            await sendMessage(autoTranscript)
          }
        })
      }
    } catch (error: any) {
      console.error('Voice input error:', error)
      
      if (isMicrophoneError(error)) {
        showAlert('error', 'Microphone Permission Denied',
          'Microphone access is required for voice input.',
          {
            label: 'Open Permissions',
            onClick: openPermissionsPage
          })
      } else if (isSpeechRecognitionError(error)) {
        showAlert('error', 'Speech Recognition Not Available', 
          'Your browser does not support speech recognition.')
      } else if (isAIModelError(error)) {
        showAlert('error', 'AI Model Not Available',
          'Enable Gemini Nano in Chrome flags and relaunch browser.',
          {
            label: 'Open Flags',
            onClick: openAIFlagsPage
          })
      } else {
        showAlert('error', 'Error', error.message || 'An unexpected error occurred')
      }
    }
  }, [isListening, startListening, stopListening, sendMessage, showAlert])

  return {
    isListening,
    transcript,
    handleMicClick
  }
}

