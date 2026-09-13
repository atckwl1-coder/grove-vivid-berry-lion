// M2-D persistence / restore / reconnect (mock socket, no live account)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-m2p-'));
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP);
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.WA_SESSION_DIR = path.join(TMP, 'wa-session');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.KILL_FILE = path.join(TMP, 'kill.json');

const { initAudit } = await import('../src/sentinel/audit.js');
const { createSessionAdapter } = await import('../src/sentinel/session/adapter.js');
const { ensureWaSessionDir, credsPresent } = await import('../src/sentinel/session/store.js');

initAudit();

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

test('M2D.1 creds on disk restore starts CONNECTING without QR', async () => {
  const dir = ensureWaSessionDir(process.env.WA_SESSION_DIR);
  fs.writeFileSync(path.join(dir, 'creds.json'), JSON.stringify({ registered: true, dummy: 'x'.repeat(40) }));
  assert.equal(credsPresent(dir), true);
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: dir,
    openSocket: async () => sock,
  });
  const snap = await adapter.start();
  assert.equal(snap.state, 'CONNECTING');
  assert.equal(snap.qrSeq, 0);
  assert.equal(snap.qrAvailable, false);
  sock.ev.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.getState().state, 'CONNECTED');
  assert.equal(adapter.getState().qrSeq, 0);
});

test('M2D.2 stop then start restores without emitting QR', async () => {
  const dir = process.env.WA_SESSION_DIR;
  const sock = mockSocket();
  const adapter = createSessionAdapter({
    authDir: dir,
    openSocket: async () => sock,
  });
  await adapter.start();
  sock.ev.emit('connection.update', { connection: 'open' });
  await adapter.stop();
  assert.equal(adapter.getState().state, 'STOPPED');
  await adapter.start();
  sock.ev.emit('connection.update', { connection: 'open' });
  assert.equal(adapter.getState().state, 'CONNECTED');
  assert.equal(adapter.getState().qrAvailable, false);
});

test('ISO. owner unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
