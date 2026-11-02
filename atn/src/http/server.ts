import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Database } from 'better-sqlite3';
import { handleRequest } from './routes.js';
import { corsHeaders, handlePreflight, resolveAllowlist } from './cors.js';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REQUEST_URL_LENGTH = 2048;
const DEFAULT_RATE_LIMIT = { max: 120, windowMs: 60000 };

type BodyResult = { ok: true; body: Buffer } | { ok: false; tooLarge: boolean };
type RateLimitBucket = { count: number; resetAt: number };

export type HttpServerOptions = {
  rateLimit?: { max: number; windowMs: number };
};

function readBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        req.pause();
        resolve({ ok: false, tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve({ ok: true, body: Buffer.concat(chunks) });
      }
    });
    req.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  responseCors: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  for (const [key, value] of Object.entries(responseCors)) {
    res.setHeader(key, value);
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createHttpServer(
  db: Database,
  options: HttpServerOptions = {},
  delegationBudget: number = Number(process.env.ATN_DELEGATION_BUDGET ?? '5000000'),
): Server {
  const allowlist = resolveAllowlist();
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rateLimitBuckets = new Map<string, RateLimitBucket>();

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (handlePreflight(req, res, allowlist)) return;

        const responseCors = corsHeaders(req.headers.origin, allowlist);
        const method = req.method ?? 'GET';
        const path = req.url ?? '/';

        if (path.length > MAX_REQUEST_URL_LENGTH) {
          send(res, 414, { error: 'URI_TOO_LONG' }, responseCors);
          return;
        }

        const now = Date.now();
        for (const [ip, bucket] of rateLimitBuckets) {
          if (bucket.resetAt <= now) rateLimitBuckets.delete(ip);
        }

        const ip = req.socket.remoteAddress ?? 'unknown';
        let bucket = rateLimitBuckets.get(ip);
        if (bucket === undefined || bucket.resetAt <= now) {
          bucket = { count: 0, resetAt: now + rateLimit.windowMs };
          rateLimitBuckets.set(ip, bucket);
        }

        if (bucket.count >= rateLimit.max) {
          const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
          res.setHeader('retry-after', String(retryAfter));
          send(res, 429, { error: 'RATE_LIMITED' }, responseCors);
          return;
        }
        bucket.count += 1;

        const contentType = req.headers['content-type'] ?? '';
        if (method === 'POST' && !contentType.includes('application/json')) {
          send(res, 400, { error: 'BAD_REQUEST', detail: 'content-type must be application/json' }, responseCors);
          return;
        }
        const read = await readBody(req);
        if (!read.ok) {
          send(res, 413, { error: 'PAYLOAD_TOO_LARGE' }, responseCors);
          return;
        }
        if (method === 'POST' && read.body.length > 0) {
          try {
            JSON.parse(read.body.toString('utf8'));
          } catch {
            send(res, 400, { error: 'BAD_REQUEST', detail: 'malformed JSON' }, responseCors);
            return;
          }
        }
        const out = await handleRequest({
          method,
          path,
          headers: req.headers,
          body: read.body,
          db,
          delegationBudget,
        });
        send(res, out.status, out.body, responseCors);
      } catch {
        send(res, 500, { error: 'INTERNAL' }, corsHeaders(req.headers.origin, allowlist));
      }
    })();
  });

  server.headersTimeout = 30000;
  server.requestTimeout = 35000;
  server.maxHeadersCount = 100;
  return server;
}

export function startHttpServer(
  db: Database,
  port?: number,
  delegationBudget: number = Number(process.env.ATN_DELEGATION_BUDGET ?? '5000000'),
  options: HttpServerOptions = {},
): Server {
  const server = createHttpServer(db, options, delegationBudget);
  server.listen(port ?? Number(process.env.PORT ?? 8787), process.env.HOST ?? '127.0.0.1');
  return server;
}
