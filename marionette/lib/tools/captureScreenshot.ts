import type { ToolSpec } from '../tool-registry'

async function captureScreenshot(params: any) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // Capture screenshot first
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    
    // Show flash effect after capturing (so it's not in the screenshot)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const flash = document.createElement('div')
          flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: white;
            z-index: 2147483647;
            pointer-events: none;
            animation: flash-effect 0.4s ease-out;
          `
          
          // Add keyframe animation
          const style = document.createElement('style')
          style.textContent = `
            @keyframes flash-effect {
              0% { opacity: 0.9; }
              100% { opacity: 0; }
            }
          `
          document.head.appendChild(style)
          document.body.appendChild(flash)
          
          // Remove flash after animation
          setTimeout(() => {
            flash.remove()
            style.remove()
          }, 400)
        }
      })
    } catch (flashError) {
      // Continue even if flash fails (e.g., on restricted pages)
      console.warn('Flash effect failed:', flashError)
    }
    
    return { 
      success: true, 
      result: dataUrl,
      isImage: true
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'captureScreenshot',
  description: 'REQUIRED for visual questions: Takes a screenshot to see the actual page content, layout, images, and text. You only know title/URL without this - use it whenever user asks about what\'s visible.',
  parameters: [],
  spokenLine: "Let me see what you're looking at",
  examples: [
    'User: "what do you see?" → captureScreenshot (REQUIRED to see visual content)',
    'User: "describe this page" → captureScreenshot (REQUIRED to see actual content)',
    'User: "what am i looking at?" → captureScreenshot',
    'User: "what\'s on the page?" → captureScreenshot',
    'User: "show me the page" → captureScreenshot',
    'User: "is there a login button?" → captureScreenshot'
  ]
}

export default captureScreenshot
