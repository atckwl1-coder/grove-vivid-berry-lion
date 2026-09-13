// Focused: owner 2026-09-13 Reno 16 / 16F invoice + last-resort floors.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-reno16p-'));
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP, { nowMs: Date.parse('2026-09-10T12:00:00.000Z') });

const { catalog, findProduct } = await import('../src/services/catalog.js');
const { loadRules, floorAuthority, concessionStep } = await import('../src/services/negotiation.js');
const { compareProducts } = await import('../src/services/compare.js');
const nf = await import('../src/sentinel/numberFirewall.js');

const DEALER_LEAK = /dealer|dealer[- ]price|cost structure|invoice[- ]cost/i;

test('P1. exact invoices and floors from owner files', () => {
  const r16 = findProduct('reno16');
  const r16f = findProduct('reno16f');
  assert.equal(r16.price, 199999);
  assert.equal(r16.verified_price, 199999);
  assert.equal(r16f.price, 149999);
  assert.equal(r16f.verified_price, 149999);
  const rules = loadRules();
  assert.equal(rules.products.reno16.floor, 186800);
  assert.equal(rules.products.reno16.floor_status, 'RESOLVED');
  assert.equal(rules.products.reno16f.floor, 138600);
  assert.equal(rules.products.reno16f.floor_status, 'RESOLVED');
  assert.equal(rules.policy.floor_is_last_resort, true);
  assert.equal(rules.policy.disclose_dealer_terms, false);
  assert.equal(rules.policy.value_before_concession, true);
});

test('P2. above-floor negotiation remains allowed (floor < invoice)', () => {
  const rules = loadRules();
  const a = floorAuthority(rules, 'reno16');
  const b = floorAuthority(rules, 'reno16f');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.ok(a.floor < 199999);
  assert.ok(b.floor < 149999);
  assert.equal(concessionStep(199999, rules), 2000);
  assert.equal(concessionStep(149999, rules), 1500);
});

test('P3. LLM/engine cannot write floors; no floor literals in negotiation.js', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/services/negotiation.js'), 'utf8');
  assert.equal(src.includes('writeFileSync') || src.includes('atomicWriteJson'), false);
  assert.equal(/186800|138600|199999|149999/.test(src), false, 'engine contains no owner price literals');
  const brain = fs.readFileSync(path.join(process.cwd(), 'src/services/brain.js'), 'utf8');
  assert.equal(brain.includes('confirmPaidSale'), false);
});

test('P4. below-floor amounts are not in the allow-set; floors are', () => {
  assert.equal(nf.validateMonetaryReply('Reno 16 Rs. 186,800').ok, true);
  assert.equal(nf.validateMonetaryReply('Reno 16F Rs. 138,600').ok, true);
  assert.equal(nf.validateMonetaryReply('Reno 16 Rs. 180,000').ok, false);
  assert.equal(nf.validateMonetaryReply('Reno 16F Rs. 130,000').ok, false);
});

test('P5. compare and skill lines never leak dealer terms or floor numbers', () => {
  const r = compareProducts('reno16', 'reno16f');
  assert.equal(r.ok, true);
  assert.equal(DEALER_LEAK.test(r.text), false);
  assert.equal(r.text.includes('186,800'), false);
  assert.equal(r.text.includes('138,600'), false);
  const skills = JSON.parse(fs.readFileSync(process.env.SALES_SKILLS_FILE, 'utf8'));
  for (const s of skills.skills) {
    assert.equal(DEALER_LEAK.test(s.line || ''), false, s.skill_id);
  }
});

test('ISO1. shipped owner files were not mutated by this suite', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
  void catalog;
});
