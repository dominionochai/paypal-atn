import { useState, useEffect, useRef } from 'react'
import { getPageContext } from './use-page-context'

interface SelectionData {
  text: string
  element: string
  range: Range
  targetElement?: HTMLInputElement | HTMLTextAreaElement
  selectionStart?: number
  selectionEnd?: number
}

export const useTextRewriter = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [displayedSuggestion, setDisplayedSuggestion] = useState('')

  // Real rewriting using Rewriter API
  const generateSuggestion = async (selectedText: string, instruction: string) => {
    setIsProcessing(true)
    setSuggestion('')
    setDisplayedSuggestion('')

    try {
      // Check if Rewriter API is available
      if (!('Rewriter' in self)) {
        throw new Error('Rewriter API not available')
      }

      const availability = await (self as any).Rewriter.availability()
      if (availability === 'unavailable') {
        throw new Error('Rewriter model unavailable')
      }

      // Parse instruction to determine tone and length
      const lowerInstruction = instruction.toLowerCase()
      let tone: 'more-formal' | 'as-is' | 'more-casual' = 'as-is'
      let length: 'shorter' | 'as-is' | 'longer' = 'as-is'

      // Determine tone
      if (lowerInstruction.includes('formal') || lowerInstruction.includes('professional')) {
        tone = 'more-formal'
      } else if (lowerInstruction.includes('casual') || lowerInstruction.includes('friendly')) {
        tone = 'more-casual'
      }

      // Determine length
      if (lowerInstruction.includes('short') || lowerInstruction.includes('brief') || lowerInstruction.includes('concise')) {
        length = 'shorter'
      } else if (lowerInstruction.includes('longer') || lowerInstruction.includes('expand') || lowerInstruction.includes('detailed')) {
        length = 'longer'
      }

      // Get page context
      const pageContext = await getPageContext()

      // Create rewriter with parsed options and rich context
      const rewriter = await (self as any).Rewriter.create({
        tone,
        format: 'plain-text',
        length,
        sharedContext: `${pageContext}${instruction}`
      })

      // Stream the rewrite
      const stream = rewriter.rewriteStreaming(selectedText)

      let fullSuggestion = ''
      for await (const chunk of stream) {
        fullSuggestion += chunk // Accumulate each chunk
        setSuggestion(fullSuggestion)
        setDisplayedSuggestion(fullSuggestion) // Stream directly to display
      }

      // Clean up
      rewriter.destroy?.()
    } catch (error: any) {
      console.error('Rewriter error:', error)
      const errorMsg = `Error generating suggestion: ${error.message}`
      setSuggestion(errorMsg)
      setDisplayedSuggestion(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  const replaceSelection = (selectionData: SelectionData | null) => {
    if (!selectionData || !suggestion) return

    const range = selectionData.range
    
    try {
      // For input/textarea elements - use stored reference
      if (selectionData.targetElement) {
        const element = selectionData.targetElement
        const start = selectionData.selectionStart || 0
        const end = selectionData.selectionEnd || 0
        const newValue = element.value.substring(0, start) + suggestion + element.value.substring(end)
        element.value = newValue
        element.setSelectionRange(start, start + suggestion.length)
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.focus()
      } else {
        // For contenteditable and regular text
        // First, restore the selection
        const selection = window.getSelection()
        if (!selection) return
        
        selection.removeAllRanges()
        selection.addRange(range)
        
        // Try using execCommand first (works better with rich text editors like Draft.js)
        let success = false
        try {
          // Delete the selected content
          success = document.execCommand('delete', false)
          if (success) {
            // Insert new text
            success = document.execCommand('insertText', false, suggestion)
          }
        } catch (e) {
          console.warn('execCommand failed, trying fallback:', e)
          success = false
        }
        
        // Fallback method if execCommand doesn't work
        if (!success) {
          try {
            range.deleteContents()
            const textNode = document.createTextNode(suggestion)
            range.insertNode(textNode)
            
            // Move cursor to end of inserted text
            range.setStartAfter(textNode)
            range.setEndAfter(textNode)
            selection.removeAllRanges()
            selection.addRange(range)
            
            // Trigger input events for frameworks
            const container = range.commonAncestorContainer
            const element = container.nodeType === Node.TEXT_NODE 
              ? container.parentElement 
              : container as Element
            
            if (element) {
              element.dispatchEvent(new InputEvent('input', { 
                bubbles: true, 
                cancelable: true,
                inputType: 'insertText',
                data: suggestion 
              }))
              element.dispatchEvent(new Event('change', { bubbles: true }))
            }
          } catch (fallbackError) {
            console.error('Fallback replacement also failed:', fallbackError)
          }
        }
      }
    } catch (error) {
      console.error('Failed to replace selection:', error)
    }
  }

  const reset = () => {
    setSuggestion('')
    setDisplayedSuggestion('')
    setIsProcessing(false)
  }

  return {
    isProcessing,
    suggestion,
    displayedSuggestion,
    generateSuggestion,
    replaceSelection,
    reset
  }
}

