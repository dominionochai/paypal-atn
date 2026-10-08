// detectLanguage tool - Uses Language Detector API to detect text language
import type { PlasmoMessaging } from "@plasmohq/messaging"
import type { ToolSpec } from '../tool-registry'

// This handler runs in background, but actual implementation is in ui-tools.ts
// because Language Detector API requires UI context with user gesture
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  try {
    console.log("detectLanguage handler called (should be delegated to UI context)")
    
    // This should not be called directly - the tool should be executed via executeUITool
    // in the UI context where Language Detector API is available
    res.send({ 
      error: 'detectLanguage must be executed in UI context with user gesture' 
    })
  } catch (error: any) {
    console.error("Error in detectLanguage handler:", error)
    res.send({ error: error.message })
  }
}

export const spec: ToolSpec = {
  name: 'detectLanguage',
  description: 'Uses the Language Detector API to detect what language a piece of text is written in. Returns language code and confidence level.',
  parameters: [
    {
      name: 'text',
      type: 'string',
      description: 'The text to detect language for (longer text gives better results)',
      required: true
    }
  ],
  examples: [
    'User: "what language is this: Hallo und herzlich willkommen" → detectLanguage',
    'Before translation with unknown source → detectLanguage first',
    'User sends text in unknown language → detectLanguage to identify it'
  ],
  spokenLine: 'Detecting language',
  requiresUserGesture: true  // Requires UI context for Language Detector API access
}

export default handler
