// highlightSelector tool - Highlight an element by CSS selector
import type { ToolSpec } from '../tool-registry'

async function highlightSelector(params: any) {
  try {
    const { selector } = params
    
    if (!selector) {
      return { success: false, error: 'Selector parameter is required' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // Execute highlight in content script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (sel: string) => {
        const element = document.querySelector(sel)
        if (!element) {
          return { success: false, error: `No element found with selector: ${sel}` }
        }

        // Store original background
        const originalBackground = (element as HTMLElement).style.backgroundColor as string
        
        // Highlight in yellow
        (element as HTMLElement).style.backgroundColor = 'yellow' as string
        (element as HTMLElement).style.transition = 'background-color 0.3s ease'
        
        // Scroll element into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        
        // Remove highlight after 2 seconds
        setTimeout(() => {
          (element as HTMLElement).style.backgroundColor = originalBackground
        }, 2000)
        
        return { success: true, message: `Highlighted element: ${sel}` }
      },
      args: [selector]
    })

    if (results && results[0]?.result) {
      return results[0].result
    }

    return { success: false, error: 'Failed to execute highlight' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'highlightSelector',
  description: 'Highlights an element on the page by CSS selector. The element is highlighted in yellow for 2 seconds and scrolled into view.',
  parameters: [
    {
      name: 'selector',
      type: 'string',
      description: 'CSS selector for the element to highlight (e.g., "#header", ".nav-item", "button.submit")',
      required: true
    }
  ],
  examples: [
    'User: "highlight the submit button" → highlightSelector with selector: "button[type=\'submit\']"',
    'User: "show me where the login link is" → highlightSelector with selector: "a[href*=\'login\']"',
    'After finding an element → highlightSelector to show its location'
  ],
  spokenLine: 'Highlighting {selector}'
}

export default highlightSelector
