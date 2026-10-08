import type { ToolSpec } from '../tool-registry'
import { generateEmbedding, cosineSimilarity } from '../embeddings'

async function getAccessibilitySnapshot(params: any) {
  try {
    const { query } = params // Optional semantic search query
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      return { success: false, error: 'No active tab found' }
    }

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Extract interactive elements with accessibility info
        const elements: any[] = []
        let index = 0
        
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
            // For inputs, look for associated label
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
          
          // Create unique selector
          const dataAttr = `data-marionette-${index}`
          htmlEl.setAttribute(dataAttr, 'true')
          
          // Truncate long text
          const displayName = accessibleName.length > 80 
            ? accessibleName.substring(0, 77) + '...'
            : accessibleName
          
          elements.push({
            index,
            role,
            name: displayName,
            tagName: htmlEl.tagName.toLowerCase(),
            selector: `[${dataAttr}]`,
            type: htmlEl instanceof HTMLInputElement ? htmlEl.type : null,
            href: htmlEl instanceof HTMLAnchorElement ? htmlEl.href : null,
            disabled: htmlEl.hasAttribute('disabled')
          })
          
          index++
        })
        
        return elements
      }
    })

    const elements = result[0]?.result || []
    
    if (elements.length === 0) {
      return {
        success: true,
        result: 'No interactive elements found on this page.'
      }
    }
    
    let filteredElements = elements
    let wasFiltered = false
    let filterMethod = 'none'
    
    const MAX_ELEMENTS_TO_SHOW = 50
    
    // Use semantic filtering if query is provided
    if (query && typeof query === 'string') {
      try {
        console.log('[getAccessibilitySnapshot] Using semantic filtering with query:', query)
        
        // Generate query embedding
        const queryEmbedding = await generateEmbedding(query)
        
        // Generate embeddings for each element (combine role + name for context)
        const elementsWithSimilarity = await Promise.all(
          elements.map(async (el: any) => {
            const elementText = `${el.role} ${el.name}`.trim()
            const embedding = await generateEmbedding(elementText)
            const similarity = cosineSimilarity(queryEmbedding, embedding)
            return { ...el, similarity }
          })
        )
        
        // Sort by similarity and take top results
        elementsWithSimilarity.sort((a, b) => b.similarity - a.similarity)
        filteredElements = elementsWithSimilarity.slice(0, MAX_ELEMENTS_TO_SHOW)
        wasFiltered = true
        filterMethod = 'semantic'
        
        console.log('[getAccessibilitySnapshot] Filtered to top', filteredElements.length, 'elements by semantic similarity')
      } catch (embError) {
        console.warn('[getAccessibilitySnapshot] Semantic filtering failed:', embError)
        // Fall through to importance-based filtering
      }
    }
    
    // If still too many elements (no query or semantic failed), use importance-based filtering
    if (filteredElements.length > MAX_ELEMENTS_TO_SHOW) {
      console.log('[getAccessibilitySnapshot] Too many elements, filtering by importance...')
      
      // Score elements by importance
      const elementsWithScores = filteredElements.map((el: any) => {
        let score = 0
        
        // Prefer buttons and submit buttons (most interactive)
        if (el.role === 'button') score += 10
        if (el.type === 'submit') score += 15
        
        // Prefer form inputs
        if (el.role === 'textbox') score += 8
        if (el.role === 'combobox') score += 8
        
        // Prefer links with meaningful text
        if (el.role === 'link' && el.name.length > 3) score += 5
        
        // Prefer elements with descriptive names
        if (el.name.length > 5) score += 3
        if (el.name.length > 20) score += 2
        
        // Penalize empty or generic names
        if (!el.name || el.name.length === 0) score -= 5
        if (['×', '☰', '≡', '•'].includes(el.name)) score -= 3
        
        // Prefer common action words
        const actionWords = ['submit', 'send', 'save', 'login', 'sign', 'search', 'next', 'back', 'cancel', 'delete', 'add', 'create']
        if (actionWords.some(word => el.name.toLowerCase().includes(word))) score += 5
        
        return { ...el, importanceScore: score }
      })
      
      // Sort by importance and take top elements
      elementsWithScores.sort((a, b) => b.importanceScore - a.importanceScore)
      filteredElements = elementsWithScores.slice(0, MAX_ELEMENTS_TO_SHOW)
      wasFiltered = true
      filterMethod = 'importance'
      
      console.log('[getAccessibilitySnapshot] Filtered to top', filteredElements.length, 'elements by importance')
    }
    
    // Format as readable text
    let output = ''
    if (filterMethod === 'semantic') {
      output = `Found ${elements.length} elements, filtered to top ${filteredElements.length} by semantic relevance to "${query}":\n\n`
    } else if (filterMethod === 'importance') {
      output = `Found ${elements.length} elements, showing top ${filteredElements.length} most important:\n\n`
    } else {
      output = `Found ${filteredElements.length} interactive elements:\n\n`
    }
    
    filteredElements.forEach((el: any) => {
      const disabled = el.disabled ? ' [DISABLED]' : ''
      const type = el.type ? ` (type: ${el.type})` : ''
      const href = el.href ? ` (${el.href})` : ''
      const similarity = el.similarity ? ` [${(el.similarity * 100).toFixed(0)}% match]` : ''
      
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
  name: 'getAccessibilitySnapshot',
  description: 'Gets a list of interactive elements on the current page. Automatically filters to top 50 most important elements on complex pages. Use query parameter for semantic filtering.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Optional: Semantic search query to filter elements (e.g., "submit button", "login form", "email input")',
      required: false
    }
  ],
  spokenLine: "Let me see what's on this page",
  examples: [
    'User: "what can I click on this page?" → getAccessibilitySnapshot',
    'User: "show me the buttons" → getAccessibilitySnapshot',
    'User: "list all links" → getAccessibilitySnapshot',
    'Find specific elements → getAccessibilitySnapshot with query: "submit button"'
  ]
}

export default getAccessibilitySnapshot
