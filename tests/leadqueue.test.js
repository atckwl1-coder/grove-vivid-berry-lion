// ═══════════════════════════════════════════════════════════════
//  STAFF LEAD QUEUE WITHOUT A CAP-008 CONVERSATION ROW
//  Read-only. Reuses qualification + nextActionFor(). No send.
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-leadqueue-'));
const REPO = process.cwd();
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP, { nowMs: Date.parse('2026-09-10T12:00:00.000Z') });

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.META_APP_SECRET = 'testsecret-leadqueue';
process.env.META_VERIFY_TOKEN = 'leadqueue';
process.env.OUTBOX_POLL_MS = '15';
delete process.env.WHATSAPP_TOKEN;
delete process.env.PHONE_NUMBER_ID;
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-lq', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-lq', role: 'STAFF', tenant: 'khanewal-demo' },
  { id: 'outsider', password: 'outsider-pw-lq', role: 'STAFF', tenant: 'tenant-b' },
]);

const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const cust = await import('../src/services/customers.js');
const convs = await import('../src/sentinel/conversations.js');
const kill = await import('../src/sentinel/killswitch.js');
const { buildApp } = await import('../src/app.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');
const { refreshQualification, nextActionFor, listQueuedLeads, QUEUE_STAGES } = await import('../src/services/qualification.js');

auditMod.initAudit();
idem.initIdempotency();
kill.initKill();
cust.loadDb();
seedStaffIfMissing();

const delivered = [];
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob-main'),
  sendFn: async (p) => { delivered.push(p); return { ok: true }; },
  windowGuard: () => ({ ok: true }),
  autonomyGuard: () => ({ ok: true }),
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

let seq = 0;
const P = () => `92300918${String(++seq).padStart(4, '0')}`;
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;

async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id, password }),
  });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf, body: j };
}
async function inboxJson(creds) {
  const r = await fetch(`${base}/inbox?json=1`, {
    headers: { Accept: 'application/json', ...(creds?.cookie ? { Cookie: creds.cookie } : {}) },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function seedHighIntent(phone) {
  cust.touchCustomer(phone);
  cust.logMessage(phone, 'in', 'text', 'reno16 200000 mein le raha hoon');
  return refreshQualification(phone);
}
function seedNegotiation(phone) {
  cust.touchCustomer(phone);
  cust.updateCustomer(phone, { stateData: { negotiation: { active: true, offer: 186800, start: 186800 } } });
  return refreshQualification(phone);
}
function seedPurchaseReady(phone) {
  cust.touchCustomer(phone);
  cust.recordNegotiation({ phone, product: 'reno16', outcome: 'sale', verification: 'customer_statement' });
  return refreshQualification(phone);
}

test('L1. high_intent with no conversation is visible to home-tenant staff', async () => {
  const phone = P();
  const q = seedHighIntent(phone);
  assert.equal(q.stage, 'high_intent');
  assert.equal(convs.getConversation(phone, 'khanewal-demo'), null);
  const before = delivered.length;
  const staff = await login('hassan', 'hassan-pw-lq');
  const r = await inboxJson(staff);
  assert.equal(r.status, 200);
  const row = (r.body.leads || []).find((l) => l.phone === phone);
  assert.ok(row, JSON.stringify(r.body.leads));
  assert.equal(row.stage, 'high_intent');
  assert.equal(row.lead_score, 70);
  assert.equal(row.next_action, nextActionFor(q));
  assert.equal(convs.getConversation(phone, 'khanewal-demo'), null);
  assert.equal(delivered.length, before);
});

test('L2. negotiation and purchase_ready appear; browsing does not', async () => {
  const neg = P();
  const ready = P();
  const browse = P();
  const qn = seedNegotiation(neg);
  const qr = seedPurchaseReady(ready);
  cust.touchCustomer(browse);
  refreshQualification(browse);
  assert.equal(qn.stage, 'negotiation');
  assert.equal(qr.stage, 'purchase_ready');
  const staff = await login('hassan', 'hassan-pw-lq');
  const r = await inboxJson(staff);
  const phones = (r.body.leads || []).map((l) => l.phone);
  assert.ok(phones.includes(neg));
  assert.ok(phones.includes(ready));
  assert.equal(phones.includes(browse), false);
  const nRow = r.body.leads.find((l) => l.phone === neg);
  const rRow = r.body.leads.find((l) => l.phone === ready);
  assert.equal(nRow.next_action, nextActionFor(qn));
  assert.equal(rRow.next_action, nextActionFor(qr));
  assert.equal(convs.getConversation(neg, 'khanewal-demo'), null);
  assert.equal(convs.getConversation(ready, 'khanewal-demo'), null);
});

test('L3. HTML inbox shows phone, stage, score, next_action', async () => {
  const phone = P();
  const q = seedHighIntent(phone);
  const staff = await login('hassan', 'hassan-pw-lq');
  const r = await fetch(`${base}/inbox`, { headers: { Cookie: staff.cookie } });
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, new RegExp(phone));
  assert.match(html, /high_intent/);
  assert.match(html, new RegExp(String(q.lead_score)));
  assert.match(html, new RegExp(nextActionFor(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /Does not require a CAP-008 conversation/);
});

test('L4. unauthenticated GET /inbox → 401', async () => {
  const r = await inboxJson({});
  assert.equal(r.status, 401);
});

test('L5. foreign tenant does not see home-tenant leads', async () => {
  const phone = P();
  seedHighIntent(phone);
  const out = await login('outsider', 'outsider-pw-lq');
  const r = await inboxJson(out);
  assert.equal(r.status, 200);
  const phones = (r.body.leads || []).map((l) => l.phone);
  assert.equal(phones.includes(phone), false);
  assert.deepEqual(r.body.leads, []);
});

test('L6. listing does not enqueue WhatsApp or call Graph', async () => {
  const phone = P();
  seedHighIntent(phone);
  const before = delivered.length;
  const staff = await login('hassan', 'hassan-pw-lq');
  await inboxJson(staff);
  assert.equal(delivered.length, before);
  const srcQ = fs.readFileSync(path.join(REPO, 'src/services/qualification.js'), 'utf8');
  const fn = srcQ.slice(srcQ.indexOf('export function listQueuedLeads'), srcQ.indexOf('function pack('));
  assert.equal(/enqueueAsHuman|sendText|graph\.facebook|escalate\(/.test(fn), false);
  const inbox = fs.readFileSync(path.join(REPO, 'src/routes/inbox.js'), 'utf8');
  assert.match(inbox, /listQueuedLeads/);
});

test('L7. confirm-paid still works without a conversation', async () => {
  const phone = P();
  seedPurchaseReady(phone);
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'customer_statement');
  const staff = await login('hassan', 'hassan-pw-lq');
  const r = await fetch(`${base}/inbox/c/${phone}/confirm-paid?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: staff.cookie, 'x-csrf': staff.csrf },
    body: JSON.stringify({ product: 'reno16', actionId: actId('l7') }),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.status, 'PAID_CONFIRMED');
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'paid');
});

test('L8. QUEUE_STAGES is only high_intent / negotiation / purchase_ready', () => {
  assert.deepEqual([...QUEUE_STAGES], ['high_intent', 'negotiation', 'purchase_ready']);
  const phone = P();
  cust.touchCustomer(phone);
  cust.logMessage(phone, 'in', 'text', 'reno16 ki price?');
  refreshQualification(phone);
  assert.equal(listQueuedLeads().some((l) => l.phone === phone), false);
});

test('ISO1. shipped owner files were not mutated', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});

test('teardown', () => {
  mainOutbox.stop();
  server.close();
});
