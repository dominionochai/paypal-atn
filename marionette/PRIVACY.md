# Privacy Policy for Marionette

**Last Updated**: October 12, 2025

## Overview

Marionette is a browser automation assistant designed with privacy as its foundational principle. After initial setup, the extension operates entirely offline with all AI processing happening on your device using Chrome's built-in Gemini Nano. No data is transmitted to external servers during normal operation.

## Information Collection and Storage

### Local Data Storage

All data collected by Marionette is stored exclusively on your device in browser storage and is never transmitted externally:

**Conversation History**
- Your chat messages with the AI agent
- AI responses and tool execution results
- Stored in Chrome Extension local storage

**Semantic Vault**
- Captured webpage content processed for semantic search
- Page titles, URLs, cleaned text content, and embeddings
- Screenshots taken by the AI agent
- Stored in IndexedDB on your device

**User Memories**
- Optional personal information you choose to store (e.g., name, email, phone)
- Used only for form auto-fill convenience
- Stored in Chrome Extension local storage

**Preferences and Settings**
- Extension configuration and user preferences
- Response ratings (thumbs up/down feedback)
- Stored in Chrome Extension local storage

### Data We Do Not Collect

Marionette does not collect, transmit, or store any of the following externally:

- Browsing history sent to external servers
- Personal identifiable information sent to third parties
- Usage analytics or telemetry data
- Crash reports or error logs sent externally
- Authentication credentials or passwords
- Location data
- Financial or payment information

## How Your Data is Processed

### On-Device AI Processing

All AI inference occurs locally on your device:

- **Gemini Nano**: Chrome's built-in AI model managed by Google Chrome infrastructure
- **Embeddings Model**: all-MiniLM-L6-v2 model (23MB) downloaded once from Hugging Face CDN
- **ONNX Runtime**: WebAssembly binaries (approximately 5MB) loaded from CDN for ML inference

After the one-time model download during initial setup (approximately 2GB total), Marionette operates completely offline with zero network activity.

### Data Processing Locations

- **AI Inference**: Your device only
- **Semantic Search**: Your device only
- **Voice Transcription**: Your device using Web Speech API
- **Audio Analysis**: Your device using Chrome's built-in APIs
- **Form Filling**: Your device only

### Network Activity

**During Initial Setup:**
- Gemini Nano download (managed by Chrome)
- Embeddings model download (Hugging Face CDN)
- ONNX Runtime WASM binaries (jsdelivr/unpkg CDN)

**After Setup:**
- Zero network requests from the extension
- Completely offline operation
- Can be verified via Chrome DevTools Network tab

## Permissions Explanation

Marionette requests the following Chrome permissions:

**sidePanel**: Display the main user interface for text and voice interaction

**tabs**: Navigate between tabs, open new tabs, and get current tab information for context

**activeTab**: Inject scripts into the current webpage to enable automation (clicking, filling forms, scrolling)

**tabCapture**: Capture and transcribe audio from web pages when users request audio analysis

**audioCapture**: Enable voice input for hands-free control using on-device speech recognition

**scripting**: Inject content scripts to interact with page elements based on natural language commands

**storage**: Store conversation history, memories, and preferences locally

**unlimitedStorage**: Store semantic vault data without size restrictions for unlimited page capture history

**alarms**: Schedule background tasks for automatic page capture and indexing

**webNavigation**: Detect page navigation to trigger auto-capture for the semantic vault

**Host Permissions (all_urls)**: Enable automation across all websites as requested by users

All permissions are used exclusively for local processing. No data accessed through these permissions is transmitted externally.

## Data Security

### Storage Security

- **Sandboxed Storage**: All data is isolated in Chrome's extension storage APIs
- **No Cloud Storage**: No backups or synchronization to external servers
- **Local Encryption**: Protected by your device's operating system security
- **Isolated Access**: Other extensions and websites cannot access this data

### Model Security

- **On-Device Execution**: AI models run locally in a sandboxed environment
- **No External Inference**: Prompts and responses never leave your device
- **Cached Models**: After download, models are cached and used offline

## Data Retention and Deletion

### User Control

You maintain complete control over your data:

- **Manual Deletion**: Clear conversation history anytime from the extension UI
- **Vault Management**: Delete individual captured pages or clear entire vault
- **Memory Management**: Remove stored personal information anytime
- **Complete Removal**: Uninstalling the extension immediately deletes all stored data

### Automatic Cleanup

- Optional vault size limits can be configured
- No automatic external backups or data retention
- Data exists only as long as the extension is installed

## Third-Party Services

### Model Downloads (One-Time)

**Gemini Nano**: Downloaded and managed by Google Chrome's built-in model distribution system

**Embeddings Model**: Downloaded from Hugging Face CDN (huggingface.co)

**ONNX Runtime**: WebAssembly binaries loaded from jsdelivr or unpkg CDN

These downloads occur only during initial setup. After caching, no further external requests are made.

### No Third-Party Analytics

Marionette does not use:
- Google Analytics or similar services
- Crash reporting services
- Error tracking or monitoring services
- A/B testing frameworks
- Advertising networks
- Social media integrations

## Children's Privacy

Marionette does not knowingly collect personal information from anyone. All data processing occurs locally on the user's device. We do not maintain user accounts or collect data that would identify users of any age.

## Data Sharing and Transfer

Marionette does not:
- Sell user data to any third party
- Share data with advertisers or data brokers
- Transfer data to external servers or cloud services
- Provide data to analytics services
- Share data with affiliated companies

Your data remains exclusively on your device under your control.

## International Data Transfers

Since all data processing occurs locally on your device and no data is transmitted externally, there are no international data transfers.

## Your Rights

Depending on your jurisdiction, you may have rights regarding your personal data. Since Marionette processes all data locally without external transmission:

- **Right to Access**: All your data is accessible through the extension interface
- **Right to Delete**: You can delete any or all data through the extension settings
- **Right to Export**: Conversation and vault data can be exported (feature in development)
- **Right to Portability**: Data exists in standard formats in your browser storage

## Compliance

Marionette is designed to comply with:

- **GDPR** (General Data Protection Regulation)
- **CCPA** (California Consumer Privacy Act)
- **Chrome Web Store Developer Program Policies**

By design, Marionette's local-only architecture minimizes privacy risks and regulatory compliance requirements.

## Changes to This Policy

We may update this privacy policy to reflect changes in the extension's functionality or legal requirements. Material changes will be communicated through:

- Updated "Last Updated" date at the top of this document
- Extension update notes in the Chrome Web Store
- Notification in the extension UI for significant changes

Continued use of Marionette after policy updates constitutes acceptance of the revised policy.

## Open Source Transparency

Marionette is open source software. You can review the complete source code, verify privacy claims, and audit data handling practices at:

**GitHub Repository**: https://github.com/youneslaaroussi/Marionette

We encourage security researchers and privacy advocates to review our implementation.

## Contact Information

For privacy questions, concerns, or requests:

**Email**: hello@youneslaaroussi.ca

**GitHub Issues**: https://github.com/youneslaaroussi/Marionette/issues

**Developer**: Younes Laaroussi

We respond to privacy inquiries within 7 business days.

## Verification of Privacy Claims

You can independently verify Marionette's privacy claims:

1. Open Chrome DevTools (F12)
2. Navigate to the Network tab
3. Use Marionette normally
4. Observe zero outbound network requests from the extension
5. All processing occurs locally with no external communication

## Summary

Marionette's privacy guarantee is simple: **your data never leaves your device**. All AI processing, storage, and automation happens locally. No accounts, no cloud services, no telemetry, no tracking. Complete privacy by design.

