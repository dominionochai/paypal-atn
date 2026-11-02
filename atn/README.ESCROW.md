# VeriPay escrow

This document describes the escrow module currently implemented in [`src/escrow/escrow.ts`](src/escrow/escrow.ts), its inspector in [`src/escrow/inspector.ts`](src/escrow/inspector.ts), and the escrow tables in [`src/db/migrations/006_escrow.sql`](src/db/migrations/006_escrow.sql). It documents the code's behavior, not a production escrow or payment-service guarantee.

## Escrow lifecycle and legal transitions

The persisted escrow statuses are `CREATED`, `FUNDED`, `INSPECTING`, `RELEASED`, `REFUNDED`, and `FAILED`. The escrow functions enforce these moves:

| From | To | Trigger |
| --- | --- | --- |
| `CREATED` | `FUNDED` | `fundEscrow` receives a successful `PaymentAdapter.charge` result. |
| `CREATED` | `FAILED` | `PaymentAdapter.charge` throws; the failed funding attempt is recorded. |
| `FUNDED` | `INSPECTING` | `inspectEscrow` starts inspection. |
| `FUNDED` | `REFUNDED` | An explicit call to `refundEscrow`. |
| `INSPECTING` | `RELEASED` | Inspection outcome is `PASS`. |
| `INSPECTING` | `FUNDED` | Inspection outcome is `FAIL` or `INCONCLUSIVE`; funds remain in the funded state. |
| `INSPECTING` | `REFUNDED` | An explicit call to `refundEscrow`. |

These are the transitions implemented by the escrow module. In particular, an inspection `FAIL` does **not** move the escrow to `FAILED`; it returns to `FUNDED`. `FAILED`, `RELEASED`, and `REFUNDED` have no further transitions in this module. Invalid state operations raise an `EscrowStateError` rather than making a move.

`fundEscrow` calls the supplied payment adapter to charge. By contrast, `refundEscrow` only changes the local escrow status and records an event; it does not call a payment-provider refund. Likewise, inspection's `RELEASED` status update does not itself issue a payout. The escrow row, transition events, and inspection summary are stored in SQLite.

## Inspection outcomes

`inspectEscrow` changes the state to `INSPECTING`, runs `inspectArtifact` over the supplied bytes and declared media type, records the outcome/reasons plus SHA-256 and byte count, then applies the transition above.

- **`PASS`** — the ONNX protobuf metadata parser completed, and there are no non-informational findings. `INFO_...` findings alone do not prevent a pass.
- **`FAIL`** — at least one hard-failure reason is present: `OVERSIZE`, `HASH_MISMATCH`, or a `FORBIDDEN_OP:<hint>` finding.
- **`INCONCLUSIVE`** — parsing did not complete successfully, the artifact is empty, the media type is unexpected, or another non-`INFO_` finding exists without a hard-failure reason. This includes `PARSE_ERROR` and `MALFORMED_PROTOBUF`.

A pass is a result of these implemented checks only. It is not a claim that the model is safe, correct, accurate, or suitable to run.

## Inspection reason codes and triggers

| Reason | Trigger |
| --- | --- |
| `OVERSIZE` | Artifact byte length exceeds `maxBytes` (default: 8 MiB). An over-limit artifact is not parsed. |
| `HASH_MISMATCH` | Optional `expectedSha256`, after trimming and lowercasing, differs from the computed SHA-256 digest. |
| `UNEXPECTED_MEDIA_TYPE` | Trimmed, lowercased declared media type is not `application/octet-stream`, `application/x-onnx`, or `model/onnx`. This is inconclusive, not by itself a hard failure. |
| `FORBIDDEN_OP:<hint>` | The bytes contain a configured non-empty hint as a literal byte substring. Defaults are `PyFunc`, `PythonOp`, `StringNormalizer`, and `Tokenizer`; callers may supply a different hint list. This is a byte scan, not graph/operator analysis. |
| `EMPTY_ARTIFACT` | Artifact length is zero. |
| `MALFORMED_PROTOBUF` | The ONNX metadata protobuf reader encounters a recognized malformed/truncated/invalid protobuf structure. |
| `PARSE_ERROR` | An inspection/parser error other than the recognized malformed-protobuf error occurs; also used for an invalid `maxBytes` value (not a non-negative safe integer). |
| `INFO_IR_VERSION:<version>` | Successfully parsed ONNX IR version metadata is present. |
| `INFO_PRODUCER_NAME:<name>` | Successfully parsed producer-name metadata is present; its JSON representation is truncated to 128 characters for the finding. |
| `INFO_OPSET_VERSION:<version>` | A successfully parsed opset-import version is present; one finding is added per parsed opset version. |

The default byte limit can be overridden with `maxBytes`. Informational findings report metadata; they do not certify model behavior. The parser reads selected protobuf metadata, and the forbidden-hint check searches raw bytes; this implementation does not perform model inference or comprehensive ONNX graph, tensor-shape, accuracy, or malware analysis.

## Inspection isolation and security limits

Inspection is an offline, data-only operation on the supplied `Buffer`: it computes a local hash, parses selected protobuf metadata, and checks byte substrings. It makes no network calls, does not execute the model, and does not spawn or execute external processes.

This is **not a sandbox or VM**. Parsing still runs in the application's process, and this inspection cannot stop or contain a malicious parser exploit. ONNX parsing is best-effort and is **not a substitute for a hardened runtime**. Do not treat this check as safe execution of an untrusted model.

## Not implemented

- **HTTP escrow routes:** no HTTP endpoints for creating, funding, inspecting, releasing, or refunding escrows are implemented. The code currently provides TypeScript module functions, not an HTTP route surface.
- **LIVE payments:** no live-payment provider is implemented. The payment adapter code provides simulated and PayPal sandbox implementations; a `LIVE` mode type is not a live provider. Do not use this implementation to make or represent real live charges.
- **Provider payout/refund execution from escrow:** `RELEASED` and `REFUNDED` are local escrow state updates, not payment-provider payout or refund calls.

## Commands

Run these from the repository root:

```sh
cd atn
npm install
npm test
npm run typecheck
```
