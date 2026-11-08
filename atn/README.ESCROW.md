# VeriPay escrow

The escrow module ([`src/escrow/escrow.ts`](src/escrow/escrow.ts)) locks funds from a vault, inspects a delivered artifact ([`src/escrow/inspector.ts`](src/escrow/inspector.ts)), and releases or refunds. All HTTP routes require a signed request envelope.

## Lifecycle

Statuses: `CREATED`, `FUNDED`, `INSPECTING`, `RELEASED`, `REFUNDED`, `FAILED`.

| From | To | Trigger |
| --- | --- | --- |
| `CREATED` | `FUNDED` | `POST /v1/escrows/:id/fund` (payer). The adapter places a hold; the vault reservation was made at creation. |
| `CREATED` | `FAILED` | The funding call throws; the reservation is released. |
| `FUNDED` | `INSPECTING` | `POST /v1/escrows/:id/inspect` (payee only). |
| `INSPECTING` | `RELEASED` | Outcome `PASS`: capture and payout, vault `committed` increases, payee trust +10. |
| `INSPECTING` | `REFUNDED` | Outcome `FAIL`: the hold is voided, the reservation returns to the vault, payee trust -50. |
| `INSPECTING` | `FUNDED` | Outcome `INCONCLUSIVE`: attempts increase; after the maximum number of attempts the escrow is refunded. |
| `FUNDED` or `INSPECTING` | `REFUNDED` | `POST /v1/escrows/:id/refund` (payer only), or the deadline sweeper for a stale escrow. |

Trust scores are integers from 0 to 1000 and start at 500. A delegation may set a minimum counterparty trust, and creating an escrow for a worker below it is refused with `COUNTERPARTY_UNTRUSTED`.

## Inspection outcomes

- **`PASS`**: the ONNX metadata parsed and there are no hard findings. `INFO_` findings alone do not prevent a pass.
- **`FAIL`**: `OVERSIZE`, `HASH_MISMATCH`, or a `FORBIDDEN_OP:<hint>` finding.
- **`INCONCLUSIVE`**: parsing did not complete, the artifact is empty, the media type is unexpected, or another non-`INFO_` finding exists.

A pass means "structurally valid and nothing on the deny-list". It is not a claim that the model is safe, correct, accurate, or suitable to run.

| Reason | Trigger |
| --- | --- |
| `OVERSIZE` | Larger than `maxBytes` (default 8 MiB); not parsed |
| `HASH_MISMATCH` | `expectedSha256` differs from the computed digest |
| `UNEXPECTED_MEDIA_TYPE` | Media type is not `application/octet-stream`, `application/x-onnx` or `model/onnx` |
| `FORBIDDEN_OP:<hint>` | The bytes contain a deny-list marker as a literal substring (defaults: `PyFunc`, `PythonOp`, `StringNormalizer`, `Tokenizer`) |
| `EMPTY_ARTIFACT` | Zero bytes |
| `MALFORMED_PROTOBUF` | The metadata reader hit a malformed or truncated structure |
| `PARSE_ERROR` | Any other parser error, or an invalid `maxBytes` |
| `INFO_IR_VERSION`, `INFO_PRODUCER_NAME`, `INFO_OPSET_VERSION` | Metadata that was parsed |

## Limits of the inspector

Inspection is offline and data-only: it hashes the bytes, reads selected protobuf metadata, and checks byte substrings. It makes no network calls and does **not** execute or evaluate the model, check tensor shapes, or measure accuracy. It runs in the application's process, so it is **not a sandbox** and cannot contain a malicious parser exploit. The deny-list is a literal substring match and is not exhaustive.

## Payments

`fund`, `release` and `refund` go through the payment adapter. With `SETTLEMENT_MODE=SIMULATED` (the default) nothing leaves the process. With `SETTLEMENT_MODE=PAYPAL_SANDBOX` the hold stays a ledger hold, and the payout on release is a real PayPal sandbox Payouts call; see [`README.PAYMENTS.md`](README.PAYMENTS.md). There is no live-payment mode.
