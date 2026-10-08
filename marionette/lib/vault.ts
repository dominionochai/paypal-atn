// Vault system - IndexedDB storage for captured web pages
import { generateEmbedding, cosineSimilarity } from './embeddings'

const DB_NAME = 'marionette_vault'
const DB_VERSION = 2 // Incremented for chunks
const STORE_NAME = 'pages'
const CHUNKS_STORE_NAME = 'chunks'

export interface VaultEntry {
  id: string // timestamp-based ID
  url: string
  title: string
  content: string // cleaned text content
  excerpt: string // first 200 chars
  embedding: number[] // 384D vector for full content
  timestamp: number
  domain: string
  wordCount: number
  metadata?: {
    fileName?: string
    fileType?: string
    fileSize?: number
    lastModified?: number
  }
}

export interface ContentChunk {
  id: string // pageId-chunkIndex
  pageId: string
  content: string
  embedding: number[]
  chunkIndex: number
  startChar: number
  endChar: number
}

// Chunk text into overlapping segments for better semantic search
function chunkText(text: string, chunkSize: number = 500, overlap: number = 100): string[] {
  const chunks: string[] = []
  let start = 0
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    const chunk = text.slice(start, end).trim()
    
    if (chunk.length > 0) {
      chunks.push(chunk)
    }
    
    // Move forward by chunkSize - overlap
    start += chunkSize - overlap
    
    // Break if we've reached the end
    if (end === text.length) break
  }
  
  return chunks
}

// Initialize IndexedDB
async function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const oldVersion = event.oldVersion
      
      // Create pages store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('timestamp', 'timestamp', { unique: false })
        store.createIndex('domain', 'domain', { unique: false })
        store.createIndex('url', 'url', { unique: false })
      }
      
      // Create chunks store for version 2+
      if (oldVersion < 2 && !db.objectStoreNames.contains(CHUNKS_STORE_NAME)) {
        const chunksStore = db.createObjectStore(CHUNKS_STORE_NAME, { keyPath: 'id' })
        chunksStore.createIndex('pageId', 'pageId', { unique: false })
        chunksStore.createIndex('chunkIndex', 'chunkIndex', { unique: false })
      }
    }
  })
}

// Store a page in the vault
export async function storePageInVault(entry: Omit<VaultEntry, 'id' | 'timestamp' | 'embedding'>): Promise<string> {
  try {
    console.log('[Vault] Storing page:', entry.url)
    console.log('[Vault] Content length:', entry.content.length)
    
    // Generate embedding for full content
    const embedding = await generateEmbedding(entry.content)
    console.log('[Vault] Page embedding generated:', embedding.length, 'dimensions')
    
    // Create full entry
    const pageId = Date.now().toString()
    const fullEntry: VaultEntry = {
      ...entry,
      id: pageId,
      timestamp: Date.now(),
      embedding: Array.from(embedding)
    }
    
    // Chunk the content and generate embeddings
    console.log('[Vault] Chunking content...')
    const textChunks = chunkText(entry.content)
    console.log('[Vault] Created', textChunks.length, 'chunks')
    
    const chunks: ContentChunk[] = []
    let currentPos = 0
    
    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i]
      const chunkEmbedding = await generateEmbedding(chunkText)
      
      chunks.push({
        id: `${pageId}-${i}`,
        pageId,
        content: chunkText,
        embedding: Array.from(chunkEmbedding),
        chunkIndex: i,
        startChar: currentPos,
        endChar: currentPos + chunkText.length
      })
      
      // Update position (approximate)
      currentPos += chunkText.length
    }
    
    console.log('[Vault] Generated embeddings for', chunks.length, 'chunks')
    
    // Store page and chunks in IndexedDB
    const db = await getDB()
    const transaction = db.transaction([STORE_NAME, CHUNKS_STORE_NAME], 'readwrite')
    const pageStore = transaction.objectStore(STORE_NAME)
    const chunkStore = transaction.objectStore(CHUNKS_STORE_NAME)
    
    // Store page
    await new Promise<void>((resolve, reject) => {
      const request = pageStore.add(fullEntry)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    
    // Store chunks
    for (const chunk of chunks) {
      await new Promise<void>((resolve, reject) => {
        const request = chunkStore.add(chunk)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    }
    
    console.log('[Vault] Page stored:', pageId, 'with', chunks.length, 'chunks')
    return pageId
  } catch (error) {
    console.error('[Vault] Error storing page:', error)
    throw error
  }
}

// Search vault using semantic search with chunk-based retrieval
export async function searchVault(
  query: string, 
  limit: number = 10, 
  threshold: number = 0.3
): Promise<Array<VaultEntry & { similarity: number; relevantChunks: string[] }>> {
  try {
    console.log('[Vault] Searching for:', query)
    
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query)
    
    // Get all chunks from vault
    const db = await getDB()
    const transaction = db.transaction([STORE_NAME, CHUNKS_STORE_NAME], 'readonly')
    const pageStore = transaction.objectStore(STORE_NAME)
    const chunkStore = transaction.objectStore(CHUNKS_STORE_NAME)
    
    const pages = await new Promise<VaultEntry[]>((resolve, reject) => {
      const request = pageStore.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    const chunks = await new Promise<ContentChunk[]>((resolve, reject) => {
      const request = chunkStore.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    if (pages.length === 0) {
      console.log('[Vault] No pages found')
      return []
    }
    
    console.log('[Vault] Searching', chunks.length, 'chunks from', pages.length, 'pages')
    
    // Calculate similarity for each chunk
    const chunkResults = chunks.map(chunk => ({
      chunk,
      similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    
    // Filter by threshold and sort by similarity
    const relevantChunks = chunkResults
      .filter(r => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
    
    if (relevantChunks.length === 0) {
      console.log('[Vault] No chunks above threshold')
      return []
    }
    
    // Group chunks by page and get best chunks per page
    const pageChunkMap = new Map<string, Array<{ content: string; similarity: number }>>()
    
    for (const { chunk, similarity } of relevantChunks) {
      if (!pageChunkMap.has(chunk.pageId)) {
        pageChunkMap.set(chunk.pageId, [])
      }
      pageChunkMap.get(chunk.pageId)!.push({ content: chunk.content, similarity })
    }
    
    // Create results with relevant chunks
    const results = Array.from(pageChunkMap.entries()).map(([pageId, chunks]) => {
      const page = pages.find(p => p.id === pageId)!
      
      // Sort chunks by similarity and take top 2-3
      const topChunks = chunks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
      
      // Best similarity score for this page
      const bestSimilarity = topChunks[0].similarity
      
      return {
        ...page,
        similarity: bestSimilarity,
        relevantChunks: topChunks.map(c => c.content)
      }
    })
    
    // Sort pages by their best similarity score
    const filtered = results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
    
    console.log('[Vault] Found', filtered.length, 'pages with relevant chunks')
    filtered.forEach(r => {
      console.log(`  ${r.title.slice(0, 50)} - ${(r.similarity * 100).toFixed(1)}% (${r.relevantChunks.length} chunks)`)
    })
    
    return filtered
  } catch (error) {
    console.error('[Vault] Error searching vault:', error)
    throw error
  }
}

// Get vault statistics
export async function getVaultStats(): Promise<{
  count: number
  oldestEntry?: number
  newestEntry?: number
  domains: Record<string, number>
}> {
  try {
    const db = await getDB()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    
    const entries = await new Promise<VaultEntry[]>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    if (entries.length === 0) {
      return { count: 0, domains: {} }
    }
    
    // Calculate stats
    const timestamps = entries.map(e => e.timestamp)
    const domains: Record<string, number> = {}
    
    entries.forEach(e => {
      domains[e.domain] = (domains[e.domain] || 0) + 1
    })
    
    return {
      count: entries.length,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
      domains
    }
  } catch (error) {
    console.error('[Vault] Error getting stats:', error)
    throw error
  }
}

// Get all vault entries
export async function getAllVaultEntries(): Promise<VaultEntry[]> {
  try {
    const db = await getDB()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    
    const entries = await new Promise<VaultEntry[]>((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    // Sort by timestamp (newest first)
    return entries.sort((a, b) => b.timestamp - a.timestamp)
  } catch (error) {
    console.error('[Vault] Error getting all entries:', error)
    throw error
  }
}

// Delete a single vault entry and its chunks
export async function deleteVaultEntry(id: string): Promise<void> {
  try {
    console.log('[Vault] Deleting entry:', id)
    
    const db = await getDB()
    const transaction = db.transaction([STORE_NAME, CHUNKS_STORE_NAME], 'readwrite')
    const pageStore = transaction.objectStore(STORE_NAME)
    const chunkStore = transaction.objectStore(CHUNKS_STORE_NAME)
    
    // Delete page
    await new Promise<void>((resolve, reject) => {
      const request = pageStore.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    
    // Delete associated chunks
    const chunkIndex = chunkStore.index('pageId')
    const chunks = await new Promise<ContentChunk[]>((resolve, reject) => {
      const request = chunkIndex.getAll(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    await Promise.all(
      chunks.map(chunk =>
        new Promise<void>((resolve, reject) => {
          const request = chunkStore.delete(chunk.id)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      )
    )
    
    console.log('[Vault] Deleted entry and', chunks.length, 'chunks')
  } catch (error) {
    console.error('[Vault] Error deleting entry:', error)
    throw error
  }
}

// Clear entire vault
export async function clearVault(): Promise<void> {
  try {
    const db = await getDB()
    const transaction = db.transaction([STORE_NAME, CHUNKS_STORE_NAME], 'readwrite')
    const pageStore = transaction.objectStore(STORE_NAME)
    const chunkStore = transaction.objectStore(CHUNKS_STORE_NAME)
    
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const request = pageStore.clear()
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      }),
      new Promise<void>((resolve, reject) => {
        const request = chunkStore.clear()
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    ])
    
    console.log('[Vault] Cleared all pages and chunks')
  } catch (error) {
    console.error('[Vault] Error clearing vault:', error)
    throw error
  }
}

// Delete old entries (cleanup)
export async function cleanupVault(maxEntries: number = 100): Promise<number> {
  try {
    const db = await getDB()
    const transaction = db.transaction([STORE_NAME, CHUNKS_STORE_NAME], 'readwrite')
    const pageStore = transaction.objectStore(STORE_NAME)
    const chunkStore = transaction.objectStore(CHUNKS_STORE_NAME)
    const index = pageStore.index('timestamp')
    
    // Get all entries sorted by timestamp
    const entries = await new Promise<VaultEntry[]>((resolve, reject) => {
      const request = index.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    if (entries.length <= maxEntries) {
      return 0
    }
    
    // Sort by timestamp and get entries to delete
    entries.sort((a, b) => a.timestamp - b.timestamp)
    const toDelete = entries.slice(0, entries.length - maxEntries)
    const pageIdsToDelete = toDelete.map(e => e.id)
    
    // Delete pages
    await Promise.all(
      pageIdsToDelete.map(id => 
        new Promise<void>((resolve, reject) => {
          const request = pageStore.delete(id)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
      )
    )
    
    // Delete associated chunks
    const chunkIndex = chunkStore.index('pageId')
    for (const pageId of pageIdsToDelete) {
      const chunks = await new Promise<ContentChunk[]>((resolve, reject) => {
        const request = chunkIndex.getAll(pageId)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      
      await Promise.all(
        chunks.map(chunk =>
          new Promise<void>((resolve, reject) => {
            const request = chunkStore.delete(chunk.id)
            request.onsuccess = () => resolve()
            request.onerror = () => reject(request.error)
          })
        )
      )
    }
    
    console.log('[Vault] Cleaned up', toDelete.length, 'pages and their chunks')
    return toDelete.length
  } catch (error) {
    console.error('[Vault] Error cleaning up:', error)
    throw error
  }
}
