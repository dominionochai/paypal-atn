// File embedding system - handles different file types and stores in vault
import { storePageInVault, type VaultEntry } from './vault'
import { extractTextFromPDF, getPDFMetadata } from './pdf-parser'

export interface EmbedFileResult {
  id: string
  fileName: string
  fileType: string
  wordCount: number
  success: boolean
  error?: string
}

/**
 * Supported file types for embedding
 */
export const SUPPORTED_FILE_TYPES = {
  'application/pdf': { extension: 'pdf', name: 'PDF Document' },
  'text/plain': { extension: 'txt', name: 'Text File' },
  'text/markdown': { extension: 'md', name: 'Markdown File' },
  'text/html': { extension: 'html', name: 'HTML File' },
  'application/json': { extension: 'json', name: 'JSON File' }
} as const

/**
 * Check if file type is supported
 */
export function isSupportedFileType(mimeType: string): boolean {
  return mimeType in SUPPORTED_FILE_TYPES
}

/**
 * Get file type display name
 */
export function getFileTypeName(mimeType: string): string {
  return SUPPORTED_FILE_TYPES[mimeType as keyof typeof SUPPORTED_FILE_TYPES]?.name || 'Unknown'
}

/**
 * Extract text from file based on type
 */
async function extractTextFromFile(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    return extractTextFromPDF(file)
  } else if (file.type.startsWith('text/') || file.type === 'application/json') {
    return file.text()
  } else {
    throw new Error(`Unsupported file type: ${file.type}`)
  }
}

/**
 * Get title from file - use PDF metadata if available
 */
async function getFileTitle(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    try {
      const metadata = await getPDFMetadata(file)
      if (metadata.title) {
        return metadata.title
      }
    } catch (error) {
      console.warn('[File Embedder] Could not get PDF metadata:', error)
    }
  }
  
  // Fall back to file name without extension
  return file.name.replace(/\.[^/.]+$/, '')
}

/**
 * Embed a file into the vault
 * @param file - File to embed
 * @returns Result with page ID and metadata
 */
export async function embedFile(file: File): Promise<EmbedFileResult> {
  try {
    console.log('[File Embedder] Embedding file:', file.name, file.type, file.size, 'bytes')
    
    // Check if file type is supported
    if (!isSupportedFileType(file.type)) {
      throw new Error(`File type not supported: ${file.type}. Supported types: PDF, TXT, MD, HTML, JSON`)
    }
    
    // Check file size (limit to 10MB)
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB (max 10MB)`)
    }
    
    // Extract text content
    const text = await extractTextFromFile(file)
    
    if (!text || text.trim().length === 0) {
      throw new Error('No text content found in file')
    }
    
    console.log('[File Embedder] Extracted', text.length, 'characters')
    
    // Get file title
    const title = await getFileTitle(file)
    
    // Calculate word count
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length
    
    // Store in vault with file metadata
    const pageId = await storePageInVault({
      url: `file://${file.name}`,
      title,
      content: text,
      excerpt: text.slice(0, 200),
      domain: 'local-files',
      wordCount,
      // Store additional file metadata in a custom field
      metadata: {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        lastModified: file.lastModified
      }
    } as any)
    
    console.log('[File Embedder] Successfully embedded file:', pageId)
    
    return {
      id: pageId,
      fileName: file.name,
      fileType: file.type,
      wordCount,
      success: true
    }
  } catch (error) {
    console.error('[File Embedder] Error embedding file:', error)
    
    return {
      id: '',
      fileName: file.name,
      fileType: file.type,
      wordCount: 0,
      success: false,
      error: error.message
    }
  }
}

/**
 * Embed multiple files
 * @param files - Array of files to embed
 * @param onProgress - Optional callback for progress updates
 */
export async function embedFiles(
  files: File[],
  onProgress?: (current: number, total: number, file: File) => void
): Promise<EmbedFileResult[]> {
  const results: EmbedFileResult[] = []
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    
    if (onProgress) {
      onProgress(i + 1, files.length, file)
    }
    
    const result = await embedFile(file)
    results.push(result)
  }
  
  return results
}

