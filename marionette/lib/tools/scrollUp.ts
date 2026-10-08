// scrollUp tool - Scroll the current page up
import type { ToolSpec } from '../tool-registry'

async function scrollUp(params: any) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    // Execute scroll in content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const SCROLL_DELTA = 500
        window.scrollBy({
          top: -SCROLL_DELTA,
          behavior: 'smooth'
        })
      }
    })

    return {
      success: true,
      result: 'Scrolled up'
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'scrollUp',
  description: 'Scrolls the current page up by a fixed amount. Note: Does NOT work on video feed sites like TikTok, Instagram Reels, or YouTube Shorts - use pressKey with "ArrowUp" instead for those.',
  parameters: [],
  examples: [
    'User: "scroll up" → scrollUp',
    'User: "go back up" → scrollUp',
    'User: "move up on the page" → scrollUp',
    'User on Instagram Reels: "go back" → Use pressKey with key: "ArrowUp" instead'
  ],
  spokenLine: 'Scrolling up'
}

export default scrollUp
