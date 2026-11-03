// End-to-end demo: starts the ATN HTTP server on a free port and drives the real API.
// Run from atn/: node scripts/demo.mjs
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const atnDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(os.tmpdir(), 'atn-demo-' + process.pid + '-' + crypto.randomBytes(6).toString('hex') + '.db');
const PAYER = 'agent:demo-payer';
const PAYEE = 'agent:demo-payee';
const CEILING = 50_000_000;
const records = [];
let child = null;
let childExit = null;

function add(name, result, detail) {
  records.push({ name, result, detail: detail ?? '' });
  console.log((result === 'PASS' ? '[PASS] ' : result === 'SKIP' ? '[SKIP] ' : '[FAIL] ') + name + (detail ? ' - ' + detail : ''));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function call(base, method, route, body, headers) {
  const options = { method, headers: { ...(headers ?? {}) } };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(base + route, options);
  const raw = await response.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { json = null; }
  return { status: response.status, json, raw };
}

// Must match src/streaming/signing.ts canonicalize(): length-prefixed strings + int64 big-endian numbers.
function canonicalBytes(p) {
  const parts = [];
  const str = (s) => {
    const b = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length, 0);
    parts.push(len, b);
  };
  const i64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(BigInt(n), 0);
    parts.push(b);
  };
  str(p.channelId);
  str(p.payeeAgentId);
  i64(p.cumulativeAmount);
  i64(p.nonce);
  i64(p.issuedAt);
  return Buffer.concat(parts);
}

function signedVoucher(channelId, cumulativeAmount, nonce, privateKeyPem) {
  const payload = { channelId, payeeAgentId: PAYEE, cumulativeAmount, nonce, issuedAt: Date.now() };
  const signature = crypto.sign(null, canonicalBytes(payload), privateKeyPem).toString('base64');
  return { payload, signature };
}

async function waitReady(base) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (childExit) throw new Error('Server exited before readiness (code ' + childExit.code + ')');
    try {
      const probe = await call(base, 'GET', '/v1/channels/none');
      if (probe.status === 404) return probe.status;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server did not become ready in 30 seconds');
}

async function run() {
  console.log('ATN end-to-end demo ($50 simulated channel + escrow)');
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_PATH: dbPath,
    SETTLEMENT_MODE: 'SIMULATED',
    ATN_DELEGATION_BUDGET: String(CEILING),
    NODE_ENV: 'test',
    ATN_CORS_ORIGINS: 'http://localhost:3000',
  };
  child = spawn(process.execPath, ['--import', 'tsx', 'src/http/server.ts'], { cwd: atnDir, env, stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code, signal) => { childExit = { code, signal }; });

  const status = await waitReady(base);
  add('Server readiness', 'PASS', 'HTTP ' + status);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const created = await call(base, 'POST', '/v1/channels', {
    payerAgentId: PAYER, payeeAgentId: PAYEE, payerPublicKey: publicPem, ceiling: CEILING, ttlSeconds: 600,
  });
  const channelId = created.json?.channelId;
  if (created.status === 201 && typeof channelId === 'string') add('Create channel', 'PASS', 'ceiling ' + created.json.ceiling);
  else add('Create channel', 'FAIL', 'HTTP ' + created.status + ' ' + created.raw);
  if (typeof channelId !== 'string') return;

  const route = '/v1/channels/' + encodeURIComponent(channelId) + '/vouchers';
  let lastVoucher = null;
  const steps = [[10_000_000, 1], [25_000_000, 2], [50_000_000, 3]];
  for (const [amount, nonce] of steps) {
    const voucher = signedVoucher(channelId, amount, nonce, privatePem);
    lastVoucher = voucher;
    const result = await call(base, 'POST', route, voucher);
    if (result.status === 200 && result.json?.spent === amount) add('Voucher ' + nonce, 'PASS', 'spent=' + result.json.spent);
    else add('Voucher ' + nonce, 'FAIL', 'expected 200 spent=' + amount + ', got HTTP ' + result.status + ' ' + result.raw);
  }

  const over = await call(base, 'POST', route, signedVoucher(channelId, CEILING + 10_000_000, 4, privatePem));
  if (over.status === 422 || over.status === 409) add('Over-ceiling voucher rejected', 'PASS', 'HTTP ' + over.status + ' ' + (over.json?.error ?? ''));
  else add('Over-ceiling voucher rejected', 'FAIL', 'HTTP ' + over.status + ' ' + over.raw);

  const replay = await call(base, 'POST', route, lastVoucher);
  if (replay.status === 409) add('Replayed voucher rejected', 'PASS', 'HTTP 409');
  else add('Replayed voucher rejected', 'FAIL', 'expected 409, got HTTP ' + replay.status + ' ' + replay.raw);

  const settleRoute = '/v1/channels/' + encodeURIComponent(channelId) + '/settle';
  const wrong = await call(base, 'POST', settleRoute, { idempotencyKey: 'demo-wrong' }, { 'x-atn-authority': 'agent:someone-else' });
  if (wrong.status === 403) add('Wrong-authority settlement rejected', 'PASS', 'HTTP 403');
  else add('Wrong-authority settlement rejected', 'FAIL', 'expected 403, got HTTP ' + wrong.status);

  const settled = await call(base, 'POST', settleRoute, { idempotencyKey: 'demo-settle-1' }, { 'x-atn-authority': PAYEE });
  if (settled.status === 200 && settled.json?.amount === CEILING && settled.json?.mode === 'SIMULATED') {
    add('Settlement', 'PASS', 'amount=' + settled.json.amount + ' mode=' + settled.json.mode);
  } else add('Settlement', 'FAIL', 'expected 200 amount=' + CEILING + ' SIMULATED, got HTTP ' + settled.status + ' ' + settled.raw);

  const again = await call(base, 'POST', settleRoute, { idempotencyKey: 'demo-settle-1' }, { 'x-atn-authority': PAYEE });
  if ((again.status === 200 && again.json?.amount === CEILING) || (again.status === 409 && again.json?.error === 'ALREADY_SETTLED')) {
    add('Repeat settlement is safe', 'PASS', 'HTTP ' + again.status);
  } else add('Repeat settlement is safe', 'FAIL', 'HTTP ' + again.status + ' ' + again.raw);

  const escrow = await call(base, 'POST', '/v1/escrows', { payerAgentId: PAYER, payeeAgentId: PAYEE, amount: 25_000_000, currency: 'USD' });
  const escrowId = escrow.json?.escrowId;
  if (escrow.status === 201 && typeof escrowId === 'string') add('Escrow create', 'PASS', 'status=' + escrow.json.status + ' amount=' + escrow.json.amount);
  else add('Escrow create', 'FAIL', 'HTTP ' + escrow.status + ' ' + escrow.raw);

  if (typeof escrowId === 'string') {
    const artifactBase64 = Buffer.from('ATN demo artifact').toString('base64');
    const inspect = await call(base, 'POST', '/v1/escrows/' + encodeURIComponent(escrowId) + '/inspect', { artifactBase64, declaredMediaType: 'application/octet-stream' });
    if (inspect.status === 409) add('Escrow inspect and release', 'SKIP', 'no HTTP route funds an escrow yet (phase V1); module paths are covered by unit tests');
    else if (inspect.status === 200) add('Escrow inspect', 'PASS', 'outcome=' + inspect.json?.outcome);
    else add('Escrow inspect', 'FAIL', 'HTTP ' + inspect.status + ' ' + inspect.raw);
  }
  add('Total charged', 'PASS', String(settled.json?.amount ?? 0) + ' micro-dollars');
}

async function cleanup() {
  if (child && !childExit) {
    child.kill();
    await new Promise((resolve) => {
      child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {
      // Windows may keep the file locked briefly; the temp file is disposable.
    }
  }
}

run()
  .catch((error) => add('Demo execution', 'FAIL', error instanceof Error ? error.message : String(error)))
  .finally(async () => {
    console.log('\nSummary');
    for (const row of records) console.log('| ' + row.name + ' | ' + row.result + ' | ' + row.detail + ' |');
    const failed = records.some((row) => row.result === 'FAIL');
    console.log('\nOverall: ' + (failed ? 'FAIL' : 'PASS'));
    await cleanup();
    process.exit(failed ? 1 : 0);
  });
