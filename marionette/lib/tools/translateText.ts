// translateText tool - Uses Translator API to translate text
import type { PlasmoMessaging } from "@plasmohq/messaging"
import type { ToolSpec } from '../tool-registry'

// This handler runs in background, but actual implementation is in ui-tools.ts
// because Translator API requires UI context with user gesture
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  try {
    console.log("translateText handler called (should be delegated to UI context)")
    
    // This should not be called directly - the tool should be executed via executeUITool
    // in the UI context where Translator API is available
    res.send({ 
      error: 'translateText must be executed in UI context with user gesture' 
    })
  } catch (error: any) {
    console.error("Error in translateText handler:", error)
    res.send({ error: error.message })
  }
}

export const spec: ToolSpec = {
  name: 'translateText',
  description: 'Uses the Translator API to translate text from one language to another. Works entirely on-device for privacy.',
  parameters: [
    {
      name: 'text',
      type: 'string',
      description: 'The text to translate',
      required: true
    },
    {
      name: 'sourceLanguage',
      type: 'string',
      description: 'Source language BCP 47 code (e.g., "en", "es", "fr"). Use "auto" or call detectLanguage first if unknown.',
      required: true
    },
    {
      name: 'targetLanguage',
      type: 'string',
      description: 'Target language BCP 47 code (e.g., "en", "es", "fr", "ja", "de")',
      required: true
    }
  ],
  examples: [
    'User: "translate this to Spanish" → translateText with sourceLanguage: "en", targetLanguage: "es"',
    'User: "what does \'Bonjour\' mean in English?" → translateText with text: "Bonjour", sourceLanguage: "fr", targetLanguage: "en"',
    'After detecting language → translateText with detected language as sourceLanguage'
  ],
  spokenLine: 'Translating to {targetLanguage}',
  requiresUserGesture: true  // Requires UI context for Translator API access
}

export default handler
