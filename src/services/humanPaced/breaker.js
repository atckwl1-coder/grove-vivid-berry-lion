// ─────────────────────────────────────────────────────────────
//  CONVERSATION CIRCUIT BREAKER (Human-Paced Safety Layer, 2026-09-11) — §14
//  Bounded conversation-level protection against pathological autonomous
//  loops (excessive autonomous turns, repeated identical cycles, repeated
//  failed dispatch). Objective runtime anomalies only — repeated
//  negotiation/pricing questions are NOT spam (the V1-3 engine path is
//  outside this breaker by design, and every turn here requires a real
//  customer inbound — there is no autonomous echo loop to run away).
//
//  States: NORMAL → ACTIVE → PRESSURE → HUMAN_REVIEW
//   • PRESSURE      — observed + audited; responses continue
//   • HUMAN_REVIEW  — autonomous responses STOP for this conversation; the
//     existing CAP-008 escalation path (POLICY_LIMIT) surfaces it to staff
//  No automatic permanent blocking: HUMAN_REVIEW clears when the
//  conversation is no longer human-owned (existing CAP-008
//  resolve/return-to-AI flow) or the measurement window expires.
// ─────────────────────────────────────────────────────────────
import { HUMAN_PACED_CONFIG } from './config.js';

export const BREAKER_STATES = Object.freeze({
  NORMAL: 'NORMAL', ACTIVE: 'ACTIVE', PRESSURE: 'PRESSURE', HUMAN_REVIEW: 'HUMAN_REVIEW',
});
const S = BREAKER_STATES;

const records = new Map(); // phone → record (in-memory; the conversation file
// remains the source of truth for ownership — this is an overlay, not a store)

// Test seam (documented): inspect/reset between tests.
export const _breakerRecords = () => records;
export function resetBreaker(phone) {
  const r = records.get(phone);
  if (r) { r.state = S.NORMAL; r.turns = 0; r.failures = 0; r.windowStart = Date.now(); r.updatedAt = Date.now(); }
}

function get(phone, now, cfg) {
  let r = records.get(phone);
  if (!r) {
    r = { state: S.NORMAL, windowStart: now, turns: 0, dup: null, failures: 0, updatedAt: now };
    records.set(phone, r);
    return r;
  }
  if (now - r.windowStart > cfg.windowMs) {
    // Window expiry: pressure decays (bounded, no permanent block)
    r.state = S.NORMAL; r.windowStart = now; r.turns = 0; r.updatedAt = now;
  }
  return r;
}

/**
 * Gate before an autonomous brain reply. Returns
 * { allowed, state, newly, reason, pressureNew }.
 * Only reached when the conversation is NOT human-owned (CAP-008 wall 1
 * suppresses the brain otherwise) — so a stored HUMAN_REVIEW encountered
 * here means the human flow completed → the review clears (no permanent block).
 */
export function beforeReply(phone, { inboundHash, replyHash, cfg = HUMAN_PACED_CONFIG.breaker, audit = () => {} } = {}) {
  const now = Date.now();
  const r = get(phone, now, cfg);
  const prev = r.state;
  let reason = null;
  let pressureNew = false;

  if (prev === S.HUMAN_REVIEW) {
    // Human flow completed (conversation is not suppressed here) → clear the
    // review AND the measurement window. No permanent block; if the same
    // pathological cycle repeats, it must re-accumulate to re-trigger.
    r.state = S.NORMAL; r.turns = 0; r.dup = null; r.windowStart = now;
  }

  if (inboundHash && replyHash) {
    if (r.dup && r.dup.inbound === inboundHash && r.dup.reply === replyHash) r.dup.count += 1;
    else r.dup = { inbound: inboundHash, reply: replyHash, count: 1 };
  }

  if (r.dup && r.dup.count > cfg.maxDuplicateCycle) {
    r.state = S.HUMAN_REVIEW; reason = 'duplicate_cycle';
  } else if (r.turns >= cfg.hardTurnsPerWindow) {
    r.state = S.HUMAN_REVIEW; reason = 'excessive_turns';
  } else if (r.turns > cfg.softTurnsPerWindow) {
    if (r.state !== S.PRESSURE && r.state !== S.HUMAN_REVIEW) { r.state = S.PRESSURE; pressureNew = true; }
  } else if (r.state === S.PRESSURE) {
    r.state = S.ACTIVE;
  } else if (r.state === S.NORMAL && r.turns > 0) {
    r.state = S.ACTIVE;
  }

  r.updatedAt = now;
  const newly = r.state === S.HUMAN_REVIEW && prev !== S.HUMAN_REVIEW;
  if (pressureNew) audit('autonomous_circuit_breaker_pressure', { convId: phone, turns: r.turns, windowMs: cfg.windowMs });
  if (newly) audit('autonomous_circuit_breaker_triggered', { convId: phone, reason: reason, turns: r.turns });
  return { allowed: r.state !== S.HUMAN_REVIEW, state: r.state, newly, reason, pressureNew };
}

/** Count one successfully dispatched autonomous brain reply (turn). */
export function recordTurn(phone) {
  const r = records.get(phone);
  if (r) { r.turns += 1; r.updatedAt = Date.now(); }
}

export function recordDispatchOk(phone) {
  const r = records.get(phone);
  if (r) r.failures = 0;
}

/** Consecutive failed autonomous dispatch → HUMAN_REVIEW (bounded, audited). */
export function recordDispatchFailure(phone, { cfg = HUMAN_PACED_CONFIG.breaker, audit = () => {} } = {}) {
  const r = records.get(phone);
  if (!r) return null;
  r.failures += 1;
  r.updatedAt = Date.now();
  if (r.state !== S.HUMAN_REVIEW && r.failures >= cfg.maxConsecutiveDispatchFailures) {
    r.state = S.HUMAN_REVIEW;
    audit('autonomous_circuit_breaker_triggered', { convId: phone, reason: 'dispatch_failures', failures: r.failures });
    return S.HUMAN_REVIEW;
  }
  return null;
}
