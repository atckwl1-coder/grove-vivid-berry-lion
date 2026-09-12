import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv16ops-'));
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP, { nowMs: Date.parse('2026-09-10T12:00:00.000Z') });

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.TENANT_ID = 'khanewal-demo';
delete process.env.WHATSAPP_TOKEN;
delete process.env.PHONE_NUMBER_ID;

const { initAudit } = await import('../src/sentinel/audit.js');
const { initKill } = await import('../src/sentinel/killswitch.js');
const cust = await import('../src/services/customers.js');
const { ownerSnapshot } = await import('../src/services/ops.js');
const { opsPage } = await import('../src/inbox/opsViews.js');

initAudit();
initKill();
cust.loadDb();

test('O1. empty db: zeros, DEMO, completeness OK or PARTIAL honestly', () => {
  const snap = ownerSnapshot({ tenant: 'khanewal-demo', now: new Date('2026-09-12T00:00:00Z') });
  assert.equal(snap.transport.current, 'Meta Cloud API');
  assert.equal(snap.transport.qr, 'NOT IMPLEMENTED');
  assert.equal(snap.transport.mode, 'DEMO');
  assert.equal(snap.transport.live_delivery, 'IMPLEMENTED BUT UNPROVEN');
  assert.equal(snap.customers_total, 0);
  assert.equal(snap.paid_sales, 0);
  assert.equal(snap.conversations_today, 0);
});

test('O2. paid sale + inbound today counted', () => {
  const phone = '923001160099';
  cust.touchCustomer(phone);
  cust.logMessage(phone, 'in', 'text', 'reno16');
  cust.recordNegotiation({ phone, product: 'reno16', outcome: 'sale', verification: 'customer_statement' });
  cust.confirmPaidSale({ phone, product: 'reno16', staffId: 'boss' });
  const snap = ownerSnapshot({ tenant: 'khanewal-demo', now: new Date() });
  assert.ok(snap.paid_sales >= 1);
  assert.ok(snap.conversations_today >= 1);
});

test('O3. unreadable audit → monetary_rejects null + PARTIAL', () => {
  try { fs.rmSync(process.env.AUDIT_FILE, { force: true }); } catch {}
  fs.mkdirSync(process.env.AUDIT_FILE);
  const snap = ownerSnapshot({ tenant: 'khanewal-demo' });
  assert.equal(snap.monetary_rejects, null);
  assert.equal(snap.completeness, 'PARTIAL');
  fs.rmSync(process.env.AUDIT_FILE, { recursive: true, force: true });
  fs.writeFileSync(process.env.AUDIT_FILE, '');
});

test('O4. opsPage contains honesty labels', () => {
  const html = opsPage({ staffId: 'boss', role: 'OWNER', tenant: 'khanewal-demo' }, ownerSnapshot({}));
  assert.match(html, /IMPLEMENTED BUT UNPROVEN/);
  assert.match(html, /NOT IMPLEMENTED/);
  assert.equal(/baileys|whatsapp-web\.js|wppconnect|makeWASocket/i.test(html), false);
});

test('ISO1. owner hashes unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
