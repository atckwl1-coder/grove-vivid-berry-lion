// ─────────────────────────────────────────────────────────────
//  HUMAN-PACED RESPONSE & CONVERSATION SAFETY LAYER — CONFIG (2026-09-11)
//  §18: ONE configuration source for the whole layer — no magic numbers
//  scattered across the codebase. All values are env-overridable (HP_*)
//  with conservative defaults.
//
//  Why the defaults are modest: the layer must not break the existing
//  response-timing contract of the running system. The tightest existing
//  window is CAP-055 KS4: two customer messages 152ms apart, with at
//  least one reply expected by t+280ms. Per §9 a new message supersedes
//  any in-flight composition — so the FIRST reply must complete BEFORE
//  the second message lands (~152ms), which bounds a 148-char reply's
//  composition to ≲90ms (p99). The per-character defaults below meet
//  that budget with margin for the outbox poll. Operators raise HP_*
//  values for production UX tuning — the pacing model, bounds and
//  breaker thresholds all scale from this one object.
//
//  This is a customer UX / response-pacing mechanism. It is NOT an
//  anti-ban, detection-bypass or "human indistinguishability" system — the
//  defaults are chosen for UX and runtime safety, not for evading anything.
// ─────────────────────────────────────────────────────────────
function num(env, def) {
  const v = Number(process.env[env]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}
function bool(env, def) {
  const v = process.env[env];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
}

const C = {
  // Per-character composition interval model (§4/§5):
  // interval = clamp(base + bounded variance + context adjustment, min, max)
  char: Object.freeze({
    baseMs: num('HP_CHAR_BASE_MS', 0.25),
    varianceMs: num('HP_CHAR_VARIANCE_MS', 0.25), // bounded ±(not unbounded random)
    minMs: num('HP_CHAR_MIN_MS', 0),
    maxMs: num('HP_CHAR_MAX_MS', 5),
  }),
  // Structured pausing (§5) — additive context adjustments, still capped by char bounds
  boundaries: Object.freeze({
    wordBoundaryMs: num('HP_WORD_BOUNDARY_MS', 0.5), // spaces / word edges
    commaMs: num('HP_COMMA_MS', 2),
    sentenceMs: num('HP_SENTENCE_MS', 5),            // . ! ? …
    lineBreakMs: num('HP_LINE_BREAK_MS', 8),
  }),
  // Total composition duration caps (§6)
  duration: Object.freeze({
    minMs: num('HP_MIN_COMPOSITION_MS', 50),
    maxMs: num('HP_MAX_COMPOSITION_MS', 300),
    // Length the timing model considers; longer text is paced flat at the
    // per-character minimum (no extra model cost). Aligned with the existing
    // 500-char message-recording boundary — no new message-length policy.
    maxCharsForModel: num('HP_MAX_CHARS_FOR_MODEL', 500),
  }),
  // Typing/composing presence (§7): a UX feature only. The Meta Cloud API
  // exposes a supported typing indicator on the adapter's existing messages
  // endpoint (status:read + typing_indicator; verified against the actual
  // session technology 2026-09-11 — VR-2026-09-11-02). The platform
  // auto-dismisses it on response or after 25s (no explicit stop exists).
  // In DEMO mode the adapter is network-isolated (isLive guard), so enabling
  // it is always safe; set HP_TYPING_ENABLED=false to disable in production.
  typing: Object.freeze({ enabled: bool('HP_TYPING_ENABLED', true) }),
  // Conversation circuit breaker (§14) — bounded loop/burst protection.
  // Turn = one successfully dispatched autonomous brain reply. Thresholds are
  // objective runtime anomalies (volume, duplicate cycles, failed dispatch) —
  // repeated negotiation/pricing questions are NOT spam and are not counted
  // (the V1-3 engine path is outside this breaker by design).
  breaker: Object.freeze({
    windowMs: num('HP_BREAKER_WINDOW_MS', 10 * 60 * 1000),
    softTurnsPerWindow: num('HP_BREAKER_SOFT_TURNS', 12),  // → PRESSURE (observed + audited)
    hardTurnsPerWindow: num('HP_BREAKER_HARD_TURNS', 20),  // → HUMAN_REVIEW (stop + human path)
    maxDuplicateCycle: num('HP_BREAKER_MAX_DUP_CYCLE', 3), // repeated identical inbound+reply pairs
    maxConsecutiveDispatchFailures: num('HP_BREAKER_MAX_DISPATCH_FAILURES', 3),
  }),
};

export const HUMAN_PACED_CONFIG = Object.freeze(C);
