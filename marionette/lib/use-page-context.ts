import { useState, useEffect } from 'react'

interface PageContext {
  title: string
  url: string
  domain: string
  contextString: string
  memories: string
}

// Retrieve and format all stored memories
async function getAllMemories(): Promise<string> {
  try {
    const storage = await chrome.storage.local.get(['agent_memories'])
    const memories = storage.agent_memories || []
    
    if (memories.length === 0) {
      return ''
    }
    
    // Sort by timestamp (most recent first)
    const sortedMemories = memories.sort((a: any, b: any) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
    
    // Format memories concisely for AI context
    const memoryList = sortedMemories
      .slice(0, 10) // Only include top 10 most recent
      .map((m: any) => m.content)
      .join('; ')
    
    return memoryList ? `User info: ${memoryList}. ` : ''
  } catch (error) {
    console.error('[usePageContext] Error loading memories:', error)
    return ''
  }
}

// Hook to get current page context for AI APIs
export const usePageContext = () => {
  const [context, setContext] = useState<PageContext>({
    title: '',
    url: '',
    domain: '',
    contextString: '',
    memories: ''
  })

  useEffect(() => {
    const updateContext = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        
        if (!tab || !tab.url) {
          setContext({
            title: '',
            url: '',
            domain: '',
            contextString: '',
            memories: ''
          })
          return
        }
        
        // Skip chrome:// and extension pages
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
          setContext({
            title: tab.title || '',
            url: tab.url,
            domain: '',
            contextString: '',
            memories: ''
          })
          return
        }
        
        const title = tab.title || 'Untitled'
        let domain = ''
        try {
          const urlObj = new URL(tab.url)
          domain = urlObj.hostname
        } catch {
          domain = ''
        }
        
        // Get user memories
        const memories = await getAllMemories()
        
        // Build rich context string
        let contextString = `Current page: "${title}" on ${domain}. `
        
        // Add page type context
        if (domain.includes('google.com')) {
          contextString += 'This is Google Search. '
        } else if (domain.includes('youtube.com')) {
          contextString += 'This is YouTube. '
        } else if (domain.includes('github.com')) {
          contextString += 'This is GitHub. '
        } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
          contextString += 'This is Twitter/X. '
        } else if (domain.includes('linkedin.com')) {
          contextString += 'This is LinkedIn. '
        } else if (domain.includes('reddit.com')) {
          contextString += 'This is Reddit. '
        } else if (domain.includes('amazon.com')) {
          contextString += 'This is Amazon. '
        } else if (domain.includes('facebook.com')) {
          contextString += 'This is Facebook. '
        } else if (domain.includes('instagram.com')) {
          contextString += 'This is Instagram. '
        }
        
        // Add memories to context
        contextString += memories
        
        setContext({
          title,
          url: tab.url,
          domain,
          contextString,
          memories
        })
      } catch (error) {
        console.error('[usePageContext] Error getting page context:', error)
        setContext({
          title: '',
          url: '',
          domain: '',
          contextString: '',
          memories: ''
        })
      }
    }

    updateContext()

    // Listen for tab changes
    const handleTabUpdate = () => {
      updateContext()
    }

    chrome.tabs.onActivated.addListener(handleTabUpdate)
    chrome.tabs.onUpdated.addListener(handleTabUpdate)

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabUpdate)
      chrome.tabs.onUpdated.removeListener(handleTabUpdate)
    }
  }, [])

  return context
}

// Standalone function for non-hook contexts
export async function getPageContext(): Promise<string> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    
    if (!tab || !tab.url) {
      return ''
    }
    
    // Skip chrome:// and extension pages
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
      return ''
    }
    
    const title = tab.title || 'Untitled'
    let domain = ''
    try {
      const urlObj = new URL(tab.url)
      domain = urlObj.hostname
    } catch {
      domain = ''
    }
    
    // Get user memories
    const memories = await getAllMemories()
    
    // Build rich context string with more details
    let contextString = `Current page: "${title}" on ${domain}. `
    
    // Add page type context
    if (domain.includes('google.com')) {
      contextString += 'This is Google Search. '
    } else if (domain.includes('youtube.com')) {
      contextString += 'This is YouTube. '
    } else if (domain.includes('github.com')) {
      contextString += 'This is GitHub. '
    } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
      contextString += 'This is Twitter/X. '
    } else if (domain.includes('linkedin.com')) {
      contextString += 'This is LinkedIn. '
    } else if (domain.includes('reddit.com')) {
      contextString += 'This is Reddit. '
    } else if (domain.includes('amazon.com')) {
      contextString += 'This is Amazon. '
    } else if (domain.includes('facebook.com')) {
      contextString += 'This is Facebook. '
    } else if (domain.includes('instagram.com')) {
      contextString += 'This is Instagram. '
    }
    
    // Add memories to context
    contextString += memories
    
    return contextString
  } catch (error) {
    console.error('[getPageContext] Error getting page context:', error)
    return ''
  }
}

