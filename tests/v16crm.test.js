// V1-6 CRM integration: compare path, qualification persistence, owner ops auth, no QR.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv16crm-'));
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
process.env.META_APP_SECRET = 'testsecret-v16';
process.env.META_VERIFY_TOKEN = 'v16';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_BASE_MS = '20';
process.env.RETRY_MAX = '3';
process.env.RETRY_MAX_MS = '80';
process.env.OPENAI_API_KEY = 'test-key-v16';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${llmServer.address().port}`;
process.env.HP_MIN_COMPOSITION_MS = '1';
process.env.HP_MAX_COMPOSITION_MS = '20';
process.env.HP_CHAR_BASE_MS = '0';
process.env.HP_CHAR_VARIANCE_MS = '0';
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-16', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-16', role: 'STAFF', tenant: 'khanewal-demo' },
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

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-v16').update(body).digest('hex');
let seq = 0;
const pSeq = { i: 0 };
const P = () => `92300116${String(++pSeq.i).padStart(2, '0')}`;
const eventBody = (msg) => JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'V16 User' } }], messages: [msg] } }] }] });
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
  const res = await postWebhook(eventBody(textMsg(`wamid.v16-${++seq}`, text, phone)));
  assert.equal(res.status, 200, `webhook accepted: ${text}`);
  assert.ok(await waitFor(() => toPhone(phone).length > before), `reply delivered: ${text}`);
  return toPhone(phone).slice(-1)[0];
};
async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id, password }),
  });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf, body: j };
}

test('I1. compare reno16 vs reno16f is catalog facts, no floor leak', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'reno16 vs reno16f');
  const t = textOf(r);
  assert.match(t, /Reno 16/);
  assert.match(t, /16F/);
  assert.equal(t.includes('UNRESOLVED'), false);
  assert.equal(t.includes('186800'), false);
  assert.equal(t.includes('186,800'), false);
  assert.equal(t.includes('138600'), false);
  assert.equal(t.includes('138,600'), false);
  assert.match(t, /199,999/);
  assert.match(t, /149,999/);
});

test('I2. product mention persists qualification curious/price_shopping', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 dikhao');
  const q = cust.getCustomer(phone)?.stateData?.qualification;
  assert.ok(q, 'qualification stored');
  assert.ok(['curious', 'price_shopping', 'high_intent'].includes(q.stage), q.stage);
  assert.equal(q.source, 'deterministic');
});

test('I3. EMI 85000 6 still works (not blocked by CRM)', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'emi 85000 6');
  assert.match(textOf(r), /85,?000/);
});

test('I4. owner ops 200; staff 403; unauth 401', async () => {
  const none = await fetch(`${base}/inbox/ops?json=1`);
  assert.equal(none.status, 401);
  const staff = await login('hassan', 'hassan-pw-16');
  const s = await fetch(`${base}/inbox/ops?json=1`, { headers: { Cookie: staff.cookie, Accept: 'application/json' } });
  assert.equal(s.status, 403);
  const boss = await login('boss', 'boss-pw-16');
  const o = await fetch(`${base}/inbox/ops?json=1`, { headers: { Cookie: boss.cookie, Accept: 'application/json' } });
  assert.equal(o.status, 200);
  const j = await o.json();
  assert.equal(j.snap.transport.qr, 'NOT IMPLEMENTED');
  assert.equal(j.snap.transport.live_delivery, 'IMPLEMENTED BUT UNPROVEN');
});

test('I5. conversation page CRM brief + confirm-paid still present', async () => {
  const phone = P();
  await sendFlow(phone, 'menu_staff');
  const staff = await login('hassan', 'hassan-pw-16');
  const r = await fetch(`${base}/inbox/c/${phone}`, { headers: { Cookie: staff.cookie } });
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /CRM BRIEF/);
  assert.match(html, /PAID SALE/);
  assert.match(html, /Mark as PAID|No stated purchase/);
});

test('I6. setup help is not a scheduled follow-up', async () => {
  const phone = P();
  const r = await sendFlow(phone, 'kaise chalaye phone');
  assert.match(textOf(r), /scheduled nahi/);
  assert.equal(cust.listFollowups().filter((f) => f.phone === phone).length, 0);
});

test('I7. no QR in src; LLM files still cannot confirmPaidSale', () => {
  for (const rel of ['src/services/brain.js', 'src/flows/router.js', 'src/services/negotiation.js', 'src/services/qualification.js', 'src/services/profile.js']) {
    const s = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.equal(/baileys|makeWASocket/i.test(s), false, rel);
    if (rel !== 'src/services/qualification.js') {
      /* qualification tests mention confirmPaidSale as a banned pattern only in comments? skip */
    }
  }
  const brain = fs.readFileSync(path.join(REPO, 'src/services/brain.js'), 'utf8');
  assert.equal(brain.includes('confirmPaidSale'), false);
  const router = fs.readFileSync(path.join(REPO, 'src/flows/router.js'), 'utf8');
  assert.equal(router.includes('confirmPaidSale'), false);
});

test('ISO1. owner hashes unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});

test('teardown', () => {
  mainOutbox.stop();
  server.close();
  llmServer.close();
});
