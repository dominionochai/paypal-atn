import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';

const COLORS = {
  reset: '\u001b[0m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};
const records = [];
const children = [];
let totalChargedMicros = 0;
let child = null;
let childExit = null;
let fallbackStarted = false;
const atnDir = path.resolve(path.dirname(path.resolve(process.argv[1] || '.')), '..');
const dbPath = path.join(os.tmpdir(), `atn-demo-${process.pid}-${crypto.randomBytes(8).toString('hex')}.db`);

function color(label, value) {
  const code = label === 'PASS' ? COLORS.green : label === 'FAIL' ? COLORS.red : label === 'SKIP' ? COLORS.yellow : COLORS.cyan;
  return `${code}${value}${COLORS.reset}`;
}

function addRecord(name, result, detail = '') {
  records.push({ name, result, detail });
}

function printResponse(requestLine, response, rawBody) {
  console.log(`\nREQUEST ${requestLine}`);
  console.log(`STATUS ${response.status}`);
  console.log(`BODY ${rawBody || '(empty)'}`);
}

function parseJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function amountFrom(json) {
  return json?.amount ?? json?.settlement?.amount ?? json?.data?.amount;
}

function modeFrom(json) {
  return json?.mode ?? json?.settlement?.mode ?? json?.data?.mode;
}

function channelIdFrom(json) {
  return json?.channelId ?? json?.id ?? json?.channel?.channelId ?? json?.channel?.id ?? json?.data?.channelId ?? json?.data?.id;
}

function spentFrom(json) {
  return json?.spent ?? json?.cumulativeSpent ?? json?.spentAmount ?? json?.channel?.spent ?? json?.data?.spent;
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not determine a free TCP port');
  return address.port;
}

function launch(command, args, env) {
  childExit = null;
  child = spawn(command, args, { cwd: atnDir, env, stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code, signal) => { childExit = { code, signal }; });
  return child;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, options) {
  const response = await fetch(url, options);
  const raw = await response.text();
  return { response, raw, json: parseJson(raw) };
}

async function requestJson(baseUrl, method, route, body, headers = {}) {
  const requestHeaders = { ...headers };
  const options = { method, headers: requestHeaders };
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetchText(`${baseUrl}${route}`, options);
}

function summarize() {
  console.log('\nSummary');
  console.log('| Step | Result | Detail |');
  console.log('|---|---|---|');
  for (const row of records) {
    console.log(`| ${row.name.replaceAll('|', '\\|')} | ${row.result} | ${row.detail.replaceAll('|', '\\|')} |`);
  }
  const failed = records.some((row) => row.result === 'FAIL');
  const dollars = (totalChargedMicros / 1_000_000).toFixed(2);
  console.log(`\nTotal charged: $${dollars} (${totalChargedMicros} micros)`);
  console.log(`Overall: ${color(failed ? 'FAIL' : 'PASS', failed ? 'FAIL' : 'PASS')}`);
  process.exitCode = failed ? 1 : 0;
}

async function run() {
  console.log('ATN end-to-end demo — $50 simulated delegation');

  const port = await reservePort();
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: dbPath,
    SETTLEMENT_MODE: 'SIMULATED',
    NODE_ENV: 'test',
    ATN_CORS_ORIGINS: 'http://localhost:3000',
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  launch(process.execPath, ['--import', 'tsx', 'src/http/server.ts'], env);

  let ready = false;
  let readyProbe = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (childExit) {
      if (childExit.code === 1 && !fallbackStarted) {
        fallbackStarted = true;
        launch('npx', ['tsx', 'src/http/server.ts'], env);
      } else {
        throw new Error(`Server process exited before readiness (code ${childExit.code}, signal ${childExit.signal ?? 'none'})`);
      }
    }
    try {
      readyProbe = await fetchText(`${baseUrl}/v1/channels/none`, { method: 'GET' });
      ready = true;
      break;
    } catch {
      if (childExit) continue;
      await sleep(500);
    }
  }
  if (!ready && childExit?.code === 1 && !fallbackStarted) {
    fallbackStarted = true;
    launch('npx', ['tsx', 'src/http/server.ts'], env);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (childExit) throw new Error(`Fallback server exited before readiness (code ${childExit.code}, signal ${childExit.signal ?? 'none'})`);
      try {
        readyProbe = await fetchText(`${baseUrl}/v1/channels/none`, { method: 'GET' });
        ready = true;
        break;
      } catch {
        if (childExit) throw new Error(`Fallback server exited before readiness (code ${childExit.code}, signal ${childExit.signal ?? 'none'})`);
        await sleep(500);
      }
    }
  }
  if (!ready) throw new Error('Server did not become ready after 40 attempts (500 ms interval)');
  printResponse('GET /v1/channels/none', readyProbe.response, readyProbe.raw);
  addRecord('Server readiness', 'PASS', `HTTP ${readyProbe.response.status}`);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const payerPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const createChannelBody = {
    payerAgentId: 'agent:demo-payer',
    payeeAgentId: 'agent:demo-payee',
    payerPublicKey,
    ceiling: 50_000_000,
    ttlSeconds: 1800,
  };
  const channelResponse = await requestJson(baseUrl, 'POST', '/v1/channels', createChannelBody);
  printResponse(`POST /v1/channels ${JSON.stringify(createChannelBody)}`, channelResponse.response, channelResponse.raw);
  let channelId = channelIdFrom(channelResponse.json);
  if (channelResponse.response.status === 201 && channelId) {
    addRecord('Create channel', 'PASS', `HTTP 201; channelId=${channelId}`);
  } else {
    addRecord('Create channel', 'FAIL', `expected HTTP 201 and a channel ID; received HTTP ${channelResponse.response.status}`);
    channelId = null;
  }

  const voucherAmounts = [10_000_000, 25_000_000, 50_000_000];
  if (channelId) {
    for (let index = 0; index < voucherAmounts.length; index += 1) {
      const cumulativeAmount = voucherAmounts[index];
      const voucherPayload = {
        channelId,
        payeeAgentId: 'agent:demo-payee',
        cumulativeAmount,
        nonce: index + 1,
        issuedAt: new Date().toISOString(),
      };
      // Best-effort reconstruction: canonicalization must match src/streaming/signing.ts.
      const canonical = JSON.stringify(voucherPayload);
      const signature = crypto.sign(null, Buffer.from(canonical), privateKey).toString('base64');
      const body = { ...voucherPayload, signature };
      const route = `/v1/channels/${encodeURIComponent(channelId)}/vouchers`;
      const result = await requestJson(baseUrl, 'POST', route, body);
      printResponse(`POST ${route} ${JSON.stringify(body)}`, result.response, result.raw);
      const actualSpent = spentFrom(result.json);
      if (result.response.status === 200 && Number(actualSpent) === cumulativeAmount) {
        addRecord(`Voucher ${index + 1}`, 'PASS', `HTTP 200; spent=${actualSpent}`);
      } else {
        addRecord(`Voucher ${index + 1}`, 'FAIL', `expected HTTP 200 and spent=${cumulativeAmount}; received HTTP ${result.response.status}, spent=${actualSpent ?? 'missing'}`);
      }
    }

    const overPayload = {
      channelId,
      payeeAgentId: 'agent:demo-payee',
      cumulativeAmount: 60_000_000,
      nonce: 4,
      issuedAt: new Date().toISOString(),
    };
    const overCanonical = JSON.stringify(overPayload);
    const overBody = { ...overPayload, signature: crypto.sign(null, Buffer.from(overCanonical), privateKey).toString('base64') };
    const voucherRoute = `/v1/channels/${encodeURIComponent(channelId)}/vouchers`;
    const overResult = await requestJson(baseUrl, 'POST', voucherRoute, overBody);
    printResponse(`POST ${voucherRoute} ${JSON.stringify(overBody)}`, overResult.response, overResult.raw);
    if (overResult.response.status === 409 || overResult.response.status === 422) {
      addRecord('Over-ceiling voucher', 'PASS', `rejected with HTTP ${overResult.response.status}`);
    } else {
      addRecord('Over-ceiling voucher', 'FAIL', `expected HTTP 409 or 422; received HTTP ${overResult.response.status}`);
    }

    const replayPayload = {
      channelId,
      payeeAgentId: 'agent:demo-payee',
      cumulativeAmount: 50_000_000,
      nonce: 3,
      issuedAt: new Date().toISOString(),
    };
    const replayCanonical = JSON.stringify(replayPayload);
    const replayBody = { ...replayPayload, signature: crypto.sign(null, Buffer.from(replayCanonical), privateKey).toString('base64') };
    const replayResult = await requestJson(baseUrl, 'POST', voucherRoute, replayBody);
    printResponse(`POST ${voucherRoute} ${JSON.stringify(replayBody)}`, replayResult.response, replayResult.raw);
    if (replayResult.response.status === 409) {
      addRecord('Replay voucher', 'PASS', 'rejected with HTTP 409');
    } else {
      addRecord('Replay voucher', 'FAIL', `expected HTTP 409; received HTTP ${replayResult.response.status}`);
    }

    const settleRoute = `/v1/channels/${encodeURIComponent(channelId)}/settle`;
    const settleBody = { idempotencyKey: 'demo-settle-1' };
    const wrong = await requestJson(baseUrl, 'POST', settleRoute, settleBody, { 'x-atn-authority': 'agent:wrong' });
    printResponse(`POST ${settleRoute} ${JSON.stringify(settleBody)} [x-atn-authority: agent:wrong]`, wrong.response, wrong.raw);
    if (wrong.response.status === 403) {
      addRecord('Wrong-authority settlement', 'PASS', 'rejected with HTTP 403');
    } else {
      addRecord('Wrong-authority settlement', 'FAIL', `expected HTTP 403; received HTTP ${wrong.response.status}`);
    }

    const correctHeaders = { 'x-atn-authority': 'agent:demo-payee' };
    const settled = await requestJson(baseUrl, 'POST', settleRoute, settleBody, correctHeaders);
    printResponse(`POST ${settleRoute} ${JSON.stringify(settleBody)} [x-atn-authority: agent:demo-payee]`, settled.response, settled.raw);
    const settledAmount = amountFrom(settled.json);
    if (settled.response.status === 200 && modeFrom(settled.json) === 'SIMULATED' && Number(settledAmount) === 50_000_000) {
      totalChargedMicros = Number(settledAmount);
      addRecord('Settlement', 'PASS', `HTTP 200; mode=SIMULATED; amount=${settledAmount} micros ($${(Number(settledAmount) / 1_000_000).toFixed(2)})`);
    } else {
      addRecord('Settlement', 'FAIL', `expected HTTP 200, mode SIMULATED, amount 50000000; received HTTP ${settled.response.status}, mode=${modeFrom(settled.json) ?? 'missing'}, amount=${settledAmount ?? 'missing'}`);
    }

    const repeated = await requestJson(baseUrl, 'POST', settleRoute, settleBody, correctHeaders);
    printResponse(`POST ${settleRoute} ${JSON.stringify(settleBody)} [x-atn-authority: agent:demo-payee] (repeat)`, repeated.response, repeated.raw);
    const repeatedAmount = amountFrom(repeated.json);
    const alreadySettled = typeof repeated.raw === 'string' && repeated.raw.toUpperCase().includes('ALREADY_SETTLED');
    if (repeated.response.status === 200 && Number(repeatedAmount) === 50_000_000) {
      addRecord('Idempotent settlement repeat', 'PASS', `HTTP 200; same amount=${repeatedAmount} micros`);
    } else if (repeated.response.status === 409 && alreadySettled) {
      addRecord('Idempotent settlement repeat', 'PASS', 'HTTP 409; ALREADY_SETTLED');
    } else {
      addRecord('Idempotent settlement repeat', 'FAIL', `expected HTTP 200 with amount 50000000 or HTTP 409 ALREADY_SETTLED; received HTTP ${repeated.response.status}, amount=${repeatedAmount ?? 'missing'}`);
    }
  } else {
    for (const name of ['Voucher 1', 'Voucher 2', 'Voucher 3', 'Over-ceiling voucher', 'Replay voucher', 'Wrong-authority settlement', 'Settlement', 'Idempotent settlement repeat']) {
      addRecord(name, 'SKIP', 'channel creation did not produce a usable channel ID');
    }
  }

  const escrowRows = [];
  let escrowMissing = false;
  let escrowId = null;
  const escrowCreateBody = { payerAgentId: 'agent:demo-payer', payeeAgentId: 'agent:demo-payee', amount: 1_000_000 };
  const escrowCreate = await requestJson(baseUrl, 'POST', '/v1/escrows', escrowCreateBody);
  printResponse(`POST /v1/escrows ${JSON.stringify(escrowCreateBody)}`, escrowCreate.response, escrowCreate.raw);
  if (escrowCreate.response.status === 404) {
    escrowMissing = true;
  } else {
    escrowId = escrowCreate.json?.escrowId ?? escrowCreate.json?.id ?? escrowCreate.json?.escrow?.escrowId ?? escrowCreate.json?.escrow?.id ?? escrowCreate.json?.data?.escrowId ?? escrowCreate.json?.data?.id;
    escrowRows.push({ name: 'Escrow create', result: escrowCreate.response.status === 201 && escrowId ? 'PASS' : 'FAIL', detail: escrowCreate.response.status === 201 && escrowId ? `HTTP 201; escrowId=${escrowId}` : `expected HTTP 201 and escrow ID; received HTTP ${escrowCreate.response.status}` });
    if (escrowId) {
      const inspectRoute = `/v1/escrows/${encodeURIComponent(escrowId)}/inspect`;
      const inspectBody = { artifact: Buffer.from('ATN demo artifact').toString('base64'), declaredMediaType: 'text/plain' };
      const inspected = await requestJson(baseUrl, 'POST', inspectRoute, inspectBody);
      printResponse(`POST ${inspectRoute} ${JSON.stringify(inspectBody)}`, inspected.response, inspected.raw);
      console.log(`ESCROW INSPECT outcome=${inspected.json?.outcome ?? inspected.json?.result?.outcome ?? 'missing'} reasons=${JSON.stringify(inspected.json?.reasons ?? inspected.json?.result?.reasons ?? [])}`);
      if (inspected.response.status === 404) {
        escrowMissing = true;
      } else {
        escrowRows.push({ name: 'Escrow inspect', result: inspected.response.status === 200 ? 'PASS' : 'FAIL', detail: `HTTP ${inspected.response.status}; outcome=${inspected.json?.outcome ?? inspected.json?.result?.outcome ?? 'missing'}; reasons=${JSON.stringify(inspected.json?.reasons ?? inspected.json?.result?.reasons ?? [])}` });
      }
      if (!escrowMissing) {
        const releaseRoute = `/v1/escrows/${encodeURIComponent(escrowId)}/release`;
        const released = await requestJson(baseUrl, 'POST', releaseRoute);
        printResponse(`POST ${releaseRoute}`, released.response, released.raw);
        if (released.response.status === 404) {
          escrowMissing = true;
        } else if (released.response.status === 200 && (released.json?.status ?? released.json?.escrow?.status ?? released.json?.data?.status) === 'RELEASED') {
          escrowRows.push({ name: 'Escrow release', result: 'PASS', detail: 'HTTP 200; status=RELEASED' });
        } else if (released.response.status === 409) {
          const detail = released.json?.detail ?? released.json?.message ?? released.json?.error ?? released.raw;
          console.log(`ESCROW RELEASE 409 detail=${detail}`);
          escrowRows.push({ name: 'Escrow release', result: 'FAIL', detail: `HTTP 409; ${String(detail)}` });
        } else {
          escrowRows.push({ name: 'Escrow release', result: 'FAIL', detail: `expected HTTP 200 with status RELEASED; received HTTP ${released.response.status}, status=${released.json?.status ?? 'missing'}` });
        }
      } else {
        escrowRows.push({ name: 'Escrow release', result: 'SKIP', detail: 'escrow routes not present on this commit' });
      }
    } else {
      escrowRows.push({ name: 'Escrow inspect', result: 'SKIP', detail: 'escrow creation did not return an escrow ID' });
      escrowRows.push({ name: 'Escrow release', result: 'SKIP', detail: 'escrow creation did not return an escrow ID' });
    }
  }
  if (escrowMissing) {
    for (const row of escrowRows) {
      row.result = 'SKIP';
      row.detail = 'escrow routes not present on this commit';
    }
    for (const name of ['Escrow create', 'Escrow inspect', 'Escrow release']) {
      if (!escrowRows.some((row) => row.name === name)) escrowRows.push({ name, result: 'SKIP', detail: 'escrow routes not present on this commit' });
    }
  }
  records.push(...escrowRows);
}

try {
  await run();
} catch (error) {
  addRecord('Demo execution', 'FAIL', error?.message ?? String(error));
} finally {
  for (const running of children) {
    if (running.exitCode === null && running.signalCode === null) running.kill('SIGKILL');
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${dbPath}${suffix}`, { force: true }); } catch { /* best-effort temp DB cleanup */ }
  }
  summarize();
}
