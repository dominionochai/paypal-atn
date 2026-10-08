// Tool Registry - Aggregates tool specs from individual tool modules
import { spec as captureScreenshotSpec } from './tools/captureScreenshot'
import { spec as getPageTitleSpec } from './tools/getPageTitle'
import { spec as openTabSpec } from './tools/openTab'
import { spec as getAccessibilitySnapshotSpec } from './tools/getAccessibilitySnapshot'
import { spec as clickElementSpec } from './tools/clickElement'
import { spec as fillInputSpec } from './tools/fillInput'
import { spec as findElementsSpec } from './tools/findElements'
import { spec as listenSpec } from './tools/listen'
import { spec as writeContentSpec } from './tools/writeContent'
import { spec as storeMemorySpec } from './tools/storeMemory'
// getMemories removed - memories are now injected directly into system prompt
// import { spec as getMemoriesSpec } from './tools/getMemories'
import { spec as translateTextSpec } from './tools/translateText'
import { spec as detectLanguageSpec } from './tools/detectLanguage'
import { spec as scrollUpSpec } from './tools/scrollUp'
import { spec as scrollDownSpec } from './tools/scrollDown'
import { spec as pressKeySpec } from './tools/pressKey'
import { spec as highlightSelectorSpec } from './tools/highlightSelector'
import { spec as highlightTextSpec } from './tools/highlightText'
import { spec as captureCurrentPageSpec } from './tools/captureCurrentPage'
import { spec as searchVaultSpec } from './tools/searchVault'
import { spec as getVaultStatsSpec } from './tools/getVaultStats'
import { spec as getPlaybookSpec } from './tools/getPlaybook'
import { spec as thinkSpec } from './tools/think'
import { spec as summarizePageSpec } from './tools/summarizePage'
import { spec as getTabsSpec } from './tools/getTabs'
import { spec as switchTabSpec } from './tools/switchTab'

export interface ToolParameter {
  name: string
  type: string
  description: string
  required: boolean
}

export interface ToolSpec {
  name: string
  description: string
  parameters: ToolParameter[]
  examples: string[]
  spokenLine: string  // What AI says when executing this tool
  requiresUserGesture?: boolean  // If true, must be called from UI context
}

// Automatically aggregated from tool modules
export const TOOL_REGISTRY: ToolSpec[] = [
  thinkSpec,
  captureScreenshotSpec,
  getPageTitleSpec,
  openTabSpec,
  getAccessibilitySnapshotSpec,
  findElementsSpec,
  clickElementSpec,
  fillInputSpec,
  listenSpec,
  writeContentSpec,
  summarizePageSpec,
  storeMemorySpec,
  // getMemoriesSpec, // Removed - memories now injected directly into system prompt
  translateTextSpec,
  detectLanguageSpec,
  scrollUpSpec,
  scrollDownSpec,
  pressKeySpec,
  highlightSelectorSpec,
  highlightTextSpec,
  captureCurrentPageSpec,
  searchVaultSpec,
  getVaultStatsSpec,
  getPlaybookSpec,
  getTabsSpec,
  switchTabSpec
]

// Generate formatted tool documentation for specific tools
export function generateToolDocumentation(toolNames?: string[]): string {
  const { generateToolDocumentation: genDocs } = require('./tool-docs')
  return genDocs(TOOL_REGISTRY, toolNames)
}

// Get list of tool names for quick reference
export function getToolNames(): string[] {
  return TOOL_REGISTRY.map(tool => tool.name)
}

// Validate if a tool exists
export function isValidTool(toolName: string): boolean {
  return TOOL_REGISTRY.some(tool => tool.name === toolName)
}

// Get tool spec by name
export function getToolSpec(toolName: string): ToolSpec | undefined {
  return TOOL_REGISTRY.find(tool => tool.name === toolName)
}

// Check if tool requires user gesture
export function requiresUserGesture(toolName: string): boolean {
  const spec = getToolSpec(toolName)
  return spec?.requiresUserGesture || false
}

// Get all tools that require user gesture
export function getUITools(): ToolSpec[] {
  return TOOL_REGISTRY.filter(tool => tool.requiresUserGesture)
}

// Get spoken line for a tool with parameter substitution
export function getSpokenLine(toolName: string, params?: Record<string, any>): string {
  const spec = getToolSpec(toolName)
  if (!spec) {
    return toolName // fallback to tool name if spec not found
  }
  
  let spokenLine = spec.spokenLine
  
  // Replace parameters in the spoken line (e.g., {url}, {query}, {value})
  if (params) {
    Object.keys(params).forEach(key => {
      const placeholder = `{${key}}`
      if (spokenLine.includes(placeholder)) {
        // For URLs, extract just the domain
        if (key === 'url') {
          try {
            const url = new URL(params[key])
            spokenLine = spokenLine.replace(placeholder, url.hostname)
          } catch {
            spokenLine = spokenLine.replace(placeholder, params[key])
          }
        } else {
          // For other params, just replace with value
          spokenLine = spokenLine.replace(placeholder, params[key])
        }
      }
    })
  }
  
  return spokenLine
}

// Calculate Levenshtein distance between two strings
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []
  
  // Initialize first column and row
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }
  
  // Fill in the rest of the matrix
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }
  
  return matrix[str2.length][str1.length]
}

// Find similar tool names using fuzzy matching
export function findSimilarTools(invalidToolName: string, maxSuggestions: number = 3): string[] {
  const toolNames = getToolNames()
  const lowerInvalid = invalidToolName.toLowerCase()
  
  // Calculate similarity scores for all tools
  const scores = toolNames.map(toolName => {
    const lowerTool = toolName.toLowerCase()
    
    // Check if invalid name is substring (high priority)
    const substringMatch = lowerTool.includes(lowerInvalid) || lowerInvalid.includes(lowerTool)
    
    // Calculate Levenshtein distance
    const distance = levenshteinDistance(lowerInvalid, lowerTool)
    
    // Calculate similarity score (lower is better)
    // Substring matches get bonus
    const score = substringMatch ? distance - 100 : distance
    
    return { toolName, score }
  })
  
  // Sort by score (ascending) and return top matches
  return scores
    .sort((a, b) => a.score - b.score)
    .slice(0, maxSuggestions)
    .filter(item => item.score < lowerInvalid.length * 1.5) // Only suggest if reasonably similar
    .map(item => item.toolName)
}
