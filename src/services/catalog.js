// Catalog service — products.json se live data (owner har roz update karta hai)
//
// V1-2 (2026-09-09): CATALOG AUTHORITY SEMANTICS — CAP-003 contract
// ("always dated, never AI-invented"; freshness "TTL 24h then STALE";
//  output "price_card + evidence{observed_at,status:VERIFIED|STALE}";
//  acceptance "0 undated prices in any output").
//
// TRUTH BOUNDARY (three states — never collapsed):
//   DATA EXISTS  ≠  DATA IS CURRENT  ≠  DATA IS VERIFIED
//   VERIFIED : observed_at parseable AND 0 ≤ age ≤ 24h  (TTL per CAP-003)
//   STALE    : observed_at parseable AND age > 24h
//   UNKNOWN  : observed_at missing / unparseable / in the future
//              (a future timestamp cannot be a real observation —
//              deterministic rule, documented implementation assumption)
//   A JSON value existing in a file does NOT make the price current.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRODUCTS_FILE = path.join(__dirname, '../data/products.json');

// Test isolation: tests copy the owner file and point CATALOG_FILE at the copy.
// Production never sets this — the shipped owner file is the authority.
export function catalogFile() {
  return process.env.CATALOG_FILE || DEFAULT_PRODUCTS_FILE;
}

// Test isolation: inject a frozen clock so 24h TTL tests do not depend on
// wall-clock age of shipped observed_at stamps.
export function catalogNow() {
  const env = process.env.CATALOG_NOW_MS;
  if (env != null && env !== '' && Number.isFinite(Number(env))) return Number(env);
  return Date.now();
}

// CAP-003 provider_failure: file unreadable / bad schema → honest sentinel.
// NEVER last-good-as-current (§27): no cache, no fallback prices, no memory.
const CORRUPT = Object.freeze({ products: [], policies: null, corrupted: true, reason: 'UNREADABLE_OR_BAD_SCHEMA' });

export function catalog() {
  try {
    const c = JSON.parse(fs.readFileSync(catalogFile(), 'utf8'));
    if (!c || typeof c !== 'object' || !Array.isArray(c.products)) throw new Error('bad schema: products[] missing');
    return c;
  } catch {
    return CORRUPT;
  }
}

export const isCatalogCorrupted = (c = catalog()) => Boolean(c?.corrupted);

// CAP-003 input freshness: "TTL 24h then STALE" — contract-specified, not invented.
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export function parseObservedAt(v, now = Date.now()) {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  if (t > now) return null; // future = not a real observation (documented assumption)
  return t;
}

// Deterministic per-product classification. Malformed price → UNKNOWN:
// a non-numeric price is never rendered (no NaN, no invented number).
export function productStatus(p, now = catalogNow()) {
  if (!p || typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price <= 0) {
    return { status: 'UNKNOWN', observedAt: null };
  }
  const t = parseObservedAt(p.observed_at, now);
  if (t === null) return { status: 'UNKNOWN', observedAt: null };
  const age = now - t;
  return { status: age <= CATALOG_TTL_MS ? 'VERIFIED' : 'STALE', observedAt: t };
}

// Locale-proof date rendering: 'YYYY-MM-DD'.
export const observedAtIso = (t) => new Date(t).toISOString().slice(0, 10);

// ── Customer-facing price lines (CAP-003: "0 undated prices in any output") ──
// VERIFIED → quotable as today's price, dated. STALE → contract wording
// 'rates kal ke ho sakte hain — confirm karein', dated, no scarcity.
// UNKNOWN  → NO number at all. Corrupt → contract wording 'rates par kaam jaari hai'.
export function priceCardLine(p, now = catalogNow()) {
  if (isCatalogCorrupted()) {
    return '⚠️ Rates par kaam jaari hai — abhi prices confirm nahi ho sakte. *staff* likhein, team aapki madad kare gi.';
  }
  const { status, observedAt } = productStatus(p, now);
  if (status === 'VERIFIED') return `💰 aaj ki price: *${formatPrice(p.price)}* (verified: ${observedAtIso(observedAt)})`;
  if (status === 'STALE') return `💰 aakhri verified price: *${formatPrice(p.price)}* (verified: ${observedAtIso(observedAt)}) — rates kal ke ho sakte hain — confirm karein`;
  return `💰 ${p.name} ki price abhi confirm nahi ho sakti (verification pending) — *staff* likhein ya store par aayen`;
}

// CAP-003 stale_data failure state: "scarcity counters auto-disabled".
// A stale/unknown stock count is a currency claim about inventory → no number.
export function stockLine(p, now = catalogNow()) {
  if (isCatalogCorrupted()) return null;
  const { status } = productStatus(p, now);
  if (status !== 'VERIFIED') return null;
  const stock = Number(p.stock);
  if (!Number.isFinite(stock)) return null;
  return `📦 Stock abhi: ${stock} pieces`;
}

// Compact per-model line for the menu list (same authority rules, short form).
export function menuPriceLine(p, now = catalogNow()) {
  if (isCatalogCorrupted()) return `price store par confirm ho gi`;
  const { status, observedAt } = productStatus(p, now);
  if (status === 'VERIFIED') {
    const stock = Number.isFinite(Number(p.stock)) ? p.stock : 'n/a';
    return `💰 *${formatPrice(p.price)}* (verified ${observedAtIso(observedAt)}) — stock: ${stock}`;
  }
  if (status === 'STALE') return `💰 *${formatPrice(p.price)}* (${observedAtIso(observedAt)} — rates kal ke ho sakte hain, confirm karein)`;
  return `💰 price confirm nahi ho sakti — store par rabta karein`;
}

// LLM prompt line — deterministic label. The model may only PHRASE; it may
// never reclassify, never relabel STALE as current, never quote UNKNOWN.
// V1-3: products may legitimately omit variant/stock/highlights (owner supplied
// only price) — optional fields render as 'n/a'/omitted, NEVER 'undefined'
// (V1-2 no-undefined discipline extended to optional fields).
export function modelCatalogLine(p, now = catalogNow()) {
  if (isCatalogCorrupted()) return 'CATALOG_UNAVAILABLE — rates par kaam jaari hai; koi price/stock number quote NAHI karein; handoff=true';
  const { status, observedAt } = productStatus(p, now);
  const variant = p.variant ? ` (${p.variant})` : '';
  const stockTxt = Number.isFinite(Number(p.stock)) ? `stock ${p.stock}; ` : 'stock n/a; ';
  const highlights = Array.isArray(p.highlights) && p.highlights.length ? p.highlights.join(', ') : '';
  const base = `- ${p.name}${variant}: `;
  if (status === 'VERIFIED') return `${base}Rs.${p.price} — VERIFIED (${observedAtIso(observedAt)}); ${stockTxt}${highlights}`;
  if (status === 'STALE') return `${base}Rs.${p.price} — STALE (aakhri verification ${observedAtIso(observedAt)}); sirf "aakhri verified price" + "rates kal ke ho sakte hain — confirm karein" ke saath quote karein — "aaj ki price" NAHI; stock/scarcity MAT bolo; ${highlights}`;
  return `${base}PRICE_UNVERIFIED — koi number quote NAHI karein; customer ko "price confirm nahi ho sakti — staff se baat karein" batayein`;
}

// V1-3: single source for P2 EVIDENCE objects (existing stage semantics,
// CAP-003): attached ONLY for VERIFIED products; STALE/UNKNOWN → null (absent
// evidence ⇒ class rules govern). Consumers: negotiation engine (V1-3).
// Kept here so catalog authority + evidence construction never split.
export function catalogEvidence(p, now = catalogNow()) {
  if (isCatalogCorrupted()) return null;
  const { status, observedAt } = productStatus(p, now);
  if (status !== 'VERIFIED' || !observedAt) return null;
  return { source: 'catalog:products.json', observed_at: new Date(observedAt).toISOString(), status: 'VERIFIED' };
}

// V1-3: approved value stack — ONLY owner-supplied `claim` strings are
// customer-quotable. `conditional` claims (e.g. account-dependent Google
// benefits) require customer-account evidence that this deployment has NO
// source for → structurally excluded from every automatic statement.
export function approvedBenefitsLine(p) {
  const b = Array.isArray(p?.benefits) ? p.benefits : [];
  const claims = b.filter((x) => typeof x?.claim === 'string' && x.claim.trim() !== '').map((x) => x.claim);
  return claims.length ? claims.join(' + ') : '';
}

// Corrupt-safe policy text (flows never print "undefined" when the file is down).
export function policyText(key, now = catalogNow()) {
  const c = catalog(now);
  const v = c?.policies?.[key];
  return (typeof v === 'string' && v.trim() !== '') ? v : 'abhi confirm nahi ho sakti';
}

export function findProduct(query) {
  const q = (query || '').toLowerCase().replace(/[\s-]/g, '');
  return catalog().products.find(
    (p) => p.id === q || p.name.toLowerCase().replace(/[\s-]/g, '').includes(q)
  );
}

export const formatPrice = (n) => 'Rs. ' + Number(n).toLocaleString('en-PK');
