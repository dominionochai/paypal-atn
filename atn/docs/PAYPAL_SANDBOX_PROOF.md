# PayPal sandbox run (7 Nov 2026)

Output of `npm run paypal:smoke` against the PayPal sandbox (api-m.sandbox.paypal.com), sandbox business app, sandbox personal buyer. All IDs are sandbox IDs.

| Step | PayPal API | Result |
| --- | --- | --- |
| OAuth token | /v1/oauth2/token | obtained |
| Create order (intent AUTHORIZE, $0.10) | /v2/checkout/orders | order 9SU236275G4534158 |
| Buyer approval | checkout approve link | approved in a browser by the sandbox buyer |
| Authorize order | /v2/checkout/orders/{id}/authorize | authorization 51P92844CW5959019 |
| Capture $0.10 | /v2/payments/authorizations/{id}/capture | capture 3VH601312X407701N |
| Refund capture | /v2/payments/captures/{id}/refund | REFUNDED |
| Second order, approved and authorized | orders + authorize | order 0339341408644570H, authorization 28A23692A9021174N |
| Void authorization | /v2/payments/authorizations/{id}/void | VOIDED |
| Payout $0.10 | /v1/payments/payouts | batch 9MJPYVD8DE2JN accepted |

Limits: the script confirms PayPal accepted the payout batch, not its final delivery status. In server mode (`SETTLEMENT_MODE=PAYPAL_SANDBOX`) escrow holds stay ledger-only and payouts are real calls; the full Orders flow above is run by `npm run paypal:smoke` because a sandbox buyer must approve each order in a browser.
