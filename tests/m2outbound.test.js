// M2-C outbound: facade → firewall → outbox → session adapter
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-m2out-'));
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP);

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.WA_SESSION_DIR = path.join(TMP, 'wa-session');
process.env.KILL_FILE = path.join(TMP, 'kill.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
delete process.env.SENTINEL_TRANSPORT;

const { initAudit } = await import('../src/sentinel/audit.js');
const { initIdempotency } = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const { createSessionAdapter } = await import('../src/sentinel/session/adapter.js');
const { initKill } = await import('../src/sentinel/killswitch.js');

initAudit();
initIdempotency();
initKill();

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
      return { key: { id: 'OUT1' } };
    },
    async sendPresenceUpdate() { return true; },
    async end() {},
  };
  return sock;
}

const sock = mockSocket();
const adapter = createSessionAdapter({
  authDir: process.env.WA_SESSION_DIR,
  openSocket: async () => sock,
});
await adapter.start();
sock.ev.emit('connection.update', { connection: 'open' });

const ob = createOutbox({
  dir: path.join(TMP, 'ob'),
  sendFn: adapter.sendFn,
  pollMs: 10,
  retry: { maxAttempts: 2, baseMs: 1, maxMs: 5 },
});
wa.initOutbox(ob);

test('M2C.1 sendText goes facade → firewall → outbox → session socket', async () => {
  const job = await wa.sendText('923001119999', 'hello session', { source: 'AI' });
  assert.equal(job.queued, true);
  await ob.tick();
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].content.text, 'hello session');
  assert.equal(sock.sent[0].jid.endsWith('@s.whatsapp.net'), true);
});

test('M2C.2 interactive buttons become text fallback — not native interactive', async () => {
  sock.sent.length = 0;
  await wa.sendButtons('923001119999', 'Colour?', [{ title: 'Black' }, { title: 'Gold' }]);
  await ob.tick();
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].content.image, undefined);
  assert.match(sock.sent[0].content.text, /Colour\?/);
  assert.match(sock.sent[0].content.text, /1\. Black/);
});

test('M2C.3 template is honest unsupported (sendFn throws, outbox retries/DLQ)', async () => {
  sock.sent.length = 0;
  await wa.sendTemplate('923001119999', 'hello_world');
  await ob.tick();
  await new Promise((r) => setTimeout(r, 15));
  await ob.tick();
  await new Promise((r) => setTimeout(r, 15));
  await ob.tick();
  assert.equal(sock.sent.length, 0);
  const dlq = fs.readdirSync(ob.dirs.F);
  assert.ok(dlq.length >= 1);
});

test('M2C.4 CAP-008 human send uses the same facade/outbox', async () => {
  sock.sent.length = 0;
  await wa.enqueueAsHuman('923001119999', 'staff hello', { staffId: 'boss', actor: { staffId: 'boss', role: 'OWNER' } });
  await ob.tick();
  assert.equal(sock.sent[0].content.text, 'staff hello');
});

test('M2C.5 typing failure does not throw into the send path', async () => {
  const r = await adapter.startTyping('923001119999', '923001119999@s.whatsapp.net');
  assert.equal(r.ok, true);
  sock.sendPresenceUpdate = async () => { throw new Error('presence down'); };
  const r2 = await adapter.startTyping('923001119999', '923001119999@s.whatsapp.net');
  assert.equal(r2, null);
});

test('ISO. owner files unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
  ob.stop();
});
