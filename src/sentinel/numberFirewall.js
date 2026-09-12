// ─────────────────────────────────────────────────────────────
//  DEBT-07 — MODEL-OUTPUT NUMBER FIREWALL (V1-5′ + V1-5.1)
//  Deterministic post-generation validator. ANY model-generated
//  customer-facing text is untrusted until this function says
//  otherwise: LLM text, future vision/image copy, future audio
//  or multimodal reasoning copy.
//
//  This module is PURE (no send, no outbox). Delivery lives in
//  brain.deliverModelOutput / pacedBrainSend. P2 and outbox.enqueue
//  do not inspect amounts — they are the action/persistence layers.
//  Deterministic catalog / EMI / negotiation / follow-up / menu
//  copy must NOT be pushed through this gate (customer-stated EMI
//  principals such as "emi 85000 6" are not catalog prices).
//
//  Authority: catalog prices, owner floors, current negotiation
//  offer, EMI-computed totals, trade-in table values.
//  The allow-set is FLAT (not SKU-bound) PLUS a small Reno 16
//  exclusive context check (16F catalog price cannot be quoted
//  as a Reno 16 amount). Other cross-SKU collisions remain.
// ─────────────────────────────────────────────────────────────
import { catalog } from '../services/catalog.js';
import { loadRules } from '../services/negotiation.js';
import { emiNumericSet } from '../services/emi.js';

export const NUMBER_FIREWALL_HANDOFF =
  'Price confirm karni hogi — team aapko sahi number batae gi. 🙏 *staff* se baat ho rahi hai.';

/** Origin tag for model-generated customer-facing text. Not a P2 source class. */
export const MODEL_OUTPUT_ORIGIN = 'MODEL_OUTPUT';

const YEAR_RE = /^(19|20)\d{2}$/;
const PHONE_RE = /^92\d{8,12}$/;

/**
 * Unambiguous digit-script + zero-width cleanup. Does NOT parse word
 * amounts, EU grouping, or other Unicode numeral systems.
 */
export function normalizeMonetaryText(text) {
  let s = String(text || '');
  s = s.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060]/g, '');
  s = s.replace(/[\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19]/g, (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
    if (c >= 0x06F0 && c <= 0x06F9) return String(c - 0x06F0);
    if (c >= 0xFF10 && c <= 0xFF19) return String(c - 0xFF10);
    return ch;
  });
  return s;
}

function parseMoney(num, suffix) {
  const n = Number(String(num).replace(/[,\s]/g, ''));
  if (!Number.isFinite(n)) return NaN;
  const s = (suffix || '').toLowerCase();
  if (s === 'k' || s === 'thousand') return n * 1000;
  if (s === 'lakh' || s === 'lac') return n * 100000;
  return n;
}

/**
 * Extract monetary amounts from free text. Small innocuous integers
 * (months, SLA minutes, clock hours) are ignored unless they carry a
 * currency marker. Years and phone-like tokens are skipped.
 *
 * Digit scripts that have an unambiguous ASCII equivalent (Arabic-Indic,
 * Eastern-Arabic, fullwidth) plus zero-width chars inside digit runs are
 * normalized first. Word amounts and EU-style grouping are NOT parsed.
 */
export function extractMonetaryAmounts(text) {
  const s = normalizeMonetaryText(text);
  const found = [];
  const seen = new Set();
  const push = (n, raw) => {
    if (!Number.isFinite(n)) return;
    const v = Math.round(n);
    if (v <= 0) return;
    const key = `${v}|${raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ value: v, raw: String(raw) });
  };

  const cur = /(?:rs\.?|pkr|rupees?)\s*[:\/-]?\s*([\d,\s]+(?:\.\d+)?)\s*(k|thousand|lakh|lac)?/gi;
  let m;
  while ((m = cur.exec(s))) push(parseMoney(m[1], m[2]), m[0].trim());

  const suf = /(?<![A-Za-z])(\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac)\b/gi;
  while ((m = suf.exec(s))) push(parseMoney(m[1], m[2]), m[0].trim());

  const grouped = /(?<!\d)(\d{1,3}(?:,\d{2,3})+)(?!\d)/g;
  while ((m = grouped.exec(s))) push(parseMoney(m[1], null), m[1]);

  const spaced = /(?<!\d)(\d{1,3}(?:\s\d{2,3}){1,3})(?!\d)/g;
  while ((m = spaced.exec(s))) {
    const compact = m[1].replace(/\s/g, '');
    if (compact.length >= 4) push(Number(compact), m[1]);
  }

  const bare = /(?<![A-Za-z0-9.,])(\d{4,7})(?![A-Za-z0-9.,])/g;
  while ((m = bare.exec(s))) {
    if (YEAR_RE.test(m[1]) || PHONE_RE.test(m[1])) continue;
    push(parseInt(m[1], 10), m[1]);
  }

  return found;
}

/**
 * Residue that LOOKS monetary but this validator will not convert.
 * Used only for MODEL_OUTPUT (fail-closed). Never applied to EMI /
 * catalog / negotiation / follow-up copy.
 */
export function findOpaqueMonetary(text) {
  const s = normalizeMonetaryText(text);
  const hits = [];
  const otherNd = s.match(/\p{Nd}/gu)?.filter((ch) => ch < '0' || ch > '9') || [];
  if (otherNd.length) hits.push({ value: null, raw: otherNd.join(''), kind: 'unicode_digit' });
  if (/\b(sawa|saawa|assi|athh?ar|dedh|dhai)\s+(lakh|lac|hazar|hazaar|crore)s?\b/i.test(s)
    || /\bone\s+eighty\b/i.test(s)
    || /\b(eighty|assi)\s+hazar\b/i.test(s)) {
    hits.push({ value: null, raw: 'word-amount', kind: 'word_amount' });
  }
  const eu = s.match(/\b\d{1,3}(?:\.\d{3}){1,2}\b/g) || [];
  for (const x of eu) {
    const n = Number(x.replace(/\./g, ''));
    if (Number.isFinite(n) && n >= 1000) hits.push({ value: n, raw: x, kind: 'eu_grouping' });
  }
  return hits;
}

/** Authoritative allow-set. Never derived from the LLM text. */
export function authorizedMonetaryAmounts({ customer } = {}) {
  const allow = new Set();
  const cat = catalog();
  if (!cat?.corrupted) {
    for (const p of cat.products || []) {
      if (typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0) {
        allow.add(Math.round(p.price));
        for (const n of emiNumericSet(p.price)) allow.add(n);
      }
      if (typeof p.verified_price === 'number' && Number.isFinite(p.verified_price) && p.verified_price > 0) {
        allow.add(Math.round(p.verified_price));
      }
    }
    for (const row of cat.tradeInTable || []) {
      for (const k of ['good', 'average', 'poor']) {
        if (typeof row[k] === 'number' && Number.isFinite(row[k]) && row[k] > 0) allow.add(Math.round(row[k]));
      }
    }
  }
  const rules = loadRules();
  if (!rules?.corrupted) {
    for (const r of Object.values(rules.products || {})) {
      if (typeof r.floor === 'number' && Number.isFinite(r.floor) && r.floor > 0) allow.add(Math.round(r.floor));
    }
  }
  const n = customer?.stateData?.negotiation;
  if (n && typeof n === 'object') {
    for (const k of ['offer', 'floor', 'start']) {
      if (typeof n[k] === 'number' && Number.isFinite(n[k]) && n[k] > 0) allow.add(Math.round(n[k]));
    }
  }
  return allow;
}

function mentionsReno16Exclusive(text) {
  const s = String(text || '');
  const has16f = /reno[\s-]*16\s*f\b/i.test(s) || /reno16f/i.test(s);
  const has16 = /reno[\s-]*16\b/i.test(s) || /reno16(?!f)/i.test(s);
  return has16 && !has16f;
}

function reno16fCatalogPrice() {
  const cat = catalog();
  const p = (cat?.products || []).find((x) => x.id === 'reno16f');
  return typeof p?.price === 'number' && Number.isFinite(p.price) && p.price > 0 ? Math.round(p.price) : null;
}

function reno16Authorized(customer) {
  const set = new Set();
  const cat = catalog();
  const p = (cat?.products || []).find((x) => x.id === 'reno16');
  if (typeof p?.price === 'number') set.add(Math.round(p.price));
  if (typeof p?.verified_price === 'number') set.add(Math.round(p.verified_price));
  const rules = loadRules();
  const floor = rules?.products?.reno16?.floor;
  if (typeof floor === 'number' && Number.isFinite(floor) && floor > 0) set.add(Math.round(floor));
  const n = customer?.stateData?.negotiation;
  if (n && (n.product === 'reno16' || !n.product)) {
    for (const k of ['offer', 'floor', 'start']) {
      if (typeof n[k] === 'number' && Number.isFinite(n[k]) && n[k] > 0) set.add(Math.round(n[k]));
    }
  }
  return set;
}

/**
 * Validate a generated customer-facing reply.
 * @returns {{ ok: true, amounts: number[] } | { ok: false, reason: string, rejected: object[], amounts: number[] }}
 */
export function validateMonetaryReply(text, { customer, origin } = {}) {
  const extracted = extractMonetaryAmounts(text);
  if (origin === MODEL_OUTPUT_ORIGIN) {
    const opaque = findOpaqueMonetary(text);
    if (opaque.length) {
      return {
        ok: false,
        reason: 'UNPARSEABLE_MONETARY_REPRESENTATION',
        rejected: opaque,
        amounts: extracted.map((x) => x.value),
      };
    }
  }
  if (!extracted.length) return { ok: true, amounts: [] };
  const allow = authorizedMonetaryAmounts({ customer });
  const rejected = extracted.filter((x) => !allow.has(x.value));
  if (rejected.length) {
    const belowFloor = rejected.some((x) => x.value < 186800 && x.value >= 1000);
    return {
      ok: false,
      reason: belowFloor ? 'UNAUTHORIZED_BELOW_FLOOR_OR_INVENTED' : 'UNAUTHORIZED_MONETARY_AMOUNT',
      rejected,
      amounts: extracted.map((x) => x.value),
    };
  }
  // Small local context check (not a SKU-bound redesign): the 16F catalog
  // price must not be quoted against exclusive Reno 16 wording.
  const sixteenF = reno16fCatalogPrice();
  if (sixteenF && mentionsReno16Exclusive(text)) {
    const reno16ok = reno16Authorized(customer);
    const smuggled = extracted.filter((x) => x.value === sixteenF && !reno16ok.has(x.value));
    if (smuggled.length) {
      return {
        ok: false,
        reason: 'CROSS_SKU_AMOUNT',
        rejected: smuggled,
        amounts: extracted.map((x) => x.value),
      };
    }
  }
  return { ok: true, amounts: extracted.map((x) => x.value) };
}
