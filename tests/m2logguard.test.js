// M2 live blocker: Signal session dumps must not reach stdout/audit/evidence
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-m2log-'));
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP);
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.KILL_FILE = path.join(TMP, 'kill.json');

const {
  installSessionLibraryConsoleGuard,
  shouldDropLibraryConsoleArgs,
  looksLikeSignalKeyMaterial,
} = await import('../src/sentinel/session/libraryConsoleGuard.js');
const { initAudit, audit, payloadHasKeyMaterial } = await import('../src/sentinel/audit.js');
const { log } = await import('../src/utils/logger.js');
const { noteConnectionUpdate, getSessionInboundState, resetSessionInboundState } = await import('../src/sentinel/sessionInbound.js');

initAudit();
installSessionLibraryConsoleGuard();

const FAKE_SESSION = {
  currentRatchet: {
    ephemeralKeyPair: { pubKey: Buffer.from('pub'), privKey: Buffer.from('TOPSECRETPRIVKEYMATERIAL') },
    rootKey: Buffer.from('TOPSECRETROOTKEYMATERIAL'),
  },
  pendingPreKey: { preKeyId: 1 },
  indexInfo: { closed: -1 },
  _chains: { x: { chainKey: {}, chainType: 1 } },
};

test('M2G.1 recognizer catches libsignal Closing session dump', () => {
  assert.equal(shouldDropLibraryConsoleArgs(['Closing session:', FAKE_SESSION]), true);
  assert.equal(shouldDropLibraryConsoleArgs(['Opening session:', FAKE_SESSION]), true);
  assert.equal(shouldDropLibraryConsoleArgs(['Closing open session in favor of incoming prekey bundle']), true);
  assert.equal(looksLikeSignalKeyMaterial(FAKE_SESSION), true);
  assert.equal(shouldDropLibraryConsoleArgs(['🌙 NOOR is awake on port 3000']), false);
  assert.equal(shouldDropLibraryConsoleArgs(['SESSION_TRANSPORT', { state: 'CONNECTED' }]), false);
});

test('M2G.2 console.info dump does not reach stdout', () => {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c, ...rest) => {
    chunks.push(String(c));
    return true;
  };
  try {
    console.info('Closing session:', FAKE_SESSION);
    console.info('operational sentinel log line');
  } finally {
    process.stdout.write = orig;
  }
  const out = chunks.join('');
  assert.equal(out.includes('TOPSECRETPRIVKEYMATERIAL'), false);
  assert.equal(out.includes('TOPSECRETROOTKEYMATERIAL'), false);
  assert.equal(out.includes('currentRatchet'), false);
  assert.match(out, /operational sentinel log line/);
});

test('M2G.3 audit refuses to persist key material', () => {
  audit('PROBE_KEY_DUMP', FAKE_SESSION);
  const raw = fs.readFileSync(process.env.AUDIT_FILE, 'utf8');
  assert.equal(raw.includes('TOPSECRETPRIVKEYMATERIAL'), false);
  assert.equal(raw.includes('TOPSECRETROOTKEYMATERIAL'), false);
  assert.equal(payloadHasKeyMaterial(FAKE_SESSION), true);
  assert.match(raw, /KEY_MATERIAL/);
});

test('M2G.4 Sentinel logger blocks key objects', () => {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try {
    log.info(FAKE_SESSION);
  } finally {
    process.stdout.write = orig;
  }
  const out = chunks.join('');
  assert.equal(out.includes('TOPSECRETPRIVKEYMATERIAL'), false);
  assert.match(out, /KEY_MATERIAL_BLOCKED/);
});

test('M2G.5 committed evidence files contain no Signal key dumps', () => {
  const dir = path.join(process.cwd(), 'evidence');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(txt|md|jsonl)$/.test(f)) continue;
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(/privKey:\s*<Buffer/.test(s), false, f);
    assert.equal(/rootKey:\s*<Buffer/.test(s), false, f);
    assert.equal(/Closing session:\s*SessionEntry/.test(s), false, f);
  }
});

test('M2G.6 socket open without RPN does not become CAUGHT_UP', () => {
  resetSessionInboundState();
  noteConnectionUpdate({ connection: 'connecting', receivedPendingNotifications: false });
  noteConnectionUpdate({ connection: 'open' });
  const snap = getSessionInboundState();
  assert.equal(snap.socket, 'CONNECTED');
  assert.equal(snap.catchup, 'PENDING');
  assert.equal(snap.receivedPendingNotifications, false);
  noteConnectionUpdate({ receivedPendingNotifications: true });
  const after = getSessionInboundState();
  assert.equal(after.catchup, 'CAUGHT_UP');
  assert.equal(after.receivedPendingNotifications, true);
});

test('ISO. owner unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
