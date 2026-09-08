// ─────────────────────────────────────────────────────────────
//  P2 — CENTRAL ACTION FIREWALL (ACTION_FIREWALL_SPEC.md)
//  The ONE deterministic server-side boundary for autonomy-facing sends.
//  Stages: KILL → IDENTITY → AUTHZ → EVIDENCE → POLICY → RISK → IDEMPOTENCY
//          → (caller performs EXECUTION via outbox) → RESULT stays with outbox
//          → AUDIT here on EVERY evaluation.
//  Authority law: SYSTEM > TENANT > BUSINESS > STAFF > CUSTOMER > MODEL.
//  LLM/customer fields are REQUEST data only — never authorization.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { config } from '../config.js';
import * as killswitch from './killswitch.js';
import * as conversations from './conversations.js';
import { claimEvent } from './idempotency.js';
import { audit } from './audit.js';

// §2 closed class set. Anything else ⇒ UNKNOWN_ACTION_CLASS (fail-closed).
export const ACTION_CLASS = Object.freeze({
  MSG_AI_TEXT: 'MSG.AI_TEXT',
  MSG_ESCALATION_ACK: 'MSG.ESCALATION_ACK',
  MSG_CONSENT_ACK: 'MSG.CONSENT_ACK',
  MSG_HUMAN_TEXT: 'MSG.HUMAN_TEXT',
  MSG_SYSTEM_ALERT: 'MSG.SYSTEM_ALERT',
  MARKETING_SEND: 'MARKETING.SEND',
  COMMERCE_RESERVE: 'COMMERCE.RESERVE',
  COMMERCE_ADMIN_ACTION: 'COMMERCE.ADMIN_ACTION',
});
const C = ACTION_CLASS;

// meta.source → class default (source is OUR tag set by OUR code paths, never caller text)
const SOURCE_CLASS = Object.freeze({
  AI: C.MSG_AI_TEXT,
  AI_SYSTEM_ACK: C.MSG_ESCALATION_ACK,
  CONSENT_ACK: C.MSG_CONSENT_ACK,
  HUMAN: C.MSG_HUMAN_TEXT,
  SYSTEM: C.MSG_SYSTEM_ALERT,
  MARKETING: C.MARKETING_SEND,
  CAMPAIGN: C.MARKETING_SEND,
});

// sources that are NOT autonomous (CAP-055 passthrough set, mirrored — not redefined)
const HUMAN_DUTY = new Set(['HUMAN', 'CONSENT_ACK']);

function deny(traceId, stage, reason, extra = {}) {
  audit('FIREWALL_DECISION', { traceId, decision: 'DENY', stage, reason, ...extra });
  return { decision: 'DENY', stage, reason, traceId };
}
function allow(traceId, klass, extra = {}) {
  audit('FIREWALL_DECISION', { traceId, decision: 'ALLOW', stage: 'EXECUTION', reason: 'ALL_STAGES_PASS', class: klass, ...extra });
  return { decision: 'ALLOW', stage: 'EXECUTION', reason: 'ALL_STAGES_PASS', class: klass, traceId };
}

/**
 * evaluate(action) — pure decision. NEVER sends. NEVER throws to caller (fail-closed inside).
 * action: { class?, source, toPhone, tenant?, actor?:{staffId,role}, actionId?, evidence?:{status} }
 * returns: { decision: 'ALLOW'|'DENY', reason, stage, traceId }   (ESCALATE wired, unused by §2 classes)
 */
export function evaluate(action) {
  const traceId = 'fw-' + crypto.randomBytes(6).toString('hex');
  try {
    // ── RISK/pre-stage: malformed requests die first (spec §6) ──
    if (!action || typeof action !== 'object') return deny(traceId, 'RISK', 'MALFORMED_REQUEST');
    if (typeof action.toPhone !== 'string' || !/^\d{8,15}$/.test(action.toPhone)) {
      audit('FIREWALL_DECISION', { traceId, decision: 'DENY', stage: 'RISK', reason: 'MALFORMED_RECIPIENT', to: action?.toPhone });
      return { decision: 'DENY', stage: 'RISK', reason: 'MALFORMED_RECIPIENT', traceId };
    }
    const source = typeof action.source === 'string' ? action.source : null;
    const klass = action.class || SOURCE_CLASS[source] || null;

    // ── Stage 1 IDENTITY ──
    if (!klass || !Object.values(C).includes(klass)) {
      return deny(traceId, 'IDENTITY', 'UNKNOWN_ACTION_CLASS', { to: action.toPhone, class: String(action.class || source) });
    }
    if (action.tenant && action.tenant !== config.tenantId) {
      return deny(traceId, 'IDENTITY', 'INVALID_TENANT', { to: action.toPhone, class: klass, tenant: action.tenant });
    }
    if (klass === C.MSG_HUMAN_TEXT && !action.actor?.staffId) {
      return deny(traceId, 'IDENTITY', 'MISSING_ACTOR', { to: action.toPhone, class: klass });
    }
    // NB (§4 NON-AUTHORITIES): meta.claimsRole/claimsAuthority/assertedByModel are NEVER read here.

    // ── Stage 0 KILL (CAP-055 upstream gate — mandatory, first) ──
    // Event name preserved for CAP-055 audit continuity: KILL_SEND_BLOCKED.
    if (!HUMAN_DUTY.has(source) && killswitch.isStopped()) {
      audit('KILL_SEND_BLOCKED', { reason: `blocked_source:${source || 'UNTAGGED'}`, class: klass, traceId });
      return deny(traceId, 'KILL', 'KILL_SWITCH_ACTIVE', { to: action.toPhone, class: klass });
    }

    // ── Stage 2 AUTHZ (CAP-008 conversation ownership — the same audited rule) ──
    const g = conversations.authorizeOutbound(action.toPhone, { source, staffId: action.actor?.staffId });
    if (!g.ok) return deny(traceId, 'AUTHZ', g.reason, { to: action.toPhone, class: klass });

    // ── Stage 3 EVIDENCE (only explicit-decay signals bind; absent ⇒ class rules govern) ──
    if (action.evidence && action.evidence.status && action.evidence.status !== 'VERIFIED') {
      return deny(traceId, 'EVIDENCE', 'EVIDENCE_NOT_VERIFIED', { to: action.toPhone, class: klass, evidenceStatus: action.evidence.status });
    }

    // ── Stage 4 POLICY (business rules — each DENY cites its registry authority) ──
    if (klass === C.MARKETING_SEND) return deny(traceId, 'POLICY', 'FEATURE_OFF_MARKETING', { to: action.toPhone, class: klass });
    if (klass === C.COMMERCE_RESERVE) return deny(traceId, 'POLICY', 'FEATURE_OFF_RESERVATION', { to: action.toPhone, class: klass });
    if (klass === C.COMMERCE_ADMIN_ACTION) return deny(traceId, 'POLICY', 'NO_AUTHORITY_SUBSYSTEM', { to: action.toPhone, class: klass });

    // ── Stage 6 IDEMPOTENCY (only for actionId-bearing actions: staff/ack/command sends) ──
    if (action.actionId) {
      const claim = claimEvent(`fw:${action.actionId}`);
      if (claim === false) return deny(traceId, 'IDEMPOTENCY', 'REPLAYED', { to: action.toPhone, class: klass });
      if (claim === null) return deny(traceId, 'IDEMPOTENCY', 'IDEMPOTENCY_UNAVAILABLE', { to: action.toPhone, class: klass }); // fail-closed
    }

    return allow(traceId, klass, { to: action.toPhone, actor: action.actor ? { staffId: action.actor.staffId } : undefined, actionId: action.actionId });
  } catch (e) {
    // §6: firewall failure must NEVER silently become ALLOW
    audit('FIREWALL_ERROR_FAILCLOSED', { traceId, error: String(e?.message || e).slice(0, 160) });
    audit('FIREWALL_DECISION', { traceId, decision: 'DENY', stage: 'INTERNAL', reason: 'FAILCLOSED_INTERNAL' });
    return { decision: 'DENY', stage: 'INTERNAL', reason: 'FAILCLOSED_INTERNAL', traceId };
  }
}

export const _constants = { SOURCE_CLASS, HUMAN_DUTY };
