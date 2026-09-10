// ─────────────────────────────────────────────────────────────
//  SESSION HEALTH GATE (Human-Paced Safety Layer, 2026-09-11) — §15
//  Fail-closed session availability for autonomous sending.
//
//  This deployment's adapter is the Meta Cloud API (stateless HTTP per
//  send — there is NO persistent session, QR, or reconnect lifecycle to
//  manage, and NONE is invented here). What IS real: the provider can
//  reject credentials (401/403) — a FATAL session condition. Then:
//    • autonomous composing is disabled at its dispatch boundary (fail
//      closed) until the operator restores credentials, and
//    • the EXISTING bounded outbox retry policy is left untouched for
//      jobs already enqueued (transient 5xx/429/timeout are NOT fatal).
//  No blind session deletion, no QR regeneration, no reconnect loops,
//  no aggressive retries — by construction (no timers exist in this file).
// ─────────────────────────────────────────────────────────────
import { audit } from '../../sentinel/audit.js';

let state = { available: true, reason: null, since: null };

/** Mark the session unavailable (fatal condition). Audited once per episode. */
export function markSessionUnavailable(reason) {
  if (!state.available) return false;
  state = { available: false, reason: String(reason || 'unknown').slice(0, 120), since: new Date().toISOString() };
  audit('SESSION_UNAVAILABLE', { reason: state.reason, note: 'autonomous composing disabled until operator recovery; existing outbox retry policy untouched' });
  return true;
}

/** Operator recovery (re-authentication / credentials fixed). Audited. */
export function markSessionAvailable() {
  if (state.available) return false;
  const prevReason = state.reason;
  state = { available: true, reason: null, since: null };
  audit('SESSION_RESTORED', { prev_reason: prevReason });
  return true;
}

export const isSessionAvailable = () => state.available;
export const sessionStatus = () => ({ ...state });

// Test seam (documented): reset between tests; not part of the runtime path.
export function resetSessionHealth() {
  state = { available: true, reason: null, since: null };
}
