// Custom error classes for proper error handling

export class AIModelUnavailableError extends Error {
  constructor(message = 'AI model is not available') {
    super(message)
    this.name = 'AIModelUnavailableError'
  }
}

export class MicrophonePermissionError extends Error {
  constructor(message = 'Microphone permission denied') {
    super(message)
    this.name = 'MicrophonePermissionError'
  }
}

export class SpeechRecognitionUnavailableError extends Error {
  constructor(message = 'Speech recognition is not supported') {
    super(message)
    this.name = 'SpeechRecognitionUnavailableError'
  }
}

export class WriterAPIUnavailableError extends Error {
  constructor(message = 'Writer API is not available') {
    super(message)
    this.name = 'WriterAPIUnavailableError'
  }
}

export function isAIModelError(error: any): error is AIModelUnavailableError {
  return error instanceof AIModelUnavailableError || error?.name === 'AIModelUnavailableError'
}

export function isMicrophoneError(error: any): error is MicrophonePermissionError {
  return error instanceof MicrophonePermissionError || error?.name === 'MicrophonePermissionError'
}

export function isSpeechRecognitionError(error: any): error is SpeechRecognitionUnavailableError {
  return error instanceof SpeechRecognitionUnavailableError || error?.name === 'SpeechRecognitionUnavailableError'
}

export function isWriterAPIError(error: any): error is WriterAPIUnavailableError {
  return error instanceof WriterAPIUnavailableError || 
         error?.name === 'WriterAPIUnavailableError' ||
         error?.message === 'WRITER_API_UNAVAILABLE'
}

