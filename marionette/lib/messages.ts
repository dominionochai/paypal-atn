// Message domain objects
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  contextCount?: number
  rating?: 'up' | 'down' | null
  visualOnly?: boolean // If true, message is displayed in UI but not sent to AI
}

export function createUserMessage(content: string): Message {
  return {
    id: Date.now() + '_user',
    role: 'user',
    content,
    timestamp: Date.now()
  }
}

export function createAssistantMessage(content: string, contextCount?: number): Message {
  return {
    id: Date.now() + '_assistant',
    role: 'assistant',
    content: content.trim(),
    timestamp: Date.now(),
    contextCount
  }
}
