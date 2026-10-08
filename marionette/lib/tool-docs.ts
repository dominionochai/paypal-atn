// Tool documentation utilities (separated to avoid circular dependencies)

// Tool call format syntax (shared across system prompt and playbooks)
export const TOOL_FORMAT = `## Format

ALWAYS use: <function_call>{"function": "toolName", "arguments": {...}}</function_call>

NOT: <tool_call>, code blocks, or backticks. Empty args: {}`

// Generate formatted tool documentation for specific tools
export function generateToolDocumentation(toolRegistry: any[], toolNames?: string[]): string {
  let doc = ''
  
  const tools = toolNames 
    ? toolRegistry.filter(tool => toolNames.includes(tool.name))
    : toolRegistry
  
  for (const tool of tools) {
    doc += `### ${tool.name}\n\n`
    doc += `${tool.description}\n\n`
    
    if (tool.parameters.length > 0) {
      doc += '**Parameters:**\n'
      for (const param of tool.parameters) {
        const requiredTag = param.required ? '(required)' : '(optional)'
        doc += `- \`${param.name}\` (${param.type}) ${requiredTag}: ${param.description}\n`
      }
      doc += '\n'
    } else {
      doc += '**Parameters:** None\n\n'
    }
    
    if (tool.examples.length > 0) {
      doc += '**Usage Examples:**\n'
      for (const example of tool.examples) {
        doc += `- ${example}\n`
      }
      doc += '\n'
    }
  }
  
  return doc
}
