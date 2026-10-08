import type { ToolSpec } from '../tool-registry'

async function clickElement(params: { index: number }) {
  try {
    if (params.index === undefined || params.index === null) {
      return { success: false, error: 'Element index is required' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (index: number) => {
        const element = document.querySelector(`[data-marionette-${index}]`) as HTMLElement
        
        if (!element) {
          return { success: false, error: `Element with index ${index} not found. Call findElements or getAccessibilitySnapshot first to get current element indices.` }
        }
        
        // Check if element is disabled
        if (element.hasAttribute('disabled')) {
          return { success: false, error: 'Element is disabled' }
        }
        
        // Scroll into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        
        // Click the element
        element.click()
        
        // Get element info for confirmation
        const role = element.getAttribute('role') || element.tagName.toLowerCase()
        const name = element.getAttribute('aria-label') || element.textContent?.trim() || 'unnamed element'
        
        return { 
          success: true, 
          message: `Clicked ${role}: "${name.substring(0, 50)}"` 
        }
      },
      args: [params.index]
    })

    const response = result[0]?.result
    
    if (response?.success === false) {
      return { success: false, error: response.error }
    }
    
    return { 
      success: true, 
      result: response?.message || `Clicked element ${params.index}`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'clickElement',
  description: 'Clicks an interactive element on the page by its index. Must call findElements or getAccessibilitySnapshot first to get element indices.',
  parameters: [
    {
      name: 'index',
      type: 'number',
      description: 'The index of the element to click (from findElements or getAccessibilitySnapshot)',
      required: true
    }
  ],
  spokenLine: "Clicking",
  examples: [
    'User: "click the submit button" → findElements "submit button" returns [5] BUTTON, then clickElement with index: 5',
    'User: "click login" → findElements "login" shows [2] LINK, then clickElement with index: 2',
    'findElements shows "[11] LINK: Model Architecture" → Use index: 11 (the number in brackets)'
  ]
}

export default clickElement
