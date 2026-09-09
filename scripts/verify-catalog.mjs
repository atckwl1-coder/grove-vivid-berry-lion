#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  OWNER CATALOG VERIFICATION RITUAL — CAP-003 / V1-2 (2026-09-09)
//
//  The owner edits src/data/products.json (prices/stock), then runs this
//  script to record WHEN the data was observed/verified (observed_at).
//  That timestamp is what makes a price VERIFIED (24h TTL) or STALE.
//
//  No network, no auth — it runs on the owner's own machine where the
//  authoritative file lives. There is NO remote/customer path that can
//  write products.json (no HTTP route touches it).
//
//  Usage:
//    node scripts/verify-catalog.mjs                      # CHECK: show classification, no writes
//    node scripts/verify-catalog.mjs --verify             # verify ALL products (observed_at=now)
//    node scripts/verify-catalog.mjs reno13 a3x --verify  # verify specific products only
//    --approve-jump=<id>  REQUIRED when a price moved >25% since the last
//    observation (registry CAP-003 permission: human approval on >25% jump).
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/data/products.json');
const TTL_MS = 24 * 60 * 60 * 1000;
const JUMP_THRESHOLD = 0.25; // CAP-003: human_approval_required "on >25% price jump in file edit"

const args = process.argv.slice(2);
const verify = args.includes('--verify');
const approved = new Set(args.filter((a) => a.startsWith('--approve-jump=')).map((a) => a.split('=')[1]));
const ids = args.filter((a) => !a.startsWith('--'));

function classify(price, observedAt, now = Date.now()) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return { status: 'UNKNOWN', why: 'bad price' };
  const t = Date.parse(observedAt);
  if (typeof observedAt !== 'string' || Number.isNaN(t)) return { status: 'UNKNOWN', why: 'missing/malformed observed_at' };
  if (t > now) return { status: 'UNKNOWN', why: 'future observed_at' };
  return { status: now - t <= TTL_MS ? 'VERIFIED' : 'STALE', ageH: Math.floor((now - t) / 36e5) };
}

let raw;
try {
  raw = fs.readFileSync(FILE, 'utf8');
} catch (e) {
  console.error(`⛔ CATALOG UNREADABLE (${e.message}) — fix the file first. No writes made.`);
  process.exit(2);
}
let data;
try {
  data = JSON.parse(raw);
  if (!data || !Array.isArray(data.products)) throw new Error('products[] missing');
} catch (e) {
  console.error(`⛔ BAD SCHEMA (${e.message}) — fix the file first. No writes made.`);
  process.exit(2);
}

const now = new Date();
const targets = data.products.filter((p) => ids.length === 0 || ids.includes(p.id));
if (verify && targets.length === 0) {
  console.error(`⛔ No products matched ids: ${ids.join(', ') || '(none)'}. Known ids: ${data.products.map((p) => p.id).join(', ')}`);
  process.exit(2);
}

// ── CAP-003 approval gate: >25% jump since last observation needs explicit approval ──
const jumps = [];
if (verify) {
  for (const p of targets) {
    if (typeof p.verified_price === 'number' && typeof p.price === 'number' && p.price !== p.verified_price) {
      const delta = Math.abs(p.price - p.verified_price) / p.verified_price;
      if (delta > JUMP_THRESHOLD) jumps.push({ id: p.id, from: p.verified_price, to: p.price, pct: Math.round(delta * 100) });
    }
  }
  const unapproved = jumps.filter((j) => !approved.has(j.id));
  if (unapproved.length > 0) {
    for (const j of unapproved) {
      console.error(`⛔ PRICE JUMP >25% on ${j.id}: Rs.${j.from} → Rs.${j.to} (${j.pct}%) — human approval required.`);
    }
    console.error(`   Re-run with: node scripts/verify-catalog.mjs --verify ${unapproved.map((j) => `--approve-jump=${j.id}`).join(' ')}`);
    process.exit(3);
  }
}

// ── Show current classification ──
console.log('── Catalog classification ──');
for (const p of data.products) {
  const c = classify(p.price, p.observed_at, now.getTime());
  console.log(`  ${p.id.padEnd(10)} Rs.${String(p.price).padStart(8)}  ${c.status.padEnd(8)} ${c.why || (c.ageH !== undefined ? `(age ${c.ageH}h)` : '')}`);
}

if (!verify) {
  console.log('\nCHECK mode — no writes. To record owner verification: node scripts/verify-catalog.mjs --verify [ids...]');
  process.exit(0);
}

// ── Owner verification: record observation (atomic write) ──
for (const p of targets) {
  p.observed_at = now.toISOString();
  p.verified_price = p.price;
}
data.updated = now.toISOString().slice(0, 10);
const tmp = FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
fs.renameSync(tmp, FILE);
console.log(`\n✅ VERIFIED ${targets.map((p) => p.id).join(', ')} at ${now.toISOString()} (24h TTL starts now).`);
