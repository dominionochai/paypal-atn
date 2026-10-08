import { type Playbook } from './types'

export const emailPlaybook: Playbook = {
  id: 'send-email',
  description: 'Opens Gmail to send email - ONLY use if not already on Gmail',
  requiredTools: ['openTab', 'findElements', 'fillInput', 'clickElement', 'writeContent', 'searchVault'],
  contents: `## Email Workflow

When user says "send email to X":

Step 1: openTab with url: "https://mail.google.com"
Step 2: findElements with query: "compose"
Step 3: clickElement with index from step 2
Step 4: Try to find recipient's email using searchVault with query like "X email address" or "contact information for X"
Step 5: If vault returns email address, use it. Otherwise, check memories for email. If not found, ask user for email address.
Step 6: findElements with query: "To"
Step 7: fillInput with recipient email
Step 8: Use writeContent to draft the email content
Step 9: Extract subject (first line after "Subject:") and body from writeContent result
Step 10: findElements with query: "subject"
Step 11: fillInput with subject from writeContent
Step 12: findElements with query: "message body"
Step 13: fillInput with body from writeContent
Step 14: findElements with query: "send"
Step 15: clickElement to send

CRITICAL:
- Open Gmail compose window FIRST
- Try searchVault to find recipient's email address (e.g., "doctor email address", "John Smith contact info")
- If vault has email, use it. If not, check memories. If still not found, ask user.
- THEN use writeContent to draft the email
- Extract subject and body from writeContent result
- Fill subject and body fields in Gmail
- Then send`
}
