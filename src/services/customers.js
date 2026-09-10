// ─────────────────────────────────────────────────────────────
//  CUSTOMER MEMORY — halka JSON database (baad mein SQLite/Postgres)
//  Har customer ki yaaddasht: naam, language, opt-in, engagement
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let db = { customers: {}, messages: [], reservations: [], campaigns: [], negotiations: [] };

export function loadDb() {
  try {
    if (fs.existsSync(config.dbFile)) {
      db = JSON.parse(fs.readFileSync(config.dbFile, 'utf8'));
    }
  } catch {
    console.log('DB corrupt ya missing — fresh start');
  }
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
}

function save() {
  fs.writeFileSync(config.dbFile, JSON.stringify(db, null, 2));
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
  c.engagement = Math.min(100, c.engagement + 2); // message bhejna = interest
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
// Same source of truth as the CAP-008 §6 staff context (db.messages), mapped to
// model roles: inbound → 'user' (untrusted customer content), outbound text →
// 'assistant' (what the customer saw). Contract — smallest deterministic policy
// (assumptions documented, nothing invented beyond repo conventions):
//   • per-customer   : hard filter by phone (isolation)
//   • bounded        : last `n` eligible entries (default 12 ≈ 6 turns); each
//                      entry ≤ 500 chars (existing log truncation) → ≤ 6000 chars
//   • ordering       : chronological (array push order)
//   • skips          : empty/non-string text; inbound internal flow tokens
//                      (/^menu_[a-z_]+$/ — button/list ids, not customer language)
//   • persistence    : existing customers-DB semantics (save() on every log;
//                      loadDb() restores at boot; parse-corrupt → fresh start)
//   • schema-corrupt : [] — fail-safe (valid JSON, wrong shape); stricter here
//                      than recentMessages because this feeds a model
// Sensitive-zone rule (DEBT-18): ONLY this customer's own conversation text may
// enter the LLM — no other-customer content, no phone numbers in content, no new
// storage, no change to redacted surfaces (audit/demo) or to log semantics.
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
// only). Captured ONLY from deterministic engine events (never LLM statements):
//   verification = 'customer_statement' — this deployment has NO payment
//   system, so a "sale" is the customer's stated acceptance of an approved
//   price, never a verified payment. Never fabricated; never backfilled.
export function recordNegotiation(rec) {
  db.negotiations = Array.isArray(db.negotiations) ? db.negotiations : [];
  db.negotiations.push({ ...rec, at: new Date().toISOString() });
  if (db.negotiations.length > 1000) db.negotiations = db.negotiations.slice(-800);
  save();
}
export const negotiationOutcomes = () => (Array.isArray(db.negotiations) ? db.negotiations : []);

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
