// captureCurrentPage tool - Capture current page to vault
import type { ToolSpec } from '../tool-registry'
import { storePageInVault } from '../vault'

async function captureCurrentPage(params: any) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url) {
      return { success: false, error: 'No active tab found' }
    }

    // Skip certain URLs
    if (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:')) {
      return { success: false, error: 'Cannot capture this type of page' }
    }

    console.log('[captureCurrentPage] Capturing:', tab.url)

    // First inject Readability.js library
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['assets/Readability.js']
    })

    // Then run the extraction with Readability
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          // Clone the document so Readability doesn't destroy the page
          const documentClone = document.cloneNode(true) as Document
          
          // @ts-ignore - Readability will be available globally
          const reader = new Readability(documentClone, {
            keepClasses: false,
            charThreshold: 100
          })
          
          const article = reader.parse()
          
          if (!article) {
            // Fallback: simple text extraction
            const mainElement = document.querySelector('main, article, [role="main"], #content')
            const fallbackContent = mainElement 
              ? (mainElement as HTMLElement).innerText 
              : document.body.innerText
            
            if (!fallbackContent || fallbackContent.length < 100) {
              return {
                success: false,
                error: 'Could not extract meaningful content from this page'
              }
            }
            
            return {
              success: true,
              title: document.title,
              content: fallbackContent.slice(0, 5000),
              excerpt: fallbackContent.slice(0, 200) + '...',
              url: document.location.href
            }
          }
          
          // Clean and validate content
          let cleanContent = article.textContent
          cleanContent = cleanContent.replace(/\s+/g, ' ').trim()
          
          if (cleanContent.length < 100) {
            return {
              success: false,
              error: 'Extracted content is too short (less than 100 characters)'
            }
          }
          
          return {
            success: true,
            title: article.title || document.title,
            content: cleanContent,
            excerpt: article.excerpt || cleanContent.slice(0, 200) + '...',
            url: document.location.href
          }
        } catch (error: any) {
          // Ultimate fallback: just grab text
          try {
            let text = document.body.innerText || document.body.textContent || ''
            
            // Clean whitespace aggressively
            text = text.replace(/\s+/g, ' ').trim()
            
            if (text.length < 100) {
              return {
                success: false,
                error: 'Page has insufficient text content (less than 100 characters after cleaning)'
              }
            }
            
            return {
              success: true,
              title: document.title,
              content: text.slice(0, 5000),
              excerpt: text.slice(0, 200) + '...',
              url: document.location.href
            }
          } catch (fallbackError: any) {
            return {
              success: false,
              error: `Failed to extract content: ${error.message}`
            }
          }
        }
      }
    })

    if (!results || !results[0] || !results[0].result) {
      return { success: false, error: 'Failed to extract page content' }
    }

    const extracted = results[0].result
    
    // Check if extraction was successful
    if (!extracted.success) {
      return { success: false, error: extracted.error || 'Failed to parse page' }
    }
    
    const content = extracted.content || ''
    
    if (!content || content.length < 100) {
      return { success: false, error: 'Page content too short or empty (min 100 characters)' }
    }

    // Extract domain
    const url = new URL(tab.url)
    const domain = url.hostname

    // Word count
    const words = content.split(/\s+/).filter(w => w.length > 0)
    const wordCount = words.length

    // Create excerpt
    const excerpt = extracted.excerpt || content.slice(0, 200).trim() + (content.length > 200 ? '...' : '')

    // Store in vault (will generate embedding)
    console.log('[captureCurrentPage] Storing in vault...')
    console.log('[captureCurrentPage] Content to store:', content.length, 'chars')
    console.log('[captureCurrentPage] Content includes "Trump"?', content.includes('Trump'))
    console.log('[captureCurrentPage] Full content preview:', content.slice(0, 500))
    
    const id = await storePageInVault({
      url: tab.url,
      title: extracted.title || tab.title || 'Untitled',
      content: content.slice(0, 5000), // Max 5k chars for embedding
      excerpt,
      domain,
      wordCount
    })

    return {
      success: true,
      result: `Page captured successfully!\n\nTitle: ${extracted.title}\nURL: ${tab.url}\nWords: ${wordCount}\nID: ${id}`,
      id,
      title: extracted.title,
      wordCount
    }
  } catch (error: any) {
    console.error('[captureCurrentPage] Error:', error)
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'captureCurrentPage',
  description: 'Captures the current web page to the vault with AI embeddings for semantic search. Extracts main content and stores it for later retrieval.',
  parameters: [],
  examples: [
    'User: "save this page" → captureCurrentPage',
    'User: "remember this article" → captureCurrentPage',
    'After user finds interesting content → captureCurrentPage'
  ],
  spokenLine: 'Capturing page to vault'
}

export default captureCurrentPage
