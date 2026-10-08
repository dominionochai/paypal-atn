// getPlaybook tool - Retrieve a specific playbook by ID
import type { ToolSpec } from '../tool-registry'
import { getPlaybookById } from '../playbooks'
import { generateToolDocumentation, TOOL_FORMAT } from '../tool-docs'

async function getPlaybook(params: any) {
  try {
    const { id } = params
    
    if (!id) {
      return { success: false, error: 'Playbook ID is required' }
    }
    
    const playbook = getPlaybookById(id)
    
    if (!playbook) {
      return { success: false, error: `Playbook not found: ${id}` }
    }
    
    // Lazy load TOOL_REGISTRY to avoid circular dependency
    const { TOOL_REGISTRY } = require('../tool-registry')
    
    // Generate tool documentation for required tools
    const toolDocs = generateToolDocumentation(TOOL_REGISTRY, playbook.requiredTools)
    
    // Combine playbook content + tool definitions + format
    const fullPlaybook = `${playbook.contents}

## Tools for this workflow

${toolDocs}

${TOOL_FORMAT}`
    
    return {
      success: true,
      result: fullPlaybook
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export const spec: ToolSpec = {
  name: 'getPlaybook',
  description: 'Retrieve step-by-step instructions for complex workflows. The playbook will tell you exactly which tools to call and in what order.',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: 'The playbook ID (e.g., "send-email", "fill-form")',
      required: true
    }
  ],
  examples: [
    'User: "send email" → <function_call>{"function": "getPlaybook", "arguments": {"id": "send-email"}}</function_call>',
    'User: "fill this form" → <function_call>{"function": "getPlaybook", "arguments": {"id": "fill-form"}}</function_call>',
    'User: "listen to this video" → <function_call>{"function": "getPlaybook", "arguments": {"id": "listen-audio"}}</function_call>'
  ],
  spokenLine: 'Getting workflow instructions'
}

export default getPlaybook
