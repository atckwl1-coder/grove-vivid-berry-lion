// ─────────────────────────────────────────────────────────────
//  V1-6 DETERMINISTIC LEAD QUALIFICATION
//  Evidence in → stage / score / next_action out.
//  The LLM may later PHRASE; it must NEVER set prices, stock,
//  floors, or paid state. This module never invents a number,
//  never marks paid, never sends on the transport.
// ─────────────────────────────────────────────────────────────
import {
  getCustomer, recentMessages, statedSalesFor, listFollowups,
  negotiationOutcomes, updateCustomer, allCustomers,
} from './customers.js';
import { isSuppressed } from '../sentinel/conversations.js';
import { findProduct, catalog } from './catalog.js';

export const STAGE_SCORE = Object.freeze({
  browsing: 10,
  curious: 25,
  price_shopping: 40,
  genuine_buyer: 55,
  high_intent: 70,
  negotiation: 78,
  purchase_ready: 90,
  existing_customer: 95,
  post_purchase_support: 60,
});

const PRICE_RE = /\b(price|kitne|kitna|cost|emi|compare|vs)\b/i;
const READY_RE = /\b(le raha|le rahi|le rha|le leta|le leti|final|deal|confirm)\b/i;
const ISSUE_RE = /\b(issue|masla|problem|kharab|defect|warranty|broken|repair|return|complaint|fault|hang|heat|battery)\b|nahi\s+chal/i;
const BUDGET_RE = /(?<!\d)(\d{4,7})(?!\d)|(?<!\d)(\d{2,3})\s*(k|thousand)\b/i;

function inboundTexts(phone) {
  return recentMessages(phone, 80)
    .filter((m) => m && m.dir === 'in')
    .map((m) => String(m.text || ''));
}

function mentionsProduct(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (findProduct(raw)) return true;
  const compact = raw.toLowerCase().replace(/[\s-]/g, '');
  const products = catalog()?.products;
  if (!Array.isArray(products)) return false;
  for (const p of products) {
    const id = String(p?.id || '').toLowerCase();
    const name = String(p?.name || '').toLowerCase().replace(/[\s-]/g, '');
    if (id && compact.includes(id)) return true;
    if (name.length >= 5 && compact.includes(name)) return true;
  }
  return false;
}

function add(signals, tok) {
  if (signals.length >= 12 || signals.includes(tok)) return;
  signals.push(tok);
}

export function nextActionFor(q) {
  if (q && q.human_owned) return 'Staff must reply — AI is silenced';
  switch (q?.stage) {
    case 'purchase_ready': return 'Confirm paid in inbox after store payment (not a PSP)';
    case 'negotiation': return 'Continue value-first negotiation; floor is owner-owned';
    case 'high_intent': return 'Close on current authorized offer; do not volunteer a lower price';
    case 'genuine_buyer': return 'Resume value-first path; floor is owner-owned';
    case 'price_shopping': return 'Send verified catalog card / compare path';
    case 'curious': return 'Send verified catalog facts; no discount';
    case 'existing_customer': return 'Relationship: care path only if issue; do not re-pitch';
    case 'post_purchase_support': return 'Handle care issue; do not concede or re-sell';
    default: return 'Offer menu; do not concede';
  }
}

/** Stages staff must see even without a CAP-008 conversation. */
export const QUEUE_STAGES = Object.freeze(['high_intent', 'negotiation', 'purchase_ready']);

/**
 * Read-only staff queue. Does not persist, escalate, send, or mark paid.
 * next_action is always the live nextActionFor() result.
 */
export function listQueuedLeads() {
  const rank = { purchase_ready: 0, negotiation: 1, high_intent: 2 };
  const out = [];
  for (const c of allCustomers()) {
    const phone = c && c.phone;
    if (!phone) continue;
    const q = qualificationOf(phone);
    if (!QUEUE_STAGES.includes(q.stage)) continue;
    out.push({
      phone,
      stage: q.stage,
      lead_score: q.lead_score,
      next_action: nextActionFor(q),
    });
  }
  out.sort((a, b) => (rank[a.stage] - rank[b.stage])
    || (b.lead_score - a.lead_score)
    || String(a.phone).localeCompare(String(b.phone)));
  return out;
}

function pack(stage, { paid, human_owned, signals, confidence }) {
  const q = {
    stage,
    lead_score: STAGE_SCORE[stage] ?? 10,
    confidence,
    signals: (signals || []).slice(0, 12),
    human_owned: Boolean(human_owned),
    paid: Boolean(paid),
    next_action: '',
    last_updated: new Date().toISOString(),
    source: 'deterministic',
  };
  q.next_action = nextActionFor(q);
  return q;
}

function browsingLow(human_owned = false) {
  return pack('browsing', { paid: false, human_owned, signals: human_owned ? ['human_owned'] : [], confidence: 'low' });
}

export function computeQualification(phone) {
  try {
    return computeInner(phone);
  } catch {
    return browsingLow();
  }
}

function computeInner(phone) {
  const id = phone == null ? '' : String(phone).trim();
  if (!id) return browsingLow();

  const signals = [];
  const c = getCustomer(id) || null;
  const texts = inboundTexts(id);
  const blob = texts.join('\n');

  let humanOwned = false;
  try { if (isSuppressed(id)) humanOwned = true; } catch { /* conv missing */ }
  if (c?.state === 'HUMAN') humanOwned = true;
  if (humanOwned) add(signals, 'human_owned');

  const sales = statedSalesFor(id) || [];
  const paid = sales.some((r) => r && r.verification === 'paid');
  const unpaidSale = sales.some((r) => r && r.verification === 'customer_statement');
  if (paid) add(signals, 'paid');
  if (unpaidSale) add(signals, 'stated_sale');

  const fus = (listFollowups() || []).filter((f) => f && f.phone === id);
  const fuEsc = fus.some((f) => f.status === 'ESCALATED');
  const issue = ISSUE_RE.test(blob);
  if (fuEsc) add(signals, 'followup_escalated');
  if (issue) add(signals, 'issue');

  const n = c?.stateData?.negotiation;
  const negActive = Boolean(n && n.active);
  const hasOffer = n != null && n.offer != null;
  const outcomes = negotiationOutcomes() || [];
  const priorNeg = Boolean(n && typeof n === 'object') || outcomes.some((r) => r && r.phone === id);
  if (negActive) add(signals, 'negotiation_active');
  if (hasOffer) add(signals, 'offer_on_table');
  if (priorNeg) add(signals, 'prior_negotiation');

  const product = texts.some((t) => mentionsProduct(t));
  const priceLang = PRICE_RE.test(blob);
  const readyLang = READY_RE.test(blob);
  const budget = BUDGET_RE.test(blob);
  if (product) add(signals, 'product_mention');
  if (priceLang) add(signals, 'price_language');
  if (readyLang) add(signals, 'ready_language');
  if (budget) add(signals, 'budget_number');

  const highIntent = hasOffer || (product && budget && readyLang);

  let stage = 'browsing';
  if (paid && (fuEsc || issue)) stage = 'post_purchase_support';
  else if (paid) stage = 'existing_customer';
  else if (unpaidSale) stage = 'purchase_ready';
  else if (negActive) stage = 'negotiation';
  else if (highIntent) stage = 'high_intent';
  else if (priorNeg) stage = 'genuine_buyer';
  else if (priceLang) stage = 'price_shopping';
  else if (product) stage = 'curious';

  let confidence = 'low';
  if (paid || unpaidSale || negActive || (priorNeg && (hasOffer || outcomes.some((r) => r && r.phone === id)))) confidence = 'high';
  else if (product && priceLang) confidence = 'medium';

  return pack(stage, { paid, human_owned: humanOwned, signals, confidence });
}

export function refreshQualification(phone) {
  const q = computeQualification(phone);
  const c = getCustomer(phone);
  if (!c) return q;
  updateCustomer(phone, { stateData: { ...(c.stateData || {}), qualification: q } });
  return q;
}

export function qualificationOf(phone) {
  try {
    const stored = getCustomer(phone)?.stateData?.qualification;
    if (stored && stored.source === 'deterministic' && typeof stored.stage === 'string') return stored;
  } catch { /* missing customer */ }
  return computeQualification(phone);
}
