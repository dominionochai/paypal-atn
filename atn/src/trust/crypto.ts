import { sign, verify } from 'node:crypto';

export interface DelegationPayload {
  version: number;
  delegationId: string;
  principalId: string;
  agentId: string;
  ceiling: number;
  scope: readonly string[];
  counterparties?: readonly string[];
  counterpartyAllowlist?: readonly string[];
  notBefore?: string | null;
  expiresAt?: string | null;
  minCounterpartyTrust?: number;
  nonce: string;
}

export interface RequestEnvelopePayload {
  agentId: string;
  method: string;
  path: string;
  bodySha256: string;
  nonce: string;
  timestamp: number;
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('canonicalJson cannot serialize undefined');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new TypeError('canonicalJson requires finite integers');
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

const DELEGATION_DOMAIN = 'ATN-DELEGATION-v1\n';
const REQUEST_DOMAIN = 'ATN-REQUEST-v1\n';

export function signDelegation(payload: DelegationPayload, privateKeyPem: string): string {
  const bytes = Buffer.concat([
    Buffer.from(DELEGATION_DOMAIN, 'utf8'),
    Buffer.from(canonicalJson(payload), 'utf8'),
  ]);
  return sign(null, bytes, privateKeyPem).toString('base64');
}

export function verifyDelegation(payload: DelegationPayload, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const bytes = Buffer.concat([
      Buffer.from(DELEGATION_DOMAIN, 'utf8'),
      Buffer.from(canonicalJson(payload), 'utf8'),
    ]);
    return verify(null, bytes, publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export function signRequest(payload: RequestEnvelopePayload, privateKeyPem: string): string {
  const bytes = Buffer.concat([
    Buffer.from(REQUEST_DOMAIN, 'utf8'),
    Buffer.from(canonicalJson(payload), 'utf8'),
  ]);
  return sign(null, bytes, privateKeyPem).toString('base64');
}

export function verifyRequest(payload: RequestEnvelopePayload, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const bytes = Buffer.concat([
      Buffer.from(REQUEST_DOMAIN, 'utf8'),
      Buffer.from(canonicalJson(payload), 'utf8'),
    ]);
    return verify(null, bytes, publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
