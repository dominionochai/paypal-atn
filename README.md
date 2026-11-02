# PayPal Autonomous Trust Network (ATN)

An end-to-end Operating System for Autonomous Commerce. Three layers, one platform:

- Layer 1: Identity & Authorization — Proof-of-Agent
- Layer 2: Real-Time Settlement Rail — Neural Streaming
- Layer 3: Delivery & Asset Verification — VeriPay Escrow

## Step-by-Step System Lifecycle

A complete multi-agent workflow: an Enterprise Market-Research Agent hires a Scraping Agent to pull data, then hires a Data-Science Agent to generate a custom machine learning model.

### Phase 1: Authentication & Scope Locking (Proof-of-Agent Layer)

- Delegation: the human assigns a budget of $50 to their primary buyer agent (Market-Research AI).
- Delegation Token Issue: the Market-Research AI needs to call external worker agents. It issues a signed delegation token specifying: Scope (authorized to interact with registered PayPal Merchant Agents only), Ceiling (hard limit of $50), Expiration (30 minutes from issue).
- Handshake: the agent connects to the PayPal ATN Gateway. the gateway validates the delegation signature, ceiling, expiry, and revocation status. The gateway opens a temporary $50 transaction vault. The human's underlying credit card or master wallet credentials remain completely hidden.

## Design Notes (Sharp Notes)

- '$50 ceiling + 30 min expiry' is the demo. Make that visible on screen during the pitch — a vault that visibly opens, gets funded, expires. Judges remember what they SEE.
- 'Human's underlying credit card stays hidden' — the sentence to repeat. It's the whole security story in one line.
- Multi-agent lifecycle (research agent hires scraper hires data-science) is the right demo — it shows the network, not a single agent.

## Problem Statement

When millions of autonomous AI agents start buying goods, subscribing to services, and invoking paid APIs on behalf of humans, traditional anti-fraud systems collapse. Normal anti-fraud looks for human biometrics: mouse wiggles, typing cadence, IP subnet consistency, session cookies, and 2FA SMS prompts. An AI agent running on a cloud server has none of these. If a malicious actor steals an agent's API keys or tricks an LLM via prompt injection, standard systems can't distinguish a legitimate agent instruction from a botnet draining a wallet.

## Core Architecture (proof of concept)

- Proof-of-Agent: acts as a cryptographic OAuth layer for Autonomous AI Agents — deterministic intent and scoping for agent authorization.
- Neural Streaming: real-time settlement rail for agent payments.
- VeriPay Escrow: delivery and asset verification before funds release.

Payments run through a simulated adapter and a local SQLite ledger; no live PayPal API calls are made in this build.

## Phase 2: High-Frequency Compute Acquisition (Neural Streaming Layer)

- Connection: the Market-Research AI hires Scraper AI to read 500 web pages. Because this is a high-frequency, low-value task ($0.0002 per page), it routes to the Neural Streaming Engine.
- WebSocket Channel Open: a WebSocket state channel opens between both agents under the delegation-scoped budget.
- Micro-Voucher Issuance: as Scraper AI streams scraped page tokens back over the WebSocket, Market-Research AI issues micro-signed payment vouchers every 100 milliseconds ($0.0002 → $0.0004 → $0.0006 ...).
- Local Channel Balance: neither payment hits PayPal's core database yet. Both agents update their local cryptographic ledger.
- Session Close & Settlement: after 500 pages, the session closes at $0.10 total. Scraper AI submits the final signed state channel receipt to PayPal. PayPal executes a single $0.10 micro-payout into Scraper AI's balance.

## Phase 3: High-Value Asset Purchase & Inspection (VeriPay Escrow Layer)

- Asset Order: the Market-Research AI takes the scraped raw data and orders a custom prediction model ($25.00) from Data-Science AI. Because this involves a static file asset of significant value, it routes to VeriPay Escrow.
- Escrow Lock: PayPal places $25.00 from the pre-authorized vault into an isolated escrow holding account.
- Delivery to Inspection Sandbox: Data-Science AI completes the model and submits the .onnx file payload to the system.
- Automated AI Inspection: before the funds unlock, the system spins up an isolated sandbox inspector: it loads the delivered model, runs automated validation — validates the model artifact structurally (format, tensor shapes, byte size, and reject-list checks), and scans for malicious code injections.
- Final Settlement or Refund: if verification passes, the escrow is marked RELEASED and funds are released from the isolated holding balance. If verification fails (e.g., model is broken/hallucinated), the escrow cancels, the $25.00 returns to the user's vault, and Data-Science AI's merchant trust rating drops automatically.

## Why the Integrated System is Unbeatable

When presented as an integrated stack, the system shows how PayPal addresses the entire lifecycle of AI-driven commerce.

| Problem in the AI Economy | Individual Component | System Integration Result |
|---|---|---|
| How do we know the bot isn't rogue? | Proof-of-Agent Layer | Cryptographic constraints prevent runaway spend or identity theft |
| How do bots pay for sub-cent compute? | Neural Streaming Layer | Low-overhead WebSocket vouchers settle high-frequency micro-transactions |
| How do bots verify digital deliverables? | VeriPay Escrow Layer | Programmatic inspection gates release and blocks broken or malformed artifacts |

Source: https://github.com/dominionochai/paypal-atn/blob/main/README.md
