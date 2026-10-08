import type { ToolSpec } from '../tool-registry'

async function openTab(params: { url: string }, context?: string) {
  try {
    // Refuse to open tabs from popup context as it would close the popup
    if (context === 'popup') {
      return { 
        success: false, 
        error: 'STOP: Cannot open tabs from popup window. Please ask the user to open Marionette in the side panel by clicking the maximize icon in the top right. Do NOT continue with the task or try other tools - just tell the user this and wait.' 
      }
    }
    
    if (!params.url) {
      return { success: false, error: 'URL is required' }
    }

    const tab = await chrome.tabs.create({ url: params.url })
    
    return { 
      success: true, 
      result: `Opened ${params.url} in new tab (ID: ${tab.id})` 
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'openTab',
  description: 'Opens a URL in a new browser tab. USE THIS to open links/videos, NOT clickElement. Extract the href from findElements result.',
  parameters: [
    {
      name: 'url',
      type: 'string',
      description: 'The full URL to open (must include http:// or https://)',
      required: true
    }
  ],
  spokenLine: "Opening {url}",
  examples: [
    'User: "open google" → openTab with url: "https://www.google.com"',
    'User: "click first video" → findElements "video" shows [118] LINK with (https://youtube.com/...), then openTab with that URL',
    'After findElements shows a link with href → openTab with url: "https://..."',
    'User: "go to that page" → openTab with the href from findElements result'
  ]
}

export default openTab
