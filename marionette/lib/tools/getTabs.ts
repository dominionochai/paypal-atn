import type { ToolSpec } from '../tool-registry'

async function getTabs(params: any, context?: string) {
  try {
    // Get all tabs in the current window
    const tabs = await chrome.tabs.query({ currentWindow: true })
    
    // Format tabs for display
    const formattedTabs = tabs.map((tab, index) => ({
      index,
      id: tab.id,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      active: tab.active
    }))
    
    return {
      success: true,
      result: `Found ${tabs.length} tabs:\n\n${formattedTabs.map(t => 
        `[${t.index}] ${t.active ? '● ' : ''}${t.title}\n    ${t.url}`
      ).join('\n\n')}`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'getTabs',
  description: 'List all open tabs in the current window with their titles and URLs',
  parameters: [],
  examples: [
    'User: "what tabs are open?" → getTabs',
    'User: "list my tabs" → getTabs',
    'User: "show me all tabs" → getTabs',
    'Before switching tabs → getTabs to see available tabs and their indices'
  ],
  spokenLine: 'Checking open tabs'
}

export default getTabs

