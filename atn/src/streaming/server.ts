import { createDatabase } from '../db/db.js';
import { startStreamingServer } from './ws.js';

const port = Number(process.env.PORT ?? 8787);
const delegationBudget = Number(process.env.DELEGATION_BUDGET ?? Number.MAX_SAFE_INTEGER);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
if (!Number.isSafeInteger(delegationBudget) || delegationBudget < 0) throw new Error('DELEGATION_BUDGET must be a non-negative safe integer in micro-dollars');

const db = createDatabase(process.env.ATN_DB_PATH ?? './atn.db');
const server = startStreamingServer({ db, port, delegationBudget });
server.on('listening', () => console.log(`Streaming WebSocket server listening on port ${port}`));

const shutdown = (): void => {
  server.close();
  db.close();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
