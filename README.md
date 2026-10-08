# PayPal Autonomous Trust Network (ATN)

An end-to-end Operating System for Autonomous Commerce. Three layers, one platform:
- Layer 1: Identity & Authorization — Proof-of-Agent
- Layer 2: Real-Time Settlement Rail — Neural Streaming
- Layer 3: Delivery & Asset Verification — VeriPay Escrow

## Step-by-Step System Lifecycle

A complete multi-agent workflow: an Enterprise Market-Research Agent hires a Scraping Agent to pull data, then hires a Data-Science Agent to generate a custom machine learning model.

### Phase 1: Authentication & Scope Locking (Proof-of-Agent Layer)
- Delegation: the human assigns a budget of $50 to their primary buyer agent (Market-Research AI).
- ZKP Generation: the Market-Research AI needs to call external worker agents. It compiles a cryptographic Zero-Knowledge Proof specifying: Scope (authorized to interact with registered PayPal Merchant Agents only), Ceiling (hard limit of $50), Expiration (30 minutes from issuance).
- Handshake: the agent connects to the PayPal ATN Gateway. PayPal validates the ZKP. The gateway opens a temporary $50 transaction vault. The human's underlying credit card or master wallet credentials remain completely hidden.

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

## Phase 2: High-Frequency Compute Acquisition (Neural Streaming Layer)

- Connection: the Market-Research AI hires Scraper AI to read 500 web pages. Because this is a high-frequency, low-value task ($0.0002 per page), it routes to the Neural Streaming Engine.
- WebSocket Channel Open: a WebSocket state channel opens between both agents under the pre-authenticated ZKP vault.
- Micro-Voucher Issuance: as Scraper AI streams scraped page tokens back over the WebSocket, Market-Research AI issues micro-signed payment vouchers every 100 milliseconds ($0.0002 → $0.0004 → $0.0006 ...).
- Local Channel Balance: neither payment hits PayPal's core database yet. Both agents update their local cryptographic ledger.
- Session Close & Settlement: after 500 pages, the session closes at $0.10 total. Scraper AI submits the final signed state channel receipt to PayPal. PayPal executes a single $0.10 micro-payout into Scraper AI's balance.
