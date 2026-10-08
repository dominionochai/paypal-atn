// Conversation summarization using Chrome's built-in Summarizer API
import type { Message } from './messages'
import { 
  SUMMARIZER_SHARED_CONTEXT, 
  SUMMARIZER_CONTEXT_PROMPT, 
  formatSummaryMessage 
} from './prompts/summarizer-prompts'

// Re-export for convenience
export { formatSummaryMessage }

export const MAX_CONTEXT_SIZE = 9216
const SUMMARIZATION_THRESHOLD = 0.8 // 80%

export function shouldSummarize(currentTokens: number): boolean {
  return currentTokens >= MAX_CONTEXT_SIZE * SUMMARIZATION_THRESHOLD
}

export async function summarizeConversation(messages: Message[]): Promise<string> {
  // Check if Summarizer API is available
  if (!('Summarizer' in self)) {
    throw new Error('Summarizer API not available')
  }

  try {
    const availability = await (self as any).Summarizer.availability()
    
    if (availability === 'unavailable') {
      throw new Error('Summarizer model unavailable')
    }

    // Create summarizer with appropriate options
    const summarizer = await (self as any).Summarizer.create({
      sharedContext: SUMMARIZER_SHARED_CONTEXT,
      type: 'key-points',
      format: 'plain-text',
      length: 'medium',
      monitor(m: any) {
        m.addEventListener('downloadprogress', (e: any) => {
          console.log(`Summarizer model download: ${Math.round(e.loaded * 100)}%`)
        })
      }
    })

    // Format conversation for summarization
    const conversationText = messages
      .map(msg => {
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
      })
      .join('\n\n')

    // Get summary with enhanced context preservation
    const summary = await summarizer.summarize(conversationText, {
      context: SUMMARIZER_CONTEXT_PROMPT
    })

    // Clean up
    summarizer.destroy?.()

    return summary
  } catch (error: any) {
    console.error('Summarization failed:', error)
    throw new Error(`Failed to summarize: ${error.message}`)
  }
}
