// ─────────────────────────────────────────────────────────────
//  HUMAN-PACED COMPOSITION ENGINE (Human-Paced Safety Layer, 2026-09-11)
//  §3: dedicated, independently testable module.
//
//  What this engine IS:
//   • takes the FINAL, already-validated response text (it generates no
//     content, sends nothing, and owns no security policy — §17),
//   • simulates human-like composing time: per-character intervals =
//     clamp(base + bounded variance + word/punctuation/line adjustments,
//     char min, char max), total clamped to [minDuration, maxDuration],
//   • supports a typing/composing-presence adapter (UX only — §7: a
//     no-op adapter is perfectly valid; production has none today),
//   • is async-cancellable between every interval, and
//   • enforces ONE active autonomous composition per conversation
//     (a new begin() supersedes the in-flight one).
//
//  What this engine is NOT: it never calls any provider. The wrapper
//  (brain.js → pacedBrainSend) re-validates state and dispatches through
//  the ONE existing outbound path (P2 firewall → durable outbox →
//  adapter). The recipient receives exactly ONE complete message.
// ─────────────────────────────────────────────────────────────
import { HUMAN_PACED_CONFIG } from './config.js';

const SENTENCE_END = new Set(['.', '!', '?', '…']);

// Minimum wall-clock size of one issued delay (see compose()). Not a
// pacing-timing value — a pure timer-overhead constant.
const CHUNK_MS = 30;

export const realClock = Object.freeze({
  delay: (ms) => new Promise((r) => setTimeout(r, ms)),
});

export function createCancelToken() {
  const t = { cancelled: false, reason: null };
  t.cancel = (reason) => { if (!t.cancelled) { t.cancelled = true; t.reason = reason || 'cancelled'; } };
  return t;
}

/**
 * Pure, deterministic interval model (§4/§5/§6).
 * Same (text, cfg, rng-seed) → same plan. rng: () => [0,1).
 * Returns { intervals[], settleMs, totalMs, capped }.
 */
export function computeIntervals(text, cfg = HUMAN_PACED_CONFIG, rng = Math.random) {
  const t = String(text ?? '');
  const n = Math.min(t.length, cfg.duration.maxCharsForModel);
  const intervals = [];
  for (let i = 0; i < n; i++) {
    const ch = t[i];
    let v = cfg.char.baseMs + (rng() * 2 - 1) * cfg.char.varianceMs;
    if (ch === ' ' || (i > 0 && t[i - 1] === ' ')) v += cfg.boundaries.wordBoundaryMs;
    else if (ch === ',') v += cfg.boundaries.commaMs;
    else if (SENTENCE_END.has(ch)) v += cfg.boundaries.sentenceMs;
    else if (ch === '\n') v += cfg.boundaries.lineBreakMs;
    intervals.push(Math.min(cfg.char.maxMs, Math.max(cfg.char.minMs, Math.round(v))));
  }
  // Text beyond maxCharsForModel: paced flat at the per-character minimum
  // (no extra model cost; total still capped below).
  for (let i = n; i < t.length; i++) intervals.push(cfg.char.minMs);

  let total = intervals.reduce((a, b) => a + b, 0);
  let capped = false;
  if (total > cfg.duration.maxMs) {
    const k = cfg.duration.maxMs / total;
    for (let i = 0; i < intervals.length; i++) intervals[i] = Math.max(1, Math.floor(intervals[i] * k));
    total = cfg.duration.maxMs;
    capped = true;
  }
  // Settle tail: per-character bounds are never violated to reach the floor —
  // the min is met by a short pause AFTER the per-character plan completes.
  const settleMs = (!capped && total < cfg.duration.minMs) ? cfg.duration.minMs - total : 0;
  const totalMs = capped ? cfg.duration.maxMs : total + settleMs;
  return { intervals, settleMs, totalMs, capped };
}

/**
 * Create a composer. deps (all injectable for tests):
 *   clock  { delay(ms) }            — realClock by default
 *   rng    () => number             — bounded-variance source (seedable in tests)
 *   typing { start(convId), stop(convId) } | null — UX presence adapter
 *   audit  (type, payload)          — existing audit convention
 *   config                         — HUMAN_PACED_CONFIG (single source)
 */
export function createComposer({ clock = realClock, rng = Math.random, typing = null, audit = () => {}, config = HUMAN_PACED_CONFIG } = {}) {
  const active = new Map(); // convId → record  (single-flight)

  function typingStart(convId) {
    if (typing?.start) { try { typing.start(convId); audit('typing_started', { convId }); } catch { /* UX only — never breaks composing */ } }
  }
  function typingStop(convId) {
    if (typing?.stop) { try { typing.stop(convId); audit('typing_stopped', { convId }); } catch { /* UX only */ } }
  }
  function finishComplete(rec, totalMs) {
    if (active.get(rec.convId) === rec) active.delete(rec.convId);
    typingStop(rec.convId);
    audit('composition_completed', { convId: rec.convId, job: rec.jobId, totalMs });
  }
  function finishCancel(rec, reason) {
    if (active.get(rec.convId) === rec) active.delete(rec.convId);
    typingStop(rec.convId);
    audit('composition_cancelled', { convId: rec.convId, job: rec.jobId, reason });
  }

  return {
    /**
     * Begin a composition. One active autonomous composition per
     * conversation: if one is in flight, it is superseded (its token is
     * cancelled; the loop observes this at its next checkpoint).
     */
    begin({ convId, jobId, text, version, token }) {
      const prev = active.get(convId);
      if (prev && prev.token !== token) {
        prev.token.cancel('superseded');
        audit('composition_superseded', { convId, job: jobId, supersedes: prev.jobId });
      }
      const rec = { convId, jobId, text: String(text ?? ''), version, token, startedAt: Date.now() };
      active.set(convId, rec);
      audit('composition_started', { convId, job: jobId, chars: rec.text.length });
      typingStart(convId);
      return rec;
    },

    /**
     * Run the composition (timed + cancellable).
     * guard() is consulted at every checkpoint: { ok: true } |
     * { ok: false, reason }. onCheckpoint(i) is a test/extension hook.
     * Returns { ok: true, totalMs } | { ok: false, reason }.
     */
    async compose(rec, { guard, onCheckpoint } = {}) {
      const plan = computeIntervals(rec.text, config, rng);
      // Timer-coalescing: the state guard is still consulted at EVERY
      // interval (cancellation stays fine-grained), but the WALL-CLOCK
      // delays are issued in ≥30ms chunks — 150 individual 1ms setTimeouts
      // cost as much in event-loop overhead as the delays themselves,
      // which would break the existing runtime's response-time budget.
      let pending = 0;
      for (let i = 0; i < plan.intervals.length; i++) {
        if (rec.token.cancelled) { finishCancel(rec, rec.token.reason); return { ok: false, reason: rec.token.reason }; }
        const g = guard ? guard(i) : { ok: true };
        if (!g.ok) { finishCancel(rec, g.reason || 'guard'); return { ok: false, reason: g.reason || 'guard' }; }
        pending += plan.intervals[i];
        if (onCheckpoint) { try { onCheckpoint(i); } catch { /* hook must not break composing */ } }
        if (pending >= CHUNK_MS || i === plan.intervals.length - 1) {
          if (pending > 0) await clock.delay(pending);
          pending = 0;
        }
      }
      if (rec.token.cancelled) { finishCancel(rec, rec.token.reason); return { ok: false, reason: rec.token.reason }; }
      if (plan.settleMs > 0) await clock.delay(plan.settleMs);
      // Completion re-validation (final checkpoint before "done")
      const g2 = guard ? guard(plan.intervals.length) : { ok: true };
      if (!g2.ok) { finishCancel(rec, g2.reason || 'guard'); return { ok: false, reason: g2.reason || 'guard' }; }
      finishComplete(rec, plan.totalMs);
      return { ok: true, totalMs: plan.totalMs };
    },

    /** Wrapper-level end/cancel (e.g. pre-dispatch re-validation failed). */
    end(convId, rec, { cancel, reason } = {}) {
      if (active.get(convId) !== rec) return;
      if (cancel) finishCancel(rec, reason || 'wrapper');
      else active.delete(convId);
    },

    isActive: (convId) => active.has(convId),
    activeCount: () => active.size,
  };
}
