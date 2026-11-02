import { WebSocketServer, WebSocket } from 'ws';
import { acceptVoucher, getChannel, type Db } from './channel.js';
import type { VoucherInput } from './voucher.js';

export function startStreamingServer(p: { db: Db; port?: number; delegationBudget: number }): WebSocketServer {
  const port = p.port ?? Number(process.env.PORT ?? 8787);
  const wss = new WebSocketServer({ port });
  const watchers = new Map<string, Set<WebSocket>>();
  const send = (ws: WebSocket, msg: unknown): void => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        let msg: { type?: string; channelId?: string; voucher?: VoucherInput };
        try { msg = JSON.parse(raw.toString()) as typeof msg; } catch { send(ws, { type: 'error', code: 'BAD_MESSAGE' }); return; }
        if (msg.type !== 'voucher' || !msg.channelId || !msg.voucher) { send(ws, { type: 'error', code: 'BAD_MESSAGE' }); return; }
        const channelId = msg.channelId;
        if (!watchers.has(channelId)) watchers.set(channelId, new Set());
        watchers.get(channelId)?.add(ws);
        const ch = getChannel(p.db, channelId);
        if (!ch) { send(ws, { type: 'reject', channelId, code: 'UNKNOWN_CHANNEL', detail: 'no such channel' }); return; }
        const result = acceptVoucher(p.db, channelId, msg.voucher, p.delegationBudget);
        if (!result.ok) { send(ws, { type: 'reject', channelId, code: result.code, detail: result.detail }); return; }
        const updated = getChannel(p.db, channelId);
        if (!updated) { send(ws, { type: 'error', code: 'INTERNAL', detail: 'channel vanished' }); return; }
        send(ws, { type: 'ack', channelId, spent: updated.spent, ceiling: updated.ceiling });
        for (const w of watchers.get(channelId) ?? []) send(w, { type: 'state', channelId, spent: updated.spent, ceiling: updated.ceiling, status: updated.status });
      } catch (e) { send(ws, { type: 'error', code: 'INTERNAL', detail: e instanceof Error ? e.message : 'unknown' }); }
    });
    ws.on('close', () => { for (const set of watchers.values()) set.delete(ws); });
  });
  return wss;
}
