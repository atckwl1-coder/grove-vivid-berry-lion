// ═══════════════════════════════════════════════════════════════
//  V1-5.1 CONTROLLED PILOT READINESS — FOCUSED VERIFICATION
//  Staff paid-sale inbox action · MODEL_OUTPUT Unicode gate ·
//  Reno 16/16F context check · D-010 is a decision record only.
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv151-'));
const REPO = process.cwd();
const FROZEN_NOW = Date.parse('2026-09-10T12:00:00.000Z');
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP, { nowMs: FROZEN_NOW });

let llmPayload = { reply: 'theek hai ji', handoff: false, intent: 'general' };
const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(llmPayload) } }] }));
  });
});
await new Promise((r) => llmServer.listen(0, '127.0.0.1', r));

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.META_APP_SECRET = 'testsecret-v151';
process.env.META_VERIFY_TOKEN = 'v151';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_BASE_MS = '20';
process.env.RETRY_MAX = '3';
process.env.RETRY_MAX_MS = '80';
process.env.OPENAI_API_KEY = 'test-key-v151';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${llmServer.address().port}`;
process.env.HP_MIN_COMPOSITION_MS = '1';
process.env.HP_MAX_COMPOSITION_MS = '20';
process.env.HP_CHAR_BASE_MS = '0';
process.env.HP_CHAR_VARIANCE_MS = '0';
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-151', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-151', role: 'STAFF', tenant: 'khanewal-demo' },
  { id: 'outsider', password: 'outsider-pw-151', role: 'STAFF', tenant: 'tenant-b' },
]);

const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const cust = await import('../src/services/customers.js');
const convs = await import('../src/sentinel/conversations.js');
const kill = await import('../src/sentinel/killswitch.js');
const fu = await import('../src/services/followups.js');
const { buildApp } = await import('../src/app.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');
const nf = await import('../src/sentinel/numberFirewall.js');
const { loadRules } = await import('../src/services/negotiation.js');

auditMod.initAudit();
idem.initIdempotency();
kill.initKill();
cust.loadDb();
seedStaffIfMissing();
convs.setEscalationAckSender((to, ackText) => wa.sendText(to, ackText, { source: 'AI_SYSTEM_ACK' }));

const delivered = [];
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob-main'),
  sendFn: async (p) => { delivered.push(p); return { ok: true }; },
  windowGuard: () => ({ ok: true }),
  autonomyGuard: (job) => (kill.isAutonomousJob(job) ? kill.gateForSend(job.payload?.to, { source: job.meta?.source }) : { ok: true }),
  auditFn: auditMod.audit,
  onTerminal: (job) => fu.noteOutboxTerminal(job),
  pollMs: 15,
  retry: { maxAttempts: 3, baseMs: 20, maxMs: 80 },
});
wa.initOutbox(mainOutbox);
wa.setKillGate((to, meta) => kill.gateForSend(to, meta));
wa.setSendGuard(convs.authorizeOutbound);
wa.setMessageLogger(cust.logOutbound);
kill.onKillStop(() => mainOutbox.holdAutonomous(kill.isAutonomousJob));
kill.onKillResume(() => mainOutbox.releaseHeld());
mainOutbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-v151').update(body).digest('hex');
let seq = 0;
const pSeq = { i: 0 };
const P = () => `923001151${String(++pSeq.i).padStart(2, '0')}`;
const eventBody = (msg) => JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'V151 User' } }], messages: [msg] } }] }] });
const textMsg = (id, text, from) => ({ from, id, type: 'text', text: { body: text } });
const postWebhook = (raw) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); }
  return false;
};
const toPhone = (phone) => delivered.filter((p) => p.to === phone);
const textOf = (p) => p.text?.body || p.interactive?.body?.text || '';
const sendFlow = async (phone, text) => {
  const before = toPhone(phone).length;
  const res = await postWebhook(eventBody(textMsg(`wamid.v151-${++seq}`, text, phone)));
  assert.equal(res.status, 200, `webhook accepted: ${text}`);
  assert.ok(await waitFor(() => toPhone(phone).length > before), `reply delivered: ${text}`);
  return toPhone(phone).slice(-1)[0];
};
const auditAll = () => {
  try { return fs.readFileSync(process.env.AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
};
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;
async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id, password }),
  });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf, body: j };
}
async function action(pathname, creds, payload = {}) {
  const r = await fetch(`${base}${pathname}?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(creds?.cookie ? { Cookie: creds.cookie } : {}), ...(creds?.csrf ? { 'x-csrf': creds.csrf } : {}) },
    body: JSON.stringify({ actionId: payload.actionId || actId('x'), ...payload }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function statedSaleThenInbox(phone) {
  await sendFlow(phone, 'reno16 200000 mein hi le raha hoon, payment karta hoon');
  const rec = cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1);
  assert.equal(rec?.verification, 'customer_statement');
  await sendFlow(phone, 'menu_staff');
  assert.ok(convs.isSuppressed(phone));
  return rec;
}
function verdict(name, expected, actual, proves, noProve) {
  console.log(`\n── ${name}\n   EXPECTED        : ${expected}\n   ACTUAL          : ${actual}\n   PROVES          : ${proves}\n   DOES NOT PROVE  : ${noProve}`);
}

const ORIGIN = nf.MODEL_OUTPUT_ORIGIN;

test('P1. authenticated staff confirms a stated sale as paid', async () => {
  const phone = P();
  const rec = await statedSaleThenInbox(phone);
  const staff = await login('hassan', 'hassan-pw-151');
  assert.equal(staff.status, 200);
  const r = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('p1') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'PAID_CONFIRMED');
  assert.equal(r.body.sale.verification, 'paid');
  assert.equal(cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1).verification, 'paid');
  assert.ok(auditAll().some((e) => e.type === 'SALE_PAID_CONFIRMED'));
  verdict('P1 staff confirm', '200 PAID_CONFIRMED + verification=paid', r.body.status, 'authenticated staff can mark paid', 'a real PSP settlement');
});

test('P2. unauthenticated confirm-paid is rejected', async () => {
  const phone = P();
  await statedSaleThenInbox(phone);
  const r = await action(`/inbox/c/${phone}/confirm-paid`, {}, { product: 'reno16', actionId: actId('p2') });
  assert.equal(r.status, 401);
  assert.equal(cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1).verification, 'customer_statement');
  verdict('P2 unauth', '401, still customer_statement', String(r.status), 'confirm-paid requires a staff session', 'stolen valid tokens');
});

test('P3. CSRF mismatch is rejected', async () => {
  const phone = P();
  const rec = await statedSaleThenInbox(phone);
  const staff = await login('hassan', 'hassan-pw-151');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, { cookie: staff.cookie, csrf: 'not-the-csrf' }, { product: rec.product, at: rec.at, actionId: actId('p3') });
  assert.equal(r.status, 403);
  assert.equal(cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1).verification, 'customer_statement');
  verdict('P3 CSRF', '403 CSRF_MISMATCH, not paid', String(r.status), 'mutation is CSRF-gated', 'GET CSRF leak');
});

test('P4. duplicate confirmation is idempotent', async () => {
  const phone = P();
  const rec = await statedSaleThenInbox(phone);
  const staff = await login('boss', 'boss-pw-151');
  const a = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('p4a') });
  const b = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('p4b') });
  assert.equal(a.body.status, 'PAID_CONFIRMED');
  assert.equal(b.body.status, 'ALREADY_CONFIRMED');
  const paid = cust.negotiationOutcomes().filter((x) => x.phone === phone && x.outcome === 'sale' && x.verification === 'paid');
  assert.equal(paid.length, 1, 'still one paid sale record');
  verdict('P4 idempotent', 'second call ALREADY_CONFIRMED, one paid row', b.body.status, 'no duplicate sale blob', 'two different products on the same phone');
});

test('P5. paid confirmation creates exactly one qualifying follow-up', async () => {
  const phone = P();
  const rec = await statedSaleThenInbox(phone);
  const staff = await login('boss', 'boss-pw-151');
  await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('p5a') });
  await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('p5b') });
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T);
  await fu.sweepFollowUps(T + 10 * 86400000);
  const fus = cust.listFollowups().filter((x) => x.phone === phone);
  assert.equal(fus.length, 1, 'exactly one follow-up');
  verdict('P5 one follow-up', 'duplicate paid confirm → one care record', String(fus.length), 'follow-up system remains the scheduler authority', 'LIVE Day-10 delivery');
});

test('P6. customer statement alone is not paid', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 200000 mein hi le raha hoon, payment karta hoon');
  const rec = cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1);
  assert.equal(rec.verification, 'customer_statement');
  const r = await fu.sweepFollowUps(Date.parse(rec.at) + 10 * 86400000);
  assert.equal((r.created || []).filter((id) => String(id).includes(phone)).length, 0);
  assert.equal(cust.listFollowups().filter((x) => x.phone === phone).length, 0);
  verdict('P6 stated ≠ paid', 'no follow-up from speech-act alone', 'asserted', 'LLM/customer language cannot mark paid', 'POS integration');
});

test('P7. kill switch does not block internal paid confirmation', async () => {
  const phone = P();
  const rec = await statedSaleThenInbox(phone);
  kill.stopAll({ staffId: 'boss', role: 'OWNER' }, actId('p7stop'), 'pilot: confirm-paid while stopped');
  const staff = await login('hassan', 'hassan-pw-151');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('p7') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'PAID_CONFIRMED');
  assert.equal(cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1).verification, 'paid');
  kill.resumeAll({ staffId: 'boss', role: 'OWNER' }, actId('p7resume'), 'pilot resume', 'RESUME');
  verdict('P7 kill vs paid', 'STOP does not prevent recording paid', r.body.status, 'paid confirm is not an outbound send', 'in-flight HTTP abort');
});

test('P8. foreign tenant cannot confirm another store\'s sale', async () => {
  const phone = P();
  const rec = await statedSaleThenInbox(phone);
  const out = await login('outsider', 'outsider-pw-151');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, out, { product: rec.product, at: rec.at, actionId: actId('p8') });
  assert.equal(r.status, 404);
  assert.equal(cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1).verification, 'customer_statement');
  verdict('P8 tenant', '404 NOT_FOUND, not paid', String(r.status), 'tenant gate still holds', 'sub-tenant ACLs');
});

test('P9. HTML inbox shows the paid-sale action', async () => {
  const phone = P();
  await statedSaleThenInbox(phone);
  const staff = await login('hassan', 'hassan-pw-151');
  const r = await fetch(`${base}/inbox/c/${phone}`, { headers: { Cookie: staff.cookie } });
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /confirm-paid/);
  assert.match(html, /Mark as PAID/);
  verdict('P9 UI', 'conversation page exposes confirm-paid', 'present', 'operator has a real control', 'mobile UX polish');
});

test('U1. Arabic-Indic / Eastern-Arabic / fullwidth / ZWSP 180000 rejected on MODEL_OUTPUT', () => {
  const cases = [
    'Reno 16 Rs. ۱۸۰۰۰۰',
    'Reno 16 Rs. ١٨٠٠٠٠',
    'Reno 16 Rs. １８００００',
    'Reno 16 Rs. 180\u200B000',
  ];
  for (const t of cases) {
    const r = nf.validateMonetaryReply(t, { origin: ORIGIN });
    assert.equal(r.ok, false, `should reject: ${JSON.stringify(t)}`);
    assert.ok((r.rejected || []).some((x) => x.value === 180000 || x.kind), t);
  }
  verdict('U1 unicode digits', 'all four obfuscations rejected', 'asserted', 'unambiguous digit scripts + ZWSP normalize into the existing allow-list', 'sawa lakh as a numeric parse (not parsed; fail-closed separately)');
});

test('U2. Unicode 180000 injected LLM reply never reaches the outbox', async () => {
  const phone = P();
  llmPayload = { reply: 'Reno 16 aapke liye Rs. ۱۸۰۰۰۰ mein fix.', handoff: false, intent: 'price_query' };
  await sendFlow(phone, 'kya scene hai yar');
  const t = toPhone(phone).map(textOf).join('\n');
  assert.ok(!/180000|۱۸۰۰۰۰/.test(t), 'customer never sees the smuggled amount');
  assert.ok(convs.isSuppressed(phone), 'handoff');
  llmPayload = { reply: 'theek hai ji', handoff: false, intent: 'general' };
  verdict('U2 live unicode', 'Persian-Indic 180000 never enqueued', 'asserted', 'brain passes origin=MODEL_OUTPUT into the validator', 'a live OpenAI model');
});

test('U3. word amounts and EU grouping fail-closed on MODEL_OUTPUT only', () => {
  const word = nf.validateMonetaryReply('sawa lakh final', { origin: ORIGIN });
  assert.equal(word.ok, false);
  assert.equal(word.reason, 'UNPARSEABLE_MONETARY_REPRESENTATION');
  const eu = nf.validateMonetaryReply('special 180.000', { origin: ORIGIN });
  assert.equal(eu.ok, false);
  const open = nf.validateMonetaryReply('sawa lakh final');
  assert.equal(open.ok, true, 'without MODEL_OUTPUT origin, opaque residue is not this gate (EMI/catalog must not inherit it)');
  verdict('U3 opaque', 'MODEL_OUTPUT fail-closed; non-origin fail-open', 'asserted', 'unknown monetary shape is unsafe for model copy', 'full multilingual money NLP');
});

test('U4. deterministic EMI 85000 6 is unchanged', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'emi 85000 6');
  assert.match(textOf(r), /85,?000/);
  assert.equal(convs.isSuppressed(phone), false);
  verdict('U4 EMI', 'emi 85000 6 still sends', 'asserted', 'normalization is not on every AI send', 'LIVE EMI disclosure');
});

test('R16. Reno 16 floor is 186800; 16F floor is 138600; 149999 is not the 16 floor', () => {
  const rules = loadRules();
  assert.equal(rules.products.reno16.floor, 186800);
  assert.equal(rules.products.reno16.floor_status, 'RESOLVED');
  assert.equal(rules.products.reno16f.floor, 138600);
  assert.equal(rules.products.reno16f.floor_status, 'RESOLVED');
  const eng = fs.readFileSync(path.join(REPO, 'src/services/negotiation.js'), 'utf8');
  assert.equal(/products\.reno16\.floor\s*=\s*149999/.test(eng), false);
  assert.equal(nf.validateMonetaryReply('Reno 16 Rs. 186,800').ok, true);
  assert.equal(nf.validateMonetaryReply('Reno 16 Rs. 149,999').ok, false);
  assert.equal(nf.validateMonetaryReply('Reno 16F Rs. 149,999').ok, true);
  assert.equal(nf.validateMonetaryReply('Reno 16F Rs. 138,600').ok, true);
  verdict('R16 floors', '186800 / 138600 RESOLVED; 149999 not a 16 floor', 'asserted', 'owner file is still the floor authority', 'LIVE dealer-price honouring');
});

test('T1. no QR/session implementation; D-010 is a decision record', () => {
  const walk = (d, acc = []) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (f === 'node_modules' || f === '.git') continue;
      if (fs.statSync(p).isDirectory()) walk(p, acc);
      else if (/\.(js|mjs|json|md)$/.test(f)) acc.push(p);
    }
    return acc;
  };
  const srcFiles = walk(path.join(REPO, 'src'));
  for (const f of srcFiles) {
    const s = fs.readFileSync(f, 'utf8');
    assert.equal(/baileys|whatsapp-web\.js|wppconnect|makeWASocket/i.test(s), false, f);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(JSON.stringify(pkg.dependencies || {}).includes('baileys'), false);
  const d010 = fs.readFileSync(path.join(REPO, 'D010_TRANSPORT_PREFLIGHT.md'), 'utf8');
  assert.match(d010, /CURRENT TRANSPORT = Meta Cloud API/);
  assert.match(d010, /QR \/ SESSION = NOT IMPLEMENTED/);
  assert.match(d010, /Not an implementation/);
  assert.equal(/from ['"].*D010/.test(fs.readFileSync(path.join(REPO, 'src/index.js'), 'utf8')), false);
  verdict('T1 transport', 'Cloud API current; QR not implemented; D-010 docs-only', 'asserted', 'no new adapter landed in this cycle', 'LIVE Meta onboarding');
});

test('T2. LLM/router cannot call confirmPaidSale', () => {
  for (const rel of ['src/services/brain.js', 'src/flows/router.js', 'src/services/negotiation.js']) {
    const s = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.equal(s.includes('confirmPaidSale'), false, rel);
  }
  verdict('T2 no LLM paid', 'confirmPaidSale only on staff/customers path', 'asserted', 'model cannot invoke paid state', 'a future POS hook (source=pos reserved)');
});

test('ISO1. shipped owner files were not mutated', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
  verdict('ISO1 owner files', 'src/data hashes unchanged', 'asserted', 'tests used copies', 'a crash that skips this assertion');
});

test('teardown', () => {
  mainOutbox.stop();
  server.close();
  llmServer.close();
});
