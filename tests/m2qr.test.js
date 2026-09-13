// M2-F owner QR/status UI + Windows-safe store ACL
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-m2qr-'));
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
  { id: 'staffA', password: 'staffa-pass-1', role: 'STAFF', tenant: 'khanewal-demo' },
]);

const { initAudit } = await import('../src/sentinel/audit.js');
const { initIdempotency } = await import('../src/sentinel/idempotency.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');
const { initKill } = await import('../src/sentinel/killswitch.js');
const { loadDb } = await import('../src/services/customers.js');
const { buildApp } = await import('../src/app.js');
const { createSessionAdapter } = await import('../src/sentinel/session/adapter.js');
const { setSessionRuntime } = await import('../src/sentinel/session/runtime.js');
const { ensureWaSessionDir } = await import('../src/sentinel/session/store.js');

initAudit();
initIdempotency();
initKill();
loadDb();
seedStaffIfMissing();

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

const sock = mockSocket();
const adapter = createSessionAdapter({
  authDir: process.env.WA_SESSION_DIR,
  openSocket: async () => sock,
});
await adapter.start();
sock.ev.emit('connection.update', { qr: 'SECRET-M2-QR' });
setSessionRuntime({ adapter, transportId: 'session' });

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function login(id, password) {
  const r = await fetch(base + '/inbox/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
    body: new URLSearchParams({ id, password }),
  });
  const cookie = r.headers.get('set-cookie');
  return cookie.split(';')[0];
}

test('M2F.1 OWNER can read session status JSON; QR payload is not in JSON', async () => {
  const cookie = await login('boss', 'boss-pass-007');
  const r = await fetch(base + '/inbox/session?json=1', { headers: { cookie } });
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.session.state, 'NEEDS_QR');
  assert.equal(body.session.qrAvailable, true);
  assert.equal(JSON.stringify(body).includes('SECRET-M2-QR'), false);
});

test('M2F.2 STAFF is denied session status', async () => {
  const cookie = await login('staffA', 'staffa-pass-1');
  const r = await fetch(base + '/inbox/session?json=1', { headers: { cookie } });
  assert.equal(r.status, 403);
});

test('M2F.3 QR route never writes payload to audit', async () => {
  const cookie = await login('boss', 'boss-pass-007');
  const r = await fetch(base + '/inbox/session/qr', { headers: { cookie } });
  assert.ok([200, 503].includes(r.status));
  if (r.status === 200) assert.match(r.headers.get('content-type') || '', /png|octet-stream/);
  const audit = fs.readFileSync(process.env.AUDIT_FILE, 'utf8');
  assert.equal(audit.includes('SECRET-M2-QR'), false);
});

test('M2F.4 store ACL helper is best-effort (Windows-safe chmod)', () => {
  const d = ensureWaSessionDir(process.env.WA_SESSION_DIR);
  assert.ok(fs.existsSync(d));
  // chmod 0700 is attempted; on Windows the platform may ignore — existence is the portable contract
});

test('ISO. owner unchanged', async () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
  server.close();
});
