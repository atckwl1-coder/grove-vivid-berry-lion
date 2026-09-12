// ─────────────────────────────────────────────────────────────
//  OWNER INTELLIGENCE SNAPSHOT (deterministic, no vanity metrics)
//  Incomplete data → null + completeness PARTIAL. Never 0-pretend.
//  Never claims LIVE delivery. Transport labels are D-010 facts.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { config, isLive } from '../config.js';
import { catalog, productStatus, catalogNow } from './catalog.js';
import {
  loadDb,
  allCustomers,
  negotiationOutcomes,
  listFollowups,
} from './customers.js';
import { peekState } from '../sentinel/killswitch.js';
import { listConversations } from '../sentinel/conversations.js';

const ACTIVE_LEAD_STAGES = new Set([
  'curious', 'price_shopping', 'genuine_buyer', 'high_intent', 'negotiation', 'purchase_ready',
]);
const HIGH_INTENT_STAGES = new Set(['high_intent', 'negotiation', 'purchase_ready']);
const HUMAN_STATES = new Set(['QUEUED', 'CLAIMED', 'HUMAN_ACTIVE']);
const PENDING_FU = new Set(['SCHEDULED', 'QUEUED']);

function resolveNow(now) {
  if (now == null || now === '') return new Date();
  if (now instanceof Date && Number.isFinite(now.getTime())) return now;
  const d = new Date(now);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function utcDay(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function catalogCounts(nowMs) {
  const cat = catalog();
  const products = Array.isArray(cat.products) ? cat.products : [];
  const out = {
    corrupted: Boolean(cat.corrupted),
    verified: 0,
    stale: 0,
    unknown: 0,
    total: products.length,
  };
  for (const p of products) {
    const { status } = productStatus(p, nowMs);
    if (status === 'VERIFIED') out.verified += 1;
    else if (status === 'STALE') out.stale += 1;
    else out.unknown += 1;
  }
  return out;
}

function customerSlice() {
  try {
    loadDb();
  } catch {
    return null;
  }
  let messages = [];
  try {
    if (fs.existsSync(config.dbFile)) {
      const st = fs.statSync(config.dbFile);
      if (!st.isFile()) return null;
      const parsed = JSON.parse(fs.readFileSync(config.dbFile, 'utf8'));
      messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    }
  } catch {
    return null;
  }
  return {
    customers: allCustomers(),
    messages,
    negotiations: negotiationOutcomes(),
    followups: listFollowups(),
  };
}

function countMonetaryRejects() {
  const file = config.auditFile;
  try {
    if (!fs.existsSync(file)) return { count: null, ok: false };
    const st = fs.statSync(file);
    if (!st.isFile()) return { count: null, ok: false };
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row && row.type === 'LLM_NUMBER_REJECTED') count += 1;
      } catch {
        // skip a bad line; the file itself was readable
      }
    }
    return { count, ok: true };
  } catch {
    return { count: null, ok: false };
  }
}

function countHumanEscalations(tenant) {
  try {
    const rows = listConversations(tenant);
    return { count: rows.filter((c) => HUMAN_STATES.has(c.state)).length, ok: true };
  } catch {
    return { count: 0, ok: false };
  }
}

export function ownerSnapshot({ tenant, now } = {}) {
  const tenantId = tenant || config.tenantId;
  const when = resolveNow(now);
  const catalogTs = now != null ? when.getTime() : catalogNow();
  let completeness = 'OK';
  const markPartial = () => { completeness = 'PARTIAL'; };

  const kill = peekState();
  const cat = catalogCounts(catalogTs);

  const slice = customerSlice();
  let conversations_today = null;
  let customers_total = null;
  let active_leads = null;
  let high_intent = null;
  let negotiations_active = null;
  let paid_sales = null;
  let stated_unpaid = null;
  let pending_followups = null;
  let unresolved_issues = null;

  if (!slice) {
    markPartial();
  } else {
    const today = utcDay(when);
    conversations_today = slice.messages.filter((m) => m?.dir === 'in' && utcDay(m.at) === today).length;
    customers_total = slice.customers.length;
    active_leads = slice.customers.filter((c) => ACTIVE_LEAD_STAGES.has(c?.stateData?.qualification?.stage)).length;
    high_intent = slice.customers.filter((c) => HIGH_INTENT_STAGES.has(c?.stateData?.qualification?.stage)).length;
    negotiations_active = slice.customers.filter((c) => Boolean(c?.stateData?.negotiation?.active)).length;
    paid_sales = slice.negotiations.filter((r) => r?.outcome === 'sale' && r?.verification === 'paid').length;
    stated_unpaid = slice.negotiations.filter((r) => r?.outcome === 'sale' && r?.verification === 'customer_statement').length;
    pending_followups = slice.followups.filter((f) => PENDING_FU.has(f?.status)).length;
    unresolved_issues = slice.followups.filter((f) => f?.status === 'ESCALATED').length;
  }

  const human = countHumanEscalations(tenantId);
  if (!human.ok) markPartial();

  const rejects = countMonetaryRejects();
  if (!rejects.ok) markPartial();

  return {
    generated_at: when.toISOString(),
    completeness,
    transport: {
      current: 'Meta Cloud API',
      qr: 'NOT IMPLEMENTED',
      mode: isLive() ? 'LIVE' : 'DEMO',
      live_delivery: 'IMPLEMENTED BUT UNPROVEN',
    },
    kill: { state: kill.state, stopped_by: kill.stopped_by },
    catalog: cat,
    conversations_today,
    customers_total,
    active_leads,
    high_intent,
    negotiations_active,
    human_escalations: human.count,
    paid_sales,
    stated_unpaid,
    pending_followups,
    unresolved_issues,
    monetary_rejects: rejects.count,
  };
}
