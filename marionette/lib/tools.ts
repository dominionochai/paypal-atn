// Tool execution module
export interface ToolCall {
  function: string
  arguments: Record<string, any>
}

export function detectInvalidToolFormat(content: string): string | null {
  // Only check for print() syntax - we'll handle code blocks in parseToolCall
  if (/print\s*\(/.test(content) && /get|click|fill|open/i.test(content)) {
    return 'Invalid format detected: print() syntax - must use <function_call> format'
  }
  return null
}

export function parseToolCall(content: string): ToolCall | null {
  console.log('[parseToolCall] Checking content length:', content.length)
  console.log('[parseToolCall] Content preview:', content.substring(0, 300))
  console.log('[parseToolCall] Full content:', content)
  console.log('[parseToolCall] Contains <function_call>?', content.includes('<function_call>'))
  console.log('[parseToolCall] Contains </function_call>?', content.includes('</function_call>'))
  
  // Helper function to process and parse JSON
  const processAndParseJSON = (jsonStr: string): ToolCall | null => {
    try {
      jsonStr = jsonStr.trim()
      console.log('Original tool call JSON:', jsonStr)
      
      // Fix common AI mistakes
      // Replace {...} placeholder with {} (handles various spacing)
      jsonStr = jsonStr.replace(/"arguments"\s*:\s*\{\s*\.\.\.?\s*\}/g, '"arguments": {}')
      
      // Also handle case without quotes around ...
      jsonStr = jsonStr.replace(/"arguments"\s*:\s*\{\.\.\.?\}/g, '"arguments": {}')
      
      // If arguments is missing entirely, add empty object
      if (!jsonStr.includes('"arguments"')) {
        jsonStr = jsonStr.replace(/("function"\s*:\s*"[^"]+")/, '$1, "arguments": {}')
      }
      
      // FIX: AI often forgets the final closing brace
      // Count opening and closing braces
      const openBraces = (jsonStr.match(/\{/g) || []).length
      const closeBraces = (jsonStr.match(/\}/g) || []).length
      
      // Add missing closing braces
      if (openBraces > closeBraces) {
        const missing = openBraces - closeBraces
        jsonStr += '}'.repeat(missing)
        console.log('Added', missing, 'missing closing brace(s)')
      }
      
      console.log('Fixed tool call JSON:', jsonStr)
      
      // Parse and validate
      const parsed = JSON.parse(jsonStr)
      
      // Ensure arguments exists
      if (!parsed.arguments) {
        parsed.arguments = {}
      }
      
      console.log('Parsed tool call:', parsed)
      return parsed
    } catch (e) {
      console.error('[parseToolCall] Failed to parse JSON:', jsonStr, e)
      return null
    }
  }
  
  // First, strip code blocks if present
  // Handle formats like:
  // ```tool_code
  // <function_call>...</function_call>
  // ```
  let processedContent = content
  const codeBlockPattern = /```(?:tool_code|tool_call|function_call|json)\s*\n?(.*?)```/s
  const codeBlockMatch = processedContent.match(codeBlockPattern)
  if (codeBlockMatch) {
    console.log('[parseToolCall] Found code block wrapper, extracting content')
    processedContent = codeBlockMatch[1].trim()
  }
  
  // Try correct format: <function_call>
  if (processedContent.includes('<function_call>')) {
    console.log('[parseToolCall] Found <function_call> tag')
    const match = processedContent.match(/<function_call>(.*?)<\/function_call>/s)
    if (match) {
      console.log('[parseToolCall] Regex matched successfully')
      return processAndParseJSON(match[1])
    } else {
      console.warn('[parseToolCall] Found <function_call> but regex did not match')
    }
  }
  
  // Try malformed format with backticks: ```tool_call> or ```function_call>
  if (content.includes('```tool_call>') || content.includes('```function_call>')) {
    console.log('[parseToolCall] Found malformed backtick format')
    // Match: ```tool_call> or ```function_call> followed by JSON, ending with </function_call>
    const match = content.match(/```(?:tool_call|function_call)>(.*?)<\/function_call>/s)
    if (match) {
      console.log('[parseToolCall] Malformed format regex matched, extracting JSON')
      return processAndParseJSON(match[1])
    }
  }
  
  // Try raw JSON in code blocks (no <function_call> tags)
  // This handles format like: ```tool_code\n{"tool": "findElements", "arguments": {...}}\n```
  if (processedContent.trim().startsWith('{') && (processedContent.includes('"tool"') || processedContent.includes('"function"'))) {
    console.log('[parseToolCall] Found raw JSON format (possibly with "tool" instead of "function")')
    try {
      // Normalize "tool" to "function" if present
      let jsonStr = processedContent.trim()
      jsonStr = jsonStr.replace(/"tool"\s*:/g, '"function":')
      const result = processAndParseJSON(jsonStr)
      if (result) {
        console.log('[parseToolCall] Successfully parsed raw JSON format')
        return result
      }
    } catch (e) {
      console.warn('[parseToolCall] Failed to parse raw JSON format:', e)
    }
  }
  
  console.log('[parseToolCall] No valid tool call format found in content')
  return null
}

export async function executeTool(toolCall: ToolCall): Promise<any> {
  // Detect if we're in popup or sidepanel context
  const isPopup = window.location.pathname.includes('popup.html')
  const context = isPopup ? 'popup' : 'sidepanel'
  
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'run_tool',
      payload: {
        toolName: toolCall.function,
        parameters: toolCall.arguments,
        context: context
      }
    }, resolve)
  })
}
