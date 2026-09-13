// ═══════════════════════════════════════════════════════════════
//  M2-A SESSION TRANSPORT — selector + adapter contract
//  Default remains DEMO. Session requires explicit selection.
//  Mock socket only — no live account.
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-m2-'));
const REPO = process.cwd();
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP);

delete process.env.WHATSAPP_TOKEN;
delete process.env.PHONE_NUMBER_ID;
delete process.env.META_APP_SECRET;
delete process.env.SENTINEL_TRANSPORT;
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.WA_SESSION_DIR = path.join(TMP, 'wa-session');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.KILL_FILE = path.join(TMP, 'kill.json');

const { initAudit } = await import('../src/sentinel/audit.js');
const { initIdempotency } = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const { deliverToMeta, demoDeliver, startTypingPresence } = await import('../src/services/whatsapp.js');
const {
  TRANSPORT_IDS,
  CAPABILITIES,
  requestedTransportId,
  resolveTransport,
  sessionNotActivatedSend,
  metaSideEffectsAllowed,
} = await import('../src/sentinel/transport.js');
const { createSessionAdapter, MAX_RECONNECT_ATTEMPTS, RECONNECT_MS } = await import('../src/sentinel/session/adapter.js');
const { digitsFromJid, digitsToJid } = await import('../src/sentinel/session/jid.js');
const { interactiveToText, mapCloudPayload } = await import('../src/sentinel/session/payload.js');
const { ensureWaSessionDir, waSessionDir, markCorrupted } = await import('../src/sentinel/session/store.js');
const { evaluate } = await import('../src/sentinel/firewall.js');

initAudit();
initIdempotency();

const SRC_BAN = /baileys|whatsapp-web\.js|wppconnect|makeWASocket/i;
const LIB_FILE = path.join(REPO, 'src/sentinel/session/librarySocket.js');

function walkJs(dir, acc = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f === 'node_modules' || f === '.git') continue;
    if (fs.statSync(p).isDirectory()) walkJs(p, acc);
    else if (/\.(js|mjs)$/.test(f)) acc.push(p);
  }
  return acc;
}

function mockSocket() {
  const handlers = {};
  const sock = {
    sent: [],
    ev: {
      on(name, fn) { (handlers[name] ||= []).push(fn); },
      emit(name, data) { for (const fn of handlers[name] || []) fn(data); },
    },
    async sendMessage(jid, content) {
      sock.sent.push({ jid, content });
      return { key: { id: 'SESSOUT1' } };
    },
    async sendPresenceUpdate() { return true; },
    async readMessages() { return true; },
    async end() {},
  };
  return sock;
}

async function startedAdapter(extra = {}) {
  const sock = extra.sock || mockSocket();
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => sock,
    reconnectMs: extra.reconnectMs ?? 20,
    onUpsert: extra.onUpsert,
  });
  await adapter.start();
  sock.ev.emit('connection.update', { connection: 'open' });
  return { adapter, sock };
}

test('M2A.1 default selector: no tokens → demo; tokens → cloud; session not default', () => {
  assert.equal(requestedTransportId({}, false), 'demo');
  assert.equal(requestedTransportId({}, true), 'cloud');
  const d = resolveTransport({ live: false, deliverToMeta, demoDeliver });
  assert.equal(d.id, 'demo');
  assert.equal(d.sendFn, demoDeliver);
  const c = resolveTransport({ live: true, deliverToMeta, demoDeliver });
  assert.equal(c.id, 'cloud');
  assert.equal(c.sendFn, deliverToMeta);
  assert.notEqual(d.sendFn, c.sendFn);
});

test('M2A.2 SENTINEL_TRANSPORT=session without adapter sendFn stays fail-closed', async () => {
  const t = resolveTransport({
    env: { SENTINEL_TRANSPORT: 'session' },
    live: true,
    deliverToMeta,
    demoDeliver,
  });
  assert.equal(t.id, 'session');
  assert.equal(t.activated, false);
  assert.equal(t.sendFn, sessionNotActivatedSend);
  await assert.rejects(() => t.sendFn({ to: '1', type: 'text' }), (e) => e.code === 'SESSION_TRANSPORT_NOT_ACTIVATED');
});

test('M2A.3 explicit session uses adapter sendFn — never dual with cloud/demo', async () => {
  const { adapter } = await startedAdapter();
  const t = resolveTransport({
    env: { SENTINEL_TRANSPORT: 'session' },
    live: true,
    deliverToMeta,
    demoDeliver,
    sessionSendFn: adapter.sendFn,
  });
  assert.equal(t.id, 'session');
  assert.equal(t.sendFn, adapter.sendFn);
  assert.notEqual(t.sendFn, deliverToMeta);
  assert.notEqual(t.sendFn, demoDeliver);
  const cloud = resolveTransport({ live: true, deliverToMeta, demoDeliver, sessionSendFn: adapter.sendFn });
  assert.equal(cloud.id, 'cloud');
  assert.equal(cloud.sendFn, deliverToMeta);
});

test('M2A.4 unknown selector fails closed', async () => {
  const t = resolveTransport({
    env: { SENTINEL_TRANSPORT: 'pigeon' },
    live: true,
    deliverToMeta,
    demoDeliver,
  });
  assert.equal(t.error, 'UNKNOWN_TRANSPORT');
  await assert.rejects(() => t.sendFn({}), (e) => e.code === 'SESSION_TRANSPORT_NOT_ACTIVATED');
});

test('M2A.5 capabilities: session has no native interactive/template; cloud typing remains', () => {
  assert.deepEqual([...TRANSPORT_IDS], ['demo', 'cloud', 'session']);
  assert.equal(CAPABILITIES.session.interactiveNative, false);
  assert.equal(CAPABILITIES.session.template, false);
  assert.equal(CAPABILITIES.session.buttons, false);
  assert.equal(CAPABILITIES.cloud.typing, true);
  assert.equal(CAPABILITIES.demo.live_send, false);
});

test('M2A.6 Meta side effects only on live cloud', async () => {
  assert.equal(metaSideEffectsAllowed({ SENTINEL_TRANSPORT: 'session' }, true), false);
  assert.equal(metaSideEffectsAllowed({}, false), false);
  assert.equal(metaSideEffectsAllowed({}, true), true);
  process.env.SENTINEL_TRANSPORT = 'session';
  assert.equal(await startTypingPresence('923000000000', 'wamid.x'), null);
  delete process.env.SENTINEL_TRANSPORT;
});

test('M2A.7 adapter CONNECTED send is submitted not DELIVERED; JID mapped', async () => {
  const { adapter, sock } = await startedAdapter();
  const r = await adapter.sendFn({
    messaging_product: 'whatsapp',
    to: '923001119999',
    type: 'text',
    text: { body: 'hello' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.submitted, true);
  assert.equal(r.delivered, false);
  assert.equal(r.evidence, 'adapter_accepted');
  assert.equal(sock.sent[0].jid, '923001119999@s.whatsapp.net');
  assert.equal(sock.sent[0].content.text, 'hello');
});

test('M2A.8 send before CONNECTED throws SESSION_NOT_CONNECTED (outbox can retry)', async () => {
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => sock,
  });
  await adapter.start();
  await assert.rejects(
    () => adapter.sendFn({ to: '923001119999', type: 'text', text: { body: 'x' } }),
    (e) => e.code === 'SESSION_NOT_CONNECTED',
  );
});

test('M2A.9 QR is bounded, owner-only, never written to audit file', async () => {
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => sock,
  });
  await adapter.start();
  sock.ev.emit('connection.update', { qr: 'SECRET-QR-PAYLOAD' });
  assert.equal(adapter.getState().state, 'NEEDS_QR');
  assert.equal(adapter.getState().qrAvailable, true);
  assert.throws(() => adapter.takeQr({ role: 'STAFF' }), (e) => e.code === 'OWNER_ONLY');
  const qr = adapter.takeQr({ role: 'OWNER' });
  assert.equal(qr, 'SECRET-QR-PAYLOAD');
  const audit = fs.readFileSync(process.env.AUDIT_FILE, 'utf8');
  assert.equal(audit.includes('SECRET-QR-PAYLOAD'), false);
});

test('M2A.10 401 → AUTH_REQUIRED, no reconnect loop', async () => {
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => sock,
    reconnectMs: 10,
  });
  await adapter.start();
  sock.ev.emit('connection.update', { connection: 'open' });
  sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');
});

test('M2A.11 reconnect 408 → RECONNECTING then mock restore CONNECTED', async () => {
  let opens = 0;
  let current;
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    reconnectMs: 15,
    openSocket: async () => {
      opens += 1;
      current = mockSocket();
      return current;
    },
  });
  await adapter.start();
  current.ev.emit('connection.update', { connection: 'open' });
  current.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  assert.equal(adapter.getState().state, 'RECONNECTING');
  await new Promise((r) => setTimeout(r, 50));
  current.ev.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.getState().state, 'CONNECTED');
  assert.ok(opens >= 2);
});

test('M2A.12 corrupted session → AUTH_REQUIRED, no send', async () => {
  markCorrupted(process.env.WA_SESSION_DIR, 'test');
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => mockSocket(),
  });
  await adapter.start();
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');
  await assert.rejects(
    () => adapter.sendFn({ to: '923001119999', type: 'text', text: { body: 'x' } }),
    (e) => e.code === 'SESSION_NOT_CONNECTED',
  );
  fs.rmSync(path.join(process.env.WA_SESSION_DIR, 'CORRUPTED'), { force: true });
});

test('M2A.13 secure storage path is not SESSIONS_DIR and is 0700', () => {
  const d = ensureWaSessionDir(process.env.WA_SESSION_DIR);
  assert.equal(d, path.resolve(process.env.WA_SESSION_DIR));
  assert.notEqual(d, path.resolve(process.env.SESSIONS_DIR));
  assert.equal(waSessionDir(process.env.WA_SESSION_DIR).includes('sessions') && !waSessionDir(process.env.WA_SESSION_DIR).includes('wa-session'), false);
  const mode = fs.statSync(d).mode & 0o777;
  assert.equal(mode, 0o700);
});

test('M2A.14 interactive → deterministic text; template unsupported', () => {
  const text = interactiveToText({
    type: 'button',
    body: { text: 'Pick a colour' },
    action: { buttons: [{ reply: { title: 'Black' } }, { reply: { title: 'Gold' } }] },
  });
  assert.match(text, /Pick a colour/);
  assert.match(text, /1\. Black/);
  assert.match(text, /2\. Gold/);
  const mapped = mapCloudPayload({
    to: '923001119999',
    type: 'interactive',
    interactive: { type: 'button', body: { text: 'Pick' }, action: { buttons: [{ reply: { title: 'A' } }] } },
  });
  assert.equal(mapped.fallback, true);
  assert.equal(mapped.content.text.includes('1. A'), true);
  assert.throws(
    () => mapCloudPayload({ to: '923001119999', type: 'template', template: { name: 'hello' } }),
    (e) => e.code === 'SESSION_TEMPLATE_UNSUPPORTED',
  );
});

test('M2A.15 JID digits round-trip', () => {
  assert.equal(digitsFromJid('923001119999@s.whatsapp.net'), '923001119999');
  assert.equal(digitsToJid('923001119999'), '923001119999@s.whatsapp.net');
  assert.equal(digitsFromJid('120@g.us'), null);
});

test('M2A.16 outbound through outbox uses session sendFn; firewall still required on facade', async () => {
  const { adapter, sock } = await startedAdapter();
  const ob = createOutbox({
    dir: path.join(TMP, 'ob-sess'),
    sendFn: adapter.sendFn,
    pollMs: 10,
  });
  ob.enqueue({ messaging_product: 'whatsapp', to: '923001119999', type: 'text', text: { body: 'via outbox' } }, { source: 'AI' });
  await ob.tick();
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].content.text, 'via outbox');
  const sentFiles = fs.readdirSync(ob.dirs.D);
  assert.equal(sentFiles.length, 1);
  const job = JSON.parse(fs.readFileSync(path.join(ob.dirs.D, sentFiles[0]), 'utf8'));
  assert.equal(job.status, 'SENT');
  assert.match(job.providerResult, /submitted/);
  assert.equal(job.providerResult.includes('"delivered":true'), false);
  ob.stop();

  const blocked = evaluate({ class: 'CUSTOMER_MESSAGE', source: 'AI', toPhone: '923001119999' });
  assert.ok(blocked.decision === 'ALLOW' || blocked.decision === 'DENY');
  const wa = fs.readFileSync(path.join(REPO, 'src/services/whatsapp.js'), 'utf8');
  assert.match(wa, /firewall\.evaluate/);
  assert.match(wa, /outbox\.enqueue/);
});

test('M2A.17 index uses resolveTransport; production path still firewall → outbox', () => {
  const idx = fs.readFileSync(path.join(REPO, 'src/index.js'), 'utf8');
  assert.match(idx, /resolveTransport/);
  assert.match(idx, /sendFn: transport\.sendFn/);
  assert.equal(/isLive\(\) \? deliverToMeta : demoDeliver/.test(idx), false);
  assert.equal(SRC_BAN.test(idx), false);
});

test('M2A.18 no session library outside librarySocket.js; pin 6.7.24', () => {
  for (const f of walkJs(path.join(REPO, 'src'))) {
    if (f === LIB_FILE) continue;
    const s = fs.readFileSync(f, 'utf8');
    assert.equal(SRC_BAN.test(s), false, f);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@whiskeysockets/baileys'], '6.7.24');
  assert.match(fs.readFileSync(LIB_FILE, 'utf8'), /6\.7\.24/);
});

test('M2A.19 AUTH_REQUIRED + late socket open stays AUTH_REQUIRED; send blocked', async () => {
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    openSocket: async () => sock,
    reconnectMs: 10,
  });
  await adapter.start();
  sock.ev.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.getState().state, 'CONNECTED');
  sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');

  sock.ev.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');
  await assert.rejects(
    () => adapter.sendFn({ to: '923001119999', type: 'text', text: { body: 'x' } }),
    (e) => e.code === 'SESSION_NOT_CONNECTED',
  );
  sock.ev.emit('connection.update', { qr: 'SHOULD-NOT-PAIR' });
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');
  assert.equal(adapter.getState().qrAvailable, false);
  await adapter.start();
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');
  await adapter.stop();
  assert.equal(adapter.getState().state, 'AUTH_REQUIRED');
});

test('M2A.20 owner resetAuth is the only in-process way out of AUTH_REQUIRED; no QR loop', async () => {
  let opens = 0;
  let current;
  const adapter = createSessionAdapter({
    authDir: process.env.WA_SESSION_DIR,
    reconnectMs: 10,
    openSocket: async () => {
      opens += 1;
      current = mockSocket();
      return current;
    },
  });
  await adapter.start();
  current.ev.emit('connection.update', { connection: 'open' });
  const opensAfterConnect = opens;
  current.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(opens, opensAfterConnect, '401 must not reconnect');
  assert.throws(() => adapter.resetAuth({ role: 'STAFF' }), (e) => e.code === 'OWNER_ONLY');
  const snap = adapter.resetAuth({ role: 'OWNER' });
  assert.equal(snap.state, 'STOPPED');
  await adapter.start();
  current.ev.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.getState().state, 'CONNECTED');
});

test('M2A.21 reconnect budget exhaustion → DEGRADED; creds intact; owner start retries', async () => {
  assert.equal(MAX_RECONNECT_ATTEMPTS, 5);
  assert.equal(RECONNECT_MS, 1500);
  const dir = process.env.WA_SESSION_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const credsPath = path.join(dir, 'creds.json');
  fs.writeFileSync(credsPath, JSON.stringify({ registered: true, dummy: 'x'.repeat(40) }));

  let opens = 0;
  let current;
  const adapter = createSessionAdapter({
    authDir: dir,
    reconnectMs: 10,
    maxReconnectAttempts: 3,
    openSocket: async () => {
      opens += 1;
      current = mockSocket();
      return current;
    },
  });
  await adapter.start();
  current.ev.emit('connection.update', { connection: 'open' });
  for (let i = 0; i < 3; i++) {
    current.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
    assert.equal(adapter.getState().state, 'RECONNECTING');
    await new Promise((r) => setTimeout(r, 10 * (i + 1) + 25));
  }
  current.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  assert.equal(adapter.getState().state, 'DEGRADED');
  const afterBudget = opens;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(opens, afterBudget, 'exhausted budget must not keep reconnecting');
  assert.equal(adapter.getState().state, 'DEGRADED');
  current.ev.emit('connection.update', { qr: 'NO-AUTO-QR' });
  assert.equal(adapter.getState().state, 'DEGRADED');
  assert.equal(adapter.getState().qrAvailable, false);
  assert.equal(fs.existsSync(credsPath), true);
  assert.ok(fs.statSync(credsPath).size > 32);
  await assert.rejects(
    () => adapter.sendFn({ to: '923001119999', type: 'text', text: { body: 'x' } }),
    (e) => e.code === 'SESSION_NOT_CONNECTED',
  );

  await adapter.start();
  current.ev.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.getState().state, 'CONNECTED');
  const sent = await adapter.sendFn({ to: '923001119999', type: 'text', text: { body: 'retry' } });
  assert.equal(sent.submitted, true);
  assert.equal(sent.delivered, false);
});

test('ISO. shipped owner files were not mutated', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
