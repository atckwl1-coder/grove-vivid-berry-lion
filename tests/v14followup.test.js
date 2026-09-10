// ═══════════════════════════════════════════════════════════════
//  V1-4 POST-PURCHASE SATISFACTION FOLLOW-UP — FOCUSED VERIFICATION
//  (2026-09-10, owner directive — the sole authority for this task)
//
//  Contract:
//   • ONE satisfaction follow-up per qualifying purchase, ~Day 10 after the
//     recorded sale (deterministic, restart-persistent)
//   • qualifying sale = negotiation outcome outcome='sale' AND
//     verification='customer_statement' (no payment system — truth)
//   • owner-approved health-check message (no marketing of any kind)
//   • positive reply → natural ack + close · issue reply → existing
//     CAP-008 support path (PRODUCT_EXCEPTION)
//   • no chasing (one follow-up, no reminders), explicit opt-out respected,
//     CAP-055 kill switch mandatory, P2 firewall + durable outbox ONLY
//     (no second transport), existing claimEvent() idempotency, existing
//     customers DB storage, LLM never on the decision path
//
//  Real path: signed webhook → ingest → flows/brain → P2 firewall →
//  outbox spy. LLM = LOCAL capture double (prompt-rule assertions only).
//  Timing is controlled via the sweep's explicit `now` (deterministic).
//  Each test uses a UNIQUE customer phone (clean per-test state).
// ═══════════════════════════════════════════════════════════════
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { spawnSync } from 'child_process';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv14-'));
const REPO = process.cwd();
const PRODUCTS_FILE = path.join(REPO, 'src/data/products.json');

// ── Local LLM capture double (before config import) — exists so "the LLM
//    was available but never used for V1-4 decisions" is a real assertion ──
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
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.META_APP_SECRET = 'testsecret-v14';
process.env.META_VERIFY_TOKEN = 'v14';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_BASE_MS = '20';
process.env.RETRY_MAX = '3';
process.env.RETRY_MAX_MS = '80';
process.env.OPENAI_API_KEY = 'test-key-v14';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${llmServer.address().port}`;
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-55', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-55', role: 'STAFF', tenant: 'khanewal-demo' },
]);
// WHATSAPP_TOKEN empty → DEMO (no Meta network ever)

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

// ── catalog: owner just verified the Reno rows (restored in teardown) ──
const originalCatalog = fs.readFileSync(PRODUCTS_FILE, 'utf8');
{
  const c = JSON.parse(originalCatalog);
  for (const id of ['reno16', 'reno16f']) {
    const p = c.products.find((x) => x.id === id);
    p.observed_at = new Date().toISOString();
  }
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(c, null, 2));
}

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-v14').update(body).digest('hex');
let seq = 0;
const pSeq = { i: 0 };
const P = () => `9230011104${String(++pSeq.i).padStart(2, '0')}`;
const eventBody = (msg) => JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'FU User' } }], messages: [msg] } }] }], });
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
const FU_MSG = /^Assalamualaikum! Aapka .* kaisa chal raha hai/;
const sendFlow = async (phone, text) => {
  const before = toPhone(phone).length;
  const res = await postWebhook(eventBody(textMsg(`wamid.v14-${++seq}`, text, phone)));
  assert.equal(res.status, 200, `webhook accepted: ${text}`);
  assert.ok(await waitFor(() => toPhone(phone).length > before), `reply delivered: ${text}`);
  return toPhone(phone).slice(-1)[0];
};
// A REAL sale the way the existing system truthfully establishes it:
// deterministic negotiation close at the listed price (verification=customer_statement).
const makeSale = async (phone) => {
  await sendFlow(phone, 'reno16 200000 mein hi le raha hoon, payment karta hoon');
  const rec = cust.negotiationOutcomes().filter((x) => x.phone === phone).at(-1);
  assert.equal(rec.outcome, 'sale', 'a real engine-recorded sale exists');
  assert.equal(rec.verification, 'customer_statement', 'honest verification label (no payment system)');
  return rec;
};
const auditAll = () => fs.readFileSync(process.env.AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const auditFind = (type, extra = () => true) => auditAll().filter((e) => e.type === type && extra(e.payload || {}));
const sentJobsFor = (phone) =>
  fs.readdirSync(mainOutbox.dirs.D).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(mainOutbox.dirs.D, f), 'utf8')))
    .filter((j) => j.payload?.to === phone);
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;
async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id, password }) });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf };
}
async function kpost(pathname, creds, payload) {
  const r = await fetch(`${base}${pathname}?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(creds ? { Cookie: creds.cookie, 'x-csrf': creds.csrf } : {}) },
    body: JSON.stringify(payload || {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const staff = await login('boss', 'boss-pw-55');
assert.equal(staff.status, 200);
// The sweep is GLOBAL (one scheduler for all customers) — assertions about a
// given sale's follow-up scope the sweep result to that sale's phone.
const sentFor = (r, phone) => (r.sent || []).filter((id) => String(id).startsWith(`fu-${phone}-`)).length;

function verdict(name, expected, actual, proves, noProve) {
  console.log(`\n── ${name}\n   EXPECTED        : ${expected}\n   ACTUAL          : ${actual}\n   PROVES          : ${proves}\n   DOES NOT PROVE  : ${noProve}`);
}

// Phones that received follow-up-flow customer-facing text (F13/F14 scan set)
const fuPhones = new Set();
const fuFacingText = () =>
  delivered.filter((p) => fuPhones.has(p.to))
    .map(textOf)
    .filter((t) => /^(Assalamualaikum! Aapka|Shukria ji! Bohot acha|👤 Aapka message)/.test(t));

// ═══════════════════════════════════════════════════════════════
test('F1. qualifying customer/stated sale creates EXACTLY ONE follow-up (sweep twice; idempotency marker)', async () => {
  const phone = P();
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  const r1 = await fu.sweepFollowUps(T);            // at sale time — schedules, not due
  const r2 = await fu.sweepFollowUps(T);            // duplicate scheduler invocation
  assert.equal(r1.created.length, 1, 'first sweep creates one follow-up');
  assert.equal(r2.created.length, 0, 'second sweep creates nothing');
  const f = cust.getFollowup(r1.created[0]);
  assert.equal(f.status, 'SCHEDULED');
  assert.equal(cust.listFollowups().filter((x) => x.phone === phone).length, 1, 'exactly one record for this sale');
  const marker = fs.readdirSync(process.env.IDEM_DIR).some((x) => x.startsWith('fu_fu-'));
  assert.ok(marker, 'existing claimEvent() marker exists for the sale record');
  verdict('F1 exactly one follow-up', '1 created on first sweep, 0 on repeat, marker present', `created=${r1.created.length}/${r2.created.length} marker=${marker}`, 'one qualifying sale ⇒ one persistent follow-up; restart/rerun-safe by the EXISTING atomic claim', 'sub-millisecond double sale of the same product by the same customer (webhook idempotency gate handles duplicate events upstream)');
});

test('F2. timing is exactly Day 10: dueAt math deterministic + not due at Day 9, sent at Day 10', async () => {
  const phone = P();
  fuPhones.add(phone);
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T); // schedule
  const f = cust.listFollowups().find((x) => x.phone === phone);
  assert.equal(f.dueAt, new Date(T + 10 * 86400000).toISOString(), 'dueAt = saleAt + 10d exactly (deterministic)');
  const r9 = await fu.sweepFollowUps(T + 9 * 86400000);
  assert.equal(sentFor(r9, phone), 0, 'Day 9: this follow-up not sent');
  assert.equal(cust.getFollowup(f.id).status, 'SCHEDULED', 'still SCHEDULED at Day 9');
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 0, 'no follow-up message before due');
  const r10 = await fu.sweepFollowUps(T + 10 * 86400000);
  assert.equal(sentFor(r10, phone), 1, 'Day 10: this follow-up sent once (no duplicates)');
  await sleep(300);
  const fuMsg = toPhone(phone).filter((p) => FU_MSG.test(textOf(p)));
  assert.equal(fuMsg.length, 1, 'exactly one follow-up message delivered');
  assert.equal(textOf(fuMsg[0]), 'Assalamualaikum! Aapka OPPO Reno 16 kaisa chal raha hai? 😊 Koi issue ya help chahiye ho to humein zaroor batayein.', 'owner-approved message (natural equivalent: product named)');
  verdict('F2 Day-10 timing', 'dueAt=sale+10d exact; Day 9 silent; Day 10 one approved message', `dueAt=${f.dueAt} day9=${r9.sent.length} day10=${r10.sent.length}`, 'deterministic, restart-persistent timing (file-backed dueAt + explicit-now sweep)', 'the 15-min cron granularity in a live process (sweep interval bounds "approximately"; worst case ≤15 min late — not observable in a unit window)');
});

test('F3. non-sale customers receive NOTHING: mere inquiry + abandoned negotiation', async () => {
  const pInq = P();
  const pWalk = P();
  await sendFlow(pInq, 'reno16 price kya hai?');                    // inquiry only — no sale state
  await sendFlow(pWalk, 'reno16 sasta karo');                        // opens a real session
  await sendFlow(pWalk, 'nahi chahiye, baad mein soch ke bataunga'); // walk → no_sale record
  const walkRec = cust.negotiationOutcomes().filter((x) => x.phone === pWalk).at(-1);
  assert.equal(walkRec.outcome, 'no_sale', 'abandoned negotiation is a real no_sale state');
  assert.equal(cust.negotiationOutcomes().some((x) => x.phone === pInq), false, 'inquiry never becomes a sale record');
  const r = await fu.sweepFollowUps(Date.now());
  assert.equal(cust.listFollowups().filter((x) => x.phone === pInq || x.phone === pWalk).length, 0, 'zero follow-ups for non-sale states');
  await fu.sweepFollowUps(Date.now() + 20 * 86400000);
  assert.equal(cust.listFollowups().filter((x) => x.phone === pInq || x.phone === pWalk).length, 0, 'still zero far in the future');
  assert.equal(toPhone(pInq).filter((p) => FU_MSG.test(textOf(p))).length + toPhone(pWalk).filter((p) => FU_MSG.test(textOf(p))).length, 0);
  void r;
  verdict('F3 non-sale exclusion', 'inquiry + abandoned negotiation ⇒ no follow-up, ever', `followups=0 sent=0`, 'the trigger is the REAL recorded sale state — not interest, intent, or an abandoned deal', 'a future verified-payment system (if one is ever added, its records would need their own truthful treatment)');
});

test('F4. restart does not duplicate (fresh process: SENT→nothing; SCHEDULED→exactly one, then old process nothing)', async () => {
  const probe = path.join(TMP, 'v14-restart-probe.mjs');
  fs.writeFileSync(probe, `
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
const REPO = process.cwd();
const im = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const LOG = process.argv[2];
const NOW = Number(process.argv[3]);
const auditMod = await im('src/sentinel/audit.js');
const idem = await im('src/sentinel/idempotency.js');
const { createOutbox } = await im('src/sentinel/outbox.js');
const wa = await im('src/services/whatsapp.js');
const cust = await im('src/services/customers.js');
const kill = await im('src/sentinel/killswitch.js');
const convs = await im('src/sentinel/conversations.js');
const fu = await im('src/services/followups.js');
auditMod.initAudit(); idem.initIdempotency(); cust.loadDb(); kill.initKill();
const outbox = createOutbox({
  dir: ${JSON.stringify(path.join(TMP, 'ob-main'))},
  sendFn: async (p) => { fs.appendFileSync(LOG, JSON.stringify({ to: p.to, text: p.text?.body || '' }) + '\\n'); return { ok: true }; },
  windowGuard: () => ({ ok: true }),
  autonomyGuard: (job) => (kill.isAutonomousJob(job) ? kill.gateForSend(job.payload?.to, { source: job.meta?.source }) : { ok: true }),
  auditFn: auditMod.audit, pollMs: 10,
});
wa.initOutbox(outbox);
wa.setKillGate((to, meta) => kill.gateForSend(to, meta));
wa.setSendGuard(convs.authorizeOutbound);
convs.setEscalationAckSender((to, t) => wa.sendText(to, t, { source: 'AI_SYSTEM_ACK' }));
kill.onKillStop(() => outbox.holdAutonomous(kill.isAutonomousJob));
kill.onKillResume(() => outbox.releaseHeld());
outbox.recover();
outbox.start();
const res = await fu.sweepFollowUps(NOW);
await new Promise((r) => setTimeout(r, 400));
outbox.stop();
console.log('CHILDRESULT ' + JSON.stringify(res));
`);
  const runProbe = (log, now) => {
    const r = spawnSync(process.execPath, [probe, log, String(now)], { encoding: 'utf8', cwd: REPO, timeout: 60000 });
    assert.equal(r.status, 0, 'restart probe exited clean: ' + (r.stderr || ''));
    assert.ok(r.stdout.includes('CHILDRESULT'), 'probe reported a result');
    return JSON.parse(r.stdout.split('CHILDRESULT ')[1]);
  };

  // (a) restart AFTER SENT → fresh process must add nothing for this phone
  const a = P();
  const ra = await makeSale(a);
  const Ta = Date.parse(ra.at);
  await fu.sweepFollowUps(Ta);
  const ra2 = await fu.sweepFollowUps(Ta + 10 * 86400000);
  assert.equal(sentFor(ra2, a), 1, 'parent sent it before the restart');
  await sleep(300);
  const logA = path.join(TMP, 'child-a.jsonl');
  const resA = runProbe(logA, Ta + 10 * 86400000);
  assert.equal(resA.sent.filter((id) => String(id).startsWith(`fu-${a}-`)).length, 0, 'fresh process sends NOTHING for an already-SENT follow-up');
  const childDelivA = fs.existsSync(logA) ? fs.readFileSync(logA, 'utf8').trim().split('\n').filter(Boolean) : [];
  assert.equal(childDelivA.filter((l) => JSON.parse(l).to === a).length, 0, 'no child delivery for phone (a)');
  cust.loadDb(); // re-sync in-memory truth from disk (as a restarted boot would)

  // (b) restart with a DUE-but-unsent (SCHEDULED) follow-up → the fresh
  //     process sends it once; the old process then adds nothing.
  const b = P();
  const rb = await makeSale(b);
  const Tb = Date.parse(rb.at);
  await fu.sweepFollowUps(Tb); // SCHEDULED only (not due) — persisted to the db file
  mainOutbox.stop(); // no concurrent processor during the child run
  let resB;
  try {
    const logB = path.join(TMP, 'child-b.jsonl');
    resB = runProbe(logB, Tb + 10 * 86400000);
    assert.equal(resB.sent.filter((id) => String(id).startsWith(`fu-${b}-`)).length, 1, 'fresh process sends the due follow-up once (no duplicates)');
    const childDelivB = fs.readFileSync(logB, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(childDelivB.filter((l) => l.to === b).length, 1, 'exactly one child delivery');
    assert.ok(FU_MSG.test(childDelivB.find((l) => l.to === b).text), 'child sent the approved message');
  } finally {
    mainOutbox.start();
  }
  cust.loadDb(); // re-sync in-memory truth from disk (as a restarted boot would)
  const rb2 = await fu.sweepFollowUps(Tb + 10 * 86400000); // the OLD process wakes and re-runs the scheduler
  assert.equal(sentFor(rb2, b), 0, 'old process adds NOTHING after the fresh one already sent');
  await sleep(300);
  assert.equal(toPhone(b).filter((p) => FU_MSG.test(textOf(p))).length, 0, 'nothing double-landed in the old process channel');
  verdict('F4 restart safety', 'SENT⇒fresh process sends 0; SCHEDULED-due⇒fresh sends 1, old sends 0', `a: childSent=${resA.sent.filter((id) => String(id).startsWith('fu-' + a)).length} childDeliv=${childDelivA.filter((l) => JSON.parse(l).to === a).length}; b: childSent=${resB.sent.filter((id) => String(id).startsWith('fu-' + b)).length} old=${sentFor(rb2, b)}`, 'file-backed state (customers DB) + atomic claims survive process death — no duplicate, no loss', 'power loss mid outbox-write (the existing §17 honest-recovery semantics apply to the job itself)');
});

test('F5. duplicate scheduler invocation (×5 at due) duplicates NOTHING', async () => {
  const phone = P();
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  let totalSent = 0;
  for (let i = 0; i < 5; i++) {
    const r = await fu.sweepFollowUps(T + 10 * 86400000);
    totalSent += sentFor(r, phone);
  }
  await sleep(300);
  assert.equal(totalSent, 1, 'five due-sweeps ⇒ one send for this follow-up');
  assert.equal(cust.listFollowups().filter((x) => x.phone === phone).length, 1, 'no re-creation from re-derivation');
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 1, 'customer got exactly one');
  verdict('F5 duplicate invocation', '5 sweeps at due ⇒ 1 send, 1 record, 1 message', `sent=${totalSent} records=1`, 'status lifecycle (SCHEDULED→SENT terminal) + the existing claim are both idempotent', 'two simultaneous live processes racing the same Q dir (single-writer assumption of this deployment; outbox claim is atomic per job)');
});

test('F6. explicit opt-out prevents sending (existing CAP-002 path; state never reinterpreted)', async () => {
  const phone = P();
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await sendFlow(phone, 'band karo'); // the EXISTING consent path
  assert.equal(cust.getCustomer(phone).optedOut, true, 'explicit opt-out recorded via the existing consent flow');
  await fu.sweepFollowUps(T); // schedule
  const r = await fu.sweepFollowUps(T + 10 * 86400000);
  assert.equal(sentFor(r, phone), 0, 'due follow-up NOT sent to an opted-out customer');
  const f = cust.listFollowups().find((x) => x.phone === phone);
  assert.equal(f.status, 'SKIPPED_OPTOUT');
  assert.ok(auditFind('FOLLOWUP_SKIPPED_OPTOUT').length >= 1, 'skip audited');
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 0, 'no follow-up message ever');
  await fu.sweepFollowUps(T + 30 * 86400000);
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 0, 'no later sweep revives it');
  verdict('F6 opt-out respected', 'opted-out customer: due follow-up skipped + audited, never sent', `status=${f.status} msgs=0`, 'CAP-002 explicit opt-out is honored on the autonomous care path (no new consent architecture)', 'opt-IN semantics (optedIn remains a marketing flag — deliberately not reinterpreted for customer care)');
});

test('F7. kill switch blocks autonomous follow-up sending; resume drains via the existing path', async () => {
  const phone = P();
  fuPhones.add(phone);
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T); // SCHEDULED
  kill.stopAll({ staffId: 'boss', role: 'OWNER' }, actId('v14-stop'), 'drill: v14 kill-switch gate');
  assert.equal(kill.isStopped(), true);
  const rStop = await fu.sweepFollowUps(T + 10 * 86400000);
  assert.equal(rStop.deferred, true, 'sweep short-circuits dispatch while STOPPED');
  assert.equal(rStop.sent.length, 0, 'nothing sent while stopped');
  const f = cust.listFollowups().find((x) => x.phone === phone);
  assert.equal(f.status, 'SCHEDULED', 'follow-up stays SCHEDULED (not sent, not lost)');
  await sleep(200);
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 0, 'provider untouched while stopped');
  assert.ok(auditFind('FOLLOWUP_SWEEP_DEFERRED').length >= 1, 'deferral audited');
  kill.resumeAll({ staffId: 'boss', role: 'OWNER' }, actId('v14-resume'), 'drill complete', 'RESUME');
  const rResume = await fu.sweepFollowUps(T + 10 * 86400000);
  assert.equal(sentFor(rResume, phone), 1, 'after resume: the deferred follow-up sends once (no duplicates)');
  await sleep(300);
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 1, 'delivered after resume');
  verdict('F7 kill-switch gate', 'STOPPED ⇒ zero external sends (deferred, audited); RESUME ⇒ one send', `stopped=0 resumed=1`, 'CAP-055 semantics: the scheduled follow-up cannot leave while autonomy is stopped; no bypass path exists', 'a STOP landing in the microsecond between the sweep check and the dispatch (covered by the firewall KILL stage + outbox execute gate — the same two walls as every autonomous send)');
});

test('F8. resume/send uses the EXISTING safe outbound path (firewall-decided job on the main outbox)', async () => {
  const phone = P();
  fuPhones.add(phone);
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T);
  await fu.sweepFollowUps(T + 10 * 86400000);
  await sleep(300);
  const jobs = sentJobsFor(phone);
  const job = jobs.find((j) => FU_MSG.test(j.payload?.text?.body || ''));
  assert.ok(job, 'the follow-up rode the MAIN durable outbox (same pipe as every AI send)');
  assert.equal(job.meta.source, 'AI');
  assert.equal(job.meta.actionId, cust.listFollowups().find((x) => x.phone === phone).id, 'actionId provenance = follow-up id');
  assert.equal(job.meta.firewall?.decision, 'ALLOW', 'P2 firewall decision recorded on the job');
  assert.ok(job.meta.firewall?.traceId, 'firewall traceId present');
  assert.equal(job.status, 'SENT');
  verdict('F8 existing outbound path', 'follow-up = ordinary AI job on the main outbox with firewall decision + actionId', `decision=${job.meta.firewall?.decision} actionId=${String(job.meta.actionId).slice(0, 24)}…`, 'no second transport: one send path, one outbox, one provider call', 'LIVE Meta 24h-window semantics (windowGuard re-applies in production; DEMO here — not production evidence)');
});

test('F9. P2 firewall governs follow-ups: ALLOW when clean, AUTHZ-DENY when a human owns the conversation', async () => {
  // (a) clean allow is proven on F8's job (decision ALLOW) — re-assert the count
  const allows = auditFind('FIREWALL_DECISION', (p) => p.decision === 'ALLOW');
  assert.ok(allows.length >= 1, 'ALLOW decisions exist (incl. the follow-up)');
  // (b) human-owned conversation ⇒ the SAME firewall denies the follow-up
  const phone = P();
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T); // schedule
  await sendFlow(phone, 'menu_staff'); // real CAP-008 escalation → QUEUED
  const conv0 = convs.getConversation(phone);
  assert.equal(conv0.state, 'QUEUED');
  const cr = await kpost(`/inbox/c/${phone}/claim`, staff, { actionId: actId('v14-claim') });
  assert.equal(cr.body.status, 'CLAIMED', 'staff claimed the conversation');
  const r = await fu.sweepFollowUps(T + 10 * 86400000);
  assert.equal(sentFor(r, phone), 0, 'follow-up NOT sent to a human-owned conversation');
  const f = cust.listFollowups().find((x) => x.phone === phone);
  assert.equal(f.status, 'SKIPPED_HUMAN');
  assert.equal(f.reason, 'AI_SEND_BLOCKED_HUMAN_ACTIVE', 'the existing CAP-008 rule did the denying');
  assert.ok(auditFind('FIREWALL_DECISION', (p) => p.decision === 'DENY' && p.stage === 'AUTHZ').length >= 1, 'AUTHZ-stage DENY audited');
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 0);
  verdict('F9 firewall governance', 'clean ⇒ ALLOW (F8); human-owned ⇒ AUTHZ DENY, SKIPPED_HUMAN, zero sends', `deny=AUTHZ status=${f.status}`, 'follow-ups are ordinary autonomous actions under the P2 boundary — CAP-008 conversation ownership applies to them too', 'a human-resolved conversation later re-opening the bot (returnToAi) re-qualifying a SKIPPED follow-up (deliberately one-shot: no revival)');
});

test('F10. durable outbox carries the follow-up job to SENT with full metadata (crash-persistent file)', async () => {
  const phone = P();
  fuPhones.add(phone);
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T);
  await fu.sweepFollowUps(T + 10 * 86400000);
  await sleep(300);
  const job = sentJobsFor(phone).find((j) => FU_MSG.test(j.payload?.text?.body || ''));
  assert.ok(job, 'job file exists in the SENT dir (read back from DISK, not memory)');
  assert.equal(job.payload.to, phone);
  assert.equal(job.payload.type, 'text');
  assert.equal(job.meta.source, 'AI');
  assert.ok(job.meta.actionId, 'action metadata present');
  assert.equal(job.meta.firewall.decision, 'ALLOW');
  assert.ok(job.providerResult, 'provider result recorded (success is real, not assumed)');
  assert.equal(job.status, 'SENT');
  verdict('F10 durable outbox', 'job file on disk: payload + source + actionId + firewall decision + providerResult', `job=${job.id.slice(0, 18)}… provider=${job.providerResult}`, 'the send is durable and honestly recorded (existing §16/§17 machinery, unchanged)', 'Meta-side delivery confirmation (providerResult here is the DEMO spy; LIVE would hold the graph response)');
});

test('F11. positive replies close the follow-up naturally (3 canonical phrases → ack + CLOSED, no further sends)', async () => {
  const phrases = ['haan theek hai', 'bilkul theek', 'sab ok'];
  for (const phrase of phrases) {
    const phone = P();
    fuPhones.add(phone);
    const rec = await makeSale(phone);
    const T = Date.parse(rec.at);
    await fu.sweepFollowUps(T);
    await fu.sweepFollowUps(T + 10 * 86400000);
    await sleep(300);
    assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 1, `follow-up out for "${phrase}"`);
    const before = toPhone(phone).length;
    await sendFlow(phone, phrase);
    const newOnes = toPhone(phone).slice(before);
    assert.equal(newOnes.length, 1, `exactly one reply to "${phrase}" (the natural ack)`);
    assert.equal(cust.listFollowups().find((x) => x.phone === phone).status, 'CLOSED', 'follow-up lifecycle closed');
    assert.equal(cust.listFollowups().find((x) => x.phone === phone).outcome, 'no_issue');
    await fu.sweepFollowUps(T + 11 * 86400000); // next day: nothing happens again
    await sleep(200);
    assert.equal(toPhone(phone).length, before + 1, `no further sends after closing ("${phrase}")`);
  }
  verdict('F11 positive close', 'haan theek hai / bilkul theek / sab ok → one warm ack, status CLOSED, silence after', '3/3 closed', 'the health check ends naturally on a no-problem response — one exchange, no chasing', 'voice-note replies (same path after STT; the classifier works on transcribed text — STT itself is CAP-020, not V1-4)');
});

test('F12. issue replies reach the EXISTING support/escalation flow (no diagnosis, no promises)', async () => {
  for (const phrase of ['battery issue', 'phone heat ho raha hai']) {
    const phone = P();
    fuPhones.add(phone);
    const rec = await makeSale(phone);
    const T = Date.parse(rec.at);
    await fu.sweepFollowUps(T);
    await fu.sweepFollowUps(T + 10 * 86400000);
    await sleep(300);
    const before = toPhone(phone).length;
    await sendFlow(phone, phrase);
    await sleep(250);
    const conv = convs.getConversation(phone);
    assert.equal(conv.state, 'QUEUED', `"${phrase}" → conversation in the staff inbox (CAP-008)`);
    assert.equal(conv.reason, 'PRODUCT_EXCEPTION', 'standard controlled escalation reason');
    assert.equal(cust.listFollowups().find((x) => x.phone === phone).status, 'ESCALATED', 'follow-up lifecycle → human ownership');
    const acks = toPhone(phone).slice(before).filter((p) => textOf(p).includes('team tak pahunch'));
    assert.ok(acks.length >= 1, `honest team-ack delivered for "${phrase}"`);
    const newOnes = toPhone(phone).slice(before);
    assert.equal(newOnes.length, 1, 'only the standard ack — no diagnosis, no offer');
  }
  verdict('F12 issue → support path', 'battery issue / heat → CAP-008 escalation (PRODUCT_EXCEPTION) + honest ack + ESCALATED', '2/2 escalated', 'issue detection routes into the EXISTING human-fallback machinery (inbox + SLA + claim), nothing new built', 'hardware diagnosis quality (deliberately not attempted — staff own the diagnosis)');
});

test('F13. no fabricated warranty/replacement/refund promises anywhere in the V1-4 customer-facing text', async () => {
  const all = fuFacingText().join('\n');
  assert.ok(all.length > 0, 'V1-4 customer-facing text exists to inspect');
  const forbidden = /\b(warranty|guarantee|replacement|replace|refund|exchange|cashback|compensation|free\s+service|free\s+phone)\b/i;
  assert.equal(forbidden.test(all), false, 'no warranty/replacement/refund/exchange language');
  assert.equal(/kabhi\s+(wada|promise)/i.test(all), false);
  verdict('F13 no fabricated promises', 'zero warranty/replacement/refund/exchange strings in follow-up + acks', `scanned=${fuFacingText().length} messages`, 'the flow never promises outcomes the business rules do not support', 'what the staff (humans) may say once they own the conversation (their domain, governed by their training)');
});

test('F14. no marketing content is injected (no offers/discounts/scarcity/review/referral)', async () => {
  const all = fuFacingText().join('\n');
  const marketing = /\b(discount|offers?|deals?|special|limited|hurry|promo|refer|referral|review|rating|kharidein|order\s+karein|cashback|gift|combo|bundle|bonus|extra)\b/i;
  assert.equal(marketing.test(all), false, 'no marketing vocabulary in the follow-up flow');
  assert.ok(/kaisa chal raha hai/.test(all), 'the approved health-check wording is what was sent');
  verdict('F14 no marketing', 'follow-up + acks are pure customer care (zero marketing vocabulary)', `scanned=${fuFacingText().length} messages`, 'V1-4 stays a care flow, not a campaign (CAP-032 journeys remain unimplemented by design)', 'the CAP-007 governor (marketing-only control) — correctly not touched, since this is not marketing');
});

test('F15. repeated no-response creates NO uncontrolled recurring sends (Day 10 / 20 / 30 sweeps)', async () => {
  const phone = P();
  fuPhones.add(phone);
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T);
  await fu.sweepFollowUps(T + 10 * 86400000); // the ONE follow-up
  await sleep(300);
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 1);
  await fu.sweepFollowUps(T + 20 * 86400000); // customer never replied — Day 20
  await fu.sweepFollowUps(T + 30 * 86400000); // Day 30
  await fu.sweepFollowUps(T + 60 * 86400000); // Day 60
  await sleep(300);
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 1, 'still exactly one follow-up after weeks of silence');
  assert.equal(cust.listFollowups().filter((x) => x.phone === phone).length, 1, 'no reminder record was ever created');
  assert.equal(cust.listFollowups().find((x) => x.phone === phone).status, 'SENT', 'stays SENT (terminal) — no re-arming');
  verdict('F15 no chasing', 'one follow-up per purchase; silence is respected at Day 20/30/60', '1 message, 1 record, terminal SENT', 'the no-recurrent-spam rule is structural (terminal status), not a rate limit that could be retuned', 'a deliberate owner decision to add a reminder later (not in this contract — nothing pre-built for it)');
});

test('F16. malformed/missing purchase state fails closed (never invents a follow-up; sweep never throws)', async () => {
  const t = Date.now();
  const fakes = [
    { phone: '923009990001', product: 'reno16', outcome: 'sale', final_offer: 200000, verification: 'verified_payment', note: 'fabricated verification label' },
    { phone: 'abc', product: 'reno16', outcome: 'sale', final_offer: 200000, verification: 'customer_statement', note: 'bad phone' },
    { phone: '923009990002', outcome: 'sale', final_offer: 200000, verification: 'customer_statement', note: 'missing product' },
    { phone: '923009990003', product: 'reno16', outcome: 'no_sale', final_offer: 200000, verification: 'customer_statement', note: 'not a sale' },
    { phone: '923009990004', product: 'reno16', outcome: 'sale', final_offer: 200000, verification: 'customer_statement', at: 'not-a-date', note: 'malformed timestamp (injected pre-at) — recordNegotiation stamps a valid at, so this models a corrupt row' },
  ];
  for (const f of fakes) cust.recordNegotiation(f);
  // corrupt row: overwrite the timestamp recordNegotiation stamped (models a
  // corrupted stored row — the live engine path always stamps a valid ISO at)
  const corrupt = cust.negotiationOutcomes().at(-1);
  corrupt.at = 'not-a-date';
  let threw = null;
  let r;
  try {
    r = await fu.sweepFollowUps(t + 10 * 86400000);
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, null, 'sweep runs clean over malformed state');
  assert.ok(r, 'sweep returned a result');
  for (const f of fakes) {
    assert.equal(cust.listFollowups().filter((x) => x.phone === f.phone).length, 0, `no follow-up invented for: ${f.note}`);
  }
  void corrupt;
  verdict('F16 fail-closed on malformed state', 'wrong verification / bad phone / missing product / no_sale / bad date ⇒ zero follow-ups, no crash', `created=${r.created.length} for fake phones`, 'a corrupted or fabricated purchase state can only DISABLE a follow-up — it can never invent one', 'a corrupt customers-DB file wholesale (existing loadDb semantics: fresh start — the follow-up array is simply absent)');
});

test('F17. the LLM is not on the V1-4 decision path (available via double, used for zero V1-4 decisions)', async () => {
  const llmBefore = llmRequests.length;
  const phone = P();
  fuPhones.add(phone);
  const rec = await makeSale(phone);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T);
  await fu.sweepFollowUps(T + 10 * 86400000);      // authorization + timing + send decision
  await sleep(300);
  assert.equal(toPhone(phone).filter((p) => FU_MSG.test(textOf(p))).length, 1);
  await sendFlow(phone, 'bilkul theek');      // close decision
  await sleep(200);
  const p2 = P();
  const rec2 = await makeSale(p2);
  const T2 = Date.parse(rec2.at);
  await fu.sweepFollowUps(T2 + 10 * 86400000);     // (schedules its own + sends this due one)
  await sleep(300);
  await sendFlow(p2, 'camera problem');      // issue classification + escalation decision
  await sleep(200);
  assert.equal(llmRequests.length, llmBefore, 'ZERO LLM calls across schedule/send/close/escalate');
  assert.equal(cust.listFollowups().find((x) => x.phone === phone).status, 'CLOSED');
  assert.equal(cust.listFollowups().find((x) => x.phone === p2).status, 'ESCALATED');
  verdict('F17 LLM exclusion', 'LLM double available; 0 calls for all V1-4 decisions', `llmCalls=${llmRequests.length - llmBefore}`, 'purchase truth, authorization, timing, opt-out, send permission and issue routing are deterministic/system-controlled', 'ordinary conversational replies that DO go to the brain (by design — the LLM may phrase/classify ordinary chat the way it already does)');
});

console.log('\n✅ V1-4 suite loaded');

after(() => {
  fs.writeFileSync(PRODUCTS_FILE, originalCatalog);
  try { mainOutbox.stop?.(); } catch {}
  try { server.close(); server.closeAllConnections?.(); } catch {}
  try { llmServer.close(); } catch {}
});
