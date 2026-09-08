// ─────────────────────────────────────────────────────────────
//  DURABLE OUTBOX (§16/§17/§27) — koi message kabhi gum nahi hota,
//  koi success kabhi fake nahi hota.
//  States: QUEUED → SENDING → SENT | RETRY_SCHEDULED | DLQ | UNKNOWN_REQUEUED
//  Crash-safety: directory renames are atomic; recovery is HONEST (uncertain).
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ensureDir, atomicWriteJson } from './store.js';

// Payload metadata envelope: { source: 'AI'|'HUMAN'|'SYSTEM', staffId, actionId } — Phase-2A+008:
// the chokepoint guard reads meta.source to enforce AI suppression on human-owned conversations.
export function createOutbox({
  dir,
  sendFn,
  windowGuard = () => ({ ok: true }),
  autonomyGuard = () => ({ ok: true }), // CAP-055: kill-switch execute-layer gate
  auditFn = () => {},
  pollMs = 2000,
  retry = { maxAttempts: 5, baseMs: 1500, maxMs: 30000 },
}) {
  const Q = path.join(dir, 'queued');
  const S = path.join(dir, 'sending');
  const D = path.join(dir, 'sent');
  const F = path.join(dir, 'dlq');
  [Q, S, D, F].forEach(ensureDir);

  const safeRead = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const list = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.json'));
  const existsFinal = (f) => fs.existsSync(path.join(D, f)) || fs.existsSync(path.join(F, f));

  function enqueue(payload, meta = {}) {
    const id = 'job-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
    const job = {
      id, idempotencyKey: id, status: 'QUEUED', attempts: 0,
      nextAttemptAt: Date.now(), createdAt: new Date().toISOString(), payload,
      meta: { ...meta, source: meta.source || 'AI', staffId: meta.staffId || null, actionId: meta.actionId || null, conversation: meta.conversation || null },
      // ^ extra fields preserved — P2 firewall decision (traceId/decision) rides along
    };
    atomicWriteJson(path.join(Q, `${id}.json`), job);
    auditFn('OUTBOX_QUEUED', { id, to: payload?.to, msgType: payload?.type, source: job.meta.source, staffId: job.meta.staffId, actionId: job.meta.actionId });
    return { queued: true, id };
  }

  let timer = null;
  let running = false;

  async function tick() {
    if (running) return; // single-flight
    running = true;
    try {
      const due = list(Q)
        .map((f) => ({ f, job: safeRead(path.join(Q, f)) }))
        .filter((x) => x.job && x.job.status !== 'SENDING' && x.job.nextAttemptAt <= Date.now())
        .sort((a, b) => new Date(a.job.createdAt) - new Date(b.job.createdAt));
      for (const { f, job } of due.slice(0, 5)) await processJob(f, job);
    } finally {
      running = false;
    }
  }

  async function processJob(f, job) {
    const qf = path.join(Q, f);
    const sf = path.join(S, f);
    // CAP-055 execute-layer gate — checked HERE, at the dispatch instant (race rule §7).
    // HELD_KILLSWITCH also lands back here: re-check on every cycle; stays held until resume.
    if (job.status === 'HELD_KILLSWITCH' || autonomyGuard(job)?.ok === false) {
      if (job.status !== 'HELD_KILLSWITCH') {
        job.status = 'HELD_KILLSWITCH';
        job.heldAt = new Date().toISOString();
        job.nextAttemptAt = Number.MAX_SAFE_INTEGER; // held: never due until releaseHeld()
        atomicWriteJson(qf, job);
        auditFn('OUTBOX_HELD', { id: job.id, to: job.payload?.to, source: job.meta?.source });
      }
      return; // no claim, no send — deterministic brake
    }
    try {
      fs.renameSync(qf, sf); // atomic claim — concurrent processor loses here
    } catch {
      return; // someone else claimed it
    }

    // Policy gate BEFORE touching provider (§12 action firewall-lite)
    const gate = windowGuard(job.payload);
    if (!gate.ok) {
      finalize(F, f, sf, { ...job, status: 'DLQ', dlqReason: gate.reason, failedAt: new Date().toISOString() });
      auditFn('OUTBOX_DLQ', { id: job.id, reason: gate.reason });
      return;
    }

    // ── SEND: SIRF asli sendFn failure hi retry trigger kar sakta hai (§16/§17) ──
    let result;
    try {
      result = await sendFn(job.payload);
    } catch (err) {
      job.attempts += 1;
      job.lastError = String(err?.message || err).slice(0, 200);
      if (job.attempts >= retry.maxAttempts) {
        finalize(F, f, sf, { ...job, status: 'DLQ', dlqReason: 'max_attempts', failedAt: new Date().toISOString() });
        auditFn('OUTBOX_DLQ', { id: job.id, reason: 'max_attempts', attempts: job.attempts });
      } else {
        job.status = 'RETRY_SCHEDULED';
        job.nextAttemptAt = Date.now() + Math.min(retry.maxMs, retry.baseMs * 2 ** (job.attempts - 1));
        atomicWriteJson(path.join(Q, f), job); // put back first…
        fs.rmSync(sf, { force: true });          // …then remove claim (recovery handles double-copy)
        auditFn('OUTBOX_RETRY', { id: job.id, attempts: job.attempts, err: job.lastError });
      }
      return;
    }

    // ── SEND HO CHUKA — bookkeeping error kabhi resend trigger NAHI karegi.
    // Provider ko ek dafa message ja chuka ho to dubara bhejna = duplicate side effect.
    // Honest state: SENT_WITH_AUDIT_GAP — retry nahi. (audit-first hardening, Phase-2A lesson)
    try {
      finalize(D, f, sf, {
        ...job, status: 'SENT', sentAt: new Date().toISOString(),
        providerResult: summarize(result),
      });
      auditFn('OUTBOX_SENT', { id: job.id, to: job.payload?.to, attempts: job.attempts });
    } catch (bookErr) {
      try {
        finalize(D, f, sf, { ...job, status: 'SENT_WITH_AUDIT_GAP', gapNote: String(bookErr?.message || bookErr).slice(0, 200) });
      } catch { /* job already caught below */ }
      try {
        auditFn('OUTBOX_BOOKKEEPING_ERROR', { id: job.id, error: String(bookErr?.message || bookErr).slice(0, 200) });
      } catch { /* nothing more we can do — job remains in S/ for recovery */ }
      console.error('⚠️ Outbox bookkeeping error (job already sent, NOT retried):', bookErr?.message || bookErr);
    }
  }

  function summarize(r) { try { return JSON.stringify(r).slice(0, 300); } catch { return 'unserializable'; } }

  // Write FINAL destination first, then remove claim — if we crash between,
  // recover() sees a final marker and discards the in-flight copy (no double-send).
  function finalize(destDir, f, sf, job) {
    atomicWriteJson(path.join(destDir, f), job);
    fs.rmSync(sf, { force: true });
  }

  // §17: crash recovery is TRUTHFUL — hum nahi jaante send hua tha ya nahi
  function recover() {
    for (const f of list(S)) {
      const job = safeRead(path.join(S, f));
      if (!job) continue;
      if (existsFinal(f)) {
        fs.rmSync(path.join(S, f), { force: true });
        auditFn('OUTBOX_RECOVERY_DISCARDED_ALREADY_FINAL', { id: job.id });
        continue;
      }
      job.status = 'UNKNOWN_REQUEUED'; // EXECUTION_RESULT_UNKNOWN — honest
      job.recoveredAt = new Date().toISOString();
      atomicWriteJson(path.join(Q, f), job);
      fs.rmSync(path.join(S, f), { force: true });
      auditFn('OUTBOX_RECOVERY_REQUEUED_UNCERTAIN', { id: job.id });
    }
  }

  function start() {
    if (!timer) timer = setInterval(() => tick().catch(() => {}), pollMs);
    if (timer.unref) timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  // CAP-055 §4: on STOP ALL — every autonomous due/in-waiting job in Q becomes HELD
  // (isAutonomousJob default: true unless caller passes one; source tag consult)
  function holdAutonomous(isAutonomous = (j) => !['HUMAN', 'CONSENT_ACK'].includes(j?.meta?.source)) {
    let n = 0;
    for (const f of list(Q)) {
      const job = safeRead(path.join(Q, f));
      if (!job || job.status === 'HELD_KILLSWITCH' || !isAutonomous(job)) continue;
      job.status = 'HELD_KILLSWITCH';
      job.heldAt = new Date().toISOString();
      job.nextAttemptAt = Number.MAX_SAFE_INTEGER;
      atomicWriteJson(path.join(Q, f), job);
      n++;
    }
    if (n) auditFn('OUTBOX_HELD', { held: n, reason: 'kill_switch_stop' });
    return n;
  }

  // CAP-055 §4: on RESUME ALL — held jobs become due again (normal gates still apply)
  function releaseHeld() {
    let n = 0;
    for (const f of list(Q)) {
      const job = safeRead(path.join(Q, f));
      if (!job || job.status !== 'HELD_KILLSWITCH') continue;
      job.status = 'QUEUED';
      job.releasedAt = new Date().toISOString();
      job.nextAttemptAt = Date.now();
      atomicWriteJson(path.join(Q, f), job);
      n++;
    }
    if (n) auditFn('OUTBOX_HELD_RELEASED', { released: n, reason: 'kill_switch_resume' });
    return n;
  }
  const countHeld = () => list(Q).filter((f) => safeRead(path.join(Q, f))?.status === 'HELD_KILLSWITCH').length;

  // PII boundary (2A.1): finalized job files hold customer text → bounded retention
  function gc({ retentionDays = 7 } = {}) {
    const cutoff = Date.now() - retentionDays * 86400_000;
    let purged = 0;
    for (const d of [D, F]) {
      for (const f of list(d)) {
        try {
          const p = path.join(d, f);
          if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { force: true }); purged++; }
        } catch { /* ignore */ }
      }
    }
    if (purged) auditFn('OUTBOX_GC', { purged, retentionDays });
    return purged;
  }

  return { enqueue, recover, start, stop, tick, gc, holdAutonomous, releaseHeld, countHeld, dirs: { Q, S, D, F } };
}
