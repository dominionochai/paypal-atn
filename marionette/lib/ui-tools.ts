// Tools that must execute in UI context (require user gesture)
// Automatically loads ALL tools with requiresUserGesture: true from registry
import type { ToolCall } from './tools'
import { getUITools } from './tool-registry'
import { WriterAPIUnavailableError } from './errors'

// Build handler map automatically from imports
const TOOL_IMPLEMENTATIONS: Record<string, (params: any) => Promise<any>> = {
  // Summarizer API tool for current page
  summarizePage: async (params: any) => {
    const { type = 'key-points', length = 'medium' } = params
    
    // Check if Summarizer API is available
    if (!('Summarizer' in self)) {
      throw new WriterAPIUnavailableError('Summarizer API is not available in this browser')
    }
    
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found')
      }

      // Skip certain URLs
      if (tab.url.startsWith('chrome://') || 
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:')) {
        throw new Error('Cannot summarize this type of page')
      }

      // Inject Readability.js
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['assets/Readability.js']
      })

      // Extract content
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          try {
            // Extract structured data before Readability strips it
            const structuredData: string[] = []
            
            // Extract emails from mailto links
            const emailLinks = document.querySelectorAll('a[href^="mailto:"]')
            const emails = new Set<string>()
            emailLinks.forEach(link => {
              const href = link.getAttribute('href')
              if (href) {
                const email = href.replace('mailto:', '').split('?')[0].trim()
                if (email && email.includes('@')) {
                  emails.add(email)
                }
              }
            })
            
            // Extract phone numbers from tel links
            const phoneLinks = document.querySelectorAll('a[href^="tel:"]')
            const phones = new Set<string>()
            phoneLinks.forEach(link => {
              const href = link.getAttribute('href')
              if (href) {
                const phone = href.replace('tel:', '').trim()
                if (phone) {
                  phones.add(phone)
                }
              }
            })
            
            // Also find emails in text content using regex
            const textContent = document.body.innerText
            const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
            const emailMatches = textContent.match(emailRegex)
            if (emailMatches) {
              emailMatches.forEach(email => emails.add(email))
            }
            
            // Find phone numbers in text (North American format)
            const phoneRegex = /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g
            const phoneMatches = textContent.match(phoneRegex)
            if (phoneMatches) {
              phoneMatches.forEach(phone => phones.add(phone))
            }
            
            // Extract social media links
            const socialLinks = new Set<string>()
            const socialPatterns = [
              /twitter\.com\/[^\/\s"]+/i,
              /x\.com\/[^\/\s"]+/i,
              /linkedin\.com\/in\/[^\/\s"]+/i,
              /linkedin\.com\/company\/[^\/\s"]+/i,
              /facebook\.com\/[^\/\s"]+/i,
              /instagram\.com\/[^\/\s"]+/i,
              /github\.com\/[^\/\s"]+/i
            ]
            
            document.querySelectorAll('a[href]').forEach(link => {
              const href = link.getAttribute('href')
              if (href) {
                socialPatterns.forEach(pattern => {
                  const match = href.match(pattern)
                  if (match) {
                    socialLinks.add(match[0])
                  }
                })
              }
            })
            
            // Build structured data section
            if (emails.size > 0) {
              structuredData.push('\n\nContact Emails: ' + Array.from(emails).join(', '))
            }
            if (phones.size > 0) {
              structuredData.push('\n\nContact Phones: ' + Array.from(phones).join(', '))
            }
            if (socialLinks.size > 0) {
              structuredData.push('\n\nSocial Media: ' + Array.from(socialLinks).join(', '))
            }
            
            const documentClone = document.cloneNode(true) as Document
            // @ts-ignore
            const reader = new Readability(documentClone, {
              keepClasses: false,
              charThreshold: 100
            })
            const article = reader.parse()
            
            if (!article) {
              const mainElement = document.querySelector('main, article, [role="main"], #content')
              const content = mainElement 
                ? (mainElement as HTMLElement).innerText 
                : document.body.innerText
              
              if (!content || content.length < 100) {
                return { success: false, error: 'Insufficient content' }
              }
              
              const contentWithStructured = content.replace(/\s+/g, ' ').trim() + structuredData.join('')
              
              return {
                success: true,
                title: document.title,
                content: contentWithStructured
              }
            }
            
            let cleanContent = article.textContent.replace(/\s+/g, ' ').trim()
            cleanContent += structuredData.join('')
            
            return {
              success: true,
              title: article.title || document.title,
              content: cleanContent
            }
          } catch (error: any) {
            return { success: false, error: error.message }
          }
        }
      })

      const extracted = results[0].result as any
      if (!extracted.success || !extracted.content) {
        throw new Error(extracted.error || 'Failed to extract page content')
      }

      // Check Summarizer availability
      const availability = await (self as any).Summarizer.availability()
      if (availability === 'unavailable') {
        throw new WriterAPIUnavailableError('Summarizer model is not available')
      }

      // Create summarizer
      let summarizer
      if (availability === 'available') {
        summarizer = await (self as any).Summarizer.create({
          type,
          format: 'plain-text',
          length
        })
      } else {
        summarizer = await (self as any).Summarizer.create({
          type,
          format: 'plain-text',
          length,
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`Summarizer downloading: ${(e.loaded * 100).toFixed(0)}%`)
            })
          }
        })
      }

      // Try to summarize with progressive truncation if input is too large
      let content = extracted.content
      let summary = null
      let truncationPercentage = 1.0 // Start with full content
      const minTruncation = 0.1 // At least 10% of original content
      
      while (truncationPercentage >= minTruncation) {
        try {
          const truncatedContent = content.substring(0, Math.floor(content.length * truncationPercentage))
          console.log(`Attempting summarization with ${(truncationPercentage * 100).toFixed(0)}% of content (${truncatedContent.length} chars)`)
          
          summary = await summarizer.summarize(truncatedContent)
          
          // Success! Break out of the loop
          if (truncationPercentage < 1.0) {
            console.log(`Successfully summarized with ${(truncationPercentage * 100).toFixed(0)}% of original content`)
          }
          break
        } catch (error: any) {
          const errorMessage = error.message?.toLowerCase() || ''
          
          // Check if it's a "too large" error
          if (errorMessage.includes('too large') || errorMessage.includes('too long')) {
            console.log(`Content too large at ${(truncationPercentage * 100).toFixed(0)}%, trying with less content`)
            // Reduce by 20% each time
            truncationPercentage -= 0.2
            
            if (truncationPercentage < minTruncation) {
              // We've tried enough, give up
              throw new Error('Content is too large even after maximum truncation. Try a different page or shorter article.')
            }
            // Continue the loop to try again with truncated content
          } else {
            // Some other error, don't retry
            throw error
          }
        }
      }

      // Clean up
      summarizer.destroy()

      if (!summary) {
        throw new Error('Failed to generate summary')
      }

      return `Summary of "${extracted.title}":\n\n${summary}`
    } catch (error: any) {
      console.error('Summarizer API error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Summarizer API error: ${error.message}`)
    }
  },
  
  // Translator API tool
  translateText: async (params: any) => {
    const { text, sourceLanguage, targetLanguage } = params
    
    if (!text) {
      throw new Error('Text parameter is required')
    }
    if (!sourceLanguage || !targetLanguage) {
      throw new Error('Both sourceLanguage and targetLanguage are required')
    }
    
    // Check if Translator API is available
    if (!('Translator' in self)) {
      throw new WriterAPIUnavailableError('Translator API is not available in this browser')
    }
    
    try {
      // Check availability for this language pair
      const availability = await (self as any).Translator.availability({
        sourceLanguage,
        targetLanguage
      })
      
      if (availability === 'no') {
        throw new WriterAPIUnavailableError(`Translation from ${sourceLanguage} to ${targetLanguage} is not supported`)
      }
      
      // Create translator (will download if needed)
      let translator
      if (availability === 'available') {
        // Ready to use immediately
        translator = await (self as any).Translator.create({
          sourceLanguage,
          targetLanguage
        })
      } else if (availability === 'downloadable') {
        // Model needs to be downloaded - this requires user gesture which we have
        console.log(`Translator model needs download for ${sourceLanguage} → ${targetLanguage}`)
        translator = await (self as any).Translator.create({
          sourceLanguage,
          targetLanguage,
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`Translator downloading: ${(e.loaded * 100).toFixed(0)}%`)
            })
          }
        })
      } else {
        throw new WriterAPIUnavailableError(`Translation availability status unknown: ${availability}`)
      }
      
      // Translate the text
      const result = await translator.translate(text)
      
      // Clean up
      translator.destroy?.()
      
      return result
    } catch (error: any) {
      console.error('Translator API error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Translator API error: ${error.message}`)
    }
  },
  
  // Language Detector API tool
  detectLanguage: async (params: any) => {
    const { text } = params
    
    if (!text) {
      throw new Error('Text parameter is required')
    }
    
    // Check if Language Detector API is available
    if (!('LanguageDetector' in self)) {
      throw new WriterAPIUnavailableError('Language Detector API is not available in this browser')
    }
    
    try {
      // Check availability
      const availability = await (self as any).LanguageDetector.availability()
      
      if (availability === 'no') {
        throw new WriterAPIUnavailableError('Language Detector model is not available')
      }
      
      // Create detector (will download if needed)
      let detector
      if (availability === 'available') {
        // Ready to use immediately
        detector = await (self as any).LanguageDetector.create()
      } else if (availability === 'downloadable') {
        // Model needs to be downloaded - this requires user gesture which we have
        console.log('Language Detector model needs download')
        detector = await (self as any).LanguageDetector.create({
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`Language Detector downloading: ${(e.loaded * 100).toFixed(0)}%`)
            })
          }
        })
      } else {
        throw new WriterAPIUnavailableError(`Language Detector availability status unknown: ${availability}`)
      }
      
      // Detect language
      const results = await detector.detect(text)
      
      // Clean up
      detector.destroy?.()
      
      // Return top result with all candidates as a formatted string
      if (results && results.length > 0) {
        const topResult = results[0]
        const topLanguage = topResult.detectedLanguage
        const topConfidence = (topResult.confidence * 100).toFixed(1)
        
        // Format alternative detections if available
        const alternatives = results.slice(1, 5).map((r: any) => 
          `${r.detectedLanguage} (${(r.confidence * 100).toFixed(1)}%)`
        ).join(', ')
        
        let result = `Detected language: ${topLanguage} (${topConfidence}% confidence)`
        if (alternatives) {
          result += `\nAlternatives: ${alternatives}`
        }
        
        return result
      }
      
      throw new Error('No language detected')
    } catch (error: any) {
      console.error('Language Detector API error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Language Detector API error: ${error.message}`)
    }
  },
  
  // Writer API tool
  writeContent: async (params: any) => {
    const { task, context, tone = 'neutral', length = 'medium', format = 'plain-text' } = params
    
    // Check if Writer API is available
    if (!('Writer' in self)) {
      throw new WriterAPIUnavailableError('Writer API is not available in this browser')
    }
    
    try {
      // Check availability
      const availability = await (self as any).Writer.availability()
      
      if (availability === 'unavailable') {
        throw new WriterAPIUnavailableError('Writer API model is not available')
      }
      
      // Create writer with options
      const options: any = {
        tone,
        length,
        format
      }
      
      let writer
      if (availability === 'available') {
        // Writer API can be used immediately
        writer = await (self as any).Writer.create(options)
      } else {
        // Model needs to be downloaded
        writer = await (self as any).Writer.create({
          ...options,
          monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => {
              console.log(`Writer API downloading: ${(e.loaded * 100).toFixed(0)}%`)
            })
          }
        })
      }
      
      // Generate content (non-streaming for now)
      const result = await writer.write(task, context ? { context } : undefined)
      
      // Clean up
      writer.destroy()
      
      return result
    } catch (error: any) {
      console.error('Writer API error:', error)
      if (error instanceof WriterAPIUnavailableError) {
        throw error
      }
      throw new Error(`Writer API error: ${error.message}`)
    }
  }
}

export async function executeUITool(toolCall: ToolCall): Promise<any> {
  console.log('=== EXECUTING IN UI CONTEXT ===')
  console.log('Has user activation:', (navigator as any).userActivation?.isActive)
  console.log('Window object:', typeof window)
  console.log('Chrome runtime:', chrome.runtime.id)
  console.log('Tool:', toolCall.function)
  console.log('================================')
  
  const handler = TOOL_IMPLEMENTATIONS[toolCall.function]
  
  if (!handler) {
    const { findSimilarTools } = require('./tool-registry')
    const similarTools = findSimilarTools(toolCall.function)
    let errorMessage = `UI tool ${toolCall.function} not implemented in ui-tools.ts`
    
    if (similarTools.length > 0) {
      errorMessage += `\n\nDid you mean one of these?\n- ${similarTools.join('\n- ')}`
    }
    
    return { success: false, error: errorMessage }
  }
  
  try {
    const result = await handler(toolCall.arguments)
    console.log('UI tool result:', result)
    
    // Wrap raw results in expected format
    return { 
      success: true, 
      result: result 
    }
  } catch (error: any) {
    console.error('UI tool error:', error)
    return { 
      success: false, 
      error: error.message 
    }
  }
}

// Validate at runtime that all UI tools from registry are implemented
export function validateUITools(): void {
  const uiToolSpecs = getUITools()
  const missing = uiToolSpecs.filter(spec => !TOOL_IMPLEMENTATIONS[spec.name])
  
  if (missing.length > 0) {
    console.error('❌ Missing UI tool implementations:', missing.map(t => t.name))
    console.error('Add these to ui-tools.ts TOOL_IMPLEMENTATIONS')
  } else {
    console.log('✅ All UI tools implemented:', uiToolSpecs.map(t => t.name))
  }
}
