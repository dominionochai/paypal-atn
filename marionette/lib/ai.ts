// Simple AI module
import { TOOL_REGISTRY } from './tool-registry'
import { getSystemPrompt } from './prompts/system-prompt'
import { E2E_TEST_CONFIG } from './e2e-config'

let aiSession: any = null
let currentController: AbortController | null = null
let filledSystemPrompt: string | null = null
let isFirstPrompt = true

async function ensureSession() {
  if (!aiSession) {
    const availability = await (window as any).LanguageModel.availability()
    if (availability === 'unavailable') {
      throw new Error('AI model unavailable')
    }
    
    // Fill template with runtime values (now async to load memories)
    const prompt = await getSystemPrompt()
    
    // Store the filled prompt for debugging
    filledSystemPrompt = prompt
    
    console.log('System prompt loaded with', TOOL_REGISTRY.length, 'tools')

    aiSession = await (window as any).LanguageModel.create({
      initialPrompts: [{ role: 'system', content: prompt }],
      expectedInputs: [{ type: 'text' }, { type: 'image' }, { type: 'audio' }]
    })
  }
}

export async function streamResponse(
  message: string, 
  onChunk: (chunk: string) => void, 
  toolResult?: any,
  onWarmingUp?: () => void,
  onWarmupComplete?: () => void
): Promise<number> {
  await ensureSession()
  
  // Notify warmup if this is the first prompt (the actual slow part)
  if (isFirstPrompt && onWarmingUp && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
    console.log('[AI] First prompt - model warming up...')
    onWarmingUp()
  }
  
  currentController = new AbortController()
  
  let promptInput: any = message
  
  if (toolResult) {
    // Check if tool result is an image (data URL)
    if (typeof toolResult === 'string' && toolResult.startsWith('data:image/')) {
      // Convert data URL to blob for multimodal input
      const response = await fetch(toolResult)
      const blob = await response.blob()

      promptInput = [{
        role: 'user',
        content: [
          { type: 'text', value: `${message}\n\nHere's the screenshot:` },
          { type: 'image', value: blob }
        ]
      }]
    }
    // Check if tool result is audio (data URL)
    else if (typeof toolResult === 'string' && toolResult.startsWith('data:audio/')) {
      // Convert data URL to blob for multimodal input
      const response = await fetch(toolResult)
      const blob = await response.blob()

      promptInput = [{
        role: 'user',
        content: [
          { type: 'text', value: `${message}\n\nHere's the audio recording:` },
          { type: 'audio', value: blob }
        ]
      }]
    } else {
      promptInput = `${message}\n\nTool result: ${toolResult}`
    }
  }
  
  const stream = aiSession.promptStreaming(promptInput, { signal: currentController.signal })
  
  let firstChunk = true
  for await (const chunk of stream) {
    // Notify warmup complete on first token
    if (firstChunk && isFirstPrompt && onWarmupComplete && !E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
      console.log('[AI] Model warmup complete - first token received')
      onWarmupComplete()
      isFirstPrompt = false
      firstChunk = false
    } else if (firstChunk && isFirstPrompt && E2E_TEST_CONFIG.SKIP_WARMUP_PHASE) {
      // Skip warmup callbacks but still mark first prompt as done
      isFirstPrompt = false
      firstChunk = false
    }
    onChunk(chunk)
  }
  
  currentController = null
  
  // Return context count after completion
  console.log('DEBUG: Stream completed, checking token usage')
  console.log('DEBUG: aiSession.inputUsage after completion:', aiSession.inputUsage)
  console.log('DEBUG: aiSession.inputQuota after completion:', aiSession.inputQuota)
  
  return aiSession.inputUsage || 0
}

export function interrupt() {
  if (currentController) {
    currentController.abort()
    currentController = null
  }
}

export function getTokenUsage() {
  console.log('DEBUG: getTokenUsage called')
  console.log('DEBUG: aiSession exists:', !!aiSession)
  
  if (!aiSession) {
    console.log('DEBUG: No session, returning 0')
    return { usage: 0, quota: 9216 }
  }
  
  console.log('DEBUG: aiSession.inputUsage:', aiSession.inputUsage)
  console.log('DEBUG: aiSession.inputQuota:', aiSession.inputQuota)
  
  return {
    usage: aiSession.inputUsage || 0,
    quota: aiSession.inputQuota || 9216
  }
}

export function destroySession() {
  if (aiSession) {
    aiSession.destroy()
    aiSession = null
  }
  filledSystemPrompt = null
  // Reset first prompt flag so next prompt will trigger warmup
  isFirstPrompt = true
}

export function getFilledSystemPrompt(): string | null {
  return filledSystemPrompt
}
