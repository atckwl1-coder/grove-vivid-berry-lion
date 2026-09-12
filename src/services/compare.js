// ─────────────────────────────────────────────────────────────
//  V1-6 CATALOG COMPARE + RECOMMEND
//  Catalog is the only product authority. No floors. No guessed
//  specs. Customer-facing prices go through priceCardLine so
//  VERIFIED / STALE / UNKNOWN wording is never relabeled.
//  This module returns text — it does not send WhatsApp.
// ─────────────────────────────────────────────────────────────
import {
  catalog,
  findProduct,
  priceCardLine,
  stockLine,
  isCatalogCorrupted,
} from './catalog.js';

const INTEREST_TAGS = ['camera', 'battery', 'gaming', 'budget', 'flagship'];

const UNKNOWN_TEXT =
  'Ji, ye model catalog mein confirm nahi mila. Specs ya price guess nahi kar sakta — *staff* se baat karein, team aapki madad kare gi.';

const NO_MATCH_TEXT =
  'Is budget par catalog mein match nahi. *staff* se baat karein — koi product invent nahi karte.';

const FILLER_RE =
  /\b(please|pls|ji|kya|hai|hain|batao|bataen|better|konsa|kaunsa|kaun|theek|and|aur|with|the|dikhao|dikhao|ka|ki|ke)\b/gi;

function cleanQuery(s) {
  return String(s || '')
    .replace(/[?!.,;:"']+/g, ' ')
    .replace(FILLER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTwoQueries(rest) {
  const raw = String(rest || '').trim();
  if (!raw) return null;
  const vs = raw.split(/\s+(?:vs\.?|versus|aur|and|with)\s+/i);
  if (vs.length >= 2) {
    const left = cleanQuery(vs[0]);
    const right = cleanQuery(vs.slice(1).join(' '));
    if (left && right) return { leftQuery: left, rightQuery: right };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 2) {
    const left = cleanQuery(tokens[0]);
    const right = cleanQuery(tokens[1]);
    if (left && right) return { leftQuery: left, rightQuery: right };
  }
  // "reno 16 reno 16f" / "oppo reno 16 oppo reno 16f" — text split only
  const duo = raw.match(
    /^((?:oppo\s+)?[a-z]+\s*\d+\s*[a-z]?)\s+((?:oppo\s+)?[a-z]+\s*\d+\s*[a-z]?)\s*$/i
  );
  if (duo) {
    const left = cleanQuery(duo[1]);
    const right = cleanQuery(duo[2]);
    if (left && right) return { leftQuery: left, rightQuery: right };
  }
  return null;
}

/**
 * Parse a customer compare utterance into two catalog queries.
 * @returns {{ leftQuery: string, rightQuery: string } | null}
 */
export function parseCompareQuery(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const compareLead = t.match(/^(?:compare|muqabla)\s+(.+)$/i);
  if (compareLead) {
    const two = splitTwoQueries(compareLead[1]);
    if (two) return two;
  }

  const keywordSplit = [
    /\s+vs\.?\s+/i,
    /\s+versus\s+/i,
    /\s+(?:ka\s+)?muqabla\s+/i,
    /\s+ya\s+better\s+/i,
  ];
  for (const re of keywordSplit) {
    const parts = t.split(re);
    if (parts.length >= 2) {
      const left = cleanQuery(parts[0]);
      const right = cleanQuery(parts.slice(1).join(' '));
      if (left && right) return { leftQuery: left, rightQuery: right };
    }
  }

  // "X ya Y better" (Roman Urdu) — only when "better" is present
  if (/\bbetter\b/i.test(t) && /\s+ya\s+/i.test(t)) {
    const parts = t.split(/\s+ya\s+/i);
    if (parts.length >= 2) {
      const left = cleanQuery(parts[0]);
      const right = cleanQuery(parts.slice(1).join(' '));
      if (left && right) return { leftQuery: left, rightQuery: right };
    }
  }

  return null;
}

function isReno16F(p) {
  return p && String(p.id || '').toLowerCase() === 'reno16f';
}

function productBlock(p) {
  const variant = p.variant ? ` (${p.variant})` : '';
  const lines = [`📱 *${p.name}*${variant}`, priceCardLine(p)];
  const sl = stockLine(p);
  if (sl) lines.push(sl);
  if (Array.isArray(p.highlights) && p.highlights.length) {
    lines.push(`✨ ${p.highlights.join(' • ')}`);
  }
  if (isReno16F(p)) {
    lines.push('Reno 16F negotiation floor UNRESOLVED — koi guessed floor nahi');
  }
  return lines.join('\n');
}

/**
 * Compare two catalog products. `a` / `b` are findProduct queries.
 * Fail-closed on unknown SKUs and on a corrupted catalog.
 * Never prints a negotiation floor number.
 */
export function compareProducts(a, b) {
  if (isCatalogCorrupted()) {
    return { ok: false, reason: 'CATALOG_CORRUPT', text: priceCardLine(null) };
  }
  const leftQ = String(a || '').trim();
  const rightQ = String(b || '').trim();
  if (!leftQ || !rightQ) {
    return { ok: false, reason: 'PRODUCT_UNKNOWN', text: UNKNOWN_TEXT };
  }
  const left = findProduct(leftQ);
  const right = findProduct(rightQ);
  if (!left || !right) {
    return { ok: false, reason: 'PRODUCT_UNKNOWN', text: UNKNOWN_TEXT };
  }

  const text =
    `⚖️ *Muqabla — catalog facts only*\n\n` +
    `${productBlock(left)}\n\n` +
    `${productBlock(right)}\n\n` +
    `Jo spec catalog mein nahi, wo guess nahi. *staff* likhein.`;

  return { ok: true, left, right, text };
}

function extractInterestTags(text, tags) {
  const wanted = new Set();
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.trim()) wanted.add(tag.trim().toLowerCase());
    }
  }
  const t = String(text || '').toLowerCase();
  if (!t) return wanted;
  if (/\b(camera|cam|photo|portrait)\b/.test(t)) wanted.add('camera');
  if (/\b(battery|backup)\b/.test(t)) wanted.add('battery');
  if (/\b(gaming|game|pubg)\b/.test(t)) wanted.add('gaming');
  if (/\b(budget|sasta|sasti)\b/.test(t)) wanted.add('budget');
  if (/\b(flagship|premium)\b/.test(t)) wanted.add('flagship');
  for (const k of INTEREST_TAGS) {
    if (t.includes(k)) wanted.add(k);
  }
  return wanted;
}

function numericBudget(budget) {
  if (budget == null || budget === '') return null;
  if (typeof budget === 'number' && Number.isFinite(budget) && budget > 0) return budget;
  if (typeof budget === 'string' && budget.trim() !== '') {
    const n = Number(budget.replace(/,/g, '').trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Recommend up to 3 catalog products.
 * `budget` is CUSTOMER_STATED (untrusted) — never printed as a catalog price.
 * Rank by tag overlap with text / tags; never invent an id or change a price.
 */
export function recommendFor({ budget, tags, text } = {}) {
  if (isCatalogCorrupted()) {
    return { products: [], text: priceCardLine(null) };
  }
  const c = catalog();
  const products = Array.isArray(c?.products) ? c.products : [];
  const cap = numericBudget(budget);
  const candidates = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p || typeof p.price !== 'number' || !Number.isFinite(p.price)) continue;
    if (cap != null && !(p.price <= cap)) continue;
    candidates.push({ p, i });
  }
  if (!candidates.length) {
    return { products: [], text: NO_MATCH_TEXT };
  }

  const wanted = extractInterestTags(text, tags);
  const scored = candidates.map(({ p, i }) => {
    const ptags = Array.isArray(p.tags) ? p.tags.map((x) => String(x).toLowerCase()) : [];
    const overlap = ptags.reduce((n, tag) => n + (wanted.has(tag) ? 1 : 0), 0);
    return { p, i, overlap };
  });
  scored.sort((a, b) => b.overlap - a.overlap || a.i - b.i);
  const picked = scored.slice(0, 3).map((x) => x.p);

  const blocks = picked.map((p) => {
    const variant = p.variant ? ` (${p.variant})` : '';
    const lines = [`📱 *${p.name}*${variant}`, priceCardLine(p)];
    if (Array.isArray(p.highlights) && p.highlights.length) {
      lines.push(`✨ ${p.highlights.join(' • ')}`);
    }
    return lines.join('\n');
  });

  const textOut =
    `Aapke bataye budget par catalog se:\n\n` +
    `${blocks.join('\n\n')}\n\n` +
    `Yeh catalog facts hain — koi naya model invent nahi. *staff* likhein.`;

  return { products: picked, text: textOut };
}
