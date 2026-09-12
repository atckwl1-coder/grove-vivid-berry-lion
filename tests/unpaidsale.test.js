// ═══════════════════════════════════════════════════════════════
//  UNPAID SALE UNIQUENESS — one unpaid row per phone + SKU
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-unpaid-'));
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
process.env.META_APP_SECRET = 'testsecret-unpaid';
process.env.META_VERIFY_TOKEN = 'unpaid';
process.env.OUTBOX_POLL_MS = '15';
delete process.env.WHATSAPP_TOKEN;
delete process.env.PHONE_NUMBER_ID;
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'hassan', password: 'hassan-pw-un', role: 'STAFF', tenant: 'khanewal-demo' },
  { id: 'outsider', password: 'outsider-pw-un', role: 'STAFF', tenant: 'tenant-b' },
]);

const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const cust = await import('../src/services/customers.js');
const kill = await import('../src/sentinel/killswitch.js');
const { buildApp } = await import('../src/app.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');

auditMod.initAudit();
idem.initIdempotency();
kill.initKill();
cust.loadDb();
seedStaffIfMissing();

const delivered = [];
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob-unpaid'),
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
let pSeq = 0;
const P = () => `92300880${String(++pSeq).padStart(4, '0')}`;
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;
const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-unpaid').update(body).digest('hex');
const eventBody = (msg) => JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'U' } }], messages: [msg] } }] }] });
const postWebhook = (raw) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
const toPhone = (phone) => delivered.filter((p) => p.to === phone);
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return false;
};
const sendFlow = async (phone, text) => {
  const before = toPhone(phone).length;
  const res = await postWebhook(eventBody({ from: phone, id: `wamid.unpaid-${++seq}`, type: 'text', text: { body: text } }));
  assert.equal(res.status, 200);
  assert.ok(await waitFor(() => toPhone(phone).length > before), `reply: ${text}`);
};

const unpaidOf = (phone, sku) => cust.unpaidStatedSales().filter((s) => s.phone === phone && s.product === sku);
const salesOf = (phone, sku) => cust.statedSalesFor(phone).filter((s) => s.product === sku);

async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id, password }),
  });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf };
}
async function postStated(creds, { phone, product, csrf } = {}) {
  const r = await fetch(`${base}/inbox/stated-sale?json=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(creds?.cookie ? { Cookie: creds.cookie } : {}),
      ...((csrf ?? creds?.csrf) ? { 'x-csrf': csrf ?? creds.csrf } : {}),
    },
    body: JSON.stringify({ phone, product, actionId: actId('ss') }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('U1. staff unpaid then engine close → one unpaid row; engine still replies', async () => {
  const phone = P();
  const staff = await login('hassan', 'hassan-pw-un');
  const created = await postStated(staff, { phone, product: 'reno16' });
  assert.equal(created.body.status, 'STATED_RECORDED');
  const beforeDelivered = toPhone(phone).length;
  await sendFlow(phone, 'reno16 199000 mein payment karta hoon');
  assert.equal(unpaidOf(phone, 'reno16').length, 1);
  assert.equal(salesOf(phone, 'reno16').length, 1);
  assert.equal(salesOf(phone, 'reno16')[0].verification, 'customer_statement');
  assert.ok(toPhone(phone).length > beforeDelivered, 'engine still sent close');
});

test('U2. engine unpaid then staff duplicate → ALREADY_RECORDED, still one row', async () => {
  const phone = P();
  await sendFlow(phone, 'reno16 199000 mein payment karta hoon');
  assert.equal(unpaidOf(phone, 'reno16').length, 1);
  const staff = await login('hassan', 'hassan-pw-un');
  const dup = await postStated(staff, { phone, product: 'reno16' });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.status, 'ALREADY_RECORDED');
  assert.equal(unpaidOf(phone, 'reno16').length, 1);
});

test('U3. paid previous sale → new unpaid sale of same SKU allowed', async () => {
  const phone = P();
  const staff = await login('hassan', 'hassan-pw-un');
  await postStated(staff, { phone, product: 'reno16' });
  const paid = await fetch(`${base}/inbox/c/${phone}/confirm-paid?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: staff.cookie, 'x-csrf': staff.csrf },
    body: JSON.stringify({ product: 'reno16', actionId: actId('paid') }),
  });
  assert.equal((await paid.json()).status, 'PAID_CONFIRMED');
  assert.equal(unpaidOf(phone, 'reno16').length, 0);
  const again = await postStated(staff, { phone, product: 'reno16' });
  assert.equal(again.body.status, 'STATED_RECORDED');
  assert.equal(unpaidOf(phone, 'reno16').length, 1);
  assert.equal(salesOf(phone, 'reno16').length, 2);
  assert.equal(salesOf(phone, 'reno16').filter((s) => s.verification === 'paid').length, 1);
});

test('U4. different SKU unpaid is allowed', async () => {
  const phone = P();
  const staff = await login('hassan', 'hassan-pw-un');
  assert.equal((await postStated(staff, { phone, product: 'reno16' })).body.status, 'STATED_RECORDED');
  assert.equal((await postStated(staff, { phone, product: 'reno13' })).body.status, 'STATED_RECORDED');
  assert.equal(unpaidOf(phone, 'reno16').length, 1);
  assert.equal(unpaidOf(phone, 'reno13').length, 1);
});

test('U5. foreign tenant cannot write a stated sale (404, no row)', async () => {
  const phone = P();
  const out = await login('outsider', 'outsider-pw-un');
  const r = await postStated(out, { phone, product: 'reno16' });
  assert.equal(r.status, 404);
  assert.equal(cust.statedSalesFor(phone).length, 0);
  const staff = await login('hassan', 'hassan-pw-un');
  assert.equal((await postStated(staff, { phone, product: 'reno16' })).status, 200);
  assert.equal(unpaidOf(phone, 'reno16').length, 1);
});

test('U6. confirmPaidSale still finds the single unpaid row; no second paid blob', async () => {
  const phone = P();
  const staff = await login('hassan', 'hassan-pw-un');
  await postStated(staff, { phone, product: 'reno16' });
  await sendFlow(phone, 'reno16 199000 mein payment karta hoon');
  const rec = cust.confirmPaidSale({ phone, product: 'reno16', staffId: 'hassan' });
  assert.equal(rec.verification, 'paid');
  assert.equal(salesOf(phone, 'reno16').length, 1);
  const again = cust.confirmPaidSale({ phone, product: 'reno16', staffId: 'hassan' });
  assert.equal(again.verification, 'paid');
  assert.equal(salesOf(phone, 'reno16').length, 1);
});

test('ISO1. shipped owner files were not mutated', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});

test('teardown', () => {
  mainOutbox.stop();
  server.close();
});
