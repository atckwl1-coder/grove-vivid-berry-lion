// ═══════════════════════════════════════════════════════════════
//  STAFF PAID CONFIRM WITHOUT A CAP-008 CONVERSATION ROW
//  Inbox gate only. confirmPaidSale authority is unchanged.
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-paidnoconv-'));
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
process.env.META_APP_SECRET = 'testsecret-paidnoconv';
process.env.META_VERIFY_TOKEN = 'paidnoconv';
process.env.OUTBOX_POLL_MS = '15';
delete process.env.WHATSAPP_TOKEN;
delete process.env.PHONE_NUMBER_ID;
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-nc', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-nc', role: 'STAFF', tenant: 'khanewal-demo' },
  { id: 'outsider', password: 'outsider-pw-nc', role: 'STAFF', tenant: 'tenant-b' },
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

const delivered = [];
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob-main'),
  sendFn: async (p) => { delivered.push(p); return { ok: true, graph: 'SHOULD_NOT_RUN' }; },
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
mainOutbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

let seq = 0;
const P = () => `92300917${String(++seq).padStart(4, '0')}`;
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;
const auditAll = () => {
  try { return fs.readFileSync(process.env.AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
};
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
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(creds?.cookie ? { Cookie: creds.cookie } : {}),
      ...(creds?.csrf ? { 'x-csrf': creds.csrf } : {}),
    },
    body: JSON.stringify({ actionId: payload.actionId || actId('x'), ...payload }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function statedSale(phone, product = 'reno16') {
  const at = new Date().toISOString();
  cust.recordNegotiation({
    phone, product, outcome: 'sale', verification: 'customer_statement', at,
    note: 'test stated acceptance — not paid',
  });
  return cust.statedSalesFor(phone).at(-1);
}

test('N1. stated unpaid sale + no conversation → PAID_CONFIRMED', async () => {
  const phone = P();
  const rec = statedSale(phone);
  assert.equal(convs.getConversation(phone, 'khanewal-demo'), null);
  const before = delivered.length;
  const staff = await login('hassan', 'hassan-pw-nc');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('n1') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'PAID_CONFIRMED');
  assert.equal(r.body.sale.verification, 'paid');
  assert.equal(r.body.conversation, null);
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'paid');
  assert.ok(auditAll().some((e) => e.type === 'SALE_PAID_CONFIRMED'));
  assert.equal(convs.getConversation(phone, 'khanewal-demo'), null, 'must not create a CAP-008 row');
  assert.equal(delivered.length, before, 'must not enqueue WhatsApp');
});

test('N2. no stated sale → 409 NO_STATED_SALE', async () => {
  const phone = P();
  assert.equal(convs.getConversation(phone, 'khanewal-demo'), null);
  const staff = await login('hassan', 'hassan-pw-nc');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: 'reno16', actionId: actId('n2') });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'NO_STATED_SALE');
  assert.equal(cust.statedSalesFor(phone).length, 0);
});

test('N3. repeat confirmation → ALREADY_CONFIRMED, one follow-up', async () => {
  const phone = P();
  const rec = statedSale(phone);
  const staff = await login('boss', 'boss-pw-nc');
  const a = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('n3a') });
  const b = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('n3b') });
  assert.equal(a.body.status, 'PAID_CONFIRMED');
  assert.equal(b.status, 200);
  assert.equal(b.body.status, 'ALREADY_CONFIRMED');
  const paid = cust.statedSalesFor(phone).filter((x) => x.verification === 'paid');
  assert.equal(paid.length, 1);
  const T = Date.parse(rec.at);
  await fu.sweepFollowUps(T);
  await fu.sweepFollowUps(T + 10 * 86400000);
  assert.equal(cust.listFollowups().filter((x) => x.phone === phone).length, 1);
});

test('N4. unauthenticated → 401, still unpaid', async () => {
  const phone = P();
  statedSale(phone);
  const r = await action(`/inbox/c/${phone}/confirm-paid`, {}, { product: 'reno16', actionId: actId('n4') });
  assert.equal(r.status, 401);
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'customer_statement');
});

test('N5. CSRF mismatch → 403, still unpaid', async () => {
  const phone = P();
  const rec = statedSale(phone);
  const staff = await login('hassan', 'hassan-pw-nc');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, { cookie: staff.cookie, csrf: 'not-the-csrf' }, { product: rec.product, at: rec.at, actionId: actId('n5') });
  assert.equal(r.status, 403);
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'customer_statement');
});

test('N6. foreign tenant → 404, still unpaid', async () => {
  const phone = P();
  const rec = statedSale(phone);
  const out = await login('outsider', 'outsider-pw-nc');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, out, { product: rec.product, at: rec.at, actionId: actId('n6') });
  assert.equal(r.status, 404);
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'customer_statement');
});

test('N7. confirm-paid does not enqueue WhatsApp or call Graph', async () => {
  const phone = P();
  const rec = statedSale(phone);
  const before = delivered.length;
  const staff = await login('hassan', 'hassan-pw-nc');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('n7') });
  assert.equal(r.status, 200);
  assert.equal(delivered.length, before);
  assert.equal(delivered.some((p) => p.graph || p.to === phone), false);
  const src = fs.readFileSync(path.join(REPO, 'src/routes/inbox.js'), 'utf8');
  const start = src.indexOf('async function handleConfirmPaid');
  const end = src.indexOf('inboxRouter.post(\'/inbox/c/:phone/reply\'');
  const fn = src.slice(start, end);
  assert.match(fn, /confirmPaidSale/);
  assert.equal(/enqueueAsHuman|sendText|graph\.facebook/.test(fn), false);
});

test('N8. kill switch does not block paid DB confirmation', async () => {
  const phone = P();
  const rec = statedSale(phone);
  kill.stopAll({ staffId: 'boss', role: 'OWNER' }, actId('n8stop'), 'paidnoconv kill');
  const staff = await login('hassan', 'hassan-pw-nc');
  const r = await action(`/inbox/c/${phone}/confirm-paid`, staff, { product: rec.product, at: rec.at, actionId: actId('n8') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'PAID_CONFIRMED');
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'paid');
  kill.resumeAll({ staffId: 'boss', role: 'OWNER' }, actId('n8resume'), 'paidnoconv resume', 'RESUME');
});

test('N9. LLM/router/qualification/profile/compare/care cannot invoke confirmPaidSale', () => {
  const banned = [
    'src/services/brain.js',
    'src/flows/router.js',
    'src/services/negotiation.js',
    'src/services/qualification.js',
    'src/services/profile.js',
    'src/services/compare.js',
    'src/services/care.js',
  ];
  for (const rel of banned) {
    const s = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.equal(/\bconfirmPaidSale\s*\(/.test(s), false, rel);
  }
});

test('N10. inbox list exposes unpaid stated sale without a conversation', async () => {
  const phone = P();
  statedSale(phone, 'reno16');
  const staff = await login('hassan', 'hassan-pw-nc');
  const r = await fetch(`${base}/inbox`, { headers: { Cookie: staff.cookie } });
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /confirm-paid/);
  assert.match(html, new RegExp(phone));
  assert.match(html, /Does not require a CAP-008 conversation/);
});

test('ISO1. shipped owner files were not mutated', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});

test('teardown', () => {
  mainOutbox.stop();
  server.close();
});
