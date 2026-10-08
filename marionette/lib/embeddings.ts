// Embedding utilities for semantic search
import { pipeline, env } from '@xenova/transformers'

// Configure Transformers.js for browser extension
env.allowLocalModels = false
env.backends.onnx.wasm.numThreads = 1
env.backends.onnx.wasm.proxy = false

// Singleton pipeline to avoid re-loading model
let embedderPipeline: any = null

// Initialize the embedding model
async function getEmbedder() {
  if (!embedderPipeline) {
    console.log('[Embeddings] Loading model...')
    embedderPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    )
    console.log('[Embeddings] Model loaded!')
  }
  return embedderPipeline
}

// Generate embedding for text
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const embedder = await getEmbedder()
    const output = await embedder(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data as Float32Array)
  } catch (error) {
    console.error('[Embeddings] Error generating embedding:', error)
    throw error
  }
}

// Calculate cosine similarity between two embeddings
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions')
  }
  
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  
  return dotProduct / (magnitudeA * magnitudeB)
}

// Find most similar memories to a query
export async function findSimilarMemories(
  queryText: string,
  memories: any[],
  limit: number = 5,
  threshold: number = 0.3
): Promise<Array<{ memory: any; similarity: number }>> {
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(queryText)
    
    // Filter memories that have embeddings
    const memoriesWithEmbeddings = memories.filter(m => m.embedding && Array.isArray(m.embedding))
    
    if (memoriesWithEmbeddings.length === 0) {
      console.log('[Embeddings] No memories with embeddings found')
      return []
    }
    
    // Calculate similarity for each memory
    const results = memoriesWithEmbeddings.map(memory => ({
      memory,
      similarity: cosineSimilarity(queryEmbedding, memory.embedding)
    }))
    
    // Sort by similarity (highest first)
    results.sort((a, b) => b.similarity - a.similarity)
    
    // Filter by threshold and limit
    return results
      .filter(r => r.similarity >= threshold)
      .slice(0, limit)
  } catch (error) {
    console.error('[Embeddings] Error finding similar memories:', error)
    throw error
  }
}
