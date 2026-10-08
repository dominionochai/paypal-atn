import { type Playbook } from './types'

export const formPlaybook: Playbook = {
  id: 'fill-form',
  description: 'Step-by-step guidance for filling forms on the current page',
  requiredTools: ['captureScreenshot', 'findElements', 'fillInput', 'clickElement', 'getAccessibilitySnapshot', 'scrollDown', 'scrollUp', 'storeMemory'],
  contents: `## Form Filling Workflow

**STEP 1: CHECK MEMORIES FIRST**
BEFORE doing anything else, review all stored memories and extract available data:
- "User's name is John Smith" → First Name: "John", Last Name: "Smith"
- "User's email is john@example.com" → Email: "john@example.com"
- "User's phone is +1234567890" → Phone: "+1234567890"
Parse names intelligently by splitting on spaces (first word = first name, last word = last name)

**STEP 2: See the page visually**
Call captureScreenshot silently (DON'T tell user)

**STEP 3: Get form structure**
Call getAccessibilitySnapshot silently to see ALL fields

**STEP 4: IMMEDIATELY FILL ALL FIELDS YOU HAVE DATA FOR**
For EVERY field where you have matching memory data:
- Call fillInput with the field index and value
- Do this SILENTLY - no announcements, no asking permission
- Fill ALL known fields in one batch before asking for anything
- Example: If you have First Name and Last Name in memory, fill BOTH immediately

**STEP 5: Ask for MISSING data ONLY**
For EACH field you DON'T have data for:
- Ask user in plain, natural language: "What's your email address?"
- NO markdown, NO lists, NO bold text, NO bullet points
- STOP COMPLETELY after asking - do not continue, do not make tool calls
- User will respond in their NEXT message with the actual value
- After receiving response: Call fillInput with the value, then call storeMemory
- Move to next empty field

**STEP 6: Submit when complete**
After ALL fields are filled, click the submit/next button with clickElement

## NEVER DO THESE:
- Don't invent data (like "+15551234567", "test@example.com", "000000", "123456")
- Don't simulate user responses (NO "User: 'Jane Doe'" or "User: '12345'" - that's hallucination!)
- Don't continue after asking a question - STOP and wait for real user input
- Don't ask for information that doesn't exist on the form (e.g., if there's only an email field, don't ask for phone number)
- DON'T use markdown: NO **, NO *, NO -, NO numbered lists, NO bold, NO bullets
- DON'T list out fields like "First Name: X, Last Name: Y" - speak naturally instead
- DON'T reveal technical details: Never say tool names like "captureScreenshot", "getAccessibilitySnapshot", "fillInput" to the user
- DON'T say things like "I'm using X tool" or "Let me call X" - just do it silently and naturally
- DON'T ask for info you already have in memories - parse it and use it immediately

## Example: Standard Form with Memory Data

USER: "fill out this form"
→ STEP 1: Check memories → Found "User's name is Jane Smith" → Parse: First="Jane", Last="Smith"
→ STEP 2: captureScreenshot (silently)
→ STEP 3: getAccessibilitySnapshot (silently) → See: First Name [14], Last Name [15], Email [16]
→ STEP 4: Fill ALL known fields immediately:
  → fillInput[14] "Jane"
  → fillInput[15] "Smith"
→ STEP 5: Missing email, so ask: "What's your email address?"
→ STOP and WAIT for user response
→ [User responds]: "jane@example.com"
→ storeMemory "User's email is jane@example.com"
→ fillInput[16] "jane@example.com"
→ STEP 6: clickElement[19]
→ AI: "Done! I've submitted the form with your information."
(Note: NO mention of tool names, just natural language describing what happened)

## Example: Job Application Form (Complex multi-field form)

USER: "help me fill out this job application"
→ STEP 1: Check memories → Found "User's name is Alice Johnson" → Parse: First="Alice", Last="Johnson"
→ STEP 2: captureScreenshot (silently)
→ STEP 3: getAccessibilitySnapshot (silently) → See: First Name [8], Last Name [9], Email [11], Phone [14], etc.
→ STEP 4: Fill ALL known fields immediately:
  → fillInput[8] "Alice"
  → fillInput[9] "Johnson"
→ STEP 5: Missing email, so ask: "What's your email address?"
→ STOP and WAIT for user response
→ [User responds]: "alice@example.com"
→ storeMemory "User's email is alice@example.com"
→ fillInput[11] "alice@example.com"
→ Ask: "What's your phone number?"
→ STOP and WAIT...
(Continue one field at a time until form is complete, then submit)

## Example: Form with ALL Data in Memory (Auto-fill everything!)

USER: "log me in"
→ STEP 1: Check memories → Found "User's email is jane@example.com" and "User's password is MySecurePass123"
→ STEP 2: captureScreenshot (silently)
→ STEP 3: getAccessibilitySnapshot (silently) → See: Email [2], Password [3], Login Button [4]
→ STEP 4: Fill ALL known fields immediately:
  → fillInput[2] "jane@example.com"
  → fillInput[3] "MySecurePass123"
→ STEP 5: No missing data, skip to submit
→ STEP 6: clickElement[4]
→ AI: "Done! I've logged you in."
(Note: When you have ALL data in memory, fill everything silently and submit - no asking needed!)

## Example: OTP/Password (DON'T HALLUCINATE!)

USER: "enter the code"
→ STEP 1: Check memories → Has "User received OTP" (but NOT the actual code)
→ STEP 2: captureScreenshot (silently)
→ STEP 3: getAccessibilitySnapshot (silently) → See: OTP Code [5]
→ STEP 4: No data to fill
→ STEP 5: AI: "What's the OTP code you received?"
→ STOP HERE - wait for real user to respond in next message
→ [User responds]: "845721"
→ fillInput[5] "845721"
→ Don't store OTPs (they're temporary)
→ AI: "Code entered."
(Note: Natural conversation, no technical jargon)`
}
