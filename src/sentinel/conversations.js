// ─────────────────────────────────────────────────────────────
//  CAP-008 — CONVERSATION STATE MACHINE (authoritative)
//  Legal transitions ONLY (CAP008_SPEC §1). Atomic claim via O_EXCL lock (§4).
//  SLA clock (§8). Controlled escalation reasons (§9). Explicit return-to-AI (§10).
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { ensureDir, atomicWriteJson, readJson } from './store.js';
import { audit } from './audit.js';

export const STATES = Object.freeze({
  AI_ACTIVE: 'AI_ACTIVE', ESCALATION_PENDING: 'ESCALATION_PENDING', QUEUED: 'QUEUED',
  CLAIMED: 'CLAIMED', HUMAN_ACTIVE: 'HUMAN_ACTIVE', RESOLVED: 'RESOLVED',
  AI_RESUMABLE: 'AI_RESUMABLE', CLOSED: 'CLOSED',
});
export const SLA = Object.freeze({ WITHIN_SLA: 'WITHIN_SLA', BREACHED: 'BREACHED', RESOLVED: 'RESOLVED' });
export const REASONS = Object.freeze([
  'CUSTOMER_REQUESTED_HUMAN', 'AI_UNCERTAIN', 'COMPLAINT', 'PAYMENT', 'PRICE_EXCEPTION',
  'PRODUCT_EXCEPTION', 'TECHNICAL_FAILURE', 'POLICY_LIMIT', 'UNKNOWN',
]);
const S = STATES;

// Legal transitions (spec §1 table — anything absent is rejected)
const LEGAL = {
  [S.AI_ACTIVE]: new Set([S.ESCALATION_PENDING]),
  [S.ESCALATION_PENDING]: new Set([S.QUEUED]),
  [S.QUEUED]: new Set([S.CLAIMED]),
  [S.CLAIMED]: new Set([S.HUMAN_ACTIVE, S.QUEUED, S.RESOLVED]),
  [S.HUMAN_ACTIVE]: new Set([S.RESOLVED]),
  [S.RESOLVED]: new Set([S.AI_RESUMABLE, S.CLOSED]),
  [S.AI_RESUMABLE]: new Set([S.AI_ACTIVE]),
  [S.CLOSED]: new Set([S.ESCALATION_PENDING]),
};

// AI is silenced in these (spec §5 — superset of directive minimum).
// ESCALATION_PENDING is TRANSIENT (inside escalate() only) so the ack can pass
// the chokepoint as source=AI_SYSTEM_ACK (one-shot window) — after QUEUED, silence.
const SUPPRESSED = new Set([S.QUEUED, S.CLAIMED, S.HUMAN_ACTIVE]);

const convDir = (tenant) => path.join(config.convDir, tenant || config.tenantId);
const convFile = (phone, tenant) => path.join(convDir(tenant), `${safeFile(phone)}.json`);
const lockFile = (phone, tenant) => path.join(convDir(tenant), 'claims', `${safeFile(phone)}.lock`);
const safeFile = (p) => String(p).replace(/[^\d]/g, '') || 'unknown';

let alertFn = () => {}; // owner alert injected at boot (outbox path)
export function setOwnerAlertFn(fn) { alertFn = fn; }

function load(phone, tenant) { return readJson(convFile(phone, tenant), null); }

function save(conv) {
  try { atomicWriteJson(convFile(conv.phone, conv.tenant), conv); return true; }
  catch (e) { audit('STATE_WRITE_FAILED', { conversation: conv.id, error: String(e?.message || e).slice(0, 120) }); return false; }
}

// Core transition guard — THE only way state changes
function transition(conv, to, actor, meta = {}) {
  const from = conv.state;
  if (!LEGAL[from]?.has(to)) {
    audit('TRANSITION_REJECTED', {
      actor: actorEnv(actor), tenant: conv.tenant, conversation: conv.id,
      prev_state: from, new_state: to, reason: meta.reason || 'illegal',
    });
    const err = new Error(`ILLEGAL_TRANSITION ${from}→${to}`);
    err.code = 'ILLEGAL_TRANSITION'; err.from = from; err.to = to;
    throw err;
  }
  conv.state = to;
  conv.updatedAt = new Date().toISOString();
  conv.history.push({ from, to, by: actor?.staffId || 'system', at: conv.updatedAt, actionId: meta.actionId || null });
  return conv;
}

const actorEnv = (a) => (a ? { staffId: a.staffId, role: a.role } : undefined);

function newConversation(phone, tenant) {
  const now = new Date().toISOString();
  return {
    id: `${tenant || config.tenantId}:${safeFile(phone)}`, phone, tenant: tenant || config.tenantId,
    state: S.AI_ACTIVE, claimedBy: null, unread: 0, priority: 'normal',
    reason: null, aiInference: null,
    queuedAt: null, claimedAt: null, firstHumanResponseAt: null, resolvedAt: null,
    slaDeadline: null, slaStatus: null, slaBreachAlerted: false,
    appliedActions: [], history: [], createdAt: now, updatedAt: now,
  };
}

export function getConversation(phone, tenant) {
  return load(phone, tenant);
}

export function listConversations(tenant) {
  const dir = convDir(tenant);
  ensureDir(dir);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f), null)).filter(Boolean)
    .sort((a, b) => score(b) - score(a));
  function score(c) {
    const pri = c.state === S.QUEUED ? 100 : c.state === S.CLAIMED || c.state === S.HUMAN_ACTIVE ? 50 : 0;
    return pri + (c.unread || 0) + (c.slaStatus === SLA.BREACHED ? 25 : 0);
  }
}

// Ack sender injected at boot (whatsapp path) — ack flies while state is the
// transient ESCALATION_PENDING (pre-suppression), tagged AI_SYSTEM_ACK.
let escalationAckSender = null;
export function setEscalationAckSender(fn) { escalationAckSender = fn; }

// ── ESCALATE (§9: reason validated against closed set; LLM only recommends) ──
// Atomic-ish phase order: audit ESCALATED → ack while possible → commit QUEUED.
// If ack fails, queue still commits and ACK_SEND_FAILED is audited (honesty).
export async function escalate(phone, reason, { tenant, aiInference = null, priority = 'normal', ackText = null } = {}) {
  let conv = load(phone, tenant) || newConversation(phone, tenant);
  const validReason = REASONS.includes(reason) ? reason : 'UNKNOWN';
  if (validReason !== reason) audit('REASON_MAPPED_UNKNOWN', { conversation: conv.id, got: String(reason).slice(0, 60) });
  if (SUPPRESSED.has(conv.state)) {
    // already in pipeline — bump unread, send NOTHING (no double-ack, state untouched)
    conv.unread += 1; conv.reason = conv.reason || validReason; save(conv);
    return { conv, already: true, ackSent: false };
  }
  const wasClosed = conv.state === S.CLOSED;
  transition(conv, S.ESCALATION_PENDING, null, { reason: validReason });
  conv.reason = validReason;
  conv.aiInference = aiInference;
  conv.priority = priority;
  const now = Date.now();
  conv.queuedAt = new Date(now).toISOString();
  conv.slaDeadline = new Date(computeDeadline(now)).toISOString();
  conv.slaStatus = SLA.WITHIN_SLA;
  conv.slaBreachAlerted = false;
  conv.claimedBy = null;
  if (!save(conv)) throw new Error('STATE_WRITE_FAILED');
  audit('ESCALATED', { tenant: conv.tenant, conversation: conv.id, prev_state: wasClosed ? S.CLOSED : S.AI_ACTIVE, new_state: S.ESCALATION_PENDING, reason: validReason });
  if (wasClosed) audit('REOPENED', { tenant: conv.tenant, conversation: conv.id, prev_state: S.CLOSED, new_state: S.ESCALATION_PENDING, reason: validReason });

  // Ack phase — the only AI-tagged send permitted during escalation
  let ackSent = false;
  const ack = ackText || honestAck(conv);
  if (escalationAckSender) {
    try { await escalationAckSender(phone, ack, conv); ackSent = true; }
    catch (e) { audit('ACK_SEND_FAILED', { tenant: conv.tenant, conversation: conv.id, error: String(e?.message || e).slice(0, 120) }); }
  }

  transition(conv, S.QUEUED, null, { reason: validReason });
  if (!save(conv)) throw new Error('STATE_WRITE_FAILED');
  return { conv, already: false, ackSent };
}

// ── Honest customer ack (§8 Human Fallback wording law) ──
export function honestAck(conv) {
  if (inStoreHours(Date.now()))
    return '👤 Aapka message hamari team tak pahunch gaya hai ✅ Store timing mein hain (10am–10pm) — team ka target 5 minute ke andar jawab dena hai. Tab tak aap "menu" bhi dekh sakte hain.';
  return '👤 Aapka message hamari team tak pahunch gaya hai ✅ Abhi store timing khatam ho chuki hai (10am–10pm) — kal subah 10 baje ke baad team aap se baat karegi. Shukriya aapke sabar ka. 🙏';
}

// SLA deadline: in-hours → +SLA_MINUTES_IN_HOURS; after-hours → next 10:00 PKT + 5min
function computeDeadline(nowMs) {
  const inMin = Number(config.slaMinutesInHours) * 60000;
  if (inStoreHours(nowMs)) return nowMs + inMin;
  const pkt = new Date(nowMs + 5 * 3600e3);
  const nextOpen = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate() + (pkt.getUTCHours() >= 22 ? 1 : 0), 10, 0, 0) - 5 * 3600e3;
  return nextOpen + inMin;
}
const inStoreHours = (ms) => { const h = new Date(ms + 5 * 3600e3).getUTCHours(); return h >= 10 && h < 22; };

// ── CLAIM (§4 atomic: O_EXCL lock file — atomic across processes) ──
export function claim(phone, actor, actionId) {
  let conv = load(phone, actor.tenant);
  if (!conv) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
  const dedupeHit = checkAction(conv, actionId);
  if (dedupeHit) return { conv, status: 'ALREADY_APPLIED' };
  ensureDir(path.dirname(lockFile(phone, actor.tenant)));
  let fd = null;
  try {
    fd = fs.openSync(lockFile(phone, actor.tenant), 'wx'); // ⛓ atomic create-or-fail
  } catch (e) {
    if (e.code === 'EEXIST') {
      const who = readJson(lockFile(phone, actor.tenant), {})?.staffId || conv.claimedBy;
      audit('CLAIM_CONFLICT', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, reason: `held_by:${who}` });
      return { conv, status: 'ALREADY_CLAIMED', claimedBy: who };
    }
    throw e;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ staffId: actor.staffId, claimedAt: new Date().toISOString() }));
  } finally { fs.closeSync(fd); }
  try {
    transition(conv, S.CLAIMED, actor, { actionId });
    conv.claimedBy = actor.staffId;
    conv.claimedAt = new Date().toISOString();
    conv.unread = 0;
    markAction(conv, actionId);
    if (!save(conv)) { fs.rmSync(lockFile(phone, actor.tenant), { force: true }); throw new Error('STATE_WRITE_FAILED'); }
  } catch (e) { if (e.code === 'ILLEGAL_TRANSITION') fs.rmSync(lockFile(phone, actor.tenant), { force: true }); throw e; }
  audit('ASSIGNED', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, prev_state: S.QUEUED, new_state: S.CLAIMED, actionId });
  audit('CLAIMED', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, prev_state: S.QUEUED, new_state: S.CLAIMED, actionId });
  return { conv, status: 'CLAIMED' };
}

// ── UNCLAIM ──
export function unclaim(phone, actor, actionId) {
  const conv = mustConv(phone, actor.tenant);
  mustOwner(conv, actor);
  const dedupeHit = checkAction(conv, actionId);
  if (dedupeHit) return { conv, status: 'ALREADY_APPLIED' };
  transition(conv, S.QUEUED, actor, { actionId });
  conv.claimedBy = null;
  markAction(conv, actionId);
  if (!save(conv)) throw new Error('STATE_WRITE_FAILED');
  fs.rmSync(lockFile(phone, actor.tenant), { force: true });
  audit('UNCLAIMED', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, prev_state: S.CLAIMED, new_state: S.QUEUED, actionId });
  return { conv, status: 'QUEUED' };
}

// ── RESOLVE (idempotent by actionId; released lock) ──
export function resolve(phone, actor, actionId) {
  const conv = mustConv(phone, actor.tenant);
  mustOwner(conv, actor);
  if (conv.state === S.RESOLVED && conv.appliedActions.includes(actionId)) return { conv, status: 'ALREADY_APPLIED' };
  const from = conv.state;
  transition(conv, S.RESOLVED, actor, { actionId });
  conv.resolvedAt = new Date().toISOString();
  conv.slaStatus = SLA.RESOLVED;
  markAction(conv, actionId);
  if (!save(conv)) throw new Error('STATE_WRITE_FAILED');
  fs.rmSync(lockFile(phone, actor.tenant), { force: true });
  audit('RESOLVED', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, prev_state: from, new_state: S.RESOLVED, actionId });
  return { conv, status: 'RESOLVED' };
}

// ── RETURN TO AI (§10 explicit only) ──
export function returnToAi(phone, actor, actionId) {
  const conv = mustConv(phone, actor.tenant);
  const dedupeHit = checkAction(conv, actionId);
  if (dedupeHit) return { conv, status: 'ALREADY_APPLIED' };
  const from = conv.state;
  transition(conv, S.AI_RESUMABLE, actor, { actionId });
  transition(conv, S.AI_ACTIVE, actor, { actionId }); // one commit, two audited states
  conv.claimedBy = null;
  conv.reason = null;
  conv.slaStatus = SLA.RESOLVED;
  markAction(conv, actionId);
  if (!save(conv)) throw new Error('STATE_WRITE_FAILED');
  fs.rmSync(lockFile(phone, actor.tenant), { force: true });
  audit('AI_RESUMED', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, prev_state: from, new_state: S.AI_ACTIVE, actionId });
  return { conv, status: 'AI_ACTIVE' };
}

// ── CLOSE (RESOLVED → CLOSED, archival) ──
export function closeConv(phone, actor, actionId) {
  const conv = mustConv(phone, actor.tenant);
  const dedupeHit = checkAction(conv, actionId);
  if (dedupeHit) return { conv, status: 'ALREADY_APPLIED' };
  const from = conv.state;
  transition(conv, S.CLOSED, actor, { actionId });
  markAction(conv, actionId);
  if (!save(conv)) throw new Error('STATE_WRITE_FAILED');
  audit('CLOSED', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, prev_state: from, new_state: S.CLOSED, actionId });
  return { conv, status: 'CLOSED' };
}

// ── HUMAN REPLY bookkeeping (called only after authz+ownership; send happens via outbox) ──
export function noteHumanMessage(phone, actor, actionId, outboxJobId) {
  const conv = mustConv(phone, actor.tenant);
  if (conv.state === S.CLAIMED) transition(conv, S.HUMAN_ACTIVE, actor, { actionId });
  if (!conv.firstHumanResponseAt) conv.firstHumanResponseAt = new Date().toISOString();
  markAction(conv, actionId);
  if (!save(conv)) throw new Error('STATE_WRITE_FAILED');
  audit('HUMAN_MESSAGE_SENT', { actor: actorEnv(actor), tenant: actor.tenant, conversation: conv.id, actionId, outboxJob: outboxJobId });
  return conv;
}

// ── Inbound message while suppressed → context append only (never a reply) ──
export function noteInboundWhileSuppressed(phone, tenant, wamid) {
  const conv = load(phone, tenant);
  if (!conv || !SUPPRESSED.has(conv.state)) return false;
  conv.unread += 1;
  conv.updatedAt = new Date().toISOString();
  save(conv);
  audit('AI_SUPPRESSED', { tenant: conv.tenant, conversation: conv.id, prev_state: conv.state, new_state: conv.state, reason: 'human_owned', inboundEvent: wamid });
  return true;
}

// ── SUPPRESSION + OUTBOUND GUARD (§5 wall 2) ──
export const isSuppressed = (phone, tenant) => SUPPRESSED.has(load(phone, tenant)?.state);

// authorizeOutbound: the single chokepoint guard — wired into services/whatsapp.send via setSendGuard()
export function authorizeOutbound(toPhone, meta = {}) {
  // Consent acknowledgements are a legal duty — never blocked (fixed code paths only).
  if (meta.source === 'CONSENT_ACK') return { ok: true };
  const conv = load(toPhone, null);
  if (!conv || !SUPPRESSED.has(conv.state)) {
    if (meta.source === 'AI' && conv?.state === S.ESCALATION_PENDING) {
      return { ok: false, reason: 'AI_SEND_BLOCKED_USE_ACK_SOURCE', state: conv.state };
    }
    return { ok: true };
  }
  if (meta.source === 'AI_SYSTEM_ACK' && conv.state === S.ESCALATION_PENDING) return { ok: true };
  if (meta.source === 'HUMAN' && conv.claimedBy && meta.staffId === conv.claimedBy) return { ok: true };
  audit('AI_SEND_BLOCKED_HUMAN_ACTIVE', { tenant: conv.tenant, conversation: conv.id, prev_state: conv.state, new_state: conv.state, reason: `blocked_source:${meta.source || 'UNTAGGED'}` });
  return { ok: false, reason: 'AI_SEND_BLOCKED_HUMAN_ACTIVE', state: conv.state };
}

// ── SLA sweep (§8) — called every 60s at boot / directly by tests ──
export function slaSweep(nowMs = Date.now()) {
  let breached = 0;
  for (const tenant of allTenants()) {
    for (const conv of listConversations(tenant)) {
      if (conv.slaStatus !== SLA.WITHIN_SLA || !conv.slaDeadline) continue;
      if (nowMs <= Date.parse(conv.slaDeadline)) continue;
      conv.slaStatus = SLA.BREACHED;
      if (!save(conv)) continue;
      audit('SLA_BREACHED', { tenant, conversation: conv.id, prev_state: conv.state, new_state: conv.state, reason: `deadline:${conv.slaDeadline}` });
      breached++;
      if (!conv.slaBreachAlerted) {
        conv.slaBreachAlerted = true; save(conv);
        try { alertFn({ tenant, conversation: conv.id, reason: conv.reason, state: conv.state }); } catch {}
      }
    }
  }
  return breached;
}
function allTenants() {
  ensureDir(config.convDir);
  return fs.readdirSync(config.convDir).filter((d) => { try { return fs.statSync(path.join(config.convDir, d)).isDirectory(); } catch { return false; } });
}

// ── helpers ──
function mustConv(phone, tenant) {
  const conv = load(phone, tenant);
  if (!conv) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
  return conv;
}
function mustOwner(conv, actor) {
  if (actor.role === 'OWNER') return;
  if (conv.claimedBy !== actor.staffId) {
    const e = new Error(`NOT_OWNER held_by:${conv.claimedBy}`);
    e.code = 'NOT_OWNER'; throw e;
  }
}
const validActionId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(id);
export function requireActionId(id) {
  if (!validActionId(id)) { const e = new Error('ACTION_ID_REQUIRED'); e.code = 'ACTION_ID_REQUIRED'; throw e; }
}
function checkAction(conv, actionId) { return actionId && conv.appliedActions.includes(actionId); }
function markAction(conv, actionId) {
  if (!actionId) return;
  conv.appliedActions.push(actionId);
  if (conv.appliedActions.length > 200) conv.appliedActions = conv.appliedActions.slice(-150);
}
export const _internals = { convFile, lockFile, inStoreHours, computeDeadline, newConversation };
