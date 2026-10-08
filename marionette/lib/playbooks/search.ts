import { type Playbook } from './types'

export const searchPlaybook: Playbook = {
  id: 'google-search',
  description: 'ONLY use to open Google.com from scratch. DO NOT use if user is already on a search site (YouTube, Amazon, etc.) - work with the current page instead',
  requiredTools: ['openTab', 'findElements', 'fillInput', 'clickElement', 'captureScreenshot'],
  contents: `## Google Search Workflow

You just retrieved this playbook. Now follow these steps using the tools listed below.

EXECUTE ONE STEP AT A TIME:

Step 1: <function_call>{"function": "openTab", "arguments": {"url": "https://www.google.com"}}</function_call>
→ Wait for result

Step 2: <function_call>{"function": "findElements", "arguments": {"query": "Search"}}</function_call>
→ Wait for result, you'll get something like "[6] COMBOBOX: Search"
→ Note the index number

Step 3: <function_call>{"function": "fillInput", "arguments": {"index": 6, "value": "USER_QUERY_HERE"}}</function_call>
→ Replace 6 with actual index from Step 2
→ Replace USER_QUERY_HERE with what the user wants to search for
→ Wait for result

Step 4: <function_call>{"function": "findElements", "arguments": {"query": "Google Search"}}</function_call>
→ Wait for result to find the search button
→ Note the index number

Step 5: <function_call>{"function": "clickElement", "arguments": {"index": INDEX_FROM_STEP_4}}</function_call>
→ Replace INDEX_FROM_STEP_4 with actual index
→ Wait for result

Step 6: <function_call>{"function": "captureScreenshot", "arguments": {}}</function_call>
→ Wait for result

Step 7: Read the screenshot and describe the search results to the user → DONE

IMPORTANT:
- Do NOT call a tool named "google-search" - that doesn't exist!
- Call ONE tool at a time and wait for each result
- Use ACTUAL index numbers from findElements results, not placeholders
- If Step 2 fails, try query "textarea" instead of "Search"`
}
