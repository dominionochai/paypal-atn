// pressKey tool - Simulate keyboard key press
import type { ToolSpec } from '../tool-registry'

async function pressKey(params: { key: string }) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const { key } = params

    // Execute key press in content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (keyToPress: string) => {
        // Get key codes
        const getKeyInfo = (key: string) => {
          const keyMap: Record<string, { code: string, keyCode: number, which: number }> = {
            'ArrowDown': { code: 'ArrowDown', keyCode: 40, which: 40 },
            'ArrowUp': { code: 'ArrowUp', keyCode: 38, which: 38 },
            'ArrowLeft': { code: 'ArrowLeft', keyCode: 37, which: 37 },
            'ArrowRight': { code: 'ArrowRight', keyCode: 39, which: 39 },
            'Enter': { code: 'Enter', keyCode: 13, which: 13 },
            'Escape': { code: 'Escape', keyCode: 27, which: 27 },
            ' ': { code: 'Space', keyCode: 32, which: 32 }
          }
          return keyMap[key] || { code: key, keyCode: 0, which: 0 }
        }
        
        const keyInfo = getKeyInfo(keyToPress)
        
        // Create more realistic keyboard events with all necessary properties
        const eventProps = {
          key: keyToPress,
          code: keyInfo.code,
          keyCode: keyInfo.keyCode,
          which: keyInfo.which,
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          detail: 0,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
          repeat: false,
          isComposing: false,
          charCode: 0
        }
        
        // Dispatch to multiple targets for maximum compatibility
        const targets = [document.body, document.documentElement, window, document]
        
        targets.forEach(target => {
          // Keydown
          const keydownEvent = new KeyboardEvent('keydown', eventProps)
          target.dispatchEvent(keydownEvent)
          
          // Keypress (deprecated but some sites still use it)
          const keypressEvent = new KeyboardEvent('keypress', eventProps)
          target.dispatchEvent(keypressEvent)
          
          // Keyup
          const keyupEvent = new KeyboardEvent('keyup', eventProps)
          target.dispatchEvent(keyupEvent)
        })
      },
      args: [key]
    })

    return {
      success: true,
      result: `Pressed key: ${key}`
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'pressKey',
  description: 'Simulates pressing a keyboard key. REQUIRED for video feed sites (TikTok, Instagram Reels, YouTube Shorts) where scrollDown/scrollUp do not work. Also useful for keyboard shortcuts and navigation.',
  parameters: [
    {
      name: 'key',
      type: 'string',
      required: true,
      description: 'The key to press (e.g., "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Escape", " " for space)'
    }
  ],
  examples: [
    'User on TikTok: "next video" → pressKey with key: "ArrowDown"',
    'User on Instagram Reels: "scroll down" → pressKey with key: "ArrowDown"',
    'User on YouTube Shorts: "previous video" → pressKey with key: "ArrowUp"',
    'User: "press escape" → pressKey with key: "Escape"',
    'User: "press space" → pressKey with key: " "'
  ],
  spokenLine: 'Pressing key'
}

export default pressKey
