// ═══════════════════════════════════════════════════════════════
//  PHASE 2A VERIFICATION SUITE (Sentinel §22)
//  Security · Idempotency · Failure · Recovery · Durability · Privacy
//  Note: DEMO mode (no live tokens) — koi network call nahi.
//  Signature enforcement appSecret set hone par force hoti hai (by design).
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// ── Environment BEFORE any module load (ESM imports hoist) ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel2a-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.META_APP_SECRET = 'testsecret-2a';
process.env.META_VERIFY_TOKEN = 'v2a';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_BASE_MS = '20';
process.env.RETRY_MAX = '3';
process.env.RETRY_MAX_MS = '80';
// WHATSAPP_TOKEN intentionally empty → DEMO (no network ever)

const { config, assertBootSafety } = await import('../src/config.js');
const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const { readJson } = await import('../src/sentinel/store.js');
const wa = await import('../src/services/whatsapp.js');
const { buildApp } = await import('../src/app.js');

auditMod.initAudit();
idem.initIdempotency();

// Outbox with spy sender — wired exactly like production boot
const delivered = [];
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob-main'),
  sendFn: async (p) => { delivered.push(p); return { ok: true }; },
  windowGuard: () => ({ ok: true }),
  auditFn: auditMod.audit,
  pollMs: 15,
  retry: { maxAttempts: 3, baseMs: 20, maxMs: 80 },
});
wa.initOutbox(mainOutbox);
mainOutbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-2a').update(body).digest('hex');
const eventBody = (wamid, text, from = '923001110001') =>
  JSON.stringify({
    entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Test User' } }], messages: [{ from, id: wamid, type: 'text', text: { body: text } }] } }] }],
  });
const postWebhook = (raw, headers = {}) =>
  fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });
const waitFor = async (fn, ms = 2500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
};
const auditTypes = () => auditMod.auditTail(100).map((e) => e.type);

// ═══ 1. HAPPY PATH — signed event → single delivery per accepted event ═══
test('1. valid signed message → single delivery per accepted event', async () => {
  const raw = eventBody('wamid.unique-001', 'menu');
  const res = await postWebhook(raw, { 'x-hub-signature-256': sign(raw) });
  assert.equal(res.status, 200);
  assert.ok(await waitFor(() => delivered.length === 1), 'reply delivered once via outbox');
  assert.ok(auditTypes().includes('EVENT_RECEIVED'));
  // content-based wait (no sleep races): audit flush must land truthfully
  assert.ok(await waitFor(() => auditTypes().includes('OUTBOX_SENT')), 'audit shows OUTBOX_SENT');
});

// ═══ 2. REPLAY ATTACK — duplicate suppressed ═══
test('2. replay attack → duplicate suppressed, no second reply', async () => {
  const raw = eventBody('wamid.unique-001', 'menu'); // SAME wamid (Meta retry / attacker replay)
  const res = await postWebhook(raw, { 'x-hub-signature-256': sign(raw) });
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(delivered.length, 1, 'still exactly one reply');
  assert.ok(auditTypes().includes('EVENT_DUPLICATE'));
});

// ═══ 3. FORGED SIGNATURE → rejected, zero processing ═══
test('3. forged signature → blocked, zero side effects', async () => {
  const before = delivered.length;
  const raw = eventBody('wamid.evil-001', 'menu');
  const res = await postWebhook(raw, { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) });
  assert.equal(res.status, 200); // transport ack only…
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(delivered.length, before, 'no processing happened');
  assert.ok(auditTypes().includes('WEBHOOK_FORGED'));
});

// ═══ 4. UNSIGNED request (secret configured) → rejected ═══
test('4. unsigned webhook while secret configured → blocked', async () => {
  const before = delivered.length;
  const res = await postWebhook(eventBody('wamid.evil-002', 'menu'));
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(delivered.length, before);
});

// ═══ 5. BOOT GATE — LIVE without secret = boot refusal ═══
test('5. Sentinent boot gate refuses LIVE without appSecret', () => {
  assert.throws(() => assertBootSafety({ live: true, appSecret: '' }), /BOOT REFUSAL/);
  assert.doesNotThrow(() => assertBootSafety({ live: true, appSecret: 'x' }));
  assert.doesNotThrow(() => assertBootSafety({ live: false, appSecret: '' }));
});

// ═══ 6. OUTBOX: retry ×2 then SENT, attempts truthful ═══
test('6. outbox retries with backoff → eventually SENT, attempts recorded', async () => {
  let fails = 2;
  const ob = createOutbox({
    dir: path.join(TMP, 'ob-retry'),
    sendFn: async () => { if (fails-- > 0) throw new Error('provider 500'); return { ok: true }; },
    auditFn: auditMod.audit, pollMs: 10, retry: { maxAttempts: 5, baseMs: 20, maxMs: 60 },
  });
  ob.start();
  const { id } = ob.enqueue({ messaging_product: 'whatsapp', to: '92300', type: 'text', text: { body: 'hi' } });
  assert.ok(await waitFor(() => fs.existsSync(path.join(ob.dirs.D, `${id}.json`)), 3000));
  const job = readJson(path.join(ob.dirs.D, `${id}.json`), {});
  assert.equal(job.status, 'SENT');
  assert.equal(job.attempts, 2, 'two honest failures recorded');
  ob.stop();
});

// ═══ 7. OUTBOX: permanent failure → DLQ + audit ═══
test('7. outbox permanent failure → DLQ with audit trail', async () => {
  const ob = createOutbox({
    dir: path.join(TMP, 'ob-dlq'),
    sendFn: async () => { throw new Error('dead provider'); },
    auditFn: auditMod.audit, pollMs: 10, retry: { maxAttempts: 2, baseMs: 15, maxMs: 40 },
  });
  ob.start();
  const { id } = ob.enqueue({ to: '1', type: 'text', text: { body: 'x' } });
  assert.ok(await waitFor(() => fs.existsSync(path.join(ob.dirs.F, `${id}.json`)), 3000));
  assert.equal(readJson(path.join(ob.dirs.F, `${id}.json`), {}).status, 'DLQ');
  assert.ok(auditTypes().includes('OUTBOX_DLQ'));
  ob.stop();
});

// ═══ 8. CRASH RECOVERY — honest, single delivery in this tested crash class ═══
test('8. crash mid-send → recovered as UNCERTAIN, single delivery (tested crash class)', async () => {
  const dir = path.join(TMP, 'ob-crash');
  const spy = [];
  const ob = createOutbox({
    dir, sendFn: async (p) => { spy.push(p); return { ok: true }; },
    auditFn: auditMod.audit, pollMs: 10, retry: { maxAttempts: 2, baseMs: 10, maxMs: 30 },
  });
  // Simulate crash: job stranded in sending/
  const f = 'job-crash1.json';
  fs.writeFileSync(path.join(ob.dirs.S, f), JSON.stringify({ id: 'job-crash1', status: 'SENDING', attempts: 0, nextAttemptAt: 0, createdAt: new Date().toISOString(), payload: { to: '9', type: 'text', text: { body: 'crash' } } }));
  ob.recover();
  assert.ok(auditTypes().includes('OUTBOX_RECOVERY_REQUEUED_UNCERTAIN'), 'honest UNCERTAIN label');
  ob.start();
  assert.ok(await waitFor(() => fs.existsSync(path.join(ob.dirs.D, f)), 3000));
  assert.equal(spy.length, 1, 'one send despite crash (tested class)');
  ob.stop();

  // Sub-case: crash AFTER final write → recovery must DISCARD (not re-send)
  const spy2 = [];
  const ob2 = createOutbox({ dir: path.join(TMP, 'ob-crash2'), sendFn: async () => { spy2.push(1); }, auditFn: auditMod.audit, pollMs: 10, retry: { maxAttempts: 2, baseMs: 10, maxMs: 20 } });
  const g = 'job-crash2.json';
  const jobData = JSON.stringify({ id: 'job-crash2', status: 'SENDING', attempts: 0, nextAttemptAt: 0, createdAt: new Date().toISOString(), payload: {} });
  fs.writeFileSync(path.join(ob2.dirs.S, g), jobData);
  fs.writeFileSync(path.join(ob2.dirs.D, g), JSON.stringify({ ...JSON.parse(jobData), status: 'SENT' })); // final marker exists
  ob2.recover();
  ob2.start();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(spy2.length, 0, 'already-final job never re-sent');
  assert.ok(auditTypes().includes('OUTBOX_RECOVERY_DISCARDED_ALREADY_FINAL'));
  ob2.stop();
});

// ═══ 9. PRIVACY — phone numbers masked in audit file ═══
test('9. audit trail masks phone numbers (PII)', () => {
  auditMod.audit('TEST_PII', { phone: '92300111222', note: 'ok' });
  const raw = fs.readFileSync(config.auditFile, 'utf8');
  const lastLine = raw.trim().split('\n').pop();
  assert.ok(!lastLine.includes('92300111222'), 'raw phone absent');
  assert.ok(lastLine.includes('9230****222'), 'masked form present');
});

// ═══ 10. CORRUPT STATE — fallback, never crash ═══
test('10. corrupt JSON file → explicit fallback, no crash', () => {
  const bad = path.join(TMP, 'corrupt.json');
  fs.writeFileSync(bad, '{broken json…');
  assert.deepEqual(readJson(bad, { ok: false }), { ok: false });
});

// ── teardown ──
test.after(() => {
  mainOutbox.stop();
  server.close();
});
