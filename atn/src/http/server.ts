import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleRequest, type Db } from './routes';

const MAX_BODY_BYTES = 1024 * 1024;

function readBody(req: IncomingMessage): Promise<{ ok: true; body: Buffer } | { ok: false; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { settled = true; resolve({ ok: false, tooLarge: true }); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve({ ok: true, body: Buffer.concat(chunks) }); } });
    req.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

export function startHttpServer(db: Db, port?: number, delegationBudget = Number(process.env.ATN_DELEGATION_BUDGET ?? '5000000')): Server {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const path = req.url ?? '/';
        const contentType = req.headers['content-type'] ?? '';
        if (method === 'POST' && !contentType.includes('application/json')) { send(res, 400, { error: 'BAD_REQUEST', detail: 'content-type must be application/json' }); return; }
        const read = await readBody(req);
        if (!read.ok) { send(res, 413, { error: 'PAYLOAD_TOO_LARGE' }); return; }
        if (method === 'POST' && read.body.length > 0) {
          try { JSON.parse(read.body.toString('utf8')); } catch { send(res, 400, { error: 'BAD_REQUEST', detail: 'malformed JSON' }); return; }
        }
        const out = await handleRequest({ method, path, headers: req.headers, body: read.body, db, delegationBudget });
        send(res, out.status, out.body);
      } catch {
        send(res, 500, { error: 'INTERNAL' });
      }
    })();
  });
  server.listen(port ?? Number(process.env.PORT ?? 8787), process.env.HOST ?? '127.0.0.1');
  return server;
}
