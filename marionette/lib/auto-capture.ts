// Auto-capture system - Intelligently captures pages for the vault
import { storePageInVault } from './vault'

// Domains to skip (social media, utilities, etc.)
const SKIP_DOMAINS = [
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'linkedin.com',
  'reddit.com',
  'youtube.com',
  'gmail.com',
  'mail.google.com',
  'calendar.google.com',
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'meet.google.com',
  'zoom.us',
  'slack.com',
  'discord.com',
  'messenger.com',
  'whatsapp.com',
  'netflix.com',
  'spotify.com',
  'twitch.tv'
]

// URL patterns to skip
const SKIP_PATTERNS = [
  /login/i,
  /signin/i,
  /signup/i,
  /register/i,
  /auth/i,
  /checkout/i,
  /cart/i,
  /payment/i,
  /settings/i,
  /account/i,
  /profile\/edit/i,
  /admin/i
]

// Check if URL should be captured
function shouldCapture(url: string): boolean {
  try {
    const urlObj = new URL(url)
    
    // Skip chrome:// and extension pages
    if (url.startsWith('chrome://') || 
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:')) {
      return false
    }
    
    // Skip file:// URLs
    if (url.startsWith('file://')) {
      return false
    }
    
    // Check domain blocklist
    const domain = urlObj.hostname.replace('www.', '')
    if (SKIP_DOMAINS.some(blocked => domain.includes(blocked))) {
      console.log('[AutoCapture] Skipping blocked domain:', domain)
      return false
    }
    
    // Check URL patterns
    if (SKIP_PATTERNS.some(pattern => pattern.test(url))) {
      console.log('[AutoCapture] Skipping blocked URL pattern:', url)
      return false
    }
    
    // Skip search pages
    if (urlObj.hostname.includes('google.') && urlObj.pathname.includes('/search')) {
      return false
    }
    
    return true
  } catch (error) {
    console.error('[AutoCapture] Error checking URL:', error)
    return false
  }
}

// Check if we recently captured this URL
const recentlyCaptured = new Set<string>()
const CAPTURE_COOLDOWN = 24 * 60 * 60 * 1000 // 24 hours

function wasRecentlyCaptured(url: string): boolean {
  // Normalize URL (remove query params and fragments for deduplication)
  try {
    const urlObj = new URL(url)
    const normalizedUrl = `${urlObj.origin}${urlObj.pathname}`
    
    if (recentlyCaptured.has(normalizedUrl)) {
      return true
    }
    
    // Add to recent set
    recentlyCaptured.add(normalizedUrl)
    
    // Clean up old entries after some time
    setTimeout(() => {
      recentlyCaptured.delete(normalizedUrl)
    }, CAPTURE_COOLDOWN)
    
    return false
  } catch (error) {
    return true // If URL parsing fails, skip it
  }
}

// Extract content from a tab
async function extractContent(tabId: number): Promise<{
  success: boolean
  title?: string
  content?: string
  excerpt?: string
  error?: string
}> {
  try {
    // Inject Readability
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['assets/Readability.js']
    })
    
    // Extract content
    const results = await chrome.scripting.executeScript({
      target: { tabId },
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
          
          // Clone document for Readability
          const documentClone = document.cloneNode(true) as Document
          
          // @ts-ignore
          const reader = new Readability(documentClone, {
            keepClasses: false,
            charThreshold: 100
          })
          
          const article = reader.parse()
          
          if (!article) {
            // Fallback
            const mainElement = document.querySelector('main, article, [role="main"], #content')
            const fallbackContent = mainElement 
              ? (mainElement as HTMLElement).innerText 
              : document.body.innerText
            
            if (!fallbackContent || fallbackContent.length < 100) {
              return { success: false, error: 'Insufficient content' }
            }
            
            const contentWithStructured = fallbackContent.replace(/\s+/g, ' ').trim() + structuredData.join('')
            
            return {
              success: true,
              title: document.title,
              content: contentWithStructured,
              excerpt: fallbackContent.slice(0, 200) + '...'
            }
          }
          
          // Clean content and append structured data
          let cleanContent = article.textContent.replace(/\s+/g, ' ').trim()
          cleanContent += structuredData.join('')
          
          if (cleanContent.length < 100) {
            return { success: false, error: 'Content too short' }
          }
          
          return {
            success: true,
            title: article.title || document.title,
            content: cleanContent,
            excerpt: article.excerpt || cleanContent.slice(0, 200) + '...'
          }
        } catch (error: any) {
          return { success: false, error: error.message }
        }
      }
    })
    
    if (!results || !results[0] || !results[0].result) {
      return { success: false, error: 'No result' }
    }
    
    return results[0].result
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// Auto-capture a page
export async function autoCapturePage(tabId: number, url: string): Promise<void> {
  try {
    // Check if we should capture
    if (!shouldCapture(url)) {
      return
    }
    
    // Check if recently captured
    if (wasRecentlyCaptured(url)) {
      console.log('[AutoCapture] Skipping recently captured URL:', url)
      return
    }
    
    console.log('[AutoCapture] Capturing:', url)
    
    // Extract content
    const extracted = await extractContent(tabId)
    
    if (!extracted.success || !extracted.content) {
      console.log('[AutoCapture] Skipping - extraction failed:', extracted.error)
      return
    }
    
    // Extract domain
    const urlObj = new URL(url)
    const domain = urlObj.hostname
    
    // Word count
    const words = extracted.content.split(/\s+/).filter(w => w.length > 0)
    const wordCount = words.length
    
    // Skip if too short
    if (wordCount < 50) {
      console.log('[AutoCapture] Skipping - too short:', wordCount, 'words')
      return
    }
    
    // Store in vault
    await storePageInVault({
      url,
      title: extracted.title || 'Untitled',
      content: extracted.content.slice(0, 5000),
      excerpt: extracted.excerpt || '',
      domain,
      wordCount
    })
    
    console.log('[AutoCapture] Successfully captured:', extracted.title)
  } catch (error) {
    console.error('[AutoCapture] Error:', error)
    // Silent failure - don't bother the user
  }
}
