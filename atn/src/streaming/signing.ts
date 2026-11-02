import { generateKeyPairSync, sign, verify } from 'node:crypto';
export interface VoucherPayload { channelId: string; payeeAgentId: string; cumulativeAmount: number; nonce: number; issuedAt: number; }
export function canonicalize(p: VoucherPayload): Buffer {
  const parts: Buffer[] = [];
  const pushStr = (s: string): void => { const b = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32BE(b.length, 0); parts.push(len, b); };
  const pushI64 = (n: number): void => { if (!Number.isSafeInteger(n)) throw new Error('non-integer value in voucher payload'); const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n), 0); parts.push(b); };
  pushStr(p.channelId); pushStr(p.payeeAgentId); pushI64(p.cumulativeAmount); pushI64(p.nonce); pushI64(p.issuedAt);
  return Buffer.concat(parts);
}
export function generateKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}
export function signVoucher(payload: VoucherPayload, privateKeyPem: string): string { return sign(null, canonicalize(payload), privateKeyPem).toString('base64'); }
export function verifyVoucher(payload: VoucherPayload, signatureB64: string, publicKeyPem: string): boolean {
  try { return verify(null, canonicalize(payload), publicKeyPem, Buffer.from(signatureB64, 'base64')); } catch { return false; }
}
