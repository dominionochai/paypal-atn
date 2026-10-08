/**
 * UI Test Runner
 * 
 * Executes automated UI test cases defined in e2e-config.ts
 */

import { E2E_TEST_CONFIG } from './e2e-config'

interface TestContext {
  [key: string]: any
}

interface TestState {
  testCase: any
  currentStep: number
  context: TestContext
  waitingForToolResult: boolean
  lastToolCall?: string
  lastStepDelay?: number
}

// Track active test state
let activeTestState: TestState | null = null

/**
 * Check if user input triggers a test case
 * If yes, initialize the test state
 */
export function checkForTestTrigger(userInput: string): boolean {
  if (!E2E_TEST_CONFIG.ENABLE_UI_TEST_MODE) {
    return false
  }

  // Find matching test case
  const testCase = E2E_TEST_CONFIG.UI_TEST_CASES.find(
    tc => tc.trigger.toLowerCase() === userInput.toLowerCase()
  )

  if (testCase) {
    console.log(`[UI Test] Triggering test: ${testCase.testId}`)
    activeTestState = {
      testCase,
      currentStep: 0,
      context: {},
      waitingForToolResult: false
    }
    return true
  }

  return false
}

/**
 * Get the next response chunk from the active test
 * This simulates LLM streaming by returning tool calls or text responses
 * Returns null when test is complete
 */
export function getNextTestChunk(toolResult?: any): string | null {
  if (!activeTestState) {
    return null
  }

  const { testCase, currentStep, context, waitingForToolResult } = activeTestState

  // If we were waiting for a tool result, process it
  if (waitingForToolResult && toolResult) {
    console.log('[UI Test] Processing tool result')
    
    // Find the step that triggered this tool
    const step = testCase.testSteps[currentStep]
    if (step.type === 'call_tool' && step.saveAs) {
      context[step.saveAs] = toolResult.result || toolResult.message || ''
      console.log(`[UI Test] Saved result as '${step.saveAs}'`)
    }
    
    activeTestState.waitingForToolResult = false
    activeTestState.currentStep++
  }

  // Process steps until we hit a tool call or response
  while (activeTestState.currentStep < testCase.testSteps.length) {
    const step = testCase.testSteps[activeTestState.currentStep]
    console.log(`[UI Test] Step ${activeTestState.currentStep + 1}: ${step.type}`)

    switch (step.type) {
      case 'call_tool': {
        const args = resolveVariables(step.args, context)
        const argsJson = JSON.stringify(args)
        const toolCall = `<function_call>{"function": "${step.tool}", "arguments": ${argsJson}}</function_call>`
        
        console.log('[UI Test] Emitting tool call:', toolCall)
        activeTestState.waitingForToolResult = true
        activeTestState.lastToolCall = step.tool
        activeTestState.lastStepDelay = (step as any).delayAfter || 0
        return toolCall
      }

      case 'extract_data': {
        const sourceData = context[step.source]
        if (sourceData) {
          for (const [key, pattern] of Object.entries(step.patterns)) {
            const match = (pattern as any).regex.exec(sourceData)
            if (match && match[(pattern as any).captureGroup]) {
              context[key] = parseInt(match[(pattern as any).captureGroup])
              console.log(`[UI Test] Extracted ${key}:`, context[key])
            }
          }
        }
        activeTestState.lastStepDelay = (step as any).delayAfter || 0
        activeTestState.currentStep++
        continue
      }

      case 'respond': {
        console.log('[UI Test] Emitting response:', step.message)
        activeTestState.lastStepDelay = (step as any).delayAfter || 0
        activeTestState.currentStep++
        return step.message
      }

      case 'wait_for_input': {
        // Test is complete, waiting for user
        console.log('[UI Test] Test complete, waiting for user input')
        activeTestState = null // Clear test state
        return null
      }

      default:
        console.warn(`[UI Test] Unknown step type:`, (step as any).type)
        activeTestState.currentStep++
    }
  }

  // Test complete
  console.log('[UI Test] Test sequence complete')
  activeTestState = null
  return null
}

/**
 * Get the delay configured for the last step
 */
export function getTestStepDelay(): number {
  if (!activeTestState) {
    return 1200
  }
  return activeTestState.lastStepDelay || 1200
}

/**
 * Replace variable placeholders like {varName} with actual values from context
 */
function resolveVariables(obj: any, context: TestContext): any {
  if (typeof obj === 'string') {
    // Replace {varName} with context value
    return obj.replace(/\{(\w+)\}/g, (match, varName) => {
      return context[varName] !== undefined ? context[varName] : match
    })
  } else if (typeof obj === 'number') {
    return obj
  } else if (Array.isArray(obj)) {
    return obj.map(item => resolveVariables(item, context))
  } else if (obj && typeof obj === 'object') {
    const resolved: any = {}
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveVariables(value, context)
    }
    return resolved
  }
  return obj
}

