// ═══════════════════════════════════════════════════════════════
//  B-2 LIVE TRANSPORT READINESS PREP — FOCUSED VERIFICATION
//  Read-only preflight + operator checklist. No HTTP. No Meta.
//  No QR/Baileys. Does not claim live success. B-2 stays OPEN.
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelv16b2-'));
const REPO = process.cwd();
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP);

delete process.env.WHATSAPP_TOKEN;
delete process.env.PHONE_NUMBER_ID;
delete process.env.META_APP_SECRET;
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');

const { b2Preflight, LIVE_DELIVERY, QR_SESSION, CURRENT_TRANSPORT } = await import('../src/services/b2preflight.js');

const CHECKLIST = path.join(REPO, 'B2_LIVE_SMOKE_CHECKLIST.md');
const PREFLIGHT_SRC = path.join(REPO, 'src/services/b2preflight.js');

const BANNED_TRANSPORT = /baileys|whatsapp-web\.js|wppconnect|makeWASocket/i;
const SECRET_KEYS = ['whatsappToken', 'appSecret', 'openaiKey', 'WHATSAPP_TOKEN', 'META_APP_SECRET', 'OPENAI_API_KEY'];

function byId(report, id) {
  return report.checks.find((c) => c.id === id);
}

test('P1. qr_session is NOT IMPLEMENTED; live_delivery phrase exact; is_live false in default test env', () => {
  const r = b2Preflight();
  assert.equal(r.qr_session, 'NOT IMPLEMENTED');
  assert.equal(r.qr_session, QR_SESSION);
  assert.equal(r.live_delivery, 'IMPLEMENTED BUT UNPROVEN');
  assert.equal(r.live_delivery, LIVE_DELIVERY);
  assert.equal(r.current_transport, 'Meta Cloud API');
  assert.equal(r.current_transport, CURRENT_TRANSPORT);
  assert.equal(r.is_live, false, 'default test env has no Cloud API tokens');
});

test('P2. ten checks; default DEMO statuses; no secret values leaked', () => {
  const r = b2Preflight();
  assert.equal(r.checks.length, 10);
  const ids = r.checks.map((c) => c.id);
  assert.deepEqual(ids, [
    'webhook_signature',
    'idempotency',
    'outbox',
    'number_firewall',
    'kill_switch',
    'cap008_inbox',
    'paid_confirm',
    'catalog_authority',
    'qr_transport',
    'live_credentials',
  ]);
  for (const c of r.checks) {
    assert.equal(['READY', 'BLOCKED', 'UNKNOWN', 'NOT_IMPLEMENTED'].includes(c.status), true, c.id);
    assert.equal(typeof c.title, 'string');
    assert.equal(typeof c.evidence, 'string');
  }
  assert.equal(byId(r, 'webhook_signature').status, 'UNKNOWN', 'DEMO without secret');
  assert.equal(byId(r, 'idempotency').status, 'READY');
  assert.equal(byId(r, 'outbox').status, 'READY');
  assert.equal(byId(r, 'number_firewall').status, 'READY');
  assert.equal(byId(r, 'kill_switch').status, 'READY');
  assert.match(byId(r, 'kill_switch').evidence, /peekState\(\)\.state=/);
  assert.equal(byId(r, 'cap008_inbox').status, 'READY');
  assert.equal(byId(r, 'paid_confirm').status, 'READY');
  assert.equal(byId(r, 'catalog_authority').status, 'READY');
  assert.equal(byId(r, 'qr_transport').status, 'NOT_IMPLEMENTED');
  assert.equal(byId(r, 'live_credentials').status, 'BLOCKED');

  const blob = JSON.stringify(r);
  for (const k of SECRET_KEYS) {
    const v = process.env[k];
    if (v) assert.equal(blob.includes(v), false, `must not dump ${k}`);
  }
  assert.equal(/Bearer\s+\S+/.test(blob), false);
  assert.match(blob, /value masked/);
  assert.equal(blob.includes('DELIVERED'), false, 'preflight must not claim DELIVERED');
});

test('P3. no baileys in b2preflight.js; no Meta HTTP from this module', () => {
  const src = fs.readFileSync(PREFLIGHT_SRC, 'utf8');
  assert.equal(BANNED_TRANSPORT.test(src), false, 'b2preflight.js must not mention QR/session clients');
  assert.equal(/graph\.facebook\.com/.test(src), false);
  assert.equal(/axios\.(get|post|put|delete)/.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/createOutbox\s*\(/.test(src), false, 'must not construct an outbox worker');
  assert.equal(/claimEvent\s*\(/.test(src), false, 'must not fake a live wamid replay');
  assert.equal(/confirmPaidSale\s*\(/.test(src), false, 'must not write a paid sale');
});

test('P4. checklist markdown is operator prep, not live evidence', () => {
  const md = fs.readFileSync(CHECKLIST, 'utf8');
  assert.match(md, /NOT evidence of a live test/);
  assert.match(md, /CURRENT TRANSPORT = Meta Cloud API/);
  assert.match(md, /B-2 remains OPEN/);
  assert.match(md, /DELIVERED is never claimed/);
  assert.match(md, /Inbound webhook HMAC/);
  assert.match(md, /Duplicate wamid/);
  assert.match(md, /SENT vs SUBMITTED/);
  assert.match(md, /Human takeover/);
  assert.match(md, /confirm-paid/);
  assert.match(md, /Kill stop/);
  assert.match(md, /Forged signature/);
  assert.match(md, /Kill during send/);
  assert.match(md, /NOT IMPLEMENTED/);
});

test('P5. this suite is HTTP-free (no listen / no webhook client)', () => {
  const src = fs.readFileSync(path.join(REPO, 'tests/v16b2.test.js'), 'utf8');
  assert.equal(/\blisten\s*\(/.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/buildApp\s*\(/.test(src), false);
  assert.equal(/createServer\s*\(/.test(src), false);
});

test('ISO1. shipped owner files were not mutated', () => {
  b2Preflight();
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
