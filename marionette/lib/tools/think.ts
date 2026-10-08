// think tool - Allow agent to explicitly reason before taking action
import type { ToolSpec } from '../tool-registry'

async function think(params: any) {
  try {
    const { reasoning } = params
    
    if (!reasoning) {
      return { success: false, error: 'Reasoning is required' }
    }
    
    // Just log and return - this is for agent's explicit reasoning
    console.log('[Agent Reasoning]:', reasoning)
    
    return {
      success: true,
      result: 'Reasoning acknowledged. Now proceed with executing your plan using the appropriate tools.'
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'think',
  description: 'OPTIONAL: State your reasoning before complex tasks. For simple tasks, skip this and execute directly.',
  parameters: [
    {
      name: 'reasoning',
      type: 'string',
      description: 'Your step-by-step reasoning and planned approach',
      required: true
    }
  ],
  examples: [
    'User: "what\'s on this page?" → Just call captureScreenshot (no need to think first)',
    'User: "fill out this form" → <function_call>{"function": "getPlaybook", "arguments": {"id": "fill-form"}}</function_call> then follow instructions',
    'User: "click submit" → Just call findElements and clickElement (no need to think first)'
  ],
  spokenLine: 'Thinking...'
}

export default think
