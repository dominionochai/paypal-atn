import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SCENARIOS, reportPasses, runScenario } from '../src/agents/scenarios.js';
import { GeminiClient, GeminiConfigError, ScriptedModel, buildGeminiRequest, call, calls, parseGeminiReply, say } from '../src/agents/model.js';
import type { ChatMessage, ToolSpec } from '../src/agents/model.js';
import { TOOL_SPECS, executeTool, newBuyerContext } from '../src/agents/buyer.js';
import { createWorld } from '../src/agents/world.js';
import { signDelegation } from '../src/trust/crypto.js';
import type { DelegationPayload } from '../src/trust/crypto.js';

describe('scenarios with the deterministic mock model', () => {
  for (const def of SCENARIOS) {
    it(def.name + ': every invariant and outcome holds, and no key material reaches the transcript', async () => {
      const report = await runScenario(def, { mode: 'mock' });
      const failed = report.checks.filter((check) => !check.ok).map((check) => check.name + ' (' + check.detail + ')');
      expect(failed).toEqual([]);
      expect(reportPasses(report)).toBe(true);
      expect(report.model).toContain('MOCK');
      expect(JSON.stringify(report)).not.toContain('PRIVATE KEY');
    }, 60_000);
  }
});

describe('server-side controls the agents rely on', () => {
  it('rejects a minCounterpartyTrust outside 0..1000', async () => {
    const world = await createWorld();
    try {
      const result = await world.client.createDelegation(world.principal, world.buyer, world.buyer.id, 1_000_000, [world.scraper.id], { minCounterpartyTrust: 2000 });
      expect(result.status).toBe(400);
    } finally {
      await world.close();
    }
  });

  it('covers minCounterpartyTrust with the principal signature: raising it after signing is FORGED_SIGNATURE', async () => {
    const world = await createWorld();
    try {
      const payload: DelegationPayload = {
        version: 1,
        delegationId: 'del-tamper',
        principalId: world.principal.id,
        agentId: world.buyer.id,
        ceiling: 1_000_000,
        scope: ['invoice.pay'],
        counterparties: [world.scraper.id],
        notBefore: null,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        minCounterpartyTrust: 100,
        nonce: 'n-' + randomBytes(6).toString('hex'),
      };
      const signature = signDelegation(payload, world.principal.privateKey);
      const tampered = await world.client.send('POST', '/v1/delegations', { payload: { ...payload, minCounterpartyTrust: 900 }, signature }, world.buyer);
      expect(tampered.status).toBe(422);
      expect(tampered.body.error).toBe('FORGED_SIGNATURE');
      const honest = await world.client.send('POST', '/v1/delegations', { payload, signature }, world.buyer);
      expect(honest.status).toBe(201);
    } finally {
      await world.close();
    }
  });

  it('lets the principal read its vault with a signed GET, and refuses a non-party agent and an unsigned read', async () => {
    const world = await createWorld();
    try {
      const snapshot = await world.client.vaultSnapshot(world.principal, world.vaultId);
      expect(snapshot).toMatchObject({ funded: 50_000_000, reserved: 0, committed: 0, available: 50_000_000, state: 'OPEN' });
      const other = await world.client.send('GET', '/v1/vaults/' + world.vaultId, undefined, world.buyer);
      expect(other.status).toBe(403);
      const unsigned = await world.client.send('GET', '/v1/vaults/' + world.vaultId, undefined);
      expect(unsigned.status).toBe(401);
    } finally {
      await world.close();
    }
  });

  it('refuses an unknown tool and bad arguments without throwing', async () => {
    const world = await createWorld();
    try {
      const ctx = newBuyerContext(world, 'good', false, 0);
      expect(await executeTool(ctx, call('transfer_everything', {}))).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
      expect(await executeTool(ctx, call('stream_pages', { count: 5 }))).toMatchObject({ ok: false, error: 'NO_CHANNEL' });
      expect(await executeTool(ctx, call('stream_pages', { count: 'many' }))).toMatchObject({ ok: false, error: 'BAD_ARGUMENT' });
      expect(await executeTool(ctx, call('open_channel', { worker: 'agent:scraper' }))).toMatchObject({ ok: false, error: 'BAD_ARGUMENT' });
      expect(TOOL_SPECS.map((spec) => spec.name)).not.toContain('transfer_everything');
    } finally {
      await world.close();
    }
  });
});

describe('ScriptedModel', () => {
  it('runs steps in order and then finishes with a plain answer', async () => {
    const model = new ScriptedModel([() => calls(call('list_workers')), () => say('done')]);
    expect((await model.generate('s', [], [])).toolCalls[0]?.name).toBe('list_workers');
    expect((await model.generate('s', [], [])).text).toBe('done');
    expect((await model.generate('s', [], [])).text).toBe('Task complete.');
  });
});

const SPEC: ToolSpec = { name: 'list_workers', description: 'List workers', parameters: { type: 'object', properties: {}, required: [] } };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('GeminiClient (stubbed network, request shape only)', () => {
  it('refuses a missing, mock or empty configuration', () => {
    expect(() => new GeminiClient({ apiKey: undefined, model: 'm' })).toThrow(GeminiConfigError);
    expect(() => new GeminiClient({ apiKey: 'mock-gemini-key', model: 'm' })).toThrow(GeminiConfigError);
    expect(() => new GeminiClient({ apiKey: 'real-key', model: '' })).toThrow(GeminiConfigError);
  });

  it('sends the key in a header (never the URL), temperature 0, tools, and groups consecutive tool results', async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: init?.headers as Record<string, string>, body: String(init?.body) });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    }) as typeof fetch;
    const client = new GeminiClient({ apiKey: 'secret-key-123', model: 'test-model', fetchImpl: stub });
    const messages: ChatMessage[] = [
      { role: 'user', text: 'goal' },
      { role: 'model', text: '', toolCalls: [call('list_workers'), call('get_trust', { worker: 'w' })] },
      { role: 'tool', callId: 'a', name: 'list_workers', result: { workers: [] } },
      { role: 'tool', callId: 'b', name: 'get_trust', result: { trust: 500 } },
    ];
    expect((await client.generate('system text', messages, [SPEC])).text).toBe('ok');
    const sent = seen[0];
    expect(sent?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    expect(sent?.url).not.toContain('secret-key-123');
    expect(sent?.headers['x-goog-api-key']).toBe('secret-key-123');
    const body = JSON.parse(sent?.body ?? '{}') as ReturnType<typeof buildGeminiRequest>;
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.systemInstruction.parts[0]?.text).toBe('system text');
    expect(body.tools[0]?.functionDeclarations[0]?.name).toBe('list_workers');
    expect(body.contents).toHaveLength(3);
    expect(body.contents[1]?.parts).toHaveLength(2);
    expect(body.contents[2]?.role).toBe('user');
    expect(body.contents[2]?.parts).toHaveLength(2);
  });

  it('parses function calls and text from a reply', () => {
    const reply = parseGeminiReply({ candidates: [{ content: { parts: [{ text: 'thinking' }, { functionCall: { name: 'open_channel', args: { worker: 'w', ceiling_micros: 5 } } }] } }] });
    expect(reply.text).toBe('thinking');
    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0]).toMatchObject({ name: 'open_channel', args: { worker: 'w', ceiling_micros: 5 } });
  });

  it('keeps Gemini 3 thought signatures and echoes them back unchanged on the function call and text parts', () => {
    const reply = parseGeminiReply({
      candidates: [{ content: { parts: [{ text: 'plan', thoughtSignature: 'sig-text' }, { functionCall: { name: 'get_vault_balance', args: {} }, thoughtSignature: 'sig-call-1' }, { functionCall: { name: 'get_trust', args: { worker: 'w' } } }] } }],
    });
    expect(reply.textSignature).toBe('sig-text');
    expect(reply.toolCalls[0]?.thoughtSignature).toBe('sig-call-1');
    expect(reply.toolCalls[1]?.thoughtSignature).toBeUndefined();
    const body = buildGeminiRequest('s', [
      { role: 'user', text: 'goal' },
      { role: 'model', text: reply.text, toolCalls: reply.toolCalls, ...(reply.textSignature !== undefined ? { textSignature: reply.textSignature } : {}) },
    ], [SPEC]);
    const modelParts = body.contents[1]?.parts ?? [];
    expect(modelParts[0]).toMatchObject({ text: 'plan', thoughtSignature: 'sig-text' });
    expect(modelParts[1]).toMatchObject({ functionCall: { name: 'get_vault_balance' }, thoughtSignature: 'sig-call-1' });
    expect(modelParts[2]?.thoughtSignature).toBeUndefined();
  });

  it('reports a blocked prompt instead of returning an empty answer', () => {
    expect(() => parseGeminiReply({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/blocked: SAFETY/);
  });

  it('redacts the key from HTTP error details and times out slow requests', async () => {
    const failing = (async () => new Response('bad request for key secret-key-123', { status: 400 })) as typeof fetch;
    const failClient = new GeminiClient({ apiKey: 'secret-key-123', model: 'm', fetchImpl: failing });
    await expect(failClient.generate('s', [], [SPEC])).rejects.toThrow(/HTTP 400.*\[redacted\]/);
    await expect(failClient.generate('s', [], [SPEC])).rejects.not.toThrow(/secret-key-123/);

    const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as typeof fetch;
    const slowClient = new GeminiClient({ apiKey: 'k', model: 'm', fetchImpl: hanging, timeoutMs: 25 });
    await expect(slowClient.generate('s', [], [SPEC])).rejects.toThrow(/timed out after 25 ms/);
  });
});
