// ─────────────────────────────────────────────────────────────
//  V1-4 (2026-09-10) — POST-PURCHASE SATISFACTION FOLLOW-UP
//  V1-5′ (2026-09-11) — delivery truth + paid-sale qualifier
//
//  CONTRACT:
//   • ONE satisfaction/health-check follow-up per qualifying purchase,
//     ~Day 10 after the recorded sale. Customer-care, NOT marketing.
//   • Qualifying sale (V1-5′): engine-recorded outcome='sale' AND
//     verification='paid' (staff-confirmed paid sale). A customer
//     saying "I'll take this" is stated intent only and does NOT
//     schedule care. There is still NO payment gateway — `paid` is
//     a staff (or future POS) confirmation of an already-stated sale.
//   • Delivery states are honest:
//       SCHEDULED → QUEUED → SUBMITTED | UNKNOWN | FAILED
//       SUBMITTED = provider accepted the send (NOT customer DELIVERED)
//       DELIVERED is never claimed (this transport has no delivery proof)
//       enqueue ≠ SUBMITTED
//   • LIVE / window-enforced: do not send free-form Day-10 text outside
//     the 24h customer-care window; leave SCHEDULED (honest deferral).
// ─────────────────────────────────────────────────────────────
import { findProduct } from './catalog.js';
import { getCustomer, listFollowups, getFollowup, patchFollowup, recordFollowup, negotiationOutcomes } from './customers.js';
import * as wa from './whatsapp.js';
import { escalate, getConversation } from '../sentinel/conversations.js';
import { isStopped } from '../sentinel/killswitch.js';
import { claimEvent } from '../sentinel/idempotency.js';
import { audit } from '../sentinel/audit.js';
import { isLive } from '../config.js';

export const FOLLOWUP_DELAY_DAYS = 10;
const DAY_MS = 86400000;
const WINDOW_MS = 24 * 3600 * 1000;

const MESSAGE_TPL = 'Assalamualaikum! Aapka {product} kaisa chal raha hai? 😊 Koi issue ya help chahiye ho to humein zaroor batayein.';
const MESSAGE_BASE = 'Assalamualaikum! Aapka phone kaisa chal raha hai? 😊 Koi issue ya help chahiye ho to humein zaroor batayein.';
export function composeMessage(productId) {
  const p = findProduct(productId);
  return p?.name ? MESSAGE_TPL.replace('{product}', p.name) : MESSAGE_BASE;
}

const POSITIVE_ACK = 'Shukria ji! Bohot acha sun kar khushi hui 😊 Agar koi masla aaye to kabhi bhi *staff* likh dein — hum hamesha hazir hain.';

// ── Qualifying-sale validation (fail-CLOSED): stated intent is NOT paid.
function followupIdFor(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (rec.outcome !== 'sale') return null;
  if (rec.verification !== 'paid') return null; // V1-5′: staff-confirmed paid only
  if (typeof rec.phone !== 'string' || !/^\d{8,15}$/.test(rec.phone)) return null;
  if (typeof rec.product !== 'string' || !rec.product) return null;
  if (typeof rec.at !== 'string' || !Number.isFinite(Date.parse(rec.at))) return null;
  return `fu-${rec.phone}-${rec.product}-${rec.at}-${rec.final_offer ?? 'na'}`;
}

/**
 * Cloud API free-form customer-care window. DEMO does not enforce
 * (not evidence of production). Tests may pass { enforce: true }.
 * Uses the sweep's `now` so timing is deterministic.
 */
export function customerCareWindow(phone, now = Date.now(), { enforce = isLive() } = {}) {
  if (!enforce) return { ok: true, reason: 'demo_window_unenforced' };
  const c = getCustomer(phone);
  const last = c?.lastSeen ? Date.parse(c.lastSeen) : 0;
  if (!Number.isFinite(last) || last <= 0) return { ok: false, reason: 'customer_window_closed' };
  const open = now - last < WINDOW_MS;
  return open ? { ok: true, reason: 'window_open' } : { ok: false, reason: 'customer_window_closed' };
}

/**
 * Outbox terminal observer. Enqueue is QUEUED; only a provider-terminal
 * job may move the follow-up to SUBMITTED / FAILED / UNKNOWN.
 * DELIVERED is never written — this transport does not prove it.
 */
export function noteOutboxTerminal(job) {
  const id = job?.meta?.actionId;
  if (!id) return;
  const f = getFollowup(id);
  if (!f) return;
  if (f.status !== 'QUEUED' && f.status !== 'UNKNOWN') return;
  if (job.status === 'SENT' || job.status === 'SENT_WITH_AUDIT_GAP') {
    patchFollowup(id, {
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString(),
      delivery: 'UNPROVEN',
      reason: null,
    });
    audit('FOLLOWUP_SUBMITTED', { id, job: job.id, delivery: 'UNPROVEN' });
    return;
  }
  if (job.status === 'DLQ') {
    patchFollowup(id, { status: 'FAILED', reason: job.dlqReason || 'dlq', delivery: 'NONE' });
    audit('FOLLOWUP_FAILED', { id, job: job.id, reason: job.dlqReason || 'dlq' });
    return;
  }
  if (job.status === 'UNKNOWN_REQUEUED') {
    patchFollowup(id, { status: 'UNKNOWN', reason: 'execution_result_unknown', delivery: 'UNKNOWN' });
    audit('FOLLOWUP_UNKNOWN', { id, job: job.id });
  }
}

/**
 * The deterministic sweep — called by the scheduler every 15 minutes
 * (and directly by tests with an explicit `now`).
 *
 * ASYNC BY DESIGN: the send path is async. Enqueue success is QUEUED,
 * never SUBMITTED/SENT. Provider outcome arrives via noteOutboxTerminal.
 */
export async function sweepFollowUps(now = Date.now(), opts = {}) {
  const created = [];
  const queued = [];
  const skipped = [];
  const failed = [];
  const sent = []; // V1-5′: always empty — enqueue is not a send. Kept so old callers don't read a lie.

  for (const rec of negotiationOutcomes()) {
    const id = followupIdFor(rec);
    if (!id) continue;
    if (getFollowup(id)) continue;
    const claim = claimEvent(`fu:${id}`);
    if (claim === false) continue;
    if (claim === null) continue;
    const saleAt = Date.parse(rec.at);
    recordFollowup({
      id,
      phone: rec.phone,
      product: rec.product,
      saleAt: rec.at,
      dueAt: new Date(saleAt + FOLLOWUP_DELAY_DAYS * DAY_MS).toISOString(),
      status: 'SCHEDULED',
      createdAt: new Date(now).toISOString(),
      outcome: null,
      sentAt: null,
      submittedAt: null,
      delivery: null,
      reason: null,
    });
    audit('FOLLOWUP_SCHEDULED', { id, product: rec.product, delayDays: FOLLOWUP_DELAY_DAYS });
    created.push(id);
  }

  if (isStopped()) {
    const due = listFollowups().filter((f) => f.status === 'SCHEDULED' && Number.isFinite(Date.parse(f.dueAt)) && Date.parse(f.dueAt) <= now).length;
    if (due) audit('FOLLOWUP_SWEEP_DEFERRED', { reason: 'kill_switch_active', due });
    return { created, queued, sent, skipped, failed, deferred: true };
  }

  const enforceWindow = opts.enforceWindow === true || (opts.enforceWindow !== false && isLive());

  for (const fu of listFollowups()) {
    if (fu.status !== 'SCHEDULED') continue;
    if (!Number.isFinite(Date.parse(fu.dueAt)) || Date.parse(fu.dueAt) > now) continue;
    const c = getCustomer(fu.phone);
    if (!c) {
      patchFollowup(fu.id, { status: 'SKIPPED', reason: 'customer_missing' });
      audit('FOLLOWUP_SKIPPED', { id: fu.id, reason: 'customer_missing' });
      skipped.push(fu.id);
      continue;
    }
    if (c.optedOut === true) {
      patchFollowup(fu.id, { status: 'SKIPPED_OPTOUT', reason: 'opted_out' });
      audit('FOLLOWUP_SKIPPED_OPTOUT', { id: fu.id });
      skipped.push(fu.id);
      continue;
    }
    const win = customerCareWindow(fu.phone, now, { enforce: enforceWindow });
    if (!win.ok) {
      // Honest deferral: do not enqueue a free-form text the transport will
      // refuse. Stay SCHEDULED so a later inbound that opens the window can
      // still receive the one-shot care message. Never mark SUBMITTED/SENT.
      audit('FOLLOWUP_WINDOW_CLOSED', { id: fu.id, reason: win.reason });
      skipped.push(fu.id);
      continue;
    }
    try {
      const job = await wa.sendText(fu.phone, composeMessage(fu.product), { source: 'AI', actionId: fu.id });
      patchFollowup(fu.id, { status: 'QUEUED', queuedAt: new Date(now).toISOString(), outboxJob: job.id, delivery: 'UNPROVEN' });
      audit('FOLLOWUP_QUEUED', { id: fu.id, product: fu.product, job: job.id });
      queued.push(fu.id);
    } catch (e) {
      const code = e?.code || 'SEND_FAILED';
      if (code === 'KILL_SWITCH_ACTIVE') {
        audit('FOLLOWUP_SEND_DEFERRED', { id: fu.id, reason: code });
      } else {
        const status = code.startsWith('AI_SEND_BLOCKED') ? 'SKIPPED_HUMAN' : 'SKIPPED';
        patchFollowup(fu.id, { status, reason: code });
        audit('FOLLOWUP_SEND_FAILED', { id: fu.id, reason: code });
        skipped.push(fu.id);
      }
    }
  }
  return { created, queued, sent, skipped, failed, deferred: false };
}

const OPEN_FOLLOWUP_STATUSES = new Set(['SUBMITTED', 'SENT']); // SENT = legacy alias; never written after V1-5′

export function latestOpenFollowup(phone) {
  const open = listFollowups().filter((f) => f.phone === phone && OPEN_FOLLOWUP_STATUSES.has(f.status));
  return open.length ? open[open.length - 1] : null;
}

const MAX_RESPONSE_LEN = 100;
const ISSUE_RE = /\b(battery|heat|garam|camera|display|screen|hang|freeze|friz|restart|reboot|charge|charging|speaker|mic|sound|network|sim|boot|slow|lag|toot|kharab|masla|problem|issue|fault)\b|nahi\s+chal|nahi\s+ho\s+raha/i;
const NEGATED_ISSUE_RE = /\b(masla|problem|issue|kharab|fault)\s*(nahi|nhi|na)\b|\b(nahi|nhi)\s*(masla|problem|issue|kharab|fault)\b/i;
const POSITIVE_START_RE = /^(haan|ji|bilkul|theek|sab|ya|ok|okay|fine|kamaal|mashallah|hamdallah|alhamdulillah|zaroor|yaqeen|chalta|chalti)/i;
const POSITIVE_BODY_RE = /\b(theek|ok|okay|fine|kamaal|badhiya|achha|achhi|good|perfect|great|bilkul|masla\s+nahi|koi\s+masla\s+nahi|koi\s+problem\s+nahi|koi\s+issue\s+nahi)\b/i;

export function classifyFollowUpResponse(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t || t.length > MAX_RESPONSE_LEN) return null;
  const cleaned = t
    .replace(/\b(masla|problem|issue|kharab|fault)\s*(nahi|nhi|na)\b/g, ' ')
    .replace(/\b(nahi|nhi)\s*(masla|problem|issue|kharab|fault)\b/g, ' ');
  if (ISSUE_RE.test(cleaned)) return 'issue';
  if (/(theek|ok|fine|chal)/.test(t) && /\b(nahi|nhi)\b/.test(t)) return 'issue';
  if (NEGATED_ISSUE_RE.test(t) && POSITIVE_BODY_RE.test(t)) return 'positive';
  if (POSITIVE_START_RE.test(t) && POSITIVE_BODY_RE.test(t)) return 'positive';
  return null;
}

export async function handleFollowUpResponse(from, rawText, customer) {
  if (customer?.stateData?.negotiation?.active) return false;
  const fu = latestOpenFollowup(from);
  if (!fu) return false;
  const cls = classifyFollowUpResponse(rawText);
  if (cls === null) return false;

  if (cls === 'positive') {
    patchFollowup(fu.id, { status: 'CLOSED', outcome: 'no_issue', closedAt: new Date().toISOString() });
    audit('FOLLOWUP_CLOSED', { id: fu.id, outcome: 'no_issue', source: 'deterministic' });
    await wa.sendText(from, POSITIVE_ACK, { source: 'AI' });
    return true;
  }
  patchFollowup(fu.id, { status: 'ESCALATED', outcome: 'issue', closedAt: new Date().toISOString() });
  audit('FOLLOWUP_ESCALATED', { id: fu.id, outcome: 'issue', source: 'deterministic' });
  try {
    await escalate(from, 'PRODUCT_EXCEPTION', { aiInference: { intent: 'repair', source: 'v14-followup-response' } });
  } catch (e) {
    audit('FOLLOWUP_ESCALATION_FAILED', { id: fu.id, error: String(e?.message || e).slice(0, 120) });
  }
  return true;
}

export function noteFollowUpAfterBrain(from) {
  const fu = latestOpenFollowup(from);
  if (!fu) return;
  const conv = getConversation(from);
  const wentHuman = Boolean(conv) && ['ESCALATION_PENDING', 'QUEUED', 'CLAIMED', 'HUMAN_ACTIVE'].includes(conv.state);
  patchFollowup(fu.id, {
    status: wentHuman ? 'ESCALATED' : 'CLOSED',
    outcome: wentHuman ? 'human_support' : 'no_issue',
    closedAt: new Date().toISOString(),
  });
  audit(wentHuman ? 'FOLLOWUP_ESCALATED' : 'FOLLOWUP_CLOSED', {
    id: fu.id, outcome: wentHuman ? 'human_support' : 'no_issue', source: 'brain',
  });
}
