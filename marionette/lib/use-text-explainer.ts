import { useState, useEffect, useRef } from 'react'
import { getPageContext } from './use-page-context'

export const useTextExplainer = () => {
  const [isProcessing, setIsProcessing] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [displayedExplanation, setDisplayedExplanation] = useState('')
  const explainerSessionRef = useRef<any>(null)

  // Helper to ensure session exists
  const ensureExplainerSession = async () => {
    if (!explainerSessionRef.current) {
      // Check if Prompt API is available
      if (!('LanguageModel' in window)) {
        throw new Error('Prompt API not available')
      }

      const availability = await (window as any).LanguageModel.availability()
      if (availability === 'unavailable') {
        throw new Error('AI model unavailable')
      }

      // Get page context
      const pageContext = await getPageContext()

      // Create a unified session for text, image, and audio explanations with rich context
      explainerSessionRef.current = await (window as any).LanguageModel.create({
        initialPrompts: [{
          role: 'system',
          content: `${pageContext}You are a helpful assistant that provides clear and concise explanations. For text, explain the meaning, context, or significance in 2-3 sentences. For images, describe what you see and provide useful context or analysis in 2-3 sentences. For audio, describe what you hear and provide relevant context or analysis in 2-3 sentences.`
        }],
        expectedInputs: [{ type: 'text' }, { type: 'image' }, { type: 'audio' }]
      })
    }
  }

  // Real LLM explanation generation using Prompt API
  const generateExplanation = async (selectedText: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      await ensureExplainerSession()

      // Stream the explanation
      const stream = explainerSessionRef.current.promptStreaming(
        `Explain the following text:\n\n"${selectedText}"`
      )

      let fullExplanation = ''
      for await (const chunk of stream) {
        fullExplanation += chunk // Accumulate each chunk
        setExplanation(fullExplanation)
        setDisplayedExplanation(fullExplanation) // Stream directly to display
      }
    } catch (error: any) {
      console.error('Explanation error:', error)
      const errorMsg = `Error generating explanation: ${error.message}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  // Real explanation with image using Prompt API
  const generateExplanationWithImage = async (imageDataUrl: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      await ensureExplainerSession()

      // Convert data URL to blob for multimodal input
      const response = await fetch(imageDataUrl)
      const blob = await response.blob()

      // Stream the explanation with image
      const stream = explainerSessionRef.current.promptStreaming([{
        role: 'user',
        content: [
          { type: 'text', value: 'Explain what you see in this image:' },
          { type: 'image', value: blob }
        ]
      }])

      let fullExplanation = ''
      for await (const chunk of stream) {
        fullExplanation += chunk // Accumulate each chunk
        setExplanation(fullExplanation)
        setDisplayedExplanation(fullExplanation) // Stream directly to display
      }
    } catch (error: any) {
      console.error('Image explanation error:', error)
      const errorMsg = `Error analyzing image: ${error.message}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  // Real explanation with audio using Prompt API
  const generateExplanationWithAudio = async (audioDataUrl: string) => {
    setIsProcessing(true)
    setExplanation('')
    setDisplayedExplanation('')

    try {
      await ensureExplainerSession()

      // Convert data URL to blob for multimodal input
      const response = await fetch(audioDataUrl)
      const blob = await response.blob()

      // Stream the explanation with audio
      const stream = explainerSessionRef.current.promptStreaming([{
        role: 'user',
        content: [
          { type: 'text', value: 'Explain what you hear in this audio:' },
          { type: 'audio', value: blob }
        ]
      }])

      let fullExplanation = ''
      for await (const chunk of stream) {
        fullExplanation += chunk // Accumulate each chunk
        setExplanation(fullExplanation)
        setDisplayedExplanation(fullExplanation) // Stream directly to display
      }
    } catch (error: any) {
      console.error('Audio explanation error:', error)
      const errorMsg = `Error analyzing audio: ${error.message}`
      setExplanation(errorMsg)
      setDisplayedExplanation(errorMsg)
    } finally {
      setIsProcessing(false)
    }
  }

  const reset = () => {
    setExplanation('')
    setDisplayedExplanation('')
    setIsProcessing(false)
  }

  // Cleanup session on unmount
  useEffect(() => {
    return () => {
      if (explainerSessionRef.current) {
        explainerSessionRef.current.destroy?.()
        explainerSessionRef.current = null
      }
    }
  }, [])

  return {
    isProcessing,
    explanation,
    displayedExplanation,
    generateExplanation,
    generateExplanationWithImage,
    generateExplanationWithAudio,
    reset
  }
}

