// ═══════════════════════════════════════════════════════════════
//  STAFF-RECORDED STATED SALE (catalog SKU, unpaid, not POS)
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-staffsale-'));
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
process.env.META_APP_SECRET = 'testsecret-staffsale';
process.env.META_VERIFY_TOKEN = 'staffsale';
process.env.OUTBOX_POLL_MS = '15';
delete process.env.WHATSAPP_TOKEN;
delete process.env.PHONE_NUMBER_ID;
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-ss', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-ss', role: 'STAFF', tenant: 'khanewal-demo' },
  { id: 'outsider', password: 'outsider-pw-ss', role: 'STAFF', tenant: 'tenant-b' },
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
const { computeQualification } = await import('../src/services/qualification.js');

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
const P = () => `92300919${String(++seq).padStart(4, '0')}`;
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;

async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id, password }),
  });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf, body: j };
}
async function postStated(creds, { phone, product, actionId, csrf } = {}) {
  const r = await fetch(`${base}/inbox/stated-sale?json=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(creds?.cookie ? { Cookie: creds.cookie } : {}),
      ...((csrf ?? creds?.csrf) ? { 'x-csrf': csrf ?? creds.csrf } : {}),
    },
    body: JSON.stringify({ phone, product, actionId: actionId || actId('ss') }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('S1. staff records unpaid catalog stated sale; no conversation; purchase_ready', async () => {
  const phone = P();
  const before = delivered.length;
  const staff = await login('hassan', 'hassan-pw-ss');
  const r = await postStated(staff, { phone, product: 'reno16' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'STATED_RECORDED');
  assert.equal(r.body.sale.verification, 'customer_statement');
  assert.equal(r.body.sale.product, 'reno16');
  assert.equal(r.body.conversation, null);
  const rows = cust.unpaidStatedSales().filter((s) => s.phone === phone);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verification, 'customer_statement');
  assert.equal(computeQualification(phone).stage, 'purchase_ready');
  assert.equal(convs.getConversation(phone, 'khanewal-demo'), null);
  assert.equal(delivered.length, before);
});

test('S2. HTML inbox lists the unpaid sale and record form', async () => {
  const phone = P();
  const staff = await login('hassan', 'hassan-pw-ss');
  await postStated(staff, { phone, product: 'reno16' });
  const r = await fetch(`${base}/inbox`, { headers: { Cookie: staff.cookie } });
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, new RegExp(phone));
  assert.match(html, /action="\/inbox\/stated-sale"/);
  assert.match(html, /Record stated sale \(unpaid\)/);
  assert.match(html, /customer_statement/);
});

test('S3. unknown SKU and invalid phone are rejected; no row written', async () => {
  const staff = await login('hassan', 'hassan-pw-ss');
  const before = cust.negotiationOutcomes().length;
  const badSku = await postStated(staff, { phone: P(), product: 'not-a-sku' });
  assert.equal(badSku.status, 400);
  assert.equal(badSku.body.error, 'UNKNOWN_SKU');
  const badPhone = await postStated(staff, { phone: 'abc', product: 'reno16' });
  assert.equal(badPhone.status, 400);
  assert.equal(badPhone.body.error, 'INVALID_PHONE');
  const empty = await postStated(staff, { phone: '', product: 'reno16' });
  assert.equal(empty.status, 400);
  assert.equal(cust.negotiationOutcomes().length, before);
});

test('S4. duplicate same phone + SKU does not create a second unpaid sale', async () => {
  const phone = P();
  const staff = await login('hassan', 'hassan-pw-ss');
  const a = await postStated(staff, { phone, product: 'reno16' });
  const b = await postStated(staff, { phone, product: 'reno16' });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.body.status, 'ALREADY_RECORDED');
  assert.equal(cust.unpaidStatedSales().filter((s) => s.phone === phone && s.product === 'reno16').length, 1);
});

test('S5. unauthenticated → 401; bad CSRF → 403', async () => {
  const phone = P();
  const noAuth = await postStated({}, { phone, product: 'reno16' });
  assert.equal(noAuth.status, 401);
  const staff = await login('hassan', 'hassan-pw-ss');
  const bad = await postStated(staff, { phone, product: 'reno16', csrf: 'forged' });
  assert.equal(bad.status, 403);
  assert.equal(cust.statedSalesFor(phone).length, 0);
});

test('S6. foreign tenant → 404 and no sale written', async () => {
  const phone = P();
  const out = await login('outsider', 'outsider-pw-ss');
  const r = await postStated(out, { phone, product: 'reno16' });
  assert.equal(r.status, 404);
  assert.equal(cust.statedSalesFor(phone).length, 0);
});

test('S7. confirm-paid still works after staff-recorded stated sale', async () => {
  const phone = P();
  const staff = await login('hassan', 'hassan-pw-ss');
  const created = await postStated(staff, { phone, product: 'reno16' });
  assert.equal(created.body.sale.verification, 'customer_statement');
  const before = delivered.length;
  const r = await fetch(`${base}/inbox/c/${phone}/confirm-paid?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: staff.cookie, 'x-csrf': staff.csrf },
    body: JSON.stringify({ product: 'reno16', actionId: actId('paid') }),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.status, 'PAID_CONFIRMED');
  assert.equal(cust.statedSalesFor(phone).at(-1).verification, 'paid');
  assert.equal(delivered.length, before);
  assert.equal(convs.getConversation(phone, 'khanewal-demo'), null);
});

test('S8. kill switch does not block staff-recorded stated sale; no Graph/LLM writer', async () => {
  const phone = P();
  const boss = await login('boss', 'boss-pw-ss');
  await fetch(`${base}/inbox/kill/stop?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: boss.cookie, 'x-csrf': boss.csrf },
    body: JSON.stringify({ actionId: actId('kill'), reason: 'staffsale-test' }),
  });
  const staff = await login('hassan', 'hassan-pw-ss');
  const r = await postStated(staff, { phone, product: 'reno16' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sale.verification, 'customer_statement');
  await fetch(`${base}/inbox/kill/resume?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: boss.cookie, 'x-csrf': boss.csrf },
    body: JSON.stringify({ actionId: actId('resume'), reason: 'done', confirm: 'RESUME' }),
  });
  const writer = fs.readFileSync(path.join(REPO, 'src/services/customers.js'), 'utf8');
  const fn = writer.slice(writer.indexOf('export function recordStaffStatedSale'), writer.indexOf('export function confirmPaidSale'));
  assert.equal(/enqueueAsHuman|sendText|graph\.facebook|confirmPaidSale\(/.test(fn), false);
  assert.equal(/verification\s*=\s*'paid'/.test(fn), false);
  for (const f of ['src/sentinel/brain.js', 'src/services/negotiation.js', 'src/llm']) {
    const p = path.join(REPO, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.statSync(p).isDirectory()
      ? fs.readdirSync(p).map((n) => fs.readFileSync(path.join(p, n), 'utf8')).join('\n')
      : fs.readFileSync(p, 'utf8');
    assert.equal(src.includes('recordStaffStatedSale'), false, f);
  }
});

test('ISO1. shipped owner files were not mutated', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});

test('teardown', () => {
  mainOutbox.stop();
  server.close();
});
