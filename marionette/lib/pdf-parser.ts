// PDF text extraction using pdf.js
// Use legacy build for browser extensions
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// Load worker from assets folder (manually copied)
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('assets/pdf.worker.min.mjs')

/**
 * Extract text content from a PDF file
 * @param file - PDF file to extract text from
 * @returns Extracted text content
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    console.log('[PDF Parser] Extracting text from:', file.name)
    
    // Read file as array buffer
    const arrayBuffer = await file.arrayBuffer()
    
    // Load PDF document with worker disabled for browser extension compatibility
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true
    })
    const pdf = await loadingTask.promise
    
    console.log('[PDF Parser] PDF loaded, pages:', pdf.numPages)
    
    // Extract text from all pages
    const textPromises: Promise<string>[] = []
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      textPromises.push(extractPageText(pdf, pageNum))
    }
    
    const pageTexts = await Promise.all(textPromises)
    const fullText = pageTexts.join('\n\n')
    
    console.log('[PDF Parser] Extracted', fullText.length, 'characters')
    
    return fullText
  } catch (error) {
    console.error('[PDF Parser] Error extracting text:', error)
    throw new Error(`Failed to extract text from PDF: ${error.message}`)
  }
}

/**
 * Extract text from a single PDF page
 */
async function extractPageText(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<string> {
  const page = await pdf.getPage(pageNum)
  const textContent = await page.getTextContent()
  
  // Combine text items with spaces
  const pageText = textContent.items
    .map((item: any) => item.str)
    .join(' ')
    .trim()
  
  return pageText
}

/**
 * Get metadata from PDF file
 */
export async function getPDFMetadata(file: File): Promise<{
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
  pageCount: number
}> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true
    })
    const pdf = await loadingTask.promise
    
    const metadata = await pdf.getMetadata()
    const info = metadata.info as any // Type assertion for PDF metadata
    
    return {
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject,
      keywords: info?.Keywords,
      creator: info?.Creator,
      producer: info?.Producer,
      creationDate: info?.CreationDate,
      modificationDate: info?.ModDate,
      pageCount: pdf.numPages
    }
  } catch (error) {
    console.error('[PDF Parser] Error getting metadata:', error)
    throw error
  }
}

