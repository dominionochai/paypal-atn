import type { ToolSpec } from '../tool-registry'

async function getPageTitle(params: any) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.title
    })

    return { 
      success: true, 
      result: result[0]?.result || 'No title found' 
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'getPageTitle',
  description: 'Gets the title of the current active browser tab',
  parameters: [],
  spokenLine: "Let me check the page title",
  examples: [
    'User: "what\'s the page title" → getPageTitle',
    'User: "what page is this" → getPageTitle'
  ]
}

export default getPageTitle
