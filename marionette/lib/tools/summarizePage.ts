// summarizePage tool - Uses Summarizer API to summarize the current page
import type { PlasmoMessaging } from "@plasmohq/messaging"
import type { ToolSpec } from '../tool-registry'

// This handler runs in background, but actual implementation is in ui-tools.ts
// because Summarizer API requires UI context with user gesture
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  try {
    console.log("summarizePage handler called (should be delegated to UI context)")
    
    // This should not be called directly - the tool should be executed via executeUITool
    // in the UI context where Summarizer API is available
    res.send({ 
      error: 'summarizePage must be executed in UI context with user gesture' 
    })
  } catch (error: any) {
    console.error("Error in summarizePage handler:", error)
    res.send({ error: error.message })
  }
}

export const spec: ToolSpec = {
  name: 'summarizePage',
  description: 'ONLY use when user EXPLICITLY asks for a summary. DO NOT call automatically after navigation, clicking, or opening pages. Summarizes the content of the current web page using Chrome\'s built-in Summarizer API.',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: 'Summary type: "key-points" for bullet points, "tl;dr" for brief summary, "teaser" for headline-style, or "headline" for title (default: "key-points")',
      required: false
    },
    {
      name: 'length',
      type: 'string',
      description: 'Summary length: "short", "medium", or "long" (default: "medium")',
      required: false
    }
  ],
  examples: [
    'User: "summarize this page" → summarizePage',
    'User: "give me the key points" → summarizePage',
    'User: "tl;dr" → summarizePage with type="tl;dr"',
    'User: "find the login button" → findElements (NOT summarizePage)',
    'User: "open that link" → openTab (NOT summarizePage)',
    'User: "click submit" → clickElement (NOT summarizePage)'
  ],
  spokenLine: 'Summarizing page',
  requiresUserGesture: true  // Requires UI context for Summarizer API access
}

export default handler
