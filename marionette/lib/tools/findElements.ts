import type { ToolSpec } from '../tool-registry'
import { generateEmbedding, cosineSimilarity } from '../embeddings'

async function findElements(params: { query: string }) {
  try {
    if (!params.query) {
      return { success: false, error: 'Query string is required' }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const elements: any[] = []
        let globalIndex = 0
        
        const interactiveSelectors = [
          'button',
          'a[href]',
          'input',
          'textarea',
          'select',
          '[role="button"]',
          '[role="link"]',
          '[role="textbox"]',
          '[tabindex]:not([tabindex="-1"])',
          '[onclick]'
        ]
        
        const allElements = document.querySelectorAll(interactiveSelectors.join(','))
        
        allElements.forEach((el) => {
          const htmlEl = el as HTMLElement
          
          // Skip hidden or non-visible elements
          const style = window.getComputedStyle(htmlEl)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return
          }
          
          // Skip elements with zero size (dummy/hidden elements)
          const rect = htmlEl.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) {
            return
          }
          
          // Skip elements far offscreen (more than 10000px away)
          if (rect.top < -10000 || rect.left < -10000) {
            return
          }
          
          // Compute accessible name
          let accessibleName = ''
          if (htmlEl.hasAttribute('aria-label')) {
            accessibleName = htmlEl.getAttribute('aria-label') || ''
          } else if (htmlEl.hasAttribute('aria-labelledby')) {
            const labelId = htmlEl.getAttribute('aria-labelledby')
            const labelEl = labelId ? document.getElementById(labelId) : null
            accessibleName = labelEl?.textContent?.trim() || ''
          } else if (htmlEl instanceof HTMLInputElement || htmlEl instanceof HTMLTextAreaElement) {
            const label = htmlEl.labels?.[0]
            accessibleName = label?.textContent?.trim() || htmlEl.placeholder || ''
          } else {
            accessibleName = htmlEl.textContent?.trim() || ''
          }
          
          // Get role
          let role = htmlEl.getAttribute('role') || ''
          if (!role) {
            const tagName = htmlEl.tagName.toLowerCase()
            if (tagName === 'button') role = 'button'
            else if (tagName === 'a') role = 'link'
            else if (tagName === 'input') {
              const type = (htmlEl as HTMLInputElement).type
              role = type === 'submit' ? 'button' : 'textbox'
            }
            else if (tagName === 'textarea') role = 'textbox'
            else if (tagName === 'select') role = 'combobox'
          }
          
          // Tag element (we'll filter semantically later)
          const dataAttr = `data-marionette-${globalIndex}`
          htmlEl.setAttribute(dataAttr, 'true')
          
          // Truncate long text
          const displayName = accessibleName.length > 80 
            ? accessibleName.substring(0, 77) + '...'
            : accessibleName
          
          elements.push({
            index: globalIndex,
            role,
            name: displayName,
            tagName: htmlEl.tagName.toLowerCase(),
            selector: `[${dataAttr}]`,
            type: htmlEl instanceof HTMLInputElement ? htmlEl.type : null,
            href: htmlEl instanceof HTMLAnchorElement ? htmlEl.href : null,
            disabled: htmlEl.hasAttribute('disabled')
          })
          
          globalIndex++
        })
        
        return elements
      }
    })

    const elements = result[0]?.result || []
    
    if (elements.length === 0) {
      return {
        success: true,
        result: `No interactive elements found on this page.`
      }
    }
    
    // Use semantic embeddings to filter and rank elements
    console.log('[findElements] Using semantic filtering with query:', params.query)
    
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(params.query)
    
    // Filter out elements with no meaningful text/name
    const meaningfulElements = elements.filter((el: any) => {
      const hasText = el.name && el.name.trim().length > 0
      const isNotJustSymbol = el.name && el.name.length > 1 || el.name && !/^[×☰≡•]$/.test(el.name)
      return hasText && isNotJustSymbol
    })
    
    if (meaningfulElements.length === 0) {
      return {
        success: true,
        result: `No elements with text found matching "${params.query}". Try a different query.`
      }
    }
    
    // Generate embeddings for each element and calculate similarity
    const elementsWithSimilarity = await Promise.all(
      meaningfulElements.map(async (el: any) => {
        const elementText = `${el.role} ${el.name}`.trim()
        const embedding = await generateEmbedding(elementText)
        const similarity = cosineSimilarity(queryEmbedding, embedding)
        return { ...el, similarity }
      })
    )
    
    // Sort by similarity (best matches first)
    elementsWithSimilarity.sort((a, b) => b.similarity - a.similarity)
    
    // Take top 10 most relevant results
    const topElements = elementsWithSimilarity.slice(0, 10)
    
    console.log('[findElements] Filtered to top', topElements.length, 'elements by semantic similarity')
    
    if (topElements.length === 0) {
      return {
        success: true,
        result: `No elements found matching "${params.query}".`
      }
    }
    
    // Format as readable text
    let output = `Found ${elements.length} elements (${meaningfulElements.length} with text), showing top ${topElements.length} matches for "${params.query}":\n\n`
    
    topElements.forEach((el: any) => {
      const disabled = el.disabled ? ' [DISABLED]' : ''
      const type = el.type ? ` (type: ${el.type})` : ''
      const href = el.href ? ` (${el.href})` : ''
      const similarity = ` [${(el.similarity * 100).toFixed(0)}% match]`
      
      output += `[${el.index}] ${el.role.toUpperCase()}: "${el.name}"${type}${href}${disabled}${similarity}\n`
    })
    
    return { 
      success: true, 
      result: output
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'findElements',
  description: 'Finds UI elements (buttons, inputs, links) on the page using semantic search. Returns top 10 most relevant matches ranked by similarity. Use natural language to describe what you\'re looking for.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Natural language description of the element you\'re looking for (e.g., "first video", "submit button", "email input", "login link")',
      required: true
    }
  ],
  spokenLine: "Looking for {query}",
  examples: [
    'User: "click the submit button" → findElements with query: "submit button"',
    'User: "click first video" → findElements with query: "video" to find video links',
    'User: "search for AI podcasts" → findElements with query: "search box" (NOT "ai podcasts"), then fillInput with "AI podcasts"',
    'User: "type my email" → findElements with query: "email input"'
  ]
}

export default findElements
