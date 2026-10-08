// getMemories tool - Retrieve all stored memories
import type { ToolSpec } from '../tool-registry'

async function getMemories(params: any) {
  try {
    const { limit } = params
    
    // Get stored memories
    const storage = await chrome.storage.local.get(['agent_memories'])
    const memories = storage.agent_memories || []

    if (memories.length === 0) {
      return {
        success: true,
        result: 'No memories stored yet.',
        memories: []
      }
    }

    // Sort by timestamp (most recent first)
    const sortedMemories = memories.sort((a: any, b: any) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    // Apply limit if specified
    const limitedMemories = limit && limit > 0 
      ? sortedMemories.slice(0, limit)
      : sortedMemories

    // Format memories for display
    const formattedMemories = limitedMemories.map((m: any, index: number) => 
      `[${index + 1}] ${m.date}${m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : ''}\n   ${m.content}`
    ).join('\n\n')

    return {
      success: true,
      result: `Found ${memories.length} memories${limit ? ` (showing ${limitedMemories.length})` : ''}:\n\n${formattedMemories}`,
      memories: limitedMemories,
      totalCount: memories.length
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'getMemories',
  description: 'Retrieve all stored memories. Returns memories sorted by most recent first.',
  parameters: [
    {
      name: 'limit',
      type: 'number',
      description: 'Optional limit on number of memories to return (default: all)',
      required: false
    }
  ],
  examples: [
    'User: "What do you remember about me?" → getMemories',
    'User: "Show me your recent memories" → getMemories with limit: 5',
    'Before responding to user → getMemories to check stored context'
  ],
  spokenLine: 'Let me check what I remember'
}

export default getMemories
