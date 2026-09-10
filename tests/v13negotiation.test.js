// ═══════════════════════════════════════════════════════════
//  V1-3 DETERMINISTIC NEGOTIATION — FOCUSED VERIFICATION (2026-09-10)
//
//  Contract (CAP-039 registry row + owner mandate 2026-09-10):
//   "Best-price offers within floor" · "deterministic engine owns numbers;
//    LLM may ONLY phrase; validator re-checks" · value before price ·
//    a discount request does NOT automatically earn a discount ·
//    floors: Reno 16 start 200,000 / floor 186,499 (RESOLVED) ·
//    Reno 16F start 150,000 / floor range 139k–142k (UNRESOLVED —
//    must NOT be guessed) · learning changes tactics ONLY, never
//    authority · truth: no fabricated scarcity/urgency/approval/
//    competitor prices/benefits; no unsupported Google duration claims.
//
//  Real path: signed webhook → ingest → flows/brain → P2 firewall →
//  outbox spy. LLM = LOCAL capture double (prompt-rule assertions only —
//  the numeric path is the deterministic router/engine, no LLM).
//  Each test uses a UNIQUE customer phone (clean per-test negotiation
//  state). Catalog/rules/skills states are exercised by patching the real
//  files (restored in teardown / per-test finally).
// ═══════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv13-'));
const REPO = process.cwd();
const PRODUCTS_FILE = path.join(REPO, 'src/data/products.json');
const RULES_FILE = path.join(REPO, 'src/data/negotiation-rules.json');
const SKILLS_FILE = path.join(REPO, 'src/data/sales-skills.json');

// ── Local LLM capture double (before config import) ──
const llmRequests = [];
let replySeq = 0;
const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    llmRequests.push(JSON.parse(body));
    replySeq += 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply: `reply-${replySeq}`, handoff: false, intent: 'general' }) } }],
    }));
  });
});
await new Promise((r) => llmServer.listen(0, '127.0.0.1', r));

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.META_APP_SECRET = 'testsecret-v13';
process.env.META_VERIFY_TOKEN = 'v13';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_BASE_MS = '20';
process.env.RETRY_MAX = '3';
process.env.RETRY_MAX_MS = '80';
process.env.OPENAI_API_KEY = 'test-key-v13';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${llmServer.address().port}`;
// WHATSAPP_TOKEN empty → DEMO (no Meta network ever)

const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const { logOutbound, getCustomer, negotiationOutcomes, recordNegotiation } = await import('../src/services/customers.js');
const convs = await import('../src/sentinel/conversations.js');
const kill = await import('../src/sentinel/killswitch.js');
const { buildApp } = await import('../src/app.js');
const neg = await import('../src/services/negotiation.js');

auditMod.initAudit();
idem.initIdempotency();
kill.initKill();
convs.setEscalationAckSender((to, ackText) => wa.sendText(to, ackText, { source: 'AI_SYSTEM_ACK' }));

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
wa.setMessageLogger(logOutbound);
mainOutbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ── file patching (shipped files restored in teardown) ──
const originalCatalog = fs.readFileSync(PRODUCTS_FILE, 'utf8');
const originalRules = fs.readFileSync(RULES_FILE, 'utf8');
const originalSkills = fs.readFileSync(SKILLS_FILE, 'utf8');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const patchCat = (fn) => { const c = readJson(PRODUCTS_FILE); fn(c); fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(c, null, 2)); };
const patchRules = (fn) => { const r = readJson(RULES_FILE); fn(r); fs.writeFileSync(RULES_FILE, JSON.stringify(r, null, 2)); };
const restoreAll = () => {
  fs.writeFileSync(PRODUCTS_FILE, originalCatalog);
  fs.writeFileSync(RULES_FILE, originalRules);
  fs.writeFileSync(SKILLS_FILE, originalSkills);
};
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// fixture: owner just verified the Reno rows (deterministic fresh state)
patchCat((c) => { for (const id of ['reno16', 'reno16f']) { const p = c.products.find((x) => x.id === id); p.observed_at = new Date().toISOString(); } });

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-v13').update(body).digest('hex');
let seq = 0;
const pSeq = { i: 0 };
const P = () => `9230011102${String(++pSeq.i).padStart(2, '0')}`;
const eventBody = (msg) => JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Neg User' } }], messages: [msg] } }] }], });
const textMsg = (id, text, from) => ({ from, id, type: 'text', text: { body: text } });
const postWebhook = (raw) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
};
const toPhone = (phone) => delivered.filter((p) => p.to === phone);
const textOf = (p) => p.text?.body || p.interactive?.body?.text || '';
const sendFlow = async (phone, text) => {
  const before = toPhone(phone).length;
  const res = await postWebhook(eventBody(textMsg(`wamid.v13-${++seq}`, text, phone)));
  assert.equal(res.status, 200, `webhook accepted: ${text}`);
  assert.ok(await waitFor(() => toPhone(phone).length > before), `reply delivered: ${text}`);
  return toPhone(phone).slice(-1)[0];
};
const latestJob = (phone) => {
  const files = fs.readdirSync(mainOutbox.dirs.D).filter((f) => f.endsWith('.json'));
  let best = null, bestMtime = -1;
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(mainOutbox.dirs.D, f), 'utf8'));
    if (j.payload?.to !== phone) continue;
    const m = fs.statSync(path.join(mainOutbox.dirs.D, f)).mtimeMs;
    if (m > bestMtime) { best = j; bestMtime = m; }
  }
  return best;
};
const nums = (t) => [...String(t).matchAll(/Rs\. ([\d,]+)/g)].map((m) => parseInt(m[1].replace(/,/g, ''), 10));
const n = (phone) => getCustomer(phone)?.stateData?.negotiation || null;
function verdict(name, expected, actual, proves, noProve) {
  console.log(`\n── ${name}\n   EXPECTED        : ${expected}\n   ACTUAL          : ${actual}\n   PROVES          : ${proves}\n   DOES NOT PROVE  : ${noProve}`);
}

const FLOOR = 186499;
const START = 200000;
const STEP = 2000;
const VALUE_SET = new Set(['SK-01', 'SK-02', 'SK-03', 'SK-04', 'SK-05', 'SK-06', 'SK-07', 'SK-08']);

// ═══ PRICE AUTHORITY ═══

test('N1. exact starting prices from the catalog (200,000 / 150,000), dated VERIFIED', async () => {
  const phone = P();
  const menu = await sendFlow(phone, 'menu_phones');
  const t = textOf(menu);
  assert.ok(t.includes('Rs. 200,000* (verified '), 'Reno 16 exact starting price, dated');
  assert.ok(t.includes('Rs. 150,000* (verified '), 'Reno 16F exact starting price, dated');
  assert.ok(t.includes('stock: n/a'), 'no stock supplied → no stock claim (never fabricated)');
  verdict('N1 starting prices', 'exact owner-supplied prices, dated, no fabricated stock', 'asserted', 'price truth comes from the owner catalog (V1-2), not the negotiation engine', 'physical availability (no stock data supplied for these models)');
});

test('N2+N3. full-range Reno 16 negotiation: 200,000 → step ladder → EXACTLY 186,499 floor; never below', async () => {
  const phone = P();
  const replies = [];
  await sendFlow(phone, 'reno16 bohat zyada hai'); // turn 1: value-first (no number move)
  replies.push(textOf(toPhone(phone).slice(-1)[0]));
  const expected = [198000, 196000, 194000, 192000, 190000, 188000, 186499];
  for (let i = 0; i < 7; i++) {
    const r = await sendFlow(phone, 'sasta karo');
    replies.push(textOf(r));
  }
  // each concession turn shows exactly the expected next offer (one step/turn)
  expected.forEach((want, i) => {
    const got = nums(replies[i + 1]);
    assert.ok(got.includes(want), `turn ${i + 2}: offer ${want} (got ${got})`);
    assert.ok(got.every((x) => x >= FLOOR), `turn ${i + 2}: nothing below floor`);
  });
  const floorReply = await sendFlow(phone, 'aur kam karo'); // at floor → final position, no new number
  const ft = textOf(floorReply);
  assert.ok(ft.includes('Rs. 186,499') && ft.includes('aakhri price'), 'floor stated as final position');
  const below = await sendFlow(phone, '180 k karo'); // below-floor push at floor → same floor line
  assert.ok(textOf(below).includes('Rs. 186,499'), 'below-floor request at floor → floor held');
  const all = nums(replies.join(' ') + ' ' + ft + ' ' + textOf(below));
  assert.ok(all.length > 0, 'numbers were quoted');
  assert.equal(Math.min(...all), FLOOR, 'NEVER below the owner floor — exact floor 186,499');
  const st = n(phone);
  assert.equal(st.offer, FLOOR, 'engine state: offer == floor');
  assert.equal(st.state, 'FLOOR');
  assert.equal(st.concessions, 7, 'seven bounded concessions = exactly start − floor');
  verdict('N2/N3 floor + range', 'exact start→floor ladder, 186,499 hard stop, 1 step/turn', 'asserted', 'the engine owns the numeric path end-to-end; the floor is a hard constraint; minimum necessary concession (1% steps, owner-tunable)', 'multi-instance; that the owner will hold the floor in practice (it is the only authority)');
});

test('N4. malformed floor → NO concession, honest staff path, no new numbers', async () => {
  const phone = P();
  patchRules((r) => { r.products.reno16.floor = 'not-a-number'; });
  try {
    const r1 = await sendFlow(phone, 'reno16 sasta karo');
    const r2 = await sendFlow(phone, 'aur bhi kam karo');
    const all = nums(textOf(r1) + ' ' + textOf(r2));
    assert.ok(all.every((x) => x >= START), 'no number below the starting price (got ' + all + ')');
    assert.ok(textOf(r1).includes('staff'), 'honest staff path');
    assert.equal(n(phone).concessions, 0, 'zero concessions without a valid floor');
  } finally {
    fs.writeFileSync(RULES_FILE, originalRules);
  }
  verdict('N4 malformed floor', 'invalid floor disables autonomous concession', 'asserted', 'a malformed authority value can never mint a discount (fail-closed to the human path)', 'auto-repair of the rules file (owner must fix it)');
});

test('N5. missing floor (product not in rules) → no autonomous discount', async () => {
  const phone = P();
  patchCat((c) => { c.products.find((x) => x.id === 'a3x').observed_at = new Date().toISOString(); });
  try {
    const r = await sendFlow(phone, 'a3x sasta karo');
    const t = textOf(r);
    const all = nums(t);
    assert.ok(all.every((x) => x >= 34999), 'no number below a3x starting price');
    assert.ok(t.includes('staff'), 'staff path for the un-authorized product');
    assert.equal(n(phone).concessions, 0, 'no concessions where the owner set no floor');
  } finally {
    restoreAll();
  }
  verdict('N5 missing floor', 'VERIFIED price restated, zero autonomous discount', 'asserted', 'negotiation authority exists only where the owner granted it (per product)', 'that the owner intends no discount on other models (absence = no authority, not a policy)');
});

test('N6. Reno 16F UNRESOLVED floor (139k–142k range) → NEVER guessed', async () => {
  const phone = P();
  const r1 = await sendFlow(phone, 'reno16f sasta karo');
  const r2 = await sendFlow(phone, '140 k mein de do');
  const r3 = await sendFlow(phone, '139000 karo');
  const all = nums(textOf(r1) + ' ' + textOf(r2) + ' ' + textOf(r3));
  assert.ok(all.every((x) => x >= 150000), 'no number below the 150,000 starting price (got ' + all + ')');
  assert.ok(!all.includes(139000) && !all.includes(140000) && !all.includes(141000) && !all.includes(142000), 'none of the range values guessed as a price');
  assert.ok(textOf(r1).includes('staff'), 'unresolved floor → staff path');
  assert.equal(n(phone).concessions, 0, 'zero concessions while the floor is unresolved');
  verdict('N6 unresolved floor', 'range ≠ authority; no 139/140/141/142k guess', 'asserted', 'the engine treats an owner range as NOT a floor — the mandated do-not-guess rule', 'that the owner will resolve the exact floor (human decision, recorded as open)');
});

// ═══ NEGOTIATION BEHAVIOR ═══

test('N7. ready-to-buy at the listed price → close at 200,000, ZERO concessions', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 200000 mein hi le raha hoon, payment karta hoon');
  const t = textOf(r);
  assert.ok(t.includes('Rs. 200,000* par fix'), 'closed at the highest approved price');
  const st = n(phone);
  assert.equal(st.state, 'CLOSED');
  assert.equal(st.concessions, 0, 'no discount for a ready customer');
  const rec = negotiationOutcomes().filter((x) => x.phone === phone).at(-1);
  assert.equal(rec.outcome, 'sale');
  assert.equal(rec.final_offer, 200000);
  assert.equal(rec.discount_amount, 0, 'zero discount realized');
  verdict('N7 close at listed price', 'ready customer → immediate close, 0 concessions', 'asserted', 'the objective is the highest approved close, not maximum discount', 'that the customer actually pays (verification=customer_statement; no payment system)');
});

test('N8. value-first: first price objection gets VALUE, not a number', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 200k bohat zyada hai');
  const t = textOf(r);
  assert.ok(nums(t).every((x) => x >= START), 'no number below the starting price on turn 1');
  assert.ok(t.includes('gifting box') || t.includes('warranty') || t.includes('S Care'), 'approved value stack used (owner-supplied only)');
  const st = n(phone);
  assert.ok(VALUE_SET.has(st.skills_used[0]), 'a value skill was selected first');
  assert.ok(!st.skills_used.includes('SK-09'), 'no concession skill before value');
  assert.equal(st.concessions, 0);
  verdict('N8 value-first', 'objection → value response, zero price movement', 'asserted', 'SELL VALUE BEFORE REDUCING PRICE is structural, not prompt advice', 'that value framing converts (learning data will track it)');
});

test('N9. controlled concession: after value + explicit request → exactly one bounded step', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai'); // value turn
  const r = await sendFlow(phone, 'sasta karo'); // explicit request → ONE step
  const t = textOf(r);
  assert.ok(t.includes('Rs. 198,000'), 'step = 200,000 − 1% (2,000) = 198,000');
  assert.equal(nums(t).length, 1, 'exactly one new number per turn');
  assert.equal(n(phone).concessions, 1, 'at most one concession per customer turn');
  verdict('N9 controlled concession', 'one 1% step per turn, after value-first', 'asserted', 'concessions are bounded, motivated, minimized (deterministic step, owner-tunable policy)', 'that the step size is optimal for margin (owner may retune policy)');
});

test('N10. competitor objection → truthful comparison skill, no fabricated competitor price', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 market mein 192 ki mil rahi hai');
  const t = textOf(r);
  assert.ok(!t.includes('192'), 'the customer-quoted competitor price is never confirmed or repeated');
  assert.ok(t.includes('verify nahi kar sakta'), 'honest: competitor rates cannot be verified from here');
  assert.ok(nums(t).every((x) => x >= START), 'no number below the starting price');
  assert.equal(n(phone).skills_used[0], 'SK-07', 'competitor-comparison skill selected');
  verdict('N10 competitor objection', 'no fabricated/confirmed competitor data; value anchor instead', 'asserted', 'truth rule: no invented or confirmed competitor prices (mandated §14)', 'actual market pricing (out of scope by design)');
});

test('N11. repeated bargaining → strictly decreasing, one step each, stops at floor', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  const offers = [];
  for (let i = 0; i < 7; i++) {
    const r = await sendFlow(phone, 'kam karo');
    const got = nums(textOf(r));
    assert.equal(got.length, 1, 'one number per turn');
    offers.push(got[0]);
  }
  // full steps, then the final PARTIAL step clamps to the floor (by design)
  for (let i = 1; i < offers.length - 1; i++) assert.equal(offers[i], offers[i - 1] - STEP, 'monotone −1 step');
  assert.ok(offers[offers.length - 1] < offers[offers.length - 2], 'final step descends');
  assert.equal(offers[offers.length - 1], FLOOR, 'final step clamps exactly to the floor');
  assert.deepEqual(offers, [198000, 196000, 194000, 192000, 190000, 188000, 186499]);
  verdict('N11 monotone ladder', 'deterministic 1%-step descent to the floor', 'asserted', 'no oscillation, no jumps, no below-floor (validator-level determinism)', 'that every step was "motivated" in the psychological sense (context gates exist: value-first / explicit request / bid)');
});

test('N12. explicit price-to-pay within one step → accept at the customer number (pays now)', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 199000 mein payment karta hoon');
  assert.ok(textOf(r).includes('Rs. 199,000* par fix'), 'accepted 199,000 (gap 1,000 ≤ one step, pays now)');
  assert.equal(n(phone).state, 'CLOSED');
  assert.equal(negotiationOutcomes().filter((x) => x.phone === phone).at(-1).discount_amount, 1000, 'exactly the necessary concession');
  verdict('N12 accept within one step', 'conversion at the smallest gap', 'asserted', 'close logic prefers realized price: stated willingness-to-pay within a step is accepted instead of re-bargaining', 'that the payment completes in-store (no payment system)');
});

test('N13. explicit bid far below → bounded counter, never a jump to the floor, never the bid', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 190000 mein le raha hoon');
  const t = textOf(r);
  assert.ok(t.includes('Rs. 198,000'), 'counter at one step (198,000) — not 190,000, not the floor');
  assert.ok(!t.includes('190,000') && !t.includes('186,499'), 'neither the low bid nor the floor volunteered');
  assert.equal(nums(t).length, 1, 'one number only');
  verdict('N13 far-bid counter', 'bounded counter toward the customer, max price preserved', 'asserted', 'the engine concedes minimally per turn toward a stated bid (highest realistic close)', 'that the customer will follow to the floor (they may walk — tracked as outcome)');
});

test('N14. below-floor request from the start → bounded counter (never 180,000)', async () => {
  const phone = P();
  const r1 = await sendFlow(phone, 'reno16 180000 mein de do');
  const t1 = textOf(r1);
  assert.ok(!t1.includes('180,000'), 'the below-floor number is never offered');
  assert.ok(t1.includes('Rs. 198,000'), 'counter at the next step');
  const r2 = await sendFlow(phone, '180 k karo');
  assert.ok(textOf(r2).includes('Rs. 196,000'), 'second bounded counter');
  const all = nums(t1 + ' ' + textOf(r2));
  assert.ok(all.every((x) => x >= FLOOR), 'every quoted number ≥ floor');
  verdict('N14 below-floor request', 'below-floor numbers are refused; bounded descent only', 'asserted', '"never below 186,499" holds even under direct below-floor pressure', 'floor behavior under a 3rd+ push (covered by the escalation test N26)');
});

test('N15. customer walks away → LOST, no-sale outcome recorded, no numbers', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  await sendFlow(phone, 'sasta karo'); // 198,000
  const r = await sendFlow(phone, 'na chahiye, phir baat karte hain');
  const t = textOf(r);
  assert.equal(nums(t).length, 0, 'no price in the farewell');
  const st = n(phone);
  assert.equal(st.state, 'LOST');
  assert.equal(st.active, false);
  const rec = negotiationOutcomes().filter((x) => x.phone === phone).at(-1);
  assert.equal(rec.outcome, 'no_sale');
  assert.equal(rec.final_offer, 198000, 'last authorized position recorded');
  verdict('N15 walk-away', 'LOST state + honest no-sale record at the last authorized position', 'asserted', 'outcomes are captured from engine events (no fabrication); the last position is retained for re-close', 'that the customer is genuinely lost (may return — next test)');
});

test('N16. return after walk → re-open at the LAST authorized position (198,000), not the start', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  await sendFlow(phone, 'sasta karo'); // 198,000
  await sendFlow(phone, 'na chahiye'); // LOST @198,000
  const r = await sendFlow(phone, 'reno16 wapis aaya hoon, le raha hoon');
  assert.ok(textOf(r).includes('Rs. 198,000* par fix'), 're-closed at the last authorized position');
  assert.equal(n(phone).state, 'CLOSED');
  assert.ok(n(phone).skills_used.includes('SK-11'), 're-close skill logged');
  assert.equal(negotiationOutcomes().filter((x) => x.phone === phone).at(-1).final_offer, 198000);
  verdict('N16 re-close', 'no reopening above the last position; no new authority', 'asserted', 're-close uses the recorded last authorized offer (deterministic, file-backed)', 'that the re-open price holds over days (it does — state is persisted; staleness of the underlying catalog still applies per V1-2)');
});

test('N17. sale outcome record = exact structured data (start/final/discount/skills/verification)', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  await sendFlow(phone, 'sasta karo');
  await sendFlow(phone, 'theek hai, le raha hoon'); // close @198,000
  const rec = negotiationOutcomes().filter((x) => x.phone === phone).at(-1);
  assert.equal(rec.product, 'reno16');
  assert.equal(rec.outcome, 'sale');
  assert.equal(rec.start, 200000);
  assert.equal(rec.final_offer, 198000);
  assert.equal(rec.discount_amount, 2000);
  assert.ok(Array.isArray(rec.skills) && rec.skills.includes('SK-02') && rec.skills.includes('SK-09') && rec.skills.includes('SK-10'), 'skill sequence captured');
  assert.equal(rec.verification, 'customer_statement', 'honest verification label (no payment system)');
  verdict('N17 outcome record', 'minimal structured capture, honestly labeled', 'asserted', 'the learning contract data exists and is truthful (verification=customer_statement)', 'that the sale completed financially (no PSP in this deployment)');
});

// ═══ TRUTH ═══

test('N18. full session: no fabricated scarcity / urgency / approval', async () => {
  const phone = P();
  const texts = [];
  for (const t of ['reno16 zyada hai', 'sasta karo', 'aur kam karo', '185 k karo', 'theek hai le raha hoon']) {
    const r = await sendFlow(phone, t);
    texts.push(textOf(r));
  }
  const all = texts.join('\n');
  assert.ok(!/last piece|akhri piece|limited|aaj tak|offer khatam|kal tak|abhi ke liye|special offer|zyadatar log/i.test(all), 'no fake scarcity/urgency');
  assert.ok(!/owner.*approv|boss ne|owner ne kaha|management ne/i.test(all), 'no fabricated approval claims');
  assert.ok(!/undefined|NaN/.test(all), 'no rendering leaks');
  verdict('N18 truth invariance', 'zero fabricated scarcity/urgency/approval across a full session', 'asserted', 'mandated §14 truth rules hold for every engine template', 'LLM-fallback phrasing (prompt rule 9 governs; non-deterministic)');
});

test('N19. no invented benefits; Reno 16F (no approved benefits) gets NO benefit claims', async () => {
  const phone = P();
  const r1 = await sendFlow(phone, 'reno16 zyada hai');
  const t1 = textOf(r1);
  assert.ok(!/free case|free insurance|extra warranty|2 saal|double warranty/i.test(t1), 'reno16: no invented benefits');
  const phone2 = P();
  const r2 = await sendFlow(phone2, 'reno16f zyada hai');
  const t2 = textOf(r2);
  assert.ok(!/S Care|gifting|replacement protection|Gemini|warranty/i.test(t2), 'reno16f: zero benefit claims (none owner-approved for it)');
  verdict('N19 benefit truth', 'only owner-approved claims, per product; none invented', 'asserted', 'value stack is data-bound to products.json `benefits` (approved list only)', 'that the owner approves more benefits later (their edit, not the bot)');
});

test('N20. no unsupported Google duration/storage claim; safe activation wording only', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 zyada hai');
  const t = textOf(r);
  assert.ok(!/18 mahina|guarantee|guaranteed|5 ?TB|5TB|1 year.*google|6 mahina.*google/i.test(t), 'no duration/storage guarantee');
  if (t.includes('Google')) assert.ok(t.includes('availability ke mutabiq'), 'Google claim carries the availability condition');
  verdict('N20 Google rule', 'activation offered conditionally; no future duration guaranteed', 'asserted', 'the mandated Google rule: a current activation elsewhere is never represented as this customer\u2019s guarantee', 'actual Google entitlement on a real account (no account-verification system exists)');
});

// ═══ SKILLS ═══

test('N21. correct skill selection for representative objections', async () => {
  const a = P();
  await sendFlow(a, 'reno16 zyada hai');
  assert.equal(n(a).skills_used[0], 'SK-02', 'price objection → objection discovery');
  const b = P();
  await sendFlow(b, 'reno16 market mein 195 ki mil rahi hai');
  assert.equal(n(b).skills_used[0], 'SK-07', 'competitor → comparison skill');
  const c = P();
  await sendFlow(c, 'reno16 budget hai');
  assert.equal(n(c).skills_used[0], 'SK-08', 'budget → budget discovery/EMI routing');
  const d = P();
  await sendFlow(d, 'reno16 trust nahi aata');
  assert.equal(n(d).skills_used[0], 'SK-05', 'trust → warranty/protection value');
  const e = P();
  await sendFlow(e, 'reno16 camera kaisa hai, zyada hai');
  assert.ok(['SK-06', 'SK-02', 'SK-03', 'SK-04'].includes(n(e).skills_used[0]), 'feature interest → feature/value skill');
  verdict('N21 selection', 'objection → specialized skill (deterministic mapping + library priorities)', 'asserted', 'skill selection is data-driven from the library, not ad-hoc', 'that each skill is "best" for its objection (learning tracks real outcomes)');
});

test('N22. chain terminates early: value → ready → close with zero concessions', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  const r = await sendFlow(phone, 'haan theek, le raha hoon');
  assert.ok(textOf(r).includes('Rs. 200,000* par fix'), 'closed after value, at the starting price');
  const st = n(phone);
  assert.equal(st.concessions, 0, 'no unnecessary negotiation');
  assert.equal(st.skills_used.at(-1), 'SK-10', 'closing skill is the last in the chain');
  verdict('N22 early termination', 'no bargaining after the customer is convinced', 'asserted', 'adaptive chains: stop when ready (mandated §7/§8)', 'that the customer pays in-store (customer_statement)');
});

test('N23. inappropriate skill never selected: concession is impossible on turn 1', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 discount do, abhi');
  const t = textOf(r);
  assert.equal(nums(t).every((x) => x >= START), true, 'no number below the start on an unprepared request');
  assert.ok(!n(phone).skills_used.includes('SK-09'), 'no concession skill before value-first');
  assert.equal(n(phone).concessions, 0, 'a bare discount request earns value, not a number');
  verdict('N23 gated concession', 'value-first gate blocks turn-1 concessions', 'asserted', '"a customer asking does not automatically earn" — enforced in code, not prompt', 'psychological optimality of the gate (learning data accumulates on real sessions)');
});

test('N24. historical performance is recorded correctly (skillStats from real outcomes)', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  await sendFlow(phone, 'sasta karo');
  await sendFlow(phone, 'theek hai le raha hoon'); // sale @198,000
  const stats = neg.skillStats();
  assert.ok(stats['SK-10'] && stats['SK-10'].uses >= 1 && stats['SK-10'].wins >= 1, 'closing skill counted on a sale');
  assert.ok(stats['SK-02'] && stats['SK-02'].uses >= 1 && stats['SK-02'].wins >= 1, 'value skill counted on a sale');
  assert.ok(stats['SK-09'] && stats['SK-09'].wins >= 1, 'concession counted on the winning session');
  verdict('N24 performance recording', 'outcome records → per-skill uses/wins (derived, not stored fake)', 'asserted', 'statistics are derived from captured engine outcomes only', 'causal attribution (a win credits every skill used — labeled decision-support, not proof)');
});

test('N25. successful strategy becomes higher priority (learned re-ranking of value skills)', async () => {
  const baseline = P();
  await sendFlow(baseline, 'reno16 zyada hai');
  assert.equal(n(baseline).skills_used[0], 'SK-02', 'baseline (no data): SK-02 (discovery) by library priority');
  // owner of records: SK-03 wins 3/3 on price objections
  for (let i = 0; i < 3; i++) {
    (await import('../src/services/customers.js')).recordNegotiation({ phone: `seed3-${i}`, product: 'reno16', outcome: 'sale', start: 200000, final_offer: 198000, discount_amount: 2000, concessions: 1, skills: ['SK-03', 'SK-10'], objections: ['price'], verification: 'customer_statement' });
  }
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  assert.equal(n(phone).skills_used[0], 'SK-03', '3/3 win-rate re-ranks SK-03 above the baseline');
  verdict('N25 learning promotes', 'win-rate (uses ≥ 3) lifts a successful value skill', 'asserted', 'tactic ranking improves from real outcomes (mandated §10/§11)', 'that the ranking is globally optimal (local win-rate heuristic, owner-visible library)');
});

test('N26. CAP-008: below-floor push at the floor (2×) → human escalation, then silence', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  for (let i = 0; i < 7; i++) await sendFlow(phone, 'kam karo'); // → floor 186,499
  await sendFlow(phone, '180 k karo'); // push 1 → floor line
  const before = toPhone(phone).length;
  const r = await sendFlow(phone, '180 k karo'); // push 2 → escalate (ack delivered inside escalate)
  assert.ok(toPhone(phone).length > before, 'ack delivered on escalation');
  assert.ok(/team/i.test(textOf(r)), 'honest human-path ack wording');
  assert.ok(convs.isSuppressed(phone), 'CAP-008: customer now human-owned (suppressed from AI/flows)');
  assert.equal(n(phone).state, 'ESCALATED');
  const rec = negotiationOutcomes().filter((x) => x.phone === phone).at(-1);
  assert.equal(rec.outcome, 'no_sale', 'honest no-sale record at the floor');
  assert.equal(rec.final_offer, FLOOR);
  // silence: one more customer message → NO new bot delivery
  const silentBefore = toPhone(phone).length;
  await postWebhook(eventBody(textMsg(`wamid.v13-${++seq}`, 'kam karo', phone)));
  assert.ok(await waitFor(() => toPhone(phone).length > silentBefore, 700) === false, 'no AI reply while human-owned');
  verdict('N26 floor → human path', 'floor = final autonomous position; CAP-008 takes over; AI silent', 'asserted', 'no invented authority past the floor; the existing human fallback is the escape valve (mandated §16)', 'that staff close the deal (human, out of scope)');
});

// ═══ LEARNING SAFETY ═══

test('N27. learning cannot change the floor / rules file (authority is read-only)', async () => {
  const h0 = hash(RULES_FILE);
  for (let i = 0; i < 10; i++) {
    recordNegotiation({ phone: 'safety-seed', product: 'reno16', outcome: i % 2 ? 'sale' : 'no_sale', start: 200000, final_offer: 186499, discount_amount: 13501, concessions: 7, skills: ['SK-03', 'SK-09', 'SK-10'], objections: ['price'], verification: 'customer_statement' });
  }
  assert.equal(hash(RULES_FILE), h0, 'rules file byte-identical after 10 outcomes');
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  for (let i = 0; i < 7; i++) await sendFlow(phone, 'kam karo');
  const r = await sendFlow(phone, 'aur kam karo');
  assert.ok(textOf(r).includes('Rs. 186,499'), 'floor still exactly 186,499');
  assert.equal(n(phone).offer, FLOOR);
  assert.equal(neg.concessionStep(200000), STEP, 'step policy unchanged');
  verdict('N27 authority immutability', '10 recorded outcomes → floor, step, rules file all unchanged', 'asserted', 'learning can NEVER move the financial boundary (structural: no write path)', 'owner-initiated rule changes (their edit + the normal git history)');
});

test('N28. learning cannot change permissions / gated skills / benefits', async () => {
  const rulesH = hash(RULES_FILE);
  const skillsH = hash(SKILLS_FILE);
  const cat = readJson(PRODUCTS_FILE);
  const benefitsH = crypto.createHash('sha256').update(JSON.stringify(cat.products.find((p) => p.id === 'reno16').benefits)).digest('hex');
  const cust = await import('../src/services/customers.js');
  // even a "perfect" record for the GATED concession skill must not make it selectable
  for (let i = 0; i < 5; i++) cust.recordNegotiation({ phone: `gated-${i}`, product: 'reno16', outcome: 'sale', start: 200000, final_offer: 198000, discount_amount: 2000, concessions: 1, skills: ['SK-09'], objections: ['price'], verification: 'customer_statement' });
  assert.equal(hash(RULES_FILE), rulesH, 'rules untouched');
  assert.equal(hash(SKILLS_FILE), skillsH, 'skill library untouched (performance is derived, not stored)');
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(readJson(PRODUCTS_FILE).products.find((p) => p.id === 'reno16').benefits)).digest('hex'), benefitsH, 'approved benefits untouched');
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  const first = n(phone).skills_used[0];
  assert.ok(VALUE_SET.has(first), 'selection stays within value skills — gated SK-09 never ranked');
  assert.notEqual(first, 'SK-09');
  // static: the engine module has NO file-write capability at all
  const src = fs.readFileSync(path.join(REPO, 'src/services/negotiation.js'), 'utf8');
  assert.ok(!/writeFileSync|writeFile\(|renameSync|appendFile|unlink/.test(src), 'engine source contains no file-write calls');
  verdict('N28 permission boundary', 'gated skills unrankable; authority files write-protected (structurally + static)', 'asserted', 'learning changes tactics only: floors, permissions, terms, benefits are unreachable by design', 'that an operator might edit the files by hand (that is the OWNER path, audited in git)');
});

test('N26b. failed strategy becomes lower priority (0/5 loss record demotes the skill)', async () => {
  const cust = await import('../src/services/customers.js');
  // SK-02 now: 0 wins / 5 uses on price (SK-03 from N25: 3/3) → SK-02 demoted
  for (let i = 0; i < 5; i++) {
    cust.recordNegotiation({ phone: `fail-${i}`, product: 'reno16', outcome: 'no_sale', start: 200000, final_offer: 200000, discount_amount: 0, concessions: 0, skills: ['SK-02'], objections: ['price'], verification: 'customer_statement' });
  }
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  assert.notEqual(n(phone).skills_used[0], 'SK-02', '0/5 skill is no longer selected first');
  assert.equal(n(phone).skills_used[0], 'SK-03', 'the 3/3 skill takes the slot');
  verdict('N26b learning demotes', 'a strategy with 5 losses / 0 wins loses the price-objection slot', 'asserted', 'ineffective strategies are identified and deprioritized (mandated §10)', 'causality of the losses (correlation-based ranking)');
});

// ═══ LLM FALLBACK SAFETY (prompt-level; numeric path is deterministic) ═══

test('N31. negotiation phrasing the deterministic layer misses → LLM path carries rule 9 and no invented number', async () => {
  const phone = P();
  const beforeLlm = llmRequests.length;
  const before = toPhone(phone).length;
  await postWebhook(eventBody(textMsg(`wamid.v13-${++seq}`, 'bhai reno16 thora adjust kar do please', phone)));
  assert.ok(await waitFor(() => llmRequests.length > beforeLlm), 'fell through to the LLM path');
  assert.ok(await waitFor(() => toPhone(phone).length > before), 'reply delivered');
  const req = llmRequests.slice(-1)[0];
  const sys = req.messages[0].content;
  assert.ok(sys.includes('deterministic engine'), 'rule 9 (engine owns numbers) present in the prompt');
  assert.ok(sys.includes('handoff=true'), 'negotiation → staff handoff instruction present');
  assert.ok(!/Rs\. [\d,]+/.test(toPhone(phone).slice(-1)[0].text?.body || ''), 'no price number invented in the reply');
  verdict('N31 LLM safety net', 'unmatched negotiation phrasing → prompt-level guard, no number, staff handoff path', 'asserted', 'the LLM path can never mint a concession (numbers are engine-only; LLM is phrasing + handoff)', 'that the real model obeys rule 9 (non-deterministic; the deterministic router covers standard phrasings)');
});

// ═══ SAFETY FOUNDATIONS ═══

test('N29. CAP-055: kill switch STOP still blocks negotiation sends; RESUME drains', async () => {
  assert.equal(kill.peekState().state, 'AUTOMATION_ACTIVE', 'harness starts ACTIVE');
  kill.stopAll('v13-test', 'act-v13-1', 'focus-test');
  const phone = P();
  const before = toPhone(phone).length;
  await postWebhook(eventBody(textMsg(`wamid.v13-${++seq}`, 'reno16 sasta karo', phone)));
  assert.ok((await waitFor(() => toPhone(phone).length > before, 700)) === false, 'NO delivery while STOPPED (engine send held)');
  kill.resumeAll('v13-test', 'act-v13-2', 'focus-test done', 'RESUME');
  await sendFlow(phone, 'reno16 zyada hai'); // delivered after resume
  assert.ok(kill.peekState().state === 'AUTOMATION_ACTIVE');
  verdict('N29 CAP-055 intact', 'global brake holds autonomous negotiation outbound', 'asserted', 'negotiation adds NO bypass around the kill switch (same transport, same gate)', 'Meta-transport stop semantics (demo provider only)');
});

test('N30. P2 firewall: every negotiation send carries a firewall decision (ALLOW) on the job', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 zyada hai');
  await sendFlow(phone, 'sasta karo');
  const job = latestJob(phone);
  assert.equal(job.meta?.firewall?.decision, 'ALLOW', 'firewall decision persisted on the job');
  assert.ok(job.meta?.firewall?.traceId, 'traceId present (reconstructible audit)');
  assert.equal(job.meta?.source, 'AI');
  assert.equal(job.meta?.evidence?.status, 'VERIFIED', 'evidence rides the existing EVIDENCE stage (verified catalog only)');
  assert.equal(job.meta?.evidence?.source, 'catalog:products.json');
  verdict('N30 P2 intact', 'negotiation outbound = ordinary AI send through the full pipeline', 'asserted', 'no second transport, no firewall bypass; evidence{observed_at,VERIFIED} on the job meta', 'external audit gate (B-1 open for all)');
});

// ── teardown: restore shipped files + stop servers ──
test('teardown', () => {
  restoreAll();
  mainOutbox.stop();
  server.close();
  llmServer.close();
});
