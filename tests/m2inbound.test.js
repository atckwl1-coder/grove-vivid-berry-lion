// M2-B inbound: library upsert → sessionInbound → injected deliver (brain)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-m2in-'));
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP);

delete process.env.SENTINEL_TRANSPORT;
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.WA_SESSION_DIR = path.join(TMP, 'wa-session');
process.env.KILL_FILE = path.join(TMP, 'kill.json');
process.env.TENANT_ID = 'khanewal-demo';

const { initAudit } = await import('../src/sentinel/audit.js');
const { initIdempotency, claimEvent } = await import('../src/sentinel/idempotency.js');
const inboundMod = await import('../src/sentinel/sessionInbound.js');
const { createSessionAdapter } = await import('../src/sentinel/session/adapter.js');
const { sessionInboundHandlers } = await import('../src/sentinel/session/bindInbound.js');

initAudit();
initIdempotency();

function mockSocket() {
  const handlers = {};
  return {
    ev: {
      on(name, fn) { (handlers[name] ||= []).push(fn); },
      emit(name, data) { for (const fn of handlers[name] || []) fn(data); },
    },
    async sendMessage() { return { key: { id: 'x' } }; },
    async end() {},
  };
}

function waMsg({ id, text = 'hi', from = '923001119999' }) {
  return {
    key: { id, remoteJid: from + '@s.whatsapp.net', fromMe: false },
    message: { conversation: text },
  };
}

async function liveBound({ deliver }) {
  inboundMod.resetSessionInboundState();
  const handlers = sessionInboundHandlers({ deliver, activated: true });
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => sock,
    onConnection: handlers.onConnection,
    onUpsert: handlers.onUpsert,
  });
  handlers.onStart();
  await adapter.start();
  sock.ev.emit('connection.update', { connection: 'open' });
  return { adapter, sock, handlers };
}

test('M2B.1 notify while pending catch-up is claimed and delivered once', async () => {
  const delivered = [];
  const { sock } = await liveBound({ deliver: async (n) => delivered.push(n) });
  await sock.ev.emit('messages.upsert', { type: 'notify', messages: [waMsg({ id: '3EB0IN1', text: 'menu' })] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].id, '3EB0IN1');
  assert.equal(delivered[0].from, '923001119999');
  assert.equal(claimEvent(inboundMod.sessionClaimId('3EB0IN1')), false);
});

test('M2B.2 append during catch-up is outage mail', async () => {
  const delivered = [];
  const { sock } = await liveBound({ deliver: async (n) => delivered.push(n) });
  await sock.ev.emit('messages.upsert', { type: 'append', messages: [waMsg({ id: '3EB0AP1', text: 'after outage' })] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(delivered[0].text.body, 'after outage');
});

test('M2B.3 notify then append same id is one deliver', async () => {
  const delivered = [];
  const { sock } = await liveBound({ deliver: async (n) => delivered.push(n) });
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [waMsg({ id: '3EB0DUP', text: 'one' })] });
  await new Promise((r) => setTimeout(r, 0));
  sock.ev.emit('messages.upsert', { type: 'append', messages: [waMsg({ id: '3EB0DUP', text: 'one' })] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(delivered.length, 1);
});

test('M2B.4 RPN drain then stale append skipped; notify live', async () => {
  const delivered = [];
  const { sock } = await liveBound({ deliver: async (n) => delivered.push(n) });
  sock.ev.emit('messages.upsert', { type: 'append', messages: [waMsg({ id: '3EB0C1', text: 'catch' })] });
  await new Promise((r) => setTimeout(r, 0));
  sock.ev.emit('connection.update', { receivedPendingNotifications: true });
  await inboundMod.flushSessionInbound();
  assert.equal(inboundMod.isCaughtUp(), true);
  sock.ev.emit('messages.upsert', { type: 'append', messages: [waMsg({ id: '3EB0OLD', text: 'hist' })] });
  await new Promise((r) => setTimeout(r, 0));
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [waMsg({ id: '3EB0LIVE', text: 'now' })] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(delivered.map((d) => d.id), ['3EB0C1', '3EB0LIVE']);
});

test('M2B.5 reconnect holds ingest; restore append accepted', async () => {
  const delivered = [];
  const { sock } = await liveBound({ deliver: async (n) => delivered.push(n) });
  sock.ev.emit('connection.update', { receivedPendingNotifications: true });
  await inboundMod.flushSessionInbound();
  sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  sock.ev.emit('messages.upsert', { type: 'append', messages: [waMsg({ id: '3EB0RC', text: 'held' })] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(delivered.length, 0);
  sock.ev.emit('connection.update', { connection: 'open' });
  sock.ev.emit('messages.upsert', { type: 'append', messages: [waMsg({ id: '3EB0RC', text: 'held' })] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(delivered.length, 1);
});

test('M2B.6 inactive bind does not deliver (default not activated)', async () => {
  inboundMod.resetSessionInboundState();
  const delivered = [];
  const handlers = sessionInboundHandlers({ deliver: async (n) => delivered.push(n), activated: false });
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => sock,
    onConnection: handlers.onConnection,
    onUpsert: handlers.onUpsert,
  });
  handlers.onStart();
  await adapter.start();
  sock.ev.emit('connection.update', { connection: 'open' });
  sock.ev.emit('messages.upsert', { type: 'notify', messages: [waMsg({ id: '3EB0NO', text: 'x' })] });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(delivered.length, 0);
});

test('M2B.7 sole processor is injected deliver — bind file has no firewall/outbox', () => {
  const src = fs.readFileSync(new URL('../src/sentinel/session/bindInbound.js', import.meta.url), 'utf8');
  assert.match(src, /handleIncomingMessage/);
  assert.equal(src.includes("from '../sessionInbound.js'"), true);
  assert.equal(/firewall|outbox|brain/.test(src), false);
});

test('ISO. owner files unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
