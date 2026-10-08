import type { ToolSpec } from '../tool-registry'

type FillResult = {
  success: boolean
  error?: string
  message?: string
}

async function fillInput(params: { index: number, value: string }) {
  try {
    if (params.index === undefined || params.index === null) {
      return { success: false, error: 'Element index is required' }
    }
    
    if (!params.value && params.value !== '') {
      return { success: false, error: 'Value is required' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // ALL fillInput goes through content script
    const contentResponse = await new Promise<{ success: boolean; result?: string; error?: string }>((resolve) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'fill_input',
        selector: `[data-marionette-${params.index}]`,
        value: params.value
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
        } else {
          resolve(response || { success: false, error: "No response from content script" })
        }
      })
    })
    
    if (!contentResponse.success) {
      return { success: false, error: contentResponse.error || 'Content script failed' }
    }
    
    const response = { success: true, message: contentResponse.result } as FillResult
    
    if (response?.success === false) {
      return { success: false, error: response.error || 'Unknown error' }
    }
    
    return { 
      success: true, 
      result: response?.message || `Filled element ${params.index}`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'fillInput',
  description: 'Fills a text input or textarea on the page with a value. Must call findElements or getAccessibilitySnapshot first to get element indices.',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The index of the input element (from findElements or getAccessibilitySnapshot)',
      required: true
    },
    {
      name: 'value',
      type: 'string',
      description: 'The text value to fill into the input',
      required: true
    }
  ],
  spokenLine: "Entering {value}",
  examples: [
    'User: "search for AI podcasts" → findElements "search box" returns [3] COMBOBOX, then fillInput with index: 3, value: "AI podcasts"',
    'User: "type my email" → findElements "email" returns [7] TEXTBOX, then fillInput with index: 7, value: stored email',
    'findElements shows "[42] TEXTBOX: Search" → Use index: 42 (the number in brackets)'
  ]
}

export default fillInput
