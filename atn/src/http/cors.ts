import type { IncomingMessage, ServerResponse } from 'node:http';

export const DEFAULT_CORS_ORIGINS: readonly string[] = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function resolveAllowlist(raw: string | undefined = process.env.ATN_CORS_ORIGINS): string[] {
  if (raw === undefined || raw.trim().length === 0) return [...DEFAULT_CORS_ORIGINS];
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function corsHeaders(origin: string | undefined, allowlist: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {
    vary: 'origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-atn-authority',
    'access-control-max-age': '600',
  };
  if (origin !== undefined && allowlist.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

export function handlePreflight(req: IncomingMessage, res: ServerResponse, allowlist: readonly string[]): boolean {
  if (req.method !== 'OPTIONS') return false;
  const origin = req.headers.origin;
  const single = Array.isArray(origin) ? origin[0] : origin;
  for (const [k, v] of Object.entries(corsHeaders(single, allowlist))) res.setHeader(k, v);
  res.statusCode = 204;
  res.end();
  return true;
}