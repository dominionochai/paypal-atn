# Hardening

## CORS

`atn/src/http/cors.ts` reads `ATN_CORS_ORIGINS` as a comma-split allowlist. The default is `http://localhost:3000,http://127.0.0.1:3000`. Only allowlisted origins are echoed; wildcard origins and `access-control-allow-credentials` are never used. Responses always include `Vary: Origin`.

Allowed methods are `GET, POST, OPTIONS`; allowed headers are `content-type, x-atn-authority`; max-age is 600 seconds. Preflight requests receive `204` before any other handling.

## Rate limiting

Rate limiting is in-memory and per IP: 120 requests per 60,000 ms. Limited requests receive `429` with `{ error: 'RATE_LIMITED' }` and a `retry-after` header. The server factory's injectable `rateLimit` option lets tests use tiny limits.

## Timeouts and limits

- `headersTimeout`: 30,000 ms.
- `requestTimeout`: 35,000 ms.
- `maxHeadersCount`: 100.
- URLs are capped at 2,048 characters; longer URLs receive `414` with `{ error: 'URI_TOO_LONG' }`.
- Request bodies are capped at 1 MiB; oversized bodies receive `413`.

## Inspector isolation

The inspector enforces a hard wall-clock budget, checked every 1,024 iterations. It bails out as `INCONCLUSIVE` with `TIME_BUDGET_EXCEEDED` when the budget is exceeded. Reasons are capped at 50, and each reason string is capped at 200 characters. Artifacts over 32 MiB are refused as `OVERSIZE` before allocation. `inspectArtifact` never throws: any throw maps to `INCONCLUSIVE` with `PARSE_ERROR`.

## WebSocket limits

WebSocket `maxPayload` is 64 KiB. A heartbeat ping is sent every 30 seconds and silent sockets are terminated. Each channel allows at most 50 watchers; excess watchers receive `TOO_MANY_WATCHERS`. Malformed messages or messages over 8 KiB are rejected with `BAD_MESSAGE`.

## Not implemented

Distributed rate limiting across processes, TLS termination, a WAF, request signing at the edge, and audit log shipping are not implemented.

## Commands

```sh
cd atn && npm install && npm run typecheck && npm test
```

No test run is claimed in this document.
