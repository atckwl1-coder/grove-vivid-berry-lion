// ═══════════════════════════════════════════════════════════════
//  PHASE 2A.1 REMEDIATION SUITE — 7 targeted proofs (see PHASE2A1_REMEDIATION_SPEC.md)
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'node:child_process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel2a1-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
// no appSecret/token — pure DEMO, no network

const { config } = await import('../src/config.js');
const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const { log } = await import('../src/utils/logger.js');

auditMod.initAudit();
idem.initIdempotency();

const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)); }
  return false;
};

// ── R1: missing-directory defect FIXED — runtime mein dir gayab ho jaye to bhi claim kaam kare ──
test('R1. idempotency survives missing directory (recovers, still dedupes)', () => {
  fs.rmSync(config.idemDir, { recursive: true, force: true }); // defect simulation
  assert.equal(idem.claimEvent('wamid.r1-a'), true, 'recovers: dir recreated, event fresh');
  assert.equal(idem.claimEvent('wamid.r1-a'), false, 'dup still suppressed after recovery');
});

// ── R2a: REAL PROCESS RESTART persistence (child A claims, child B sees duplicate) ──
test('R2a. idempotency persists across real process restarts', () => {
  const env = { ...process.env, IDEM_DIR: path.join(TMP, 'idem-restart') };
  const fx = 'tests/fixtures/idem-claim.js';
  const a = spawnSync(process.execPath, [fx, 'wamid.restart-1'], { env });
  assert.equal(a.status, 0, 'first process: fresh claim');
  const b = spawnSync(process.execPath, [fx, 'wamid.restart-1'], { env }); // brand-new process
  assert.equal(b.status, 2, 'second process: duplicate detected from disk');
});

// ── R2b: DEDICATED bookkeeping-failure regression test (the triple-send class) ──
test('R2b. bookkeeping failure AFTER successful send → no resend, honest gap state', async () => {
  let sends = 0;
  const ob = createOutbox({
    dir: path.join(TMP, 'ob-book'),
    sendFn: async () => { sends++; return { ok: true }; },
    auditFn: (type) => { if (type === 'OUTBOX_SENT') throw new Error('audit disk full'); },
    pollMs: 10,
    retry: { maxAttempts: 2, baseMs: 10, maxMs: 30 },
  });
  ob.start();
  const { id } = ob.enqueue({ to: '923001234567', type: 'text', text: { body: 'b' } });
  assert.ok(await waitFor(() => fs.existsSync(path.join(ob.dirs.D, `${id}.json`))), 'finalized');
  const job = JSON.parse(fs.readFileSync(path.join(ob.dirs.D, `${id}.json`), 'utf8'));
  assert.equal(job.status, 'SENT_WITH_AUDIT_GAP', 'honest state, not fake SENT-with-clean-audit');
  assert.equal(sends, 1, 'sendFn fired 1 time — NO resend ever after success');
  await new Promise((r) => setTimeout(r, 120)); // queue stays settled
  assert.equal(fs.readdirSync(ob.dirs.Q).length, 0, 'nothing requeued');
  assert.equal(fs.readdirSync(ob.dirs.S).length, 0, 'nothing stranded');
  ob.stop();
});

// ── R3: TRUE process-kill recovery (SIGKILL a real child mid-send) ──
test('R3. real SIGKILL mid-send → next boot recovers job → provider touched once', async () => {
  const dir = path.join(TMP, 'ob-sigkill');
  const hb = path.join(TMP, 'heartbeat.txt');
  const child = spawn(process.execPath, ['tests/fixtures/crash-child.js'], {
    env: { ...process.env, CRASH_OB_DIR: dir, CRASH_HB: hb },
    stdio: 'ignore',
  });
  assert.ok(await waitFor(() => fs.existsSync(hb)), 'child started sending');
  assert.ok(await waitFor(() => fs.readdirSync(path.join(dir, 'sending')).length === 1), 'job in-flight');
  child.kill('SIGKILL'); // 💀 real kill — nothing graceful
  await new Promise((r) => child.once('exit', r));

  // New "boot": recover + process
  const delivered = [];
  const audits = [];
  const ob2 = createOutbox({
    dir,
    sendFn: async (p) => { delivered.push(p); return { ok: true }; },
    auditFn: (t, p) => audits.push(t),
    pollMs: 15, retry: { maxAttempts: 2, baseMs: 10, maxMs: 30 },
  });
  ob2.recover();
  ob2.start();
  assert.ok(await waitFor(() => fs.readdirSync(path.join(dir, 'sent')).length === 1), 'job completes after real crash');
  assert.equal(delivered.length, 1, 'provider touched once post-recovery (crash was pre-transmission)');
  assert.ok(audits.includes('OUTBOX_RECOVERY_REQUEUED_UNCERTAIN'), 'honesty label present');
  ob2.stop();
});

// ── R4: PII boundary — logger + demo output masked; retention purge ──
test('R4a. logger masks phone numbers', () => {
  const orig = console.log;
  let out = '';
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  try { log.info('Customer 92300111222 said salam'); } finally { console.log = orig; }
  assert.ok(!out.includes('92300111222'), 'raw number absent from logs');
  assert.ok(out.includes('9230****222'), 'masked form present');
});

test('R4b. demo output masks customer phone', () => {
  const origDir = console.dir;
  let printed = '';
  console.dir = (o) => { printed += JSON.stringify(o); };
  try {
    wa.demoDeliver({ messaging_product: 'whatsapp', to: '923001998877', type: 'text', text: { body: 'hi 923001998877' } });
  } finally { console.dir = origDir; }
  assert.ok(!printed.includes('923001998877'), 'no raw phone in demo output (payload nor body)');
});

test('R4c. outbox retention: finalized jobs older than 7d purged, fresh kept', () => {
  const ob = createOutbox({ dir: path.join(TMP, 'ob-gc'), sendFn: async () => ({}), pollMs: 10 });
  const oldF = path.join(ob.dirs.D, 'job-old.json');
  const newF = path.join(ob.dirs.D, 'job-new.json');
  fs.writeFileSync(oldF, '{}'); fs.writeFileSync(newF, '{}');
  const old = Date.now() - 9 * 86400_000;
  fs.utimesSync(oldF, old / 1000, old / 1000);
  const purged = ob.gc({ retentionDays: 7 });
  assert.equal(purged, 1);
  assert.ok(!fs.existsSync(oldF) && fs.existsSync(newF));
});

// ── R5/R6: terminology discipline (lint-style, enforced forever) ──
test('R5/R6. overclaim phrases banned from src/tests (single-delivery + tamper-EVIDENT only)', () => {
  // banned phrases literal tor par is file mein likhna bhi lint ko trip karega — build dynamically
  const bannedExactly = new RegExp('\\b' + 'exactly' + '[- ]' + 'once' + '\\b', 'i');
  const bannedProof = new RegExp('tamper' + '[- ]?' + 'proof', 'i');
  const collect = (d, acc = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) collect(p, acc);
      else if (e.name.endsWith('.js')) acc.push(p);
    }
    return acc;
  };
  const files = [...collect('src'), ...collect('tests')];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(!bannedExactly.test(txt), `${f}: banned delivery-semantics overclaim found`);
    assert.ok(!bannedProof.test(txt), `${f}: must say tamper-EVIDENT, never stronger`);
  }
});
