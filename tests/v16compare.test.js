import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv16cmp-'));
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP, { nowMs: Date.parse('2026-09-10T12:00:00.000Z') });

const { parseCompareQuery, compareProducts, recommendFor } = await import('../src/services/compare.js');
const { composeSetupHelp, isSetupHelpIntent, isCareIssueIntent } = await import('../src/services/care.js');

test('C1. parse reno16 vs reno16f', () => {
  const q = parseCompareQuery('reno16 vs reno16f');
  assert.ok(q);
  assert.match(q.leftQuery, /reno\s*16/i);
  assert.match(q.rightQuery, /reno\s*16f/i);
});

test('C2. compare uses catalog lines; 16F UNRESOLVED; no 186800 floor leak', () => {
  const r = compareProducts('reno16', 'reno16f');
  assert.equal(r.ok, true);
  assert.match(r.text, /Reno 16/);
  assert.match(r.text, /16F/);
  assert.match(r.text, /UNRESOLVED/);
  assert.equal(r.text.includes('186800'), false);
  assert.equal(r.text.includes('186,800'), false);
});

test('C3. unknown product fail-closed', () => {
  const r = compareProducts('reno16', 'not-a-real-phone-xyz');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'PRODUCT_UNKNOWN');
  assert.match(r.text, /staff/i);
});

test('C4. recommend budget 60000 excludes reno16', () => {
  const r = recommendFor({ budget: 60000, text: 'battery' });
  assert.ok(Array.isArray(r.products));
  assert.equal(r.products.some((p) => p.id === 'reno16'), false);
  assert.equal(r.products.some((p) => p.price > 60000), false);
});

test('C5. recommend does not invent ids', () => {
  const r = recommendFor({ budget: 300000, text: 'camera' });
  for (const p of r.products) {
    assert.equal(typeof p.id, 'string');
    assert.ok(p.id.length > 0);
    assert.equal(typeof p.price, 'number');
  }
  assert.ok(r.products.length <= 3);
});

test('C6. setup help is honest', () => {
  assert.equal(isSetupHelpIntent('kaise chalaye phone'), true);
  const t = composeSetupHelp('reno16');
  assert.match(t, /PTA\/OPPO API query nahi/);
  assert.match(t, /ye message scheduled nahi/);
  assert.equal(isCareIssueIntent('battery masla hai'), true);
});

test('ISO1. owner hashes unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
