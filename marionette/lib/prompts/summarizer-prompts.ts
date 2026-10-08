// Prompts for conversation summarization

export const SUMMARIZER_SHARED_CONTEXT = 'This is a conversation between a user and an AI browser automation assistant'

export const SUMMARIZER_CONTEXT_PROMPT = 
  'Create a concise summary focusing on: ' +
  '1) What task the user originally requested (e.g., "fill this form"), ' +
  '2) What specific actions the AI has already completed with exact details: ' +
  '   - List EACH form field that was filled with its index number and value (e.g., "Filled [12] First Name: John", "Filled [13] Last Name: Smith") ' +
  '   - Include which buttons were clicked, which pages were opened, etc. ' +
  '3) What data the user has provided that hasn\'t been filled yet (list the exact values for each remaining field), ' +
  '4) What fields remain to be filled (list field names with their index numbers from the accessibility snapshot), ' +
  '5) What the IMMEDIATE next action should be (e.g., "Call fillInput for index 14 with email value"). ' +
  'CRITICAL: Preserve ALL field indices, names, and user-provided values. Include the complete list of remaining fillInput calls needed.'

export function formatSummaryMessage(summary: string): string {
  return `[CONTEXT SUMMARIZED - Previous conversation]\n\n${summary}\n\n---\n\nIMPORTANT: You are in the middle of a task. Based on the summary above:
- IMMEDIATELY execute the next fillInput call with the exact index and value from the summary
- DO NOT call think again
- DO NOT ask for confirmation  
- DO NOT ask the user to repeat information they already provided
- DO NOT restart the task from the beginning
- Just make the next fillInput call right now, then continue with the remaining fields
- After all fields are filled, ask if user wants to submit

Example: If summary says "Next: fill [14] Email with user@example.com", immediately call:
<function_call>{"function": "fillInput", "arguments": {"index": 14, "value": "user@example.com"}}</function_call>`
}
