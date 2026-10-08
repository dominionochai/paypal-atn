// Minimal Transformers.js test
import { pipeline, env } from '@xenova/transformers'

// Disable local model loading - use CDN instead
env.allowLocalModels = false

// Disable workers to avoid CSP issues in browser extension
// This makes it run on main thread, which is fine for small models
env.backends.onnx.wasm.numThreads = 1
env.backends.onnx.wasm.proxy = false

// Test function to generate embeddings
export async function testEmbeddings(text: string = "Hello world") {
  try {
    console.log('[Transformers] Starting test...')
    console.log('[Transformers] Creating embedding pipeline...')
    
    // Use a very small model for testing
    // all-MiniLM-L6-v2 is ~23MB, good balance of size/quality
    const embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    )
    
    console.log('[Transformers] Model loaded! Generating embedding...')
    
    // Generate embedding
    const output = await embedder(text, { pooling: 'mean', normalize: true })
    
    // Convert to regular array
    const embedding = Array.from(output.data as Float32Array)
    
    console.log('[Transformers] Success!')
    console.log('[Transformers] Text:', text)
    console.log('[Transformers] Embedding dimensions:', embedding.length)
    console.log('[Transformers] First 10 values:', embedding.slice(0, 10))
    
    return {
      success: true,
      text,
      embedding,
      dimensions: embedding.length
    }
  } catch (error: any) {
    console.error('[Transformers] Error:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// Test cosine similarity between two texts
export async function testSimilarity(text1: string, text2: string) {
  try {
    console.log('[Transformers] Testing similarity...')
    
    const embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    )
    
    // Generate embeddings
    const output1 = await embedder(text1, { pooling: 'mean', normalize: true })
    const output2 = await embedder(text2, { pooling: 'mean', normalize: true })
    
    const emb1 = Array.from(output1.data as Float32Array)
    const emb2 = Array.from(output2.data as Float32Array)
    
    // Calculate cosine similarity
    const similarity = cosineSimilarity(emb1, emb2)
    
    console.log('[Transformers] Text 1:', text1)
    console.log('[Transformers] Text 2:', text2)
    console.log('[Transformers] Similarity:', similarity)
    
    return {
      success: true,
      text1,
      text2,
      similarity
    }
  } catch (error: any) {
    console.error('[Transformers] Error:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

// Helper: Calculate cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))
  return dotProduct / (magnitudeA * magnitudeB)
}
