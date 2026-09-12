// ─────────────────────────────────────────────────────────────
//  CUSTOMER MEMORY — halka JSON database (baad mein SQLite/Postgres)
//  Har customer ki yaaddasht: naam, language, opt-in, engagement
//
//  V1-5′ durability: atomic temp+rename writes; corrupt/unreadable
//  existing files FAIL CLOSED (never silently wipe customer state).
//  Missing file on first boot is a legitimate fresh start.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { atomicWriteJson } from '../sentinel/store.js';
import { audit } from '../sentinel/audit.js';

const EMPTY_DB = () => ({ customers: {}, messages: [], reservations: [], campaigns: [], negotiations: [], followups: [] });

let db = EMPTY_DB();

export class CustomerDbError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CustomerDbError';
  }
}

function normalizeDb(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad schema: root object required');
  const next = { ...EMPTY_DB(), ...parsed };
  if (!next.customers || typeof next.customers !== 'object' || Array.isArray(next.customers)) {
    throw new Error('bad schema: customers object required');
  }
  if (!Array.isArray(next.messages)) next.messages = [];
  if (!Array.isArray(next.reservations)) next.reservations = [];
  if (!Array.isArray(next.campaigns)) next.campaigns = [];
  if (!Array.isArray(next.negotiations)) next.negotiations = [];
  if (!Array.isArray(next.followups)) next.followups = [];
  return next;
}

export function loadDb() {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  if (!fs.existsSync(config.dbFile)) {
    db = EMPTY_DB();
    return { ok: true, fresh: true };
  }
  let raw;
  try {
    raw = fs.readFileSync(config.dbFile, 'utf8');
  } catch (e) {
    throw new CustomerDbError(
      'CUSTOMER_DB_UNREADABLE',
      'CUSTOMER_DB_UNREADABLE: existing customer DB cannot be read — refusing to start with empty state (no silent wipe)',
    );
  }
  try {
    db = normalizeDb(JSON.parse(raw));
    return { ok: true, fresh: false };
  } catch {
    throw new CustomerDbError(
      'CUSTOMER_DB_CORRUPT',
      'CUSTOMER_DB_CORRUPT: existing customer DB is unreadable JSON — refusing to start with empty state (no silent wipe)',
    );
  }
}

function save() {
  // Single-process: save() is synchronous, so overlapping event-loop
  // callbacks cannot interleave stringify+write. atomicWriteJson makes
  // the replacement durable (tmp + fsync + rename) so a crash cannot
  // leave a truncated dest file.
  atomicWriteJson(config.dbFile, db);
}

// Customer ko touch karo — naya ho to banao, engagement update karo
export function touchCustomer(phone, name = '') {
  if (!db.customers[phone]) {
    db.customers[phone] = {
      phone,
      name,
      language: 'roman-ur',
      optedIn: false,      // marketing sirf tab jab true
      optedOut: false,
      engagement: 50,      // 0–100 anti-ban score
      state: 'IDLE',       // conversation flow state
      stateData: {},
      lastSeen: new Date().toISOString(),
      marketingToday: { date: today(), count: 0 },
      history: [],
    };
  }
  const c = db.customers[phone];
  if (name && !c.name) c.name = name;
  c.lastSeen = new Date().toISOString();
  c.engagement = Math.min(100, (c.engagement || 0) + 2); // message bhejna = interest
  save();
  return c;
}

export const getCustomer = (phone) => db.customers[phone];

export function updateCustomer(phone, patch) {
  Object.assign(db.customers[phone] || {}, patch);
  save();
}

// CAP-008 §6 context transfer: staff inbox reads recent history from here.
export function recentMessages(phone, n = 20) {
  return db.messages.filter((m) => m.phone === phone).slice(-n);
}

// ── V1-1 (2026-09-09): bounded MODEL-context transcript — DERIVED, no new storage.
export function recentConversation(phone, n = 12) {
  const rows = Array.isArray(db.messages) ? db.messages : [];
  return rows
    .filter((m) => m.phone === phone)
    .filter((m) => typeof m.text === 'string' && m.text.trim() !== '')
    .filter((m) => !(m.dir === 'in' && /^menu_[a-z_]+$/.test(m.text.trim())))
    .slice(-n)
    .map((m) => ({ role: m.dir === 'in' ? 'user' : 'assistant', content: m.text.slice(0, 500) }));
}

// Outbound logging via whatsapp chokepoint (wired at boot): inbox view marks [BOT] vs [STAFF•id]
export function logOutbound(phone, text, meta = {}) {
  db.messages.push({
    phone, dir: 'out', source: meta.source === 'HUMAN' ? 'HUMAN' : 'BOT',
    staffId: meta.staffId || null, text: String(text || '').slice(0, 500), at: new Date().toISOString(),
  });
  if (db.messages.length > 5000) db.messages = db.messages.slice(-4000);
  save();
}

export function logMessage(phone, dir, type, text) {
  db.messages.push({ phone, dir, type, text: (text || '').slice(0, 500), at: new Date().toISOString() });
  if (db.messages.length > 5000) db.messages = db.messages.slice(-4000);
  save();
}

export function setConsent(phone, value, source) {
  const c = touchCustomer(phone);
  c.optedIn = value;
  c.optedOut = !value;
  db.campaigns.push({ type: 'consent', phone, value, source, at: new Date().toISOString() });
  save();
}

// ── V1-3 (2026-09-10): negotiation outcome records — LEARNING DATA (tactics
// only). Captured ONLY from deterministic engine events (never LLM statements).
//
// V1-5′ sale truth:
//   verification = 'customer_statement'  → stated purchase INTENT (not paid)
//   verification = 'paid'                → staff-confirmed paid sale
// A "sale" speech act is NOT a verified payment. Follow-up requires `paid`.
export function recordNegotiation(rec) {
  db.negotiations = Array.isArray(db.negotiations) ? db.negotiations : [];
  db.negotiations.push({ ...rec, at: rec.at && Number.isFinite(Date.parse(rec.at)) ? rec.at : new Date().toISOString() });
  if (db.negotiations.length > 1000) db.negotiations = db.negotiations.slice(-800);
  save();
}
export const negotiationOutcomes = () => (Array.isArray(db.negotiations) ? db.negotiations : []);

export function statedSalesFor(phone) {
  return negotiationOutcomes().filter((r) => r.phone === phone && r.outcome === 'sale');
}

/** Stated purchases not yet staff-confirmed paid. Listing helper only. */
export function unpaidStatedSales() {
  return negotiationOutcomes().filter((r) => r.outcome === 'sale' && r.verification !== 'paid');
}

/**
 * Staff (or a future POS hook) confirms that a stated sale was actually paid.
 * Does NOT invent a sale — the engine-recorded stated_accept must already exist.
 * Already-paid records are idempotent: no second confirmation blob, no extra
 * follow-up id. LLM/customer language cannot call this function.
 */
export function confirmPaidSale({ phone, product, at, staffId = 'staff', source = 'staff', actionId = null } = {}) {
  const rows = negotiationOutcomes();
  let rec = null;
  if (phone && product && at) rec = rows.find((r) => r.phone === phone && r.product === product && r.at === at && r.outcome === 'sale') || null;
  if (!rec && phone && product) rec = [...rows].reverse().find((r) => r.phone === phone && r.product === product && r.outcome === 'sale') || null;
  if (!rec && phone) rec = [...rows].reverse().find((r) => r.phone === phone && r.outcome === 'sale') || null;
  if (!rec) return null;
  if (rec.verification === 'paid' && rec.sale_confirmation?.kind === 'staff_confirmed_paid') {
    audit('SALE_PAID_ALREADY_CONFIRMED', {
      phone: rec.phone,
      product: rec.product,
      staffId: String(staffId || 'staff'),
      actionId: actionId || null,
    });
    return rec;
  }
  rec.stated_intent_at = rec.stated_intent_at || rec.at;
  rec.verification = 'paid';
  rec.sale_confirmation = {
    kind: 'staff_confirmed_paid',
    staffId: String(staffId || 'staff'),
    source: source === 'pos' ? 'pos' : 'staff',
    at: new Date().toISOString(),
    actionId: actionId || null,
  };
  save();
  audit('SALE_PAID_CONFIRMED', { phone: rec.phone, product: rec.product, staffId: rec.sale_confirmation.staffId, source: rec.sale_confirmation.source, actionId: rec.sale_confirmation.actionId });
  return rec;
}

// ── V1-4 (2026-09-10): post-purchase follow-up records — the lifecycle of
// the single satisfaction follow-up per qualifying purchase. Stored in the
// existing customers DB (no new store). Creation is claimed via the existing
// claimEvent() mechanism (one atomic claim per sale record), so restarts,
// duplicate scheduler runs and duplicate events can never duplicate it.
export function recordFollowup(rec) {
  db.followups = Array.isArray(db.followups) ? db.followups : [];
  if (!db.followups.some((f) => f.id === rec.id)) db.followups.push(rec);
  if (db.followups.length > 1000) db.followups = db.followups.slice(-800);
  save();
}
export const listFollowups = () => (Array.isArray(db.followups) ? db.followups : []);
export const getFollowup = (id) => listFollowups().find((f) => f.id === id) || null;
export function patchFollowup(id, patch) {
  const f = getFollowup(id);
  if (f) Object.assign(f, patch);
  save();
  return f || null;
}

export const allCustomers = () => Object.values(db.customers);
export const today = () => new Date().toISOString().slice(0, 10);

export function bumpMarketingCount(phone) {
  const c = touchCustomer(phone);
  if (c.marketingToday.date !== today()) c.marketingToday = { date: today(), count: 0 };
  c.marketingToday.count += 1;
  save();
}
