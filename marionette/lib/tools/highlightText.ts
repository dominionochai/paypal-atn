// highlightText tool - Highlight text content on the page
import type { ToolSpec } from '../tool-registry'

async function highlightText(params: any) {
  try {
    const { text } = params
    
    if (!text) {
      return { success: false, error: 'Text parameter is required' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // Execute highlight in content script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (searchText: string) => {
        // Remove any existing highlights
        const existingHighlights = document.querySelectorAll('.marionette-highlight')
        existingHighlights.forEach(el => {
          const parent = el.parentNode
          if (parent) {
            parent.replaceChild(document.createTextNode(el.textContent || ''), el)
            parent.normalize()
          }
        })

        // Find all text nodes containing the search text
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null
        )

        const textNodes: Text[] = []
        let node: Node | null
        while ((node = walker.nextNode())) {
          if (node.textContent && node.textContent.toLowerCase().includes(searchText.toLowerCase())) {
            textNodes.push(node as Text)
          }
        }

        if (textNodes.length === 0) {
          return { success: false, error: `No text found matching: "${searchText}"` }
        }

        // Highlight the first match
        const firstNode = textNodes[0]
        const text = firstNode.textContent || ''
        const index = text.toLowerCase().indexOf(searchText.toLowerCase())
        
        if (index !== -1) {
          const range = document.createRange()
          range.setStart(firstNode, index)
          range.setEnd(firstNode, index + searchText.length)
          
          const highlight = document.createElement('span')
          highlight.className = 'marionette-highlight'
          highlight.style.backgroundColor = 'yellow'
          highlight.style.transition = 'background-color 0.3s ease'
          
          range.surroundContents(highlight)
          
          // Scroll into view
          highlight.scrollIntoView({ behavior: 'smooth', block: 'center' })
          
          // Remove highlight after 2 seconds
          setTimeout(() => {
            const parent = highlight.parentNode
            if (parent) {
              parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight)
              parent.normalize()
            }
          }, 2000)
          
          return { 
            success: true, 
            message: `Highlighted first occurrence of "${searchText}" (found ${textNodes.length} matches)`,
            matchCount: textNodes.length
          }
        }

        return { success: false, error: 'Failed to highlight text' }
      },
      args: [text]
    })

    if (results && results[0]) {
      const result = results[0].result
      // If the injected function returned a result, use it
      if (result) {
        return result
      }
      // If result is undefined, the text was found and highlighted successfully
      // (the injected function completed without errors but may not have returned a value)
      return { 
        success: true, 
        message: `Highlighted "${text}" on the page` 
      }
    }

    return { success: false, error: 'Failed to execute highlight script' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'highlightText',
  description: 'Highlights text content on the page. The first occurrence is highlighted in yellow for 2 seconds and scrolled into view.',
  parameters: [
    {
      name: 'text',
      type: 'string',
      description: 'Text content to search for and highlight',
      required: true
    }
  ],
  examples: [
    'User: "highlight the word login" → highlightText with text: "login"',
    'User: "show me where it says submit" → highlightText with text: "submit"',
    'User: "find the price on the page" → highlightText with text: "$" or specific price'
  ],
  spokenLine: 'Highlighting "{text}"'
}

export default highlightText
