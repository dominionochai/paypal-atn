// storeMemory tool - Store information for later recall
import type { ToolSpec } from '../tool-registry'
import { generateEmbedding } from '../embeddings'

async function storeMemory(params: any) {
  try {
    const { content, tags } = params
    
    if (!content || typeof content !== 'string') {
      return { success: false, error: 'Content is required and must be a string' }
    }

    // Get existing memories
    const storage = await chrome.storage.local.get(['agent_memories'])
    const memories = storage.agent_memories || []

    // Generate embedding for semantic search
    let embedding: number[] | undefined
    try {
      console.log('[storeMemory] Generating embedding...')
      embedding = await generateEmbedding(content)
      console.log('[storeMemory] Embedding generated:', embedding.length, 'dimensions')
    } catch (embError) {
      console.warn('[storeMemory] Failed to generate embedding:', embError)
      // Continue without embedding - fallback to keyword search
    }

    // Create new memory entry
    const memory = {
      id: Date.now().toString(),
      content: content,
      tags: tags ? (Array.isArray(tags) ? tags : [tags]) : [],
      embedding: embedding, // Store embedding for semantic search
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    }

    // Add to memories array
    memories.push(memory)

    // Store back
    await chrome.storage.local.set({ agent_memories: memories })

    return {
      success: true,
      result: `Memory stored successfully (ID: ${memory.id}). Total memories: ${memories.length}${embedding ? ' [with embedding]' : ' [keyword only]'}`,
      memoryId: memory.id,
      hasEmbedding: !!embedding
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'storeMemory',
  description: 'Store information in persistent memory for later recall. Use this to remember important facts, preferences, or context about the user.',
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: 'The information to store (e.g., "User prefers formal tone in emails", "User\'s favorite color is blue")',
      required: true
    },
    {
      name: 'tags',
      type: 'string | string[]',
      description: 'Optional tags to categorize the memory (e.g., ["preferences", "email"], "user-info")',
      required: false
    }
  ],
  examples: [
    'User: "Remember that I prefer formal emails" → storeMemory with content: "User prefers formal tone in emails", tags: ["preferences", "email"]',
    'User: "My favorite color is blue" → storeMemory with content: "User\'s favorite color is blue", tags: "preferences"',
    'After helping user with a task → storeMemory with content: "Helped user draft presentation on 2025-01-10"'
  ],
  spokenLine: 'Storing that in memory'
}

export default storeMemory
