import { useState } from 'react'
import { getPageContext } from './use-page-context'

interface WriterTargetData {
  element: HTMLInputElement | HTMLTextAreaElement
  cursorPosition: number
}

export const useTextWriter = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [output, setOutput] = useState('')
  const [displayedOutput, setDisplayedOutput] = useState('')

  // Generate text using Writer API
  const generateText = async (prompt: string) => {
    setIsProcessing(true)
    setOutput('')
    setDisplayedOutput('')

    try {
      // Check if Writer API is available
      if (!('Writer' in self)) {
        throw new Error('Writer API not available')
      }

      const availability = await (self as any).Writer.availability()
      if (availability === 'unavailable') {
        throw new Error('Writer model unavailable')
      }

      // Get page context
      const pageContext = await getPageContext()

      // Create writer with rich context
      const writer = await (self as any).Writer.create({
        sharedContext: `${pageContext}You are a helpful writing assistant. Generate clear, concise, and well-written content.`
      })

      // Stream the generation
      const stream = writer.writeStreaming(prompt)

      let fullOutput = ''
      for await (const chunk of stream) {
        fullOutput += chunk
        setOutput(fullOutput)
        setDisplayedOutput(fullOutput)
      }

      // Clean up
      writer.destroy?.()
    } catch (error: any) {
      console.error('Writer error:', error)
      const errorMsg = `Error generating text: ${error.message}`
      setOutput(errorMsg)
      setDisplayedOutput(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  const insertText = (targetData: WriterTargetData | null) => {
    if (!output) return

    try {
      // Handle input/textarea elements
      if (targetData?.element) {
        const element = targetData.element
        const position = targetData.cursorPosition
        const currentValue = element.value
        
        // Insert the generated text at cursor position
        const newValue = currentValue.substring(0, position) + output + currentValue.substring(position)
        element.value = newValue
        
        // Move cursor to end of inserted text
        element.setSelectionRange(position + output.length, position + output.length)
        
        // Dispatch events
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.focus()
        return
      }
      
      // Handle contenteditable elements
      const contentEditableTarget = (window as any).__marionette_writer_target
      if (contentEditableTarget) {
        const { element, range } = contentEditableTarget
        
        // Restore the selection
        const selection = window.getSelection()
        if (!selection) return
        
        selection.removeAllRanges()
        selection.addRange(range)
        
        // Try using execCommand first (works better with rich text editors like Draft.js)
        let success = false
        try {
          success = document.execCommand('insertText', false, output)
        } catch (e) {
          console.warn('execCommand failed, trying fallback:', e)
          success = false
        }
        
        // Fallback method if execCommand doesn't work
        if (!success) {
          try {
            const textNode = document.createTextNode(output)
            range.insertNode(textNode)
            
            // Move cursor to end of inserted text
            range.setStartAfter(textNode)
            range.setEndAfter(textNode)
            selection.removeAllRanges()
            selection.addRange(range)
          } catch (fallbackError) {
            console.error('Fallback insertion failed:', fallbackError)
          }
        }
        
        // Trigger input events for frameworks
        element.dispatchEvent(new InputEvent('input', { 
          bubbles: true, 
          cancelable: true,
          inputType: 'insertText',
          data: output 
        }))
        element.focus()
        
        // Clean up
        delete (window as any).__marionette_writer_target
      }
    } catch (error) {
      console.error('Failed to insert text:', error)
    }
  }

  const reset = () => {
    setOutput('')
    setDisplayedOutput('')
    setIsProcessing(false)
  }

  return {
    isProcessing,
    output,
    displayedOutput,
    generateText,
    insertText,
    reset
  }
}

