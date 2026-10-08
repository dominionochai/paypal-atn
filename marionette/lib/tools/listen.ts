import type { PlasmoMessaging } from "@plasmohq/messaging"
import type { ToolSpec } from '../tool-registry'

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  try {
    console.log("listen handler called with params:", req.body)
    
    const { seconds } = req.body
    // Force max duration to 10 seconds regardless of input
    let duration = parseInt(seconds) || 5
    if (duration > 10) duration = 10
    if (duration <= 0) duration = 5

    if (duration <= 0 || duration > 10) {
      throw new Error("Duration must be between 1 and 10 seconds")
    }
    
    const [tab] = await chrome.tabs.query({ active: true })
    if (!tab?.id) {
      throw new Error("No active tab found")
    }
    
    console.log(`Attempting to capture audio from tab: ${tab.url}`)
    
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
      throw new Error(`Cannot capture audio from restricted page: ${tab.url}`)
    }
    
    if (!chrome.tabCapture || typeof chrome.tabCapture.getMediaStreamId !== 'function') {
      const errMsg = "tabCapture API not available"
      console.error(errMsg)
      res.send({ error: errMsg })
      return
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { return document.title }
      })
    } catch (permissionError) {
      throw new Error(`Please click the Marionette extension icon, then try again`)
    }

    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ consumerTabId: tab.id }, (streamId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (streamId) {
          resolve(streamId)
        } else {
          reject(new Error("Failed to get media stream ID"))
        }
      })
    })

    const audioResult = await new Promise<{ result?: string; error?: string }>((resolve) => {
      chrome.tabs.sendMessage(tab.id!, {
        type: 'capture_tab_audio',
        streamId: streamId,
        duration: duration
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message })
        } else {
          resolve(response || { error: "No response from content script" })
        }
      })
    })

    if (audioResult.error) {
      throw new Error(audioResult.error)
    }

    console.log(`Audio recording completed via content script`)
    
    res.send({ 
      result: audioResult.result,
      duration: duration,
      size: audioResult.result ? Math.round(audioResult.result.length * 0.75) : 0
    })
  } catch (error) {
    console.error("Error capturing audio:", error)
    res.send({ error: error.message })
  }
}

export const spec: ToolSpec = {
  name: 'listen',
  description: 'REQUIRED for audio questions: Captures and transcribes audio from the current browser tab. You cannot hear audio without this - use it whenever user asks about what\'s playing or audible. Max 10 seconds.',
  parameters: [
    {
      name: 'seconds',
      type: 'number',
      description: 'Duration to record in seconds (1-10, default: 5, maximum: 10)',
      required: false
    }
  ],
  spokenLine: "Listening to the audio",
  examples: [
    'User: "what do you hear?" → listen (REQUIRED to hear audio)',
    'User: "what\'s playing?" → listen (REQUIRED to capture audio)',
    'User: "listen to this" → listen with seconds: 5',
    'User: "what\'s the audio saying?" → listen',
    'User: "record the audio for 10 seconds" → listen with seconds: 10',
    'User: "record for 30 seconds" → listen with seconds: 10 (maximum allowed is 10)',
    'User: "capture the sound" → listen (uses default 5 seconds)'
  ]
}

export default handler
