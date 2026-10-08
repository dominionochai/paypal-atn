import { type Playbook } from './types'

export const listenPlaybook: Playbook = {
  id: 'listen-audio',
  description: 'Captures and transcribes audio from the current page (videos, music, etc.)',
  requiredTools: ['captureScreenshot', 'listen'],
  contents: `## Audio Listening Workflow

You just retrieved this playbook. Now follow these steps using the tools listed below.

EXECUTE ONE STEP AT A TIME:

Step 1: <function_call>{"function": "captureScreenshot", "arguments": {}}</function_call>
→ Wait for result to see what's on the page

Step 2: <function_call>{"function": "listen", "arguments": {"seconds": 10}}</function_call>
→ Wait for result
→ You'll receive audio data in base64 format
→ The audio will be automatically transcribed and described

Step 3: Describe what you heard based on the audio transcription → DONE

IMPORTANT:
- The "seconds" parameter controls how long to listen (1-300 seconds, default is 10)
- If user asks to "listen for longer", increase the seconds parameter
- If user says "listen" without duration, use 10 seconds
- Audio is captured from the current browser tab (e.g., YouTube videos, music players, etc.)
- After receiving the audio result, provide a natural description of what you heard`
}

