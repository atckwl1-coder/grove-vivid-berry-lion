// ═══════════════════════════════════════════════════════════════
//  V1-6 DETERMINISTIC QUALIFICATION — FOCUSED VERIFICATION
//  Stage / score / next_action from evidence only. LLM never sets
//  prices, stock, floors, or paid state. No HTTP server.
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv16-'));
const REPO = process.cwd();
const FROZEN_NOW = Date.parse('2026-09-10T12:00:00.000Z');
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP, { nowMs: FROZEN_NOW });

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.TENANT_ID = 'khanewal-demo';

const { initAudit } = await import('../src/sentinel/audit.js');
const cust = await import('../src/services/customers.js');
const {
  computeQualification, refreshQualification, qualificationOf, nextActionFor, STAGE_SCORE,
} = await import('../src/services/qualification.js');

initAudit();
cust.loadDb();

let seq = 0;
const P = () => `92300116${String(++seq).padStart(3, '0')}`;

test('Q1. browsing default for a new customer', () => {
  const phone = P();
  cust.touchCustomer(phone);
  const q = computeQualification(phone);
  assert.equal(q.stage, 'browsing');
  assert.equal(q.lead_score, 10);
  assert.equal(q.confidence, 'low');
  assert.equal(q.paid, false);
  assert.equal(q.human_owned, false);
  assert.equal(q.source, 'deterministic');
  assert.equal(q.next_action, 'Offer menu; do not concede');
  assert.equal(STAGE_SCORE.browsing, 10);
});

test('Q2. product mention → curious', () => {
  const phone = P();
  cust.touchCustomer(phone);
  cust.logMessage(phone, 'in', 'text', 'reno16 dikhao');
  const q = computeQualification(phone);
  assert.equal(q.stage, 'curious');
  assert.equal(q.lead_score, 25);
  assert.ok(q.signals.includes('product_mention'));
  assert.equal(q.next_action, 'Send verified catalog facts; no discount');
});

test('Q3. "reno16 ki price" → price_shopping', () => {
  const phone = P();
  cust.touchCustomer(phone);
  cust.logMessage(phone, 'in', 'text', 'reno16 ki price');
  const q = computeQualification(phone);
  assert.equal(q.stage, 'price_shopping');
  assert.equal(q.lead_score, 40);
  assert.equal(q.confidence, 'medium');
  assert.ok(q.signals.includes('price_language'));
  assert.equal(q.next_action, 'Send verified catalog card / compare path');
});

test('Q4. fake active negotiation → negotiation', () => {
  const phone = P();
  cust.touchCustomer(phone);
  const c = cust.getCustomer(phone);
  cust.updateCustomer(phone, {
    stateData: { ...(c.stateData || {}), negotiation: { active: true, product: 'reno16', offer: 200000 } },
  });
  const q = computeQualification(phone);
  assert.equal(q.stage, 'negotiation');
  assert.equal(q.lead_score, 78);
  assert.equal(q.confidence, 'high');
  assert.equal(q.next_action, 'Continue value-first negotiation; floor is owner-owned');
});

test('Q5. recordNegotiation sale customer_statement → purchase_ready score 90', () => {
  const phone = P();
  cust.touchCustomer(phone);
  cust.recordNegotiation({
    phone, product: 'reno16', outcome: 'sale', verification: 'customer_statement',
    start: 200000, final_offer: 200000,
  });
  const q = computeQualification(phone);
  assert.equal(q.stage, 'purchase_ready');
  assert.equal(q.lead_score, 90);
  assert.equal(q.paid, false);
  assert.equal(q.confidence, 'high');
  assert.equal(q.next_action, 'Confirm paid in inbox after store payment (not a PSP)');
});

test('Q6. confirmPaidSale (TEST only) → existing_customer', () => {
  const phone = P();
  cust.touchCustomer(phone);
  cust.recordNegotiation({
    phone, product: 'reno16', outcome: 'sale', verification: 'customer_statement',
    start: 200000, final_offer: 200000,
  });
  const rec = cust.confirmPaidSale({ phone, product: 'reno16', staffId: 'hassan' });
  assert.equal(rec.verification, 'paid');
  const q = computeQualification(phone);
  assert.equal(q.stage, 'existing_customer');
  assert.equal(q.lead_score, 95);
  assert.equal(q.paid, true);
  assert.equal(q.confidence, 'high');
});

test('Q7. failure: 20x "hi" still browsing, not high_intent', () => {
  const phone = P();
  cust.touchCustomer(phone);
  for (let i = 0; i < 20; i++) cust.logMessage(phone, 'in', 'text', 'hi');
  const q = computeQualification(phone);
  assert.ok(q.stage === 'browsing' || q.stage === 'curious');
  assert.notEqual(q.stage, 'high_intent');
  assert.ok(q.lead_score < 70);
  assert.equal(q.paid, false);
});

test('Q8. stated sale outranks 50x hi', () => {
  const phone = P();
  cust.touchCustomer(phone);
  for (let i = 0; i < 50; i++) cust.logMessage(phone, 'in', 'text', 'hi');
  cust.recordNegotiation({
    phone, product: 'reno16', outcome: 'sale', verification: 'customer_statement',
  });
  const q = computeQualification(phone);
  assert.equal(q.stage, 'purchase_ready');
  assert.equal(q.lead_score, 90);
});

test('Q9. unknown: empty phone / missing customer does not throw', () => {
  assert.doesNotThrow(() => computeQualification(''));
  assert.doesNotThrow(() => computeQualification(null));
  assert.doesNotThrow(() => computeQualification(undefined));
  assert.doesNotThrow(() => computeQualification('999000111222'));
  const q = computeQualification('');
  assert.equal(q.stage, 'browsing');
  assert.equal(q.lead_score, 10);
  assert.equal(q.confidence, 'low');
  assert.equal(q.source, 'deterministic');
  const missing = computeQualification('999000111222');
  assert.equal(missing.stage, 'browsing');
  assert.equal(missing.lead_score, 10);
});

test('Q10. persistence: refresh writes qualification onto the customer', () => {
  const phone = P();
  cust.touchCustomer(phone);
  refreshQualification(phone);
  cust.loadDb();
  const c = cust.getCustomer(phone);
  assert.ok(c.stateData.qualification);
  assert.equal(c.stateData.qualification.stage, 'browsing');
  assert.equal(c.stateData.qualification.source, 'deterministic');
  assert.equal(c.stateData.qualification.lead_score, 10);
  assert.equal(qualificationOf(phone).stage, 'browsing');
});

test('Q11. refresh merges qualification; does not wipe stateData', () => {
  const phone = P();
  cust.touchCustomer(phone);
  const c = cust.getCustomer(phone);
  cust.updateCustomer(phone, {
    stateData: { ...(c.stateData || {}), keep: true, negotiation: { active: true, product: 'reno16' } },
  });
  refreshQualification(phone);
  const after = cust.getCustomer(phone);
  assert.equal(after.stateData.keep, true);
  assert.equal(after.stateData.negotiation.active, true);
  assert.equal(after.stateData.qualification.stage, 'negotiation');
  assert.equal(after.stateData.qualification.lead_score, 78);
});

test('Q12. human_owned is a flag, not a stage', () => {
  const phone = P();
  cust.touchCustomer(phone);
  cust.updateCustomer(phone, { state: 'HUMAN' });
  cust.logMessage(phone, 'in', 'text', 'reno16 dikhao');
  const q = computeQualification(phone);
  assert.equal(q.human_owned, true);
  assert.equal(q.stage, 'curious');
  assert.equal(q.next_action, 'Staff must reply — AI is silenced');
  assert.equal(nextActionFor(q), 'Staff must reply — AI is silenced');
});

test('Q13. paid + issue → post_purchase_support; paid healthy → existing_customer', () => {
  const phone = P();
  cust.touchCustomer(phone);
  cust.recordNegotiation({
    phone, product: 'reno16', outcome: 'sale', verification: 'customer_statement',
  });
  cust.confirmPaidSale({ phone, product: 'reno16', staffId: 'hassan' });
  const healthy = computeQualification(phone);
  assert.equal(healthy.stage, 'existing_customer');
  assert.equal(healthy.lead_score, 95);
  cust.logMessage(phone, 'in', 'text', 'battery masla hai phone kharab');
  const care = computeQualification(phone);
  assert.equal(care.stage, 'post_purchase_support');
  assert.equal(care.lead_score, 60);
  assert.equal(care.paid, true);
});

test('Q14. product + budget + ready language → high_intent; module never confirms paid', () => {
  const phone = P();
  cust.touchCustomer(phone);
  cust.logMessage(phone, 'in', 'text', 'reno16 200000 mein le raha hoon');
  const q = computeQualification(phone);
  assert.equal(q.stage, 'high_intent');
  assert.equal(q.lead_score, 70);
  const src = fs.readFileSync(path.join(REPO, 'src/services/qualification.js'), 'utf8');
  assert.equal(/\bconfirmPaidSale\s*\(/.test(src), false);
  assert.equal(/from ['"].*whatsapp/.test(src), false);
  assert.equal(/\bsendText\s*\(/.test(src), false);
  assert.ok(!/\bRs\.|\b186800\b|\b150000\b/.test(q.next_action));
});

test('ISO1. shipped owner files were not mutated', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
