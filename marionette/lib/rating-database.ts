// Rating database - IndexedDB storage for ratings with chat context
const DB_NAME = 'marionette_ratings'
const DB_VERSION = 1
const STORE_NAME = 'ratings'

export interface RatingEntry {
  id: string // timestamp-based ID
  messageId: string // ID of the rated message
  rating: 'up' | 'down'
  chatContext: string // Full conversation context at time of rating
  timestamp: number
  systemPrompt?: string // System prompt at time of rating
}

// Initialize IndexedDB
async function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      
      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        
        // Create indexes for querying
        store.createIndex('timestamp', 'timestamp', { unique: false })
        store.createIndex('rating', 'rating', { unique: false })
        store.createIndex('messageId', 'messageId', { unique: false })
      }
    }
  })
}

// Store a rating with chat context
export async function storeRating(entry: Omit<RatingEntry, 'id' | 'timestamp'>): Promise<string> {
  try {
    console.log('[Rating DB] Storing rating:', entry.rating)
    console.log('[Rating DB] Message ID:', entry.messageId)
    console.log('[Rating DB] Context length:', entry.chatContext.length)
    
    // Create full entry
    const fullEntry: RatingEntry = {
      ...entry,
      id: Date.now().toString(),
      timestamp: Date.now()
    }
    
    // Store in IndexedDB
    const db = await getDB()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    
    await new Promise<void>((resolve, reject) => {
      const request = store.add(fullEntry)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    
    console.log('[Rating DB] Rating stored:', fullEntry.id)
    return fullEntry.id
  } catch (error) {
    console.error('[Rating DB] Error storing rating:', error)
    throw error
  }
}

// Get all ratings
export async function getAllRatings(): Promise<RatingEntry[]> {
  try {
    const db = await getDB()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    
    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('[Rating DB] Error getting ratings:', error)
    return []
  }
}

// Get ratings by type (up or down)
export async function getRatingsByType(rating: 'up' | 'down'): Promise<RatingEntry[]> {
  try {
    const db = await getDB()
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const index = store.index('rating')
    
    return new Promise((resolve, reject) => {
      const request = index.getAll(rating)
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.error('[Rating DB] Error getting ratings by type:', error)
    return []
  }
}

// Get rating statistics
export async function getRatingStats(): Promise<{ total: number; positive: number; negative: number }> {
  try {
    const allRatings = await getAllRatings()
    const positive = allRatings.filter(r => r.rating === 'up').length
    const negative = allRatings.filter(r => r.rating === 'down').length
    
    return {
      total: allRatings.length,
      positive,
      negative
    }
  } catch (error) {
    console.error('[Rating DB] Error getting rating stats:', error)
    return { total: 0, positive: 0, negative: 0 }
  }
}

// Delete a rating
export async function deleteRating(id: string): Promise<void> {
  try {
    const db = await getDB()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(id)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    
    console.log('[Rating DB] Rating deleted:', id)
  } catch (error) {
    console.error('[Rating DB] Error deleting rating:', error)
    throw error
  }
}

// Clear all ratings
export async function clearAllRatings(): Promise<void> {
  try {
    const db = await getDB()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    
    await new Promise<void>((resolve, reject) => {
      const request = store.clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    
    console.log('[Rating DB] All ratings cleared')
  } catch (error) {
    console.error('[Rating DB] Error clearing ratings:', error)
    throw error
  }
}

// Export rating data as JSON
export async function exportRatings(): Promise<string> {
  try {
    const ratings = await getAllRatings()
    return JSON.stringify(ratings, null, 2)
  } catch (error) {
    console.error('[Rating DB] Error exporting ratings:', error)
    return '[]'
  }
}

