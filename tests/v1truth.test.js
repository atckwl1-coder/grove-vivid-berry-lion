// ═══════════════════════════════════════════════════════════════
//  V1-0 TRUTH CUT — FOCUSED VERIFICATION (2026-09-09)
//  Proves the phantom reservation/booking/token behavior is GONE
//  through the REAL customer path: signed webhook → ingest → brain
//  → flow router → P2 firewall → durable outbox (spy sender).
//  DEMO mode (no live tokens) — koi network call nahi.
//
//  Coverage maps to the mandated V1-0 verification items:
//   T1 phantom reservation response can no longer be produced
//   T2 no fake token is generated (bare "reserve" intent)
//   T3 out-of-stock intent → honest stock truth, no watch promise
//   T4 visit flow → no slot/token claim, no false BOOKING state
//   T5 replacement messages are truthful (catalog facts + honest
//      deferral + real human path only)
//   T6 menu remains fully functional (all rows intact)
//   T7 EMI flow works, no "appointment lein" claim
//   T8 trade-in flow works, button labels truthful
//   T9 global scan: zero phantom tokens / "RESERVED" / "24 ghante"
//   T10 unrelated flows (location) unchanged
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { isolateOwnerFiles } from './helpers/isolate-owner-files.mjs';

// ── Environment BEFORE any module load (ESM imports hoist) ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv1-'));
const { PRODUCTS_FILE } = isolateOwnerFiles(TMP);
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.META_APP_SECRET = 'testsecret-v1';
process.env.META_VERIFY_TOKEN = 'v1';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_BASE_MS = '20';
process.env.RETRY_MAX = '3';
process.env.RETRY_MAX_MS = '80';
// WHATSAPP_TOKEN intentionally empty → DEMO (no network ever)

const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const { buildApp } = await import('../src/app.js');

const CUSTOMER = '923001110010';

// V1-2 fixture: owner-just-verified catalog (observed_at=now) — deterministic
// FRESH-data state for this suite's price assertions (shipped file restored in
// teardown; VERIFIED/STALE/UNKNOWN/corrupt states are v12authority.test.js's job).
const originalCatalog = fs.readFileSync(PRODUCTS_FILE, 'utf8');
{
  const c = JSON.parse(originalCatalog);
  c.products.forEach((p) => { p.observed_at = new Date().toISOString(); });
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(c, null, 2));
}

auditMod.initAudit();
idem.initIdempotency();

// Outbox with spy sender — wired exactly like the phase2a suite
const delivered = [];
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob-main'),
  sendFn: async (p) => { delivered.push(p); return { ok: true }; },
  windowGuard: () => ({ ok: true }),
  auditFn: auditMod.audit,
  pollMs: 15,
  retry: { maxAttempts: 3, baseMs: 20, maxMs: 80 },
});
wa.initOutbox(mainOutbox);
mainOutbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-v1').update(body).digest('hex');
let seq = 0;
const eventBody = (text, from = CUSTOMER) =>
  JSON.stringify({
    entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Truth User' } }], messages: [{ from, id: `wamid.v1-${++seq}`, type: 'text', text: { body: text } }] } }] }],
  });
const postWebhook = (raw) =>
  fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
};
// Send a customer text, wait for the NEW delivery to that customer.
const sendAndAwait = async (text) => {
  const mine = () => delivered.filter((p) => p.to === CUSTOMER);
  const before = mine().length;
  const res = await postWebhook(eventBody(text));
  assert.equal(res.status, 200, `webhook accepted: ${text}`);
  assert.ok(await waitFor(() => mine().length > before), `delivery produced for: ${text}`);
  return mine().slice(-1)[0];
};
const textOf = (p) => p.text?.body || p.interactive?.body?.text || '';
const allDeliveredJson = () => JSON.stringify(delivered);

function verdict(name, expected, actual, proves, noProve) {
  console.log(`\n── ${name}\n   EXPECTED        : ${expected}\n   ACTUAL          : ${actual}\n   PROVES          : ${proves}\n   DOES NOT PROVE  : ${noProve}`);
}

// ═══ T1. The old phantom reservation response CANNOT be produced ═══
test('T1. "reserve reno13" → honest deferral; phantom RESERVED/token/24h GONE', async () => {
  const p = await sendAndAwait('reserve reno13');
  const t = textOf(p);
  // truthful catalog facts (from products.json: reno13 = Rs.139,999, stock 3)
  assert.ok(t.includes('aaj ki price: *Rs. 139,999*'), 'real price from catalog');
  assert.ok(t.includes('Stock abhi: 3 pieces'), 'real stock from catalog');
  assert.ok(t.includes('online reservation abhi available nahi'), 'honest capability statement');
  // the phantom — must be impossible
  assert.ok(!t.includes('RESERVED'), 'no "RESERVED" success claim');
  assert.ok(!/Token/i.test(t), 'no token mention');
  assert.ok(!/NK-\d+/.test(t), 'no fake token id');
  assert.ok(!t.includes('24 ghante'), 'no 24h hold claim');
  assert.ok(!t.includes('aapke naam par'), 'no "in your name" hold claim');
  verdict('T1 phantom reservation path', 'honest deferral, zero phantom strings', 'asserted clean', 'old RESERVED/token/24h response cannot be produced via reserve flow', 'that a real reservation capability exists (it does not — NOT IMPLEMENTED by design)');
});

// ═══ T2. Bare "reserve" intent — no fake token, no success claim ═══
test('T2. bare "reserve" → honest deferral without product line, no token', async () => {
  const p = await sendAndAwait('reserve');
  const t = textOf(p);
  assert.ok(t.includes('online reservation abhi available nahi'), 'honest deferral');
  assert.ok(!/NK-\d+/.test(t), 'no token generated');
  assert.ok(!t.includes('RESERVED'), 'no success claim');
  assert.ok(!t.includes('Stock abhi'), 'no phantom product line for unknown model');
  verdict('T2 no-token guarantee (bare intent)', 'no token, no success, no phantom product', 'asserted clean', 'no fake token is generated on the bare intent path', 'that the LLM path (rule 6 prompt) never promises tokens — prompt-level, not deterministically testable');
});

// ═══ T3. Out-of-stock intent → honest stock-0 truth, NO watch promise ═══
test('T3. "reserve findx8" with stock=0 → honest "0 pieces", no watchlist promise', async () => {
  const orig = fs.readFileSync(PRODUCTS_FILE, 'utf8');
  const patched = JSON.parse(orig);
  patched.products.find((x) => x.id === 'findx8').stock = 0;
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(patched, null, 2));
  try {
    const p = await sendAndAwait('reserve findx8');
    const t = textOf(p);
    assert.ok(t.includes('Stock abhi: 0 pieces'), 'honest stock-0 line (availability truthfully reported)');
    assert.ok(t.includes('online reservation abhi available nahi'), 'honest deferral');
    assert.ok(!/watch/i.test(t), 'no watchlist/stock-alert promise (no such backend exists)');
    assert.ok(!/sab se pehle aapko khabar/.test(t), 'no "you will be notified first" promise');
    assert.ok(!/NK-\d+/.test(t), 'no token');
  } finally {
    fs.writeFileSync(PRODUCTS_FILE, orig); // restore authoritative file exactly
  }
  verdict('T3 out-of-stock honesty', 'honest 0-stock + deferral, no watch promise', 'asserted clean (file restored)', 'no availability is falsely checked/claimed; no phantom subscription', 'that stock data is live (products.json is owner-maintained — staleness is V1-2)');
});

// ═══ T4. Visit flow — no slot/token claim, no false BOOKING state ═══
test('T4. "menu_visit" → honest "no booking from WhatsApp", state stays IDLE', async () => {
  const p = await sendAndAwait('menu_visit');
  const t = textOf(p);
  assert.ok(t.includes('possible nahi'), 'honest: booking not possible');
  assert.ok(t.includes('slot confirm nahi kar sakte'), 'honest: no slot confirmation');
  assert.ok(t.includes(catalog_timing()), 'real timing from catalog policies');
  assert.ok(!t.includes('Token mil jayega'), 'no "you will get a token" promise');
  assert.ok(!t.includes('wait nahi karna parega'), 'no no-queue promise');
  assert.ok(!/kal kaunsa waqt/.test(t), 'no appointment slot solicitation');
  // customer record must NOT be marked BOOKING (no booking backend exists)
  const db = JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
  assert.equal(db.customers[CUSTOMER].state, 'IDLE', 'no false BOOKING state recorded');
  verdict('T4 visit/slot honesty', 'honest deferral + IDLE state', 'asserted clean', 'no slot/availability falsely claimed; no fake booking state written', 'that staff can actually arrange a visit (human process — CAP-008 inbox exists and is proven)');
});
const catalog_timing = () => JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8')).policies.timing;

// ═══ T5. Truthfulness of the replacement: only claims the system CAN make ═══
test('T5. replacement messages contain ONLY system-backed claims', async () => {
  const p = await sendAndAwait('reserve a60');
  const t = textOf(p);
  // every factual line maps to a real source:
  assert.ok(t.includes('aaj ki price: *Rs. 54,999*'), 'price ← products.json');
  assert.ok(t.includes('Stock abhi: 5 pieces'), 'stock ← products.json');
  assert.ok(t.includes('🕙'), 'timing ← products.json policies');
  // every action offered is real:
  assert.ok(t.includes('staff'), 'staff path ← CAP-008 (proven)');
  assert.ok(!/kabhi|guarantee/.test(t), 'no promise-style language');
  verdict('T5 replacement truthfulness', 'catalog facts + real human path only', 'asserted clean', 'customer experience clearly states what Sentinel can and cannot do', 'that catalog data is current (V1-2 staleness semantics); that the LLM path stays equally honest (prompt rule 6, not deterministic)');
});

// ═══ T6. Menu remains fully functional (all rows intact) ═══
test('T6. "menu" → full list, all 6 rows, truthful labels', async () => {
  const p = await sendAndAwait('menu');
  assert.equal(p.type, 'interactive');
  assert.equal(p.interactive.type, 'list');
  const rows = p.interactive.action.sections.flatMap((s) => s.rows);
  const ids = rows.map((r) => r.id);
  for (const id of ['menu_phones', 'menu_emi', 'menu_tradein', 'menu_repair', 'menu_visit', 'menu_staff']) {
    assert.ok(ids.includes(id), `row intact: ${id}`);
  }
  const visit = rows.find((r) => r.id === 'menu_visit');
  assert.equal(visit.title, '📅 Store Visit', 'no "Book Karein" claim in row title');
  assert.ok(!/token/i.test(visit.description), 'no token claim in row description');
  const repair = rows.find((r) => r.id === 'menu_repair');
  assert.ok(!/slot/i.test(repair.description), 'no "slot booking" claim in repair row');
  verdict('T6 menu functional + truthful labels', 'all 6 rows, no booking/token/slot claims', 'asserted clean', 'existing menu behavior remains functional with honest labels', 'that tapping menu_repair reaches a working repair flow (AI-generic today — out of V1-0 scope)');
});

// ═══ T7. EMI flow works, appointment claim removed ═══
test('T7. "emi reno13" → full EMI table, no "appointment lein"', async () => {
  const p = await sendAndAwait('emi reno13');
  const t = textOf(p);
  assert.ok(t.includes('EMI Plan — Rs. 139,999 ke liye'), 'EMI math intact');
  assert.ok(t.includes('mahine'), 'plan table intact');
  assert.ok(t.includes('CNIC'), 'store process line intact');
  assert.ok(t.includes('timing aur pata mil jayega'), 'truthful visit pointer');
  assert.ok(!t.includes('appointment lein'), 'no appointment claim');
  verdict('T7 EMI flow intact + honest pointer', 'math unchanged, appointment claim gone', 'asserted clean', 'EMI behavior preserved; visit pointer now truthful', 'that visit timing data is live (same products.json staleness caveat)');
});

// ═══ T8. Trade-in flow works, button labels truthful ═══
test('T8. "trade a57 good" → estimate intact, no "book karein" button', async () => {
  const p = await sendAndAwait('trade a57 good');
  assert.equal(p.type, 'interactive');
  assert.equal(p.interactive.type, 'button');
  const t = textOf(p);
  // NOTE (pre-existing, OUT OF V1-0 SCOPE): 'a57' substring-matches the a5 row
  // first (estimateTradeIn uses q.includes(m)) → a57/good yields the a5 value
  // Rs. 8,000, not the a57 row's 12,000. Pinning CURRENT behavior here; the
  // estimate stays honestly labeled ("Andazan value" + store-confirmation).
  assert.ok(t.includes('Andazan value: *Rs. 8,000*'), 'estimate produced (a5-row match — pre-existing priority, recorded in report)');
  assert.ok(t.includes('store par phone dekh kar confirm hogi'), 'truthful in-store confirmation wording kept');
  const titles = p.interactive.action.buttons.map((b) => b.reply.title).join(' | ');
  assert.ok(!/book/i.test(titles), 'no "book karein" button label');
  assert.ok(titles.includes('Timing & pata'), 'truthful visit button label');
  verdict('T8 trade-in flow intact + honest button', 'estimate + buttons unchanged, label truthful', 'asserted clean', 'trade-in behavior preserved; visit button no longer claims booking', 'that trade-in values are market-accurate (table is owner-maintained)');
});

// ═══ T9. GLOBAL: zero phantom tokens / RESERVED / 24h across everything sent ═══
test('T9. global scan of every delivery: no phantom artifact anywhere', async () => {
  await sendAndAwait('location'); // one more flow through the pipe
  const all = allDeliveredJson();
  assert.ok(!/NK-\d+/.test(all), 'no fake token in ANY delivery');
  assert.ok(!all.includes('RESERVED'), 'no "RESERVED" in ANY delivery');
  assert.ok(!all.includes('24 ghante'), 'no 24h hold in ANY delivery');
  assert.ok(!all.includes('Token mil jayega'), 'no token promise in ANY delivery');
  verdict('T9 global phantom scan', 'zero phantom artifacts in all deliveries', 'asserted clean', 'across every customer-facing send in this session: no token, no success, no hold', 'future LLM-generated replies (prompt rule 6 mitigates; not deterministically testable)');
});

// ═══ T10. Unrelated flow unchanged: location ═══
test('T10. "location" → behavior identical to pre-V1-0', async () => {
  const p = await sendAndAwait('location');
  const t = textOf(p);
  assert.ok(t.includes('Khanewal city center'), 'address intact');
  assert.ok(t.includes('Main Bazaar'), 'address detail intact');
  assert.ok(t.includes(catalog_timing()), 'timing intact');
  verdict('T10 unrelated flow intact', 'location response unchanged', 'asserted clean', 'no unrelated product behavior changed (spot-check: location flow)', 'every other flow byte-identically (full-suite + diff review cover the rest)');
});

// ── teardown: restore shipped catalog + stop the outbox so the process can exit ──
test('teardown', () => {
  fs.writeFileSync(PRODUCTS_FILE, originalCatalog);
  mainOutbox.stop();
  server.close();
});
