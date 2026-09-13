// M2-E kill / firewall / CAP-008 still bind on the session sendFn
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-m2k-'));
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
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pass-007', role: 'OWNER', tenant: 'khanewal-demo' },
]);

const { initAudit } = await import('../src/sentinel/audit.js');
const { initIdempotency } = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const kill = await import('../src/sentinel/killswitch.js');
const { createSessionAdapter } = await import('../src/sentinel/session/adapter.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');

initAudit();
initIdempotency();
kill.initKill();
seedStaffIfMissing();

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
      return { key: { id: 'K1' } };
    },
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
  autonomyGuard: (job) => (kill.isAutonomousJob(job) ? kill.gateForSend(job.payload?.to, { source: job.meta?.source }) : { ok: true }),
  pollMs: 10,
  retry: { maxAttempts: 2, baseMs: 1, maxMs: 5 },
});
wa.initOutbox(ob);
kill.onKillStop(() => ob.holdAutonomous(kill.isAutonomousJob));
kill.onKillResume(() => ob.releaseHeld());

test('M2E.1 kill ON blocks autonomous session send; human still allowed', async () => {
  const actor = { staffId: 'boss', role: 'OWNER' };
  kill.stopAll(actor, 'kill-m2e-0001', 'test stop');
  await assert.rejects(
    () => wa.sendText('923001119999', 'bot should not send', { source: 'AI' }),
    (e) => e.code === 'KILL_SWITCH_ACTIVE' || String(e.message).includes('KILL'),
  );
  sock.sent.length = 0;
  await wa.enqueueAsHuman('923001119999', 'staff still can', { staffId: 'boss', actor });
  await ob.tick();
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].content.text, 'staff still can');
});

test('M2E.2 kill OFF resumes autonomous path', async () => {
  const actor = { staffId: 'boss', role: 'OWNER' };
  kill.resumeAll(actor, 'kill-m2e-0002', 'test resume', 'RESUME');
  sock.sent.length = 0;
  await wa.sendText('923001119999', 'bot again', { source: 'AI' });
  await ob.tick();
  assert.equal(sock.sent[0].content.text, 'bot again');
  ob.stop();
});

test('ISO. owner unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
