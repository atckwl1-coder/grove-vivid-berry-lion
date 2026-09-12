// ─────────────────────────────────────────────────────────────
//  V1-6 CUSTOMER MEMORY / CRM PROFILE
//  Structured, bounded, labeled facts from inbound customer text.
//  Customer text is UNTRUSTED DATA — never system instructions,
//  never price authority. Budget is CUSTOMER_STATED only and is
//  NOT added to the number-firewall allow-list.
// ─────────────────────────────────────────────────────────────
import { findProduct } from './catalog.js';
import { getCustomer, recentMessages, updateCustomer, touchCustomer } from './customers.js';

const SOURCE = 'customer_stated';
const BUDGET_NOTE = 'UNTRUSTED — not an authorized price';
const OBJ_MAX = 8;
const RAW_MAX = 80;

const COLOR_CANON = {
  black: 'black', white: 'white', gold: 'gold', green: 'green', blue: 'blue',
  grey: 'grey', gray: 'grey', silver: 'silver', purple: 'purple',
  kala: 'black', safed: 'white', sona: 'gold',
};
const COLOR_RE = /\b(black|white|gold|green|blue|grey|gray|silver|purple|kala|safed|sona)\b/gi;
const STORAGE_RE = /\b(64|128|256|512)\s*gb\b/gi;
const BUDGET_RE = /(?<!\d)(\d{4,7})(?!\d)/g;
const YEAR_RE = /^(19|20)\d{2}$/;
const OBJ_PATTERNS = [
  { kind: 'price', re: /\b(mehnga|expensive|zyada)\b/i },
  { kind: 'delay', re: /\bsoch(?:na|unga|ungi)\b|\bbaad\s*mein\b|\bwait\b/i },
  { kind: 'competitor', re: /\bdusri\s+shop\b|\bother\s+shop\b/i },
  { kind: 'other', re: /\bcredit\s+nahi\b/i },
];

const empty = () => ({
  preferred_model: null,
  budget: null,
  color: null,
  storage: null,
  objections: [],
  last_updated: null,
  source: SOURCE,
});

function modelFromText(text) {
  const tokens = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let last = null;
  const consider = (q) => {
    if (!q || q.length < 3 || /^\d+$/.test(q)) return;
    const p = findProduct(q);
    if (p) last = { id: p.id, name: p.name, source: SOURCE };
  };
  for (let i = 0; i < tokens.length; i++) {
    consider(tokens[i]);
    if (i + 1 < tokens.length) consider(tokens[i] + tokens[i + 1]);
  }
  return last;
}

function budgetFromText(text) {
  const s = String(text || '');
  let last = null;
  BUDGET_RE.lastIndex = 0;
  let m;
  while ((m = BUDGET_RE.exec(s))) {
    const raw = m[1];
    if (YEAR_RE.test(raw) || raw.startsWith('92')) continue;
    last = { amount: Number(raw), raw, source: SOURCE, note: BUDGET_NOTE };
  }
  return last;
}

function colorFromText(text) {
  COLOR_RE.lastIndex = 0;
  let last = null, m;
  while ((m = COLOR_RE.exec(text))) last = { value: COLOR_CANON[m[1].toLowerCase()], source: SOURCE };
  return last;
}

function storageFromText(text) {
  STORAGE_RE.lastIndex = 0;
  let last = null, m;
  while ((m = STORAGE_RE.exec(text))) last = { value: `${m[1]}GB`, source: SOURCE };
  return last;
}

function objectionsFromText(text, at) {
  const raw = String(text || '').slice(0, RAW_MAX);
  const out = [];
  for (const { kind, re } of OBJ_PATTERNS) {
    if (re.test(text)) out.push({ kind, raw, at, source: SOURCE });
  }
  return out;
}

function inboundTexts(phone, currentText) {
  const rows = recentMessages(phone, 100).filter((m) => m.dir === 'in' && typeof m.text === 'string' && m.text.trim());
  const texts = rows.map((m) => m.text);
  const extra = currentText == null ? '' : String(currentText);
  if (extra.trim() && texts[texts.length - 1] !== extra) texts.push(extra);
  return texts;
}

export function extractProfileFacts(texts) {
  let preferred_model = null, budget = null, color = null, storage = null;
  const objections = [];
  const now = new Date().toISOString();
  for (const raw of Array.isArray(texts) ? texts : []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const m = modelFromText(raw); if (m) preferred_model = m;
    const b = budgetFromText(raw); if (b) budget = b;
    const c = colorFromText(raw); if (c) color = c;
    const s = storageFromText(raw); if (s) storage = s;
    for (const o of objectionsFromText(raw, now)) objections.push(o);
  }
  return {
    preferred_model, budget, color, storage,
    objections: objections.slice(-OBJ_MAX),
    last_updated: now,
    source: SOURCE,
  };
}

export function refreshProfile(phone, currentText) {
  const c = getCustomer(phone) || touchCustomer(phone);
  const profile = { ...extractProfileFacts(inboundTexts(phone, currentText)), last_updated: new Date().toISOString(), source: SOURCE };
  updateCustomer(phone, { stateData: { ...(c.stateData || {}), profile } });
  return profile;
}

export function profileOf(phone) {
  const p = getCustomer(phone)?.stateData?.profile;
  if (!p || typeof p !== 'object') return empty();
  return {
    ...empty(),
    ...p,
    objections: Array.isArray(p.objections) ? p.objections.slice(-OBJ_MAX) : [],
  };
}

export function labeledProfileBlock(profile) {
  const p = profile && typeof profile === 'object' ? profile : empty();
  const parts = [];
  if (p.preferred_model) parts.push(`model=${p.preferred_model.id}/${p.preferred_model.name}`);
  if (p.budget) parts.push(`budget=${p.budget.amount} (customer_stated, not verified, not price authority)`);
  if (p.color) parts.push(`color=${p.color.value}`);
  if (p.storage) parts.push(`storage=${p.storage.value}`);
  if (Array.isArray(p.objections) && p.objections.length) parts.push(`objections=${p.objections.map((o) => o.kind).join(',')}`);
  return `CUSTOMER_STATED_FACTS (untrusted, not price authority): ${parts.join('; ') || 'none'}`;
}
