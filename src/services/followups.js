// ─────────────────────────────────────────────────────────────
//  V1-4 (2026-09-10) — POST-PURCHASE SATISFACTION FOLLOW-UP
//  "sales don't end at purchase" — the first real customer-care automation.
//
//  CONTRACT (owner directive 2026-09-10 — the sole authority for this task):
//   • ONE satisfaction/health-check follow-up per qualifying purchase,
//     ~Day 10 after the recorded sale. Customer-care, NOT a marketing
//     campaign (no offers, discounts, scarcity, review/referral asks).
//   • Sale state = ONLY what this deployment can truthfully establish:
//     negotiation outcomes with outcome='sale' AND
//     verification='customer_statement' (there is NO payment system —
//     never treat a sale as a verified payment; never fabricate one).
//   • Positive reply  → natural acknowledgement + close the follow-up.
//   • Issue reply     → existing CAP-008 support/escalation path
//     (PRODUCT_EXCEPTION). No hardware diagnosis, no warranty outcomes,
//     no replacement promises.
//   • No chasing: one follow-up per purchase; no reminder on no-response.
//
//  SAFETY — reuses EXISTING mechanisms only (no new transport, no new
//  dedup system, no new consent architecture):
//   • Consent (CAP-002): an EXPLICIT optedOut customer is never messaged.
//     No other consent state is reinterpreted (optedIn is a marketing flag).
//   • Kill switch (CAP-055): the sweep short-circuits dispatch while
//     stopped; every send ALSO passes the firewall KILL stage and the
//     outbox execute-layer gate — the standard two walls, no bypass.
//   • P2 firewall: every outbound follow-up goes through the ONE send path
//     (wa.sendText → firewall.evaluate → durable outbox) with source 'AI'
//     and actionId = the follow-up id (provenance + firewall idempotency).
//   • Idempotency: the EXISTING claimEvent() marker gives one atomic claim
//     per sale record (crash/restart/duplicate-event safe), plus the status
//     lifecycle SCHEDULED → SENT | SKIPPED_* (terminal) → CLOSED/ESCALATED.
//   • Storage: follow-up records live in the EXISTING customers DB
//     (one new array — no new store).
//   • The LLM is NOT on the decision path: it may phrase/classify ordinary
//     conversation via the existing brain path, but purchase truth,
//     follow-up authorization, timing, opt-out, kill-switch state, send
//     permission and warranty terms are deterministic/system-controlled.
// ─────────────────────────────────────────────────────────────
import { findProduct } from './catalog.js';
import { getCustomer, listFollowups, getFollowup, patchFollowup, recordFollowup, negotiationOutcomes } from './customers.js';
import * as wa from './whatsapp.js';
import { escalate, getConversation } from '../sentinel/conversations.js';
import { isStopped } from '../sentinel/killswitch.js';
import { claimEvent } from '../sentinel/idempotency.js';
import { audit } from '../sentinel/audit.js';

// ── Timing: exactly Day 10 from the recorded sale (owner: "approximately
//    1–2 weeks after purchase"; fixed at Day 10 — no journey, no variants).
//    The sweep interval (15 min) only bounds "approximately": the actual
//    send lands between Day 10 and Day 10 + 15 min.
export const FOLLOWUP_DELAY_DAYS = 10;
const DAY_MS = 86400000;

// Owner-approved default message (2026-09-10). Natural equivalent: the
// purchased product name — factual data from the sale record, resolvable
// from the catalog at send time — is named; otherwise the approved text
// verbatim. No promotional content of any kind.
const MESSAGE_TPL = 'Assalamualaikum! Aapka {product} kaisa chal raha hai? 😊 Koi issue ya help chahiye ho to humein zaroor batayein.';
const MESSAGE_BASE = 'Assalamualaikum! Aapka phone kaisa chal raha hai? 😊 Koi issue ya help chahiye ho to humein zaroor batayein.';
export function composeMessage(productId) {
  const p = findProduct(productId);
  return p?.name ? MESSAGE_TPL.replace('{product}', p.name) : MESSAGE_BASE;
}

// Positive-reply acknowledgement — warm, no warranty/replacement/refund
// claims, no marketing.
const POSITIVE_ACK = 'Shukria ji! Bohot acha sun kar khushi hui 😊 Agar koi masla aaye to kabhi bhi *staff* likh dein — hum hamesha hazir hain.';

// ── Qualifying-sale validation (fail-CLOSED): a malformed or untruthful
//    record is simply NOT a follow-up — the sweep never invents one. ──
function followupIdFor(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (rec.outcome !== 'sale') return null;
  if (rec.verification !== 'customer_statement') return null; // the ONLY state this deployment can truthfully establish
  if (typeof rec.phone !== 'string' || !/^\d{8,15}$/.test(rec.phone)) return null;
  if (typeof rec.product !== 'string' || !rec.product) return null;
  if (typeof rec.at !== 'string' || !Number.isFinite(Date.parse(rec.at))) return null;
  return `fu-${rec.phone}-${rec.product}-${rec.at}-${rec.final_offer ?? 'na'}`;
}

/**
 * The deterministic sweep — called by the scheduler every 15 minutes
 * (and directly by tests with an explicit `now`). Two phases:
 *  1) Scheduling (self-healing): derive qualifying sales from the engine's
 *     outcome records; claim + create each follow-up at most once
 *  2) Dispatch: send due follow-ups through the ONE outbound path.
 *
 * ASYNC BY DESIGN: the send path is async (firewall evaluate → outbox
 * enqueue), so a DENY surfaces as a rejection that must be AWAITED — a
 * rejected-but-unawaited send would skip the catch and mark the follow-up
 * SENT on a send that never happened. Callers (scheduler, tests, probes)
 * await the sweep and treat its result as the authoritative outcome.
 */
export async function sweepFollowUps(now = Date.now()) {
  const created = [];
  const sent = [];
  const skipped = [];

  // ── 1) Scheduling — one follow-up per qualifying sale (no duplicate scheduling) ──
  for (const rec of negotiationOutcomes()) {
    const id = followupIdFor(rec);
    if (!id) continue; // malformed / not a real sale → fail closed
    if (getFollowup(id)) continue; // already tracked (this or a prior sweep)
    const claim = claimEvent(`fu:${id}`);
    if (claim === false) continue; // another instance claimed first → no duplicate
    if (claim === null) continue;  // idempotency store unavailable → fail closed
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
      reason: null,
    });
    audit('FOLLOWUP_SCHEDULED', { id, product: rec.product, delayDays: FOLLOWUP_DELAY_DAYS });
    created.push(id);
  }

  // ── 2) Dispatch — existing kill-switch semantics: while STOPPED, NOTHING
  //       autonomous leaves the building (SCHEDULED stays SCHEDULED). ──
  if (isStopped()) {
    const due = listFollowups().filter((f) => f.status === 'SCHEDULED' && Number.isFinite(Date.parse(f.dueAt)) && Date.parse(f.dueAt) <= now).length;
    if (due) audit('FOLLOWUP_SWEEP_DEFERRED', { reason: 'kill_switch_active', due });
    return { created, sent, skipped, deferred: true };
  }

  for (const fu of listFollowups()) {
    if (fu.status !== 'SCHEDULED') continue; // terminal or not yet handled — never re-sent
    if (!Number.isFinite(Date.parse(fu.dueAt)) || Date.parse(fu.dueAt) > now) continue; // not (approximately) due
    const c = getCustomer(fu.phone);
    if (!c) {
      patchFollowup(fu.id, { status: 'SKIPPED', reason: 'customer_missing' });
      audit('FOLLOWUP_SKIPPED', { id: fu.id, reason: 'customer_missing' });
      skipped.push(fu.id);
      continue;
    }
    if (c.optedOut === true) { // CAP-002: explicit opt-out is respected (no re-interpretation of other states)
      patchFollowup(fu.id, { status: 'SKIPPED_OPTOUT', reason: 'opted_out' });
      audit('FOLLOWUP_SKIPPED_OPTOUT', { id: fu.id });
      skipped.push(fu.id);
      continue;
    }
    // ── THE send: ONE path — P2 firewall (KILL→IDENTITY→AUTHZ→EVIDENCE→POLICY→IDEMPOTENCY)
    //    → durable outbox. actionId = follow-up id (provenance + one-shot claim).
    //    AWAITED: a firewall DENY is a rejection; only a resolved enqueue is SENT.
    try {
      const job = await wa.sendText(fu.phone, composeMessage(fu.product), { source: 'AI', actionId: fu.id });
      patchFollowup(fu.id, { status: 'SENT', sentAt: new Date(now).toISOString(), outboxJob: job.id });
      audit('FOLLOWUP_SENT', { id: fu.id, product: fu.product, job: job.id });
      sent.push(fu.id);
    } catch (e) {
      const code = e?.code || 'SEND_FAILED';
      if (code === 'KILL_SWITCH_ACTIVE') {
        // STOP landed between the check and the dispatch — defer (next sweep
        // retries); NEVER mark a killed send as terminal or sent.
        audit('FOLLOWUP_SEND_DEFERRED', { id: fu.id, reason: code });
      } else {
        const status = code.startsWith('AI_SEND_BLOCKED') ? 'SKIPPED_HUMAN' : 'SKIPPED';
        patchFollowup(fu.id, { status, reason: code });
        audit('FOLLOWUP_SEND_FAILED', { id: fu.id, reason: code });
        skipped.push(fu.id);
      }
    }
  }
  return { created, sent, skipped, deferred: false };
}

// ─────────────────────────────────────────────────────────────
//  CUSTOMER RESPONSES — the follow-up stays a normal conversation
// ─────────────────────────────────────────────────────────────

// The open (sent, awaiting response) follow-up for a customer, if any.
export function latestOpenFollowup(phone) {
  const open = listFollowups().filter((f) => f.phone === phone && f.status === 'SENT');
  return open.length ? open[open.length - 1] : null;
}

// Deterministic classification of a follow-up reply (canonical fast path).
// Everything it does NOT recognize falls through to the normal conversation
// path (flows/brain) — where the LLM may classify ordinary replies the way
// it already does (e.g. complaint/repair → existing escalation).
const MAX_RESPONSE_LEN = 100; // a reply to a health check is short and direct
const ISSUE_RE = /\b(battery|heat|garam|camera|display|screen|hang|freeze|friz|restart|reboot|charge|charging|speaker|mic|sound|network|sim|boot|slow|lag|toot|kharab|masla|problem|issue|fault)\b|nahi\s+chal|nahi\s+ho\s+raha/i;
const NEGATED_ISSUE_RE = /\b(masla|problem|issue|kharab|fault)\s*(nahi|nhi|na)\b|\b(nahi|nhi)\s*(masla|problem|issue|kharab|fault)\b/i;
const POSITIVE_START_RE = /^(haan|ji|bilkul|theek|sab|ya|ok|okay|fine|kamaal|mashallah|hamdallah|alhamdulillah|zaroor|yaqeen|chalta|chalti)/i;
const POSITIVE_BODY_RE = /\b(theek|ok|okay|fine|kamaal|badhiya|achha|achhi|good|perfect|great|bilkul|masla\s+nahi|koi\s+masla\s+nahi|koi\s+problem\s+nahi|koi\s+issue\s+nahi)\b/i;

export function classifyFollowUpResponse(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t || t.length > MAX_RESPONSE_LEN) return null;
  // Negated issue words ("masla nahi", "koi problem nahi") are NOT issues.
  const cleaned = t
    .replace(/\b(masla|problem|issue|kharab|fault)\s*(nahi|nhi|na)\b/g, ' ')
    .replace(/\b(nahi|nhi)\s*(masla|problem|issue|kharab|fault)\b/g, ' ');
  if (ISSUE_RE.test(cleaned)) return 'issue';
  if (/(theek|ok|fine|chal)/.test(t) && /\b(nahi|nhi)\b/.test(t)) return 'issue'; // "theek nahi hai"
  if (NEGATED_ISSUE_RE.test(t) && POSITIVE_BODY_RE.test(t)) return 'positive';   // "masla nahi hai"
  if (POSITIVE_START_RE.test(t) && POSITIVE_BODY_RE.test(t)) return 'positive';  // "haan theek hai" …
  return null;
}

/**
 * Router hook (before the negotiation engine): handles the customer's reply
 * to an open follow-up. positive → acknowledge + close; issue → the existing
 * CAP-008 support path (PRODUCT_EXCEPTION — the standard escalation; the
 * customer gets the honest team ack, the inbox gets the full context).
 * Returns true only when it took the message.
 */
export async function handleFollowUpResponse(from, rawText, customer) {
  if (customer?.stateData?.negotiation?.active) return false; // an active sale session always wins
  const fu = latestOpenFollowup(from);
  if (!fu) return false;
  const cls = classifyFollowUpResponse(rawText);
  if (cls === null) return false; // ordinary conversation — normal path handles it

  if (cls === 'positive') {
    patchFollowup(fu.id, { status: 'CLOSED', outcome: 'no_issue', closedAt: new Date().toISOString() });
    audit('FOLLOWUP_CLOSED', { id: fu.id, outcome: 'no_issue', source: 'deterministic' });
    await wa.sendText(from, POSITIVE_ACK, { source: 'AI' });
    return true;
  }
  // Issue → existing support/escalation path. No diagnosis beyond what the
  // customer stated; no warranty outcome; no replacement promise.
  patchFollowup(fu.id, { status: 'ESCALATED', outcome: 'issue', closedAt: new Date().toISOString() });
  audit('FOLLOWUP_ESCALATED', { id: fu.id, outcome: 'issue', source: 'deterministic' });
  try {
    await escalate(from, 'PRODUCT_EXCEPTION', { aiInference: { intent: 'repair', source: 'v14-followup-response' } });
  } catch (e) {
    audit('FOLLOWUP_ESCALATION_FAILED', { id: fu.id, error: String(e?.message || e).slice(0, 120) });
  }
  return true;
}

/**
 * Brain-path bookkeeping (called after the AI brain answered a customer
 * who has an open follow-up): if the brain's answer escalated into human
 * support, the follow-up went to human ownership; any other ordinary reply
 * is a no-problem response → close. Deterministic state changes only.
 */
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
