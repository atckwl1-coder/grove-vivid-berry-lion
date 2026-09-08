# OUTBOX — SPECIFICATION
# STATUS: DERIVED EXTRACTION — created 2026-09-07 at reviewer request.
# PROVENANCE: content assembled verbatim from the artifact(s) listed below.
# These files did NOT exist during Phase-2A verification; they are faithful
# copies from the governing artifacts, not originals. No content invented.
# SOURCES:
#   - CAPABILITY_REGISTRY.yml  (SHA256: d0a6e5f7f9bbb678c6caa6f97b5ba762183fc4d04cb6d48063a2647dcb6a629f)
#   - src/sentinel/outbox.js  (SHA256: fdddd276b36b8ad04758a0e4775598d42770f87e1fb9e9c3ac8383a5f29794e4)
---
## Governing contract

```yaml
  CAP-011-outbound-dispatcher:
    claim: "Every outbound message is queued, retried, 24h-window-checked, audit-logged; unknown outcomes are EXECUTION_RESULT_UNKNOWN — never fake success (§27)."
    purpose: "Durability under Meta failures; zero lost replies."
    inputs: [{field: outbound_job, source: internal_capabilities, authority: policy_checked_only, freshness: queued}]
    processing: {type: "outbox + worker + exp backoff + DLQ + window gate + idempotency key", deterministic: true, model: none, version: outbox_v1}
    output: {type: "delivery{QUEUED|SENT|DELIVERED|READ|FAILED|UNKNOWN}", evidence_grade: A}
    permissions: {can_read: [outbox], can_infer: [], can_recommend: [], can_execute: [send_via_meta], human_approval_required: false}
    failure_states:
      provider_failure: "retry ×N → DLQ + owner alert"
      timeout: "status UNKNOWN, reconcile via Meta status webhook"
      conflicting_data: "Meta status callback is authority for DELIVERED/READ"
    verification:
      method: "chaos: kill worker mid-send; fake 500s; duplicate status callbacks"
      acceptance_criteria: "0 silent losses; 0 duplicate sends on retry"
      reproducibility: chaos tests
    production_status: PILOT   # VR-2026-09-06-02: retry/DLQ/crash-recovery/no-double-send proven; real Meta failures pending (Phase-5)
    autonomy_level: L4
    risk_level: HIGH
    last_verification_date: "2026-09-06"
    verification_record: VERIFICATION_LOG.md#VR-2026-09-06-02
```

## Executable specification (complete source, verbatim)

```javascript
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

export function createOutbox({
  dir,
  sendFn,
  windowGuard = () => ({ ok: true }),
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

  function enqueue(payload) {
    const id = 'job-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
    const job = {
      id, idempotencyKey: id, status: 'QUEUED', attempts: 0,
      nextAttemptAt: Date.now(), createdAt: new Date().toISOString(), payload,
    };
    atomicWriteJson(path.join(Q, `${id}.json`), job);
    auditFn('OUTBOX_QUEUED', { id, to: payload?.to, msgType: payload?.type });
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

  return { enqueue, recover, start, stop, tick, dirs: { Q, S, D, F } };
}

```
