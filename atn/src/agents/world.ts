import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDatabase } from '../db/db.js';
import type { Database } from '../db/db.js';
import { startHttpServer } from '../http/server.js';
import { AtnClient, newActor } from './client.js';
import type { Actor } from './client.js';

export const IDS = {
  principal: 'principal-human',
  buyer: 'agent:buyer',
  scraper: 'agent:scraper',
  datasci: 'agent:datasci',
  attacker: 'agent:attacker',
} as const;

export const VAULT_MICRO = 50_000_000;
const ADMIN_TOKEN = 'scenario-admin-token';
const ENV_KEYS = ['ATN_ADMIN_TOKEN', 'SETTLEMENT_MODE', 'HOST'] as const;

export interface WorldOptions {
  minCounterpartyTrust?: number;
}

export interface World {
  client: AtnClient;
  db: Database;
  principal: Actor;
  buyer: Actor;
  scraper: Actor;
  datasci: Actor;
  attacker: Actor;
  delegationId: number;
  vaultId: string;
  close(): Promise<void>;
}

function must(label: string, result: { status: number; body: Record<string, unknown> }, expected: number): Record<string, unknown> {
  if (result.status !== expected) {
    throw new Error('World setup failed at "' + label + '": HTTP ' + String(result.status) + ' ' + JSON.stringify(result.body));
  }
  return result.body;
}

/** Starts an in-process ATN server on a free port (simulated settlement only) and registers a full cast over HTTP. */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.ATN_ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.SETTLEMENT_MODE = 'SIMULATED';
  process.env.HOST = '127.0.0.1';

  const db = createDatabase(':memory:');
  const server: Server = startHttpServer(db, 0, VAULT_MICRO, { rateLimit: { max: 1_000_000, windowMs: 60_000 } });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const client = new AtnClient('http://127.0.0.1:' + String(port), ADMIN_TOKEN);

  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const principal = newActor(IDS.principal);
    const buyer = newActor(IDS.buyer);
    const scraper = newActor(IDS.scraper);
    const datasci = newActor(IDS.datasci);
    const attacker = newActor(IDS.attacker);

    must('register principal', await client.registerPrincipal(principal, 'Human principal'), 201);
    must('register buyer', await client.registerAgent(buyer, principal.id, 'Buyer agent', VAULT_MICRO), 201);
    must('register scraper', await client.registerAgent(scraper, principal.id, 'Scraper worker', 0), 201);
    must('register datasci', await client.registerAgent(datasci, principal.id, 'Data-science worker', 0), 201);
    must('register attacker', await client.registerAgent(attacker, principal.id, 'Unlisted agent', 0), 201);

    const delegationBody = must(
      'create delegation',
      await client.createDelegation(
        principal,
        buyer,
        buyer.id,
        VAULT_MICRO,
        [scraper.id, datasci.id],
        options.minCounterpartyTrust !== undefined ? { minCounterpartyTrust: options.minCounterpartyTrust } : {},
      ),
      201,
    );
    const delegationId = Number(delegationBody.delegationId);
    const vaultBody = must('open vault', await client.openVault(principal, delegationId, VAULT_MICRO), 201);
    const vaultId = String(vaultBody.id);

    return { client, db, principal, buyer, scraper, datasci, attacker, delegationId, vaultId, close };
  } catch (error) {
    await close();
    throw error;
  }
}
