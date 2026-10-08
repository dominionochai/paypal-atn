// writeContent tool - Uses Writer API to generate written content
import type { PlasmoMessaging } from "@plasmohq/messaging"
import type { ToolSpec } from '../tool-registry'

// This handler runs in background, but actual implementation is in ui-tools.ts
// because Writer API requires UI context with user gesture
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  try {
    console.log("writeContent handler called (should be delegated to UI context)")
    
    // This should not be called directly - the tool should be executed via executeUITool
    // in the UI context where Writer API is available
    res.send({ 
      error: 'writeContent must be executed in UI context with user gesture' 
    })
  } catch (error: any) {
    console.error("Error in writeContent handler:", error)
    res.send({ error: error.message })
  }
}

export const spec: ToolSpec = {
  name: 'writeContent',
  description: 'Uses the Writer API to create new written content based on a writing task. Use this to help draft emails, blog posts, reviews, or any written content for the user.',
  parameters: [
    {
      name: 'task',
      type: 'string',
      description: 'The writing task or prompt describing what content to create (e.g., "An email to my bank about wire transfers", "A blog post about AI")',
      required: true
    },
    {
      name: 'context',
      type: 'string',
      description: 'Optional additional context to help the model generate better content (e.g., "I\'m a longtime customer", "This is for a technical audience")',
      required: false
    },
    {
      name: 'tone',
      type: 'string',
      description: 'Writing tone: "formal", "neutral", or "casual" (default: "neutral")',
      required: false
    },
    {
      name: 'length',
      type: 'string',
      description: 'Output length: "short", "medium", or "long" (default: "medium")',
      required: false
    },
    {
      name: 'format',
      type: 'string',
      description: 'Output format: "markdown" or "plain-text" (default: "plain-text")',
      required: false
    }
  ],
  examples: [
    'User: "draft an email to my boss requesting time off" → writeContent',
    'User: "write a blog post introduction about AI" → writeContent',
    'User: "help me write a product review" → writeContent',
    'User: "compose a professional response to this inquiry" → writeContent'
  ],
  spokenLine: 'Writing content',
  requiresUserGesture: true  // Requires UI context for Writer API access
}

export default handler
