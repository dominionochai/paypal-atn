import { useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { useTextRewriter } from '~lib/use-text-rewriter'
import { useTextExplainer } from '~lib/use-text-explainer'
import { useTextWriter } from '~lib/use-text-writer'
import { loadSettings } from '~lib/settings'
import { TextRewriterView } from './text-rewriter-view'
import { TextExplainerView } from './text-explainer-view'
import { TextWriterView } from './text-writer-view'
import type { PresetAction } from './rewriter-presets'

interface SelectionData {
  text: string
  element: string
  range: Range
  isEditable: boolean // true for input/textarea, false for static text
  targetElement?: HTMLInputElement | HTMLTextAreaElement
  selectionStart?: number
  selectionEnd?: number
  screenshot?: string // base64 image data
  audio?: string // base64 audio data
}

interface HighlightRect {
  top: number
  left: number
  width: number
  height: number
}

// Global state for screenshot mode and audio capture
let globalScreenshotModeCallback: (() => void) | null = null
let globalAudioCaptureCallback: (() => void) | null = null
let globalAudioCountdownGetter: (() => number) | null = null
let globalIsCapturingAudioGetter: (() => boolean) | null = null
let globalCancelAudioCapture: (() => void) | null = null

const CustomTextSelection = () => {
  const [selectionData, setSelectionData] = useState<SelectionData | null>(null)
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([])
  const [referenceHighlightRects, setReferenceHighlightRects] = useState<HighlightRect[]>([]) // Orange highlights for references
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [showBelow, setShowBelow] = useState(false) // Whether to show tooltip below target
  const [inputValue, setInputValue] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [explainerMode, setExplainerMode] = useState<'options' | 'explaining'>('options')
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Screenshot mode state
  const [isScreenshotMode, setIsScreenshotMode] = useState(false)
  const [screenshotStart, setScreenshotStart] = useState<{ x: number; y: number } | null>(null)
  const [screenshotEnd, setScreenshotEnd] = useState<{ x: number; y: number } | null>(null)
  
  // Audio capture state
  const [isCapturingAudio, setIsCapturingAudio] = useState(false)
  const [audioCountdown, setAudioCountdown] = useState(5)
  const audioCancelledRef = useRef(false)
  
  // Writer mode state
  const [isWriterMode, setIsWriterMode] = useState(false)
  const [writerTargetElement, setWriterTargetElement] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const [writerCursorPosition, setWriterCursorPosition] = useState(0)
  const [writeCommandEnabled, setWriteCommandEnabled] = useState(false)
  
  // Hooks for different modes
  const rewriter = useTextRewriter()
  const explainer = useTextExplainer()
  const writer = useTextWriter()

  // Helper function to calculate if tooltip should be shown below
  const calculateShowBelow = (targetY: number, isScreenshotOrAudio: boolean = false) => {
    // Estimate tooltip height based on mode
    // Regular tooltip with options: ~250px
    // With explanation/suggestion: up to ~400px
    // Screenshot/audio: centered, so different logic
    const estimatedHeight = isScreenshotOrAudio ? 300 : 250
    
    // Check if showing above would put tooltip off-screen
    // targetY is relative to document, so we need to compare with viewport
    const viewportTop = window.scrollY
    const spaceAbove = targetY - viewportTop
    
    // If there's not enough space above (with 20px padding), show below
    return spaceAbove < estimatedHeight + 20
  }

  // Load settings to check if write command is enabled
  useEffect(() => {
    loadSettings().then(settings => {
      setWriteCommandEnabled(settings.writeCommandEnabled)
    })
  }, [])

  // Command detection for /write
  useEffect(() => {
    // Don't activate if disabled in settings
    if (!writeCommandEnabled) return
    const handleInput = (e: Event) => {
      const target = e.target as HTMLElement
      
      // Check for input/textarea elements
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const value = target.value
        const cursorPos = target.selectionStart || 0
        
        // Check if the text contains /write command
        const writeCommandPattern = /\/write(\s|$)/i
        const match = value.match(writeCommandPattern)
        
        if (match) {
          const commandStart = value.indexOf(match[0])
          
          // Clear the /write command from the input
          const beforeCommand = value.substring(0, commandStart)
          const afterCommand = value.substring(commandStart + match[0].length)
          const newValue = beforeCommand + afterCommand
          
          target.value = newValue
          
          // Update cursor position (place it where the command was)
          const newCursorPos = commandStart
          target.setSelectionRange(newCursorPos, newCursorPos)
          
          // Dispatch events to notify React/frameworks
          target.dispatchEvent(new Event('input', { bubbles: true }))
          target.dispatchEvent(new Event('change', { bubbles: true }))
          
          // Open writer overlay
          setIsWriterMode(true)
          setWriterTargetElement(target)
          setWriterCursorPosition(newCursorPos)
          
          // Position the writer overlay near the input
          const rect = target.getBoundingClientRect()
          const shouldShowBelow = calculateShowBelow(rect.top + window.scrollY)
          const targetY = shouldShowBelow 
            ? rect.bottom + window.scrollY + 10  // Below: bottom + padding
            : rect.top + window.scrollY - 10     // Above: top - padding
          setTooltipPosition({
            x: rect.left + rect.width / 2,
            y: targetY
          })
          setShowBelow(shouldShowBelow)
          
          setInputValue('')
        }
        return
      }
      
      // Check for contenteditable elements
      if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
        const textContent = target.textContent || ''
        
        // Check if the text contains /write command
        const writeCommandPattern = /\/write(\s|$)/i
        const match = textContent.match(writeCommandPattern)
        
        if (match) {
          const commandStart = textContent.indexOf(match[0])
          
          // Get the selection to find cursor position
          const selection = window.getSelection()
          if (!selection) return
          
          // Remove the /write command using execCommand or direct DOM manipulation
          try {
            // Find and remove the command text
            const range = document.createRange()
            const walker = document.createTreeWalker(
              target,
              NodeFilter.SHOW_TEXT,
              null
            )
            
            let currentPos = 0
            let commandNode: Text | null = null
            let commandOffset = 0
            
            // Find the text node containing the command
            while (walker.nextNode()) {
              const node = walker.currentNode as Text
              const nodeText = node.textContent || ''
              const nodeLength = nodeText.length
              
              if (currentPos + nodeLength >= commandStart) {
                commandNode = node
                commandOffset = commandStart - currentPos
                break
              }
              
              currentPos += nodeLength
            }
            
            if (commandNode) {
              // Delete the command text
              const commandLength = match[0].length
              const nodeText = commandNode.textContent || ''
              const beforeCommand = nodeText.substring(0, commandOffset)
              const afterCommand = nodeText.substring(commandOffset + commandLength)
              commandNode.textContent = beforeCommand + afterCommand
              
              // Set cursor position where the command was
              range.setStart(commandNode, commandOffset)
              range.setEnd(commandNode, commandOffset)
              selection.removeAllRanges()
              selection.addRange(range)
              
              // Dispatch input event for React/frameworks
              target.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'deleteContent'
              }))
              
              // Open writer overlay - store a fake target for contenteditable
              // We'll handle insertion differently for contenteditable
              setIsWriterMode(true)
              setWriterTargetElement(null) // Signal that this is contenteditable
              setWriterCursorPosition(0)
              
              // Store the contenteditable element and range for later
              ;(window as any).__marionette_writer_target = {
                element: target,
                range: range.cloneRange()
              }
              
              // Position the writer overlay near the element
              const rect = target.getBoundingClientRect()
              const shouldShowBelow = calculateShowBelow(rect.top + window.scrollY)
              const targetY = shouldShowBelow 
                ? rect.bottom + window.scrollY + 10  // Below: bottom + padding
                : rect.top + window.scrollY - 10     // Above: top - padding
              setTooltipPosition({
                x: rect.left + rect.width / 2,
                y: targetY
              })
              setShowBelow(shouldShowBelow)
              
              setInputValue('')
            }
          } catch (error) {
            console.error('Failed to remove /write command from contenteditable:', error)
          }
        }
      }
    }
    
    // Listen to input events on the entire document
    document.addEventListener('input', handleInput, true)
    
    return () => {
      document.removeEventListener('input', handleInput, true)
    }
  }, [writeCommandEnabled])

  useEffect(() => {
    const handleSelection = (e: MouseEvent | KeyboardEvent, source: 'mouse' | 'keyboard') => {
      const target = (e.target || document.activeElement) as HTMLElement
      
      // Check if selection is in an input or textarea
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const selectedText = target.value.substring(target.selectionStart || 0, target.selectionEnd || 0).trim()
        
        if (!selectedText) {
          return
        }
        
        const tagName = target.tagName.toLowerCase()
        const rect = target.getBoundingClientRect()
        
        // Create a highlight rect for the entire input (approximation)
        const highlightRects: HighlightRect[] = [{
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height
        }]
        
        // Position tooltip above the input
        const shouldShowBelow = calculateShowBelow(rect.top + window.scrollY)
        const targetY = shouldShowBelow 
          ? rect.bottom + window.scrollY + 10  // Below: bottom + padding
          : rect.top + window.scrollY - 10     // Above: top - padding
        setTooltipPosition({
          x: rect.left + rect.width / 2,
          y: targetY
        })
        setShowBelow(shouldShowBelow)
        
        // Store selection data with target element info
        setSelectionData({
          text: selectedText,
          element: tagName,
          range: document.createRange(), // Placeholder range
          isEditable: true, // Input/textarea is editable
          targetElement: target,
          selectionStart: target.selectionStart || 0,
          selectionEnd: target.selectionEnd || 0
        })
        
        setHighlightRects(highlightRects)
        setInputValue('')
        
        return
      }
      
      // Check if selection is in a contenteditable element
      if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
        const selection = window.getSelection()
        
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
          return
        }
        
        const selectedText = selection.toString().trim()
        const range = selection.getRangeAt(0)
        const rects = range.getClientRects()
        
        if (rects.length === 0) {
          return
        }
        
        const highlightRects: HighlightRect[] = []
        
        for (let i = 0; i < rects.length; i++) {
          const rect = rects[i]
          if (rect.width > 0 && rect.height > 0) {
            highlightRects.push({
              top: rect.top + window.scrollY,
              left: rect.left + window.scrollX,
              width: rect.width,
              height: rect.height
            })
          }
        }
        
        const firstRect = rects[0]
        const shouldShowBelow = calculateShowBelow(firstRect.top + window.scrollY)
        const targetY = shouldShowBelow 
          ? firstRect.bottom + window.scrollY + 10  // Below: bottom + padding
          : firstRect.top + window.scrollY - 10     // Above: top - padding
        setTooltipPosition({
          x: firstRect.left + firstRect.width / 2,
          y: targetY
        })
        setShowBelow(shouldShowBelow)
        
        setSelectionData({
          text: selectedText,
          element: target.tagName.toLowerCase(),
          range: range.cloneRange(),
          isEditable: true // Contenteditable is editable
        })
        
        setHighlightRects(highlightRects)
        setInputValue('')
        
        // Clear the native selection after we've captured it
        setTimeout(() => {
          selection.removeAllRanges()
        }, 50)
        
        return
      }
      
      // Handle regular text selection (static/non-editable)
      const selection = window.getSelection()
      
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        return
      }

      const selectedText = selection.toString().trim()
      const range = selection.getRangeAt(0)
      
      // Get the wrapper element
      const container = range.commonAncestorContainer
      const element = container.nodeType === Node.TEXT_NODE 
        ? container.parentElement 
        : container as Element
      
      const tagName = element?.tagName?.toLowerCase() || 'unknown'
      
      // Get all rects for the selection (handles multi-line selections)
      const rects = range.getClientRects()
      const highlightRects: HighlightRect[] = []
      
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i]
        if (rect.width > 0 && rect.height > 0) {
          highlightRects.push({
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height
          })
        }
      }
      
      // Position tooltip above the first rect
      const firstRect = rects[0]
      const shouldShowBelow = calculateShowBelow(firstRect.top + window.scrollY)
      const targetY = shouldShowBelow 
        ? firstRect.bottom + window.scrollY + 10  // Below: bottom + padding
        : firstRect.top + window.scrollY - 10     // Above: top - padding
      setTooltipPosition({
        x: firstRect.left + firstRect.width / 2,
        y: targetY
      })
      setShowBelow(shouldShowBelow)
      
      // Store selection data for static text
      const data: SelectionData = {
        text: selectedText,
        element: tagName,
        range: range.cloneRange(),
        isEditable: false // Static text is not editable
      }
      
      setSelectionData(data)
      setHighlightRects(highlightRects)
      setInputValue('')
      
      // Clear the native selection after we've captured it
      setTimeout(() => {
        selection.removeAllRanges()
      }, 50)
      
      // Reset to options mode (don't auto-generate anything)
      setExplainerMode('options')
    }

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      
      // Don't clear if clicking on our tooltip
      if (target.closest('.marionette-custom-selection-tooltip')) {
        return
      }
      
      // Clear custom selection
      setSelectionData(null)
      setHighlightRects([])
      setTooltipPosition(null)
      setShowBelow(false)
      setInputValue('')
      rewriter.reset()
      explainer.reset()
    }

    const handleMouseUp = (e: MouseEvent) => handleSelection(e, 'mouse')
    
    // Debounce keyboard selection to avoid too many triggers
    let keyboardSelectionTimeout: NodeJS.Timeout
    const handleKeyUp = (e: KeyboardEvent) => {
      // Only trigger on selection-related keys
      const isSelectionKey = 
        e.key === 'a' && (e.ctrlKey || e.metaKey) || // Ctrl/Cmd+A
        e.key.startsWith('Arrow') && e.shiftKey ||    // Shift+Arrow
        e.key === 'Home' && e.shiftKey ||             // Shift+Home
        e.key === 'End' && e.shiftKey                 // Shift+End
      
      if (isSelectionKey) {
        clearTimeout(keyboardSelectionTimeout)
        keyboardSelectionTimeout = setTimeout(() => {
          handleSelection(e, 'keyboard')
        }, 150) // Small delay to let selection settle
      }
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keyup', handleKeyUp)
    document.addEventListener('mousedown', handleMouseDown)

    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('mousedown', handleMouseDown)
      clearTimeout(keyboardSelectionTimeout)
    }
  }, [rewriter, explainer])

  // Note: Input focus is now handled in TextRewriterView component

  const handleDragStart = (e: React.MouseEvent) => {
    if (!tooltipPosition) return
    
    setIsDragging(true)
    setDragOffset({
      x: e.clientX - tooltipPosition.x,
      y: e.clientY - tooltipPosition.y
    })
  }

  useEffect(() => {
    const handleDragMove = (e: MouseEvent) => {
      if (!isDragging || !tooltipPosition) return
      
      e.preventDefault() // Prevent text selection while dragging
      
      setTooltipPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      })
    }

    const handleDragEnd = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleDragMove)
      document.addEventListener('mouseup', handleDragEnd)
      
      // Prevent text selection globally while dragging
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.userSelect = ''
    }

    return () => {
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('mouseup', handleDragEnd)
      document.body.style.userSelect = ''
    }
  }, [isDragging, dragOffset, tooltipPosition])

  // Screenshot mode effect
  useEffect(() => {
    globalScreenshotModeCallback = () => {
      setIsScreenshotMode(true)
      setScreenshotStart(null)
      setScreenshotEnd(null)
    }

    return () => {
      globalScreenshotModeCallback = null
    }
  }, [])
  
  // Set up global callback for audio capture trigger
  useEffect(() => {
    globalAudioCaptureCallback = () => {
      handleAudioCapture()
    }
    globalAudioCountdownGetter = () => audioCountdown
    globalIsCapturingAudioGetter = () => isCapturingAudio
    globalCancelAudioCapture = () => {
      console.log('[AUDIO CAPTURE] Cancel requested')
      audioCancelledRef.current = true
      setIsCapturingAudio(false)
      setAudioCountdown(5)
    }

    return () => {
      globalAudioCaptureCallback = null
      globalAudioCountdownGetter = null
      globalIsCapturingAudioGetter = null
      globalCancelAudioCapture = null
    }
  }, [audioCountdown, isCapturingAudio])

  // Screenshot drag handlers
  useEffect(() => {
    if (!isScreenshotMode) return

    const handleMouseDown = (e: MouseEvent) => {
      setScreenshotStart({ x: e.clientX, y: e.clientY })
      setScreenshotEnd({ x: e.clientX, y: e.clientY })
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (screenshotStart) {
        setScreenshotEnd({ x: e.clientX, y: e.clientY })
      }
    }

    const handleMouseUp = async () => {
      if (screenshotStart && screenshotEnd) {
        // Calculate the area
        const left = Math.min(screenshotStart.x, screenshotEnd.x)
        const top = Math.min(screenshotStart.y, screenshotEnd.y)
        const width = Math.abs(screenshotEnd.x - screenshotStart.x)
        const height = Math.abs(screenshotEnd.y - screenshotStart.y)

        if (width > 10 && height > 10) {
          // Exit screenshot mode FIRST to hide the overlay
          setIsScreenshotMode(false)
          setScreenshotStart(null)
          setScreenshotEnd(null)
          
          // Wait for React to re-render and remove the overlay
          await new Promise(resolve => setTimeout(resolve, 50))
          
          // NOW capture screenshot (without the overlay)
          await captureAreaScreenshot(left, top, width, height)
        } else {
          // If selection too small, just exit
          setIsScreenshotMode(false)
          setScreenshotStart(null)
          setScreenshotEnd(null)
        }
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsScreenshotMode(false)
        setScreenshotStart(null)
        setScreenshotEnd(null)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isScreenshotMode, screenshotStart, screenshotEnd])

  const captureAreaScreenshot = async (left: number, top: number, width: number, height: number) => {
    try {
      // Request screenshot from background FIRST (before flash)
      const response = await chrome.runtime.sendMessage({ type: 'capture_screenshot' })
      
      // Show flash effect AFTER capturing (so it's not in the screenshot)
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
        animation: flash-effect 0.3s ease-out;
      `
      const style = document.createElement('style')
      style.textContent = `
        @keyframes flash-effect {
          0% { opacity: 0.8; }
          100% { opacity: 0; }
        }
      `
      document.head.appendChild(style)
      document.body.appendChild(flash)
      
      setTimeout(() => {
        flash.remove()
        style.remove()
      }, 300)
      
      if (response.success && response.dataUrl) {
        // Crop the screenshot to the selected area
        const croppedImage = await cropImage(response.dataUrl, left, top, width, height)
        
        // Show explainer with the screenshot
        setSelectionData({
          text: '',
          element: 'screenshot',
          range: document.createRange(),
          isEditable: false,
          screenshot: croppedImage
        })
        
        // Position tooltip centered in the current viewport
        const targetY = window.innerHeight / 2 + window.scrollY
        setTooltipPosition({
          x: window.innerWidth / 2 + window.scrollX,
          y: targetY
        })
        // Screenshots are centered, so use centered positioning
        setShowBelow(false)
        
        setExplainerMode('options')
      }
    } catch (error) {
      console.error('Screenshot capture failed:', error)
    }
  }

  const cropImage = (dataUrl: string, left: number, top: number, width: number, height: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        
        // Account for device pixel ratio
        const dpr = window.devicePixelRatio || 1
        canvas.width = width * dpr
        canvas.height = height * dpr
        
        ctx.drawImage(
          img,
          left * dpr, top * dpr, width * dpr, height * dpr,
          0, 0, width * dpr, height * dpr
        )
        
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = dataUrl
    })
  }
  
  // Audio capture function
  const handleAudioCapture = async () => {
    if (isCapturingAudio) return
    
    setIsCapturingAudio(true)
    setAudioCountdown(5)
    audioCancelledRef.current = false
    
    try {
      // Countdown
      for (let i = 4; i >= 0; i--) {
        if (audioCancelledRef.current) {
          console.log('[AUDIO CAPTURE] Cancelled during countdown')
          return
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (audioCancelledRef.current) {
          console.log('[AUDIO CAPTURE] Cancelled during countdown')
          return
        }
        setAudioCountdown(i)
      }
      
      if (audioCancelledRef.current) {
        console.log('[AUDIO CAPTURE] Cancelled before capture')
        return
      }
      
      // Capture audio from background
      const response = await chrome.runtime.sendMessage({ 
        type: 'capture_audio',
        duration: 5
      })
      
      if (response.success && response.audioDataUrl) {
        // Show explainer with the audio
        setSelectionData({
          text: '',
          element: 'audio',
          range: document.createRange(),
          isEditable: false,
          audio: response.audioDataUrl
        })
        
        // Position tooltip centered in the current viewport
        const targetY = window.innerHeight / 2 + window.scrollY
        setTooltipPosition({
          x: window.innerWidth / 2 + window.scrollX,
          y: targetY
        })
        // Audio is centered, so use centered positioning
        setShowBelow(false)
        
        setExplainerMode('options')
      } else {
        // Check if it's the extension invocation error
        const errorMsg = response.error || ''
        console.log('[AUDIO CAPTURE] Error occurred:', errorMsg)
        if (errorMsg.includes('Extension has not been invoked') || errorMsg.includes('activeTab permission')) {
          console.log('[AUDIO CAPTURE] Showing extension invocation error toast')
          showErrorMessage('Please click the Marionette extension icon first, then try recording audio again.')
        } else {
          console.log('[AUDIO CAPTURE] Showing generic error toast')
          showErrorMessage(`Audio capture failed: ${errorMsg}`)
        }
      }
    } catch (error: any) {
      console.error('Audio capture error:', error)
      const errorMsg = error.message || String(error)
      if (errorMsg.includes('Extension has not been invoked') || errorMsg.includes('activeTab permission')) {
        showErrorMessage('Please click the Marionette extension icon first, then try recording audio again.')
      } else {
        showErrorMessage(`Audio capture error: ${errorMsg}`)
      }
    } finally {
      setIsCapturingAudio(false)
      setAudioCountdown(5)
    }
  }
  
  // Show error message as a toast
  const showErrorMessage = (message: string) => {
    console.log('[TOAST] Creating toast with message:', message)
    
    const toast = document.createElement('div')
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(239, 68, 68, 0.95);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      max-width: 400px;
      text-align: center;
      pointer-events: auto;
    `
    
    toast.textContent = message
    document.body.appendChild(toast)
    
    console.log('[TOAST] Toast appended to body')
    
    setTimeout(() => {
      console.log('[TOAST] Removing toast')
      toast.remove()
    }, 4000)
  }

  const clearAll = () => {
    setSelectionData(null)
    setHighlightRects([])
    setTooltipPosition(null)
    setShowBelow(false)
    setInputValue('')
    setExplainerMode('options')
    setIsWriterMode(false)
    setWriterTargetElement(null)
    setWriterCursorPosition(0)
    rewriter.reset()
    explainer.reset()
    writer.reset()
    
    // Clean up contenteditable target
    delete (window as any).__marionette_writer_target
  }

  // Rewriter handlers (for editable text)
  const handleReplaceAndClose = () => {
    rewriter.replaceSelection(selectionData)
    clearAll()
  }

  const handleRewriterSend = async () => {
    if (rewriter.isProcessing) return

    if (rewriter.suggestion) {
      // If we already have a suggestion, apply it
      handleReplaceAndClose()
    } else if (inputValue.trim() && selectionData) {
      // Generate suggestion based on input
      await rewriter.generateSuggestion(selectionData.text, inputValue)
    }
  }

  const handleRewriterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRewriterSend()
    } else if (e.key === 'Escape') {
      clearAll()
    }
  }

  // Explainer handlers (for static text, screenshots, and audio)
  const handleExplain = () => {
    if (!selectionData) return
    setExplainerMode('explaining')
    
    if (selectionData.screenshot) {
      // For screenshots, pass the image to explainer
      explainer.generateExplanationWithImage(selectionData.screenshot)
    } else if (selectionData.audio) {
      // For audio, pass the audio to explainer
      explainer.generateExplanationWithAudio(selectionData.audio)
    } else {
      // For text, use regular explanation
      explainer.generateExplanation(selectionData.text)
    }
  }
  
  const handleSendToChat = () => {
    if (!selectionData) return
    
    // Determine what to send based on current mode
    let result = ''
    let image: string | undefined
    let audio: string | undefined
    
    if (explainerMode === 'explaining' && explainer.explanation) {
      result = explainer.explanation
    } else if (selectionData.screenshot) {
      // For screenshots without explanation, just send the image
      result = 'Please analyze this image'
      image = selectionData.screenshot
    } else if (selectionData.audio) {
      // For audio without explanation, just send the audio
      result = 'Please analyze this audio'
      audio = selectionData.audio
    } else {
      // In options mode, just send the selected text
      result = `Please analyze this text: "${selectionData.text}"`
    }
    
    const referenceData = {
      text: selectionData.text || (selectionData.screenshot ? '[Screenshot]' : '[Audio Recording]'),
      explanation: result,
      image: selectionData.screenshot || image,
      audio: selectionData.audio || audio,
      timestamp: Date.now()
    }
    
    // Store reference in chrome storage for chat context to pick up
    chrome.storage.local.set({ chat_reference: referenceData }, () => {
      console.log('[REFERENCE] Saved to storage:', referenceData)
    })
    
    // Open the popup
    chrome.runtime.sendMessage({ type: 'open_popup' }).catch(err => {
      console.log('[REFERENCE] Could not open popup:', err)
    })
    
    // Keep highlights but change to orange (reference color)
    setReferenceHighlightRects(highlightRects)
    
    // Close the tooltip but keep reference highlight
    setSelectionData(null)
    setHighlightRects([])
    setTooltipPosition(null)
    setShowBelow(false)
    
    // Auto-clear reference highlight after 3 seconds
    setTimeout(() => {
      setReferenceHighlightRects([])
    }, 3000)
  }

  // Preset handler (for quick actions)
  const handlePresetClick = async (preset: PresetAction) => {
    if (!selectionData) return
    
    // Set the input value to the preset prompt
    setInputValue(preset.prompt)
    
    // Automatically trigger the rewriter with the preset prompt
    await rewriter.generateSuggestion(selectionData.text, preset.prompt)
  }

  // Writer handlers
  const handleWriterSend = async () => {
    if (writer.isProcessing) return

    if (writer.output) {
      // If we already have output, insert it
      writer.insertText(writerTargetElement ? {
        element: writerTargetElement,
        cursorPosition: writerCursorPosition
      } : null)
      clearAll()
    } else if (inputValue.trim()) {
      // Generate text based on prompt
      await writer.generateText(inputValue)
    }
  }

  const handleWriterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleWriterSend()
    } else if (e.key === 'Escape') {
      clearAll()
    }
  }

  const handleWriterClose = () => {
    clearAll()
  }

  return (
    <>
      {/* Screenshot mode overlay */}
      {isScreenshotMode && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 2147483646,
            cursor: 'crosshair',
            pointerEvents: 'auto'
          }}
        >
          {/* Instructions */}
          <div style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '14px',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            zIndex: 2147483647
          }}>
            Drag to select area • Press ESC to cancel
          </div>
          
          {/* Selection rectangle with darkened surroundings */}
          {screenshotStart && screenshotEnd ? (
            <div
              style={{
                position: 'fixed',
                left: `${Math.min(screenshotStart.x, screenshotEnd.x)}px`,
                top: `${Math.min(screenshotStart.y, screenshotEnd.y)}px`,
                width: `${Math.abs(screenshotEnd.x - screenshotStart.x)}px`,
                height: `${Math.abs(screenshotEnd.y - screenshotStart.y)}px`,
                border: '2px solid #60a5fa',
                background: 'transparent',
                pointerEvents: 'none',
                zIndex: 2147483647,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)'
              }}
            />
          ) : (
            /* Show full dark overlay when no selection yet */
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                background: 'rgba(0, 0, 0, 0.5)',
                pointerEvents: 'none'
              }}
            />
          )}
        </div>
      )}
      
      {/* Blue highlight overlays for active selection */}
      {highlightRects.map((rect, index) => (
        <div
          key={`blue-${index}`}
          style={{
            position: 'absolute',
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            background: 'rgba(59, 130, 246, 0.3)', // Blue highlight
            pointerEvents: 'none',
            zIndex: 2147483646
          }}
        />
      ))}
      
      {/* Orange highlight overlays for sent reference */}
      {referenceHighlightRects.map((rect, index) => (
        <div
          key={`orange-${index}`}
          style={{
            position: 'absolute',
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            background: 'rgba(249, 115, 22, 0.35)', // Orange highlight for reference
            border: '1px solid rgba(249, 115, 22, 0.5)',
            pointerEvents: 'none',
            zIndex: 2147483645,
            animation: 'fadeInOrange 0.3s ease-out'
          }}
        />
      ))}
      
      {/* Writer mode overlay - separate from selection overlay */}
      {isWriterMode && tooltipPosition && (
        <div
          className="marionette-custom-selection-tooltip"
          style={{
            position: 'absolute',
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: showBelow ? 'translate(-50%, 0%)' : 'translate(-50%, -100%)',
            zIndex: 2147483647,
            pointerEvents: 'auto',
            cursor: isDragging ? 'grabbing' : 'auto'
          }}
        >
          <div
            style={{
              background: '#1a1a1a',
              borderRadius: '24px',
              border: '1px solid #2a2a2a',
              boxShadow: isDragging ? '0 8px 30px rgba(0, 0, 0, 0.7)' : '0 4px 20px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '6px 8px',
              minWidth: '550px',
              maxWidth: '750px',
              transition: 'box-shadow 0.2s'
            }}
          >
            <TextWriterView
              inputValue={inputValue}
              setInputValue={setInputValue}
              isProcessing={writer.isProcessing}
              output={writer.output}
              displayedOutput={writer.displayedOutput}
              inputRef={inputRef}
              isDragging={isDragging}
              onDragStart={handleDragStart}
              onSendClick={handleWriterSend}
              onKeyDown={handleWriterKeyDown}
              onClose={handleWriterClose}
            />
          </div>
        </div>
      )}

      {/* Only render tooltip if we have selection data and position */}
      {!selectionData || !tooltipPosition || isWriterMode ? null : (
        <>
          {/* Tooltip with input */}
          <div
        className="marionette-custom-selection-tooltip"
        style={{
          position: 'absolute',
          left: `${tooltipPosition.x}px`,
          top: `${tooltipPosition.y}px`,
          transform: selectionData.screenshot || selectionData.audio 
            ? 'translate(-50%, -50%)' 
            : (showBelow ? 'translate(-50%, 0%)' : 'translate(-50%, -100%)'),
          zIndex: 2147483647,
          pointerEvents: 'auto',
          cursor: isDragging ? 'grabbing' : 'auto'
        }}
          >
            <div
              style={{
                background: '#1a1a1a',
                borderRadius: '24px',
                border: '1px solid #2a2a2a',
                boxShadow: isDragging ? '0 8px 30px rgba(0, 0, 0, 0.7)' : '0 4px 20px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '6px 8px',
                minWidth: '550px',
                maxWidth: '750px',
                transition: 'box-shadow 0.2s'
              }}
            >
              {/* Render appropriate view based on selection type */}
              {selectionData.isEditable ? (
                <TextRewriterView
                  inputValue={inputValue}
                  setInputValue={setInputValue}
                  isProcessing={rewriter.isProcessing}
                  suggestion={rewriter.suggestion}
                  displayedSuggestion={rewriter.displayedSuggestion}
                  inputRef={inputRef}
                  isDragging={isDragging}
                  onDragStart={handleDragStart}
                  onSendClick={handleRewriterSend}
                  onKeyDown={handleRewriterKeyDown}
                  onPresetClick={handlePresetClick}
                />
              ) : (
                <TextExplainerView
                  selectedText={selectionData.text}
                  screenshot={selectionData.screenshot}
                  audio={selectionData.audio}
                  mode={explainerMode}
                  isProcessing={explainer.isProcessing}
                  result={explainer.explanation}
                  displayedResult={explainer.displayedExplanation}
                  isDragging={isDragging}
                  onDragStart={handleDragStart}
                  onExplain={handleExplain}
                  onSendToChat={handleSendToChat}
                />
              )}
            </div>
          </div>
        </>
      )}
      
      {/* CSS animations */}
      <style>{`
        @keyframes fadeInOrange {
          0% {
            opacity: 0;
            transform: scale(1.05);
          }
          50% {
            opacity: 0.5;
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  )
}

// Initialize the custom selection UI
export const initCustomTextSelection = () => {
  // Create a container for the custom selection UI
  const container = document.createElement('div')
  container.id = 'marionette-custom-selection-root'
  container.style.position = 'absolute'
  container.style.top = '0'
  container.style.left = '0'
  container.style.width = '0'
  container.style.height = '0'
  container.style.zIndex = '2147483646'
  container.style.pointerEvents = 'none'
  
  document.body.appendChild(container)
  
  const root = createRoot(container)
  root.render(<CustomTextSelection />)
  
  console.log('Marionette: Custom text selection initialized')
}

// Export screenshot mode trigger
export function triggerScreenshotMode() {
  if (globalScreenshotModeCallback) {
    globalScreenshotModeCallback()
  }
}

// Export audio capture trigger
export function triggerAudioCapture() {
  if (globalAudioCaptureCallback) {
    globalAudioCaptureCallback()
  }
}

// Export audio state getters
export function getAudioCountdown() {
  return globalAudioCountdownGetter ? globalAudioCountdownGetter() : 5
}

export function getIsCapturingAudio() {
  return globalIsCapturingAudioGetter ? globalIsCapturingAudioGetter() : false
}

// Export cancel function
export function cancelAudioCapture() {
  if (globalCancelAudioCapture) {
    globalCancelAudioCapture()
  }
}

