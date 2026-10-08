export {}

import { initCustomTextSelection, triggerScreenshotMode, triggerAudioCapture } from '~components/custom-text-selection'
import { initCaptureOverlayButtons } from '~components/capture-overlay-buttons'
import { loadSettings } from '~lib/settings'

console.log('Marionette content script loaded')

let globalShortcutsEnabled = true

// Load settings and initialize features
loadSettings().then(settings => {
  console.log('[Content] Loaded settings:', settings)
  
  if (settings.textSelectionEnabled) {
    initCustomTextSelection()
  }
  
  if (settings.captureOverlayEnabled) {
    initCaptureOverlayButtons(triggerScreenshotMode, triggerAudioCapture)
  }
  
  globalShortcutsEnabled = settings.globalShortcutsEnabled
})

// Listen for keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!globalShortcutsEnabled) return
  
  // Cmd/Ctrl + Shift + S for screenshot
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
    e.preventDefault()
    e.stopPropagation()
    triggerScreenshotMode()
  }
  
  // Cmd/Ctrl + Shift + A for audio capture
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'a') {
    e.preventDefault()
    e.stopPropagation()
    triggerAudioCapture()
  }
})

// Listen for audio capture requests from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'capture_tab_audio') {
    handleTabAudioCapture(message.streamId, message.duration)
      .then(result => sendResponse({ result }))
      .catch(error => sendResponse({ error: error.message }))
    return true // Indicates async response
  }
  
  if (message.type === 'fill_input') {
    console.log('[CONTENT] Received fill_input message:', message)
    handleFillInput(message.selector, message.value)
      .then(result => {
        console.log('[CONTENT] Fill succeeded:', result)
        sendResponse({ success: true, result })
      })
      .catch(error => {
        console.error('[CONTENT] Fill failed:', error)
        sendResponse({ success: false, error: error.message })
      })
    return true // Indicates async response
  }
  
  if (message.type === 'settings_updated') {
    console.log('[Content] Settings updated, reloading page recommended')
    // User needs to reload page for settings to take effect
    sendResponse({ success: true })
    return true
  }
})

async function handleFillInput(selector: string, value: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector) as HTMLElement
    
    if (!element) {
      reject(new Error(`Element not found with selector ${selector}. Call findElements or getAccessibilitySnapshot first to get current element indices.`))
      return
    }
    
    // Check element type
    const isInput = element instanceof HTMLInputElement
    const isTextarea = element instanceof HTMLTextAreaElement
    const isContentEditable = element.getAttribute('contenteditable') === 'true' || 
                              element.getAttribute('role') === 'textbox'
    
    if (!isInput && !isTextarea && !isContentEditable) {
      reject(new Error('Element is not an input, textarea, or contenteditable'))
      return
    }
    
    // Scroll into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.focus()
    
    if (isContentEditable) {
      // For contenteditable (Gmail, rich editors): click + focus + wait + execCommand
      element.click()
      element.focus()
      
      setTimeout(() => {
        try {
          const success = document.execCommand('insertText', false, value)
          
          if (!success) {
            // Fallback
            element.textContent = value
            element.dispatchEvent(new InputEvent('input', { bubbles: true }))
          }
          
          const name = element.getAttribute('aria-label') || 'input field'
          resolve(`Filled "${name.substring(0, 50)}"`)
        } catch (error: any) {
          reject(error)
        }
      }, 100)
    } else {
      // For regular inputs/textareas: direct value assignment
      try {
        const inputElement = element as HTMLInputElement | HTMLTextAreaElement
        inputElement.value = value
        inputElement.dispatchEvent(new Event('input', { bubbles: true }))
        inputElement.dispatchEvent(new Event('change', { bubbles: true }))
        
        const name = element.getAttribute('aria-label') || 
                     inputElement.labels?.[0]?.textContent?.trim() ||
                     inputElement.placeholder || 
                     'input field'
        resolve(`Filled "${name.substring(0, 50)}"`)
      } catch (error: any) {
        reject(error)
      }
    }
  })
}

async function handleTabAudioCapture(streamId: string, duration: number): Promise<string> {
  try {
    console.log('Content script: Starting tab audio capture')
    
    // Get the media stream using the provided stream ID
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      } as any
    } as any)

    // Prevent tab audio from being muted (based on Stack Overflow solution)
    const audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    source.connect(audioContext.destination)

    // Create MediaRecorder to record the stream
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    const audioChunks: Blob[] = []
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data)
      }
    }
    
    // Start recording
    mediaRecorder.start()
    console.log(`Content script: Started recording audio for ${duration} seconds`)
    
    // Stop recording after specified duration
    setTimeout(() => {
      mediaRecorder.stop()
      stream.getTracks().forEach(track => track.stop())
      audioContext.close()
    }, duration * 1000)
    
    // Wait for recording to complete
    const audioBlob = await new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' })
        resolve(blob)
      }
    })
    
    // Convert blob to data URL
    const reader = new FileReader()
    const audioDataUrl = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(audioBlob)
    })
    
    console.log(`Content script: Audio recording completed: ${audioBlob.size} bytes`)
    return audioDataUrl
    
  } catch (error) {
    console.error('Content script: Error capturing tab audio:', error)
    throw error
  }
}

