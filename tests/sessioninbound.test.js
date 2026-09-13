// ═══════════════════════════════════════════════════════════════
//  SESSION INBOUND CATCH-UP + DURABLE IDEMPOTENCY
//  Safeguards only. Transport is NOT activated. No session library.
//  CONNECTED ≠ CAUGHT_UP. append during catch-up is outage mail;
//  append after CAUGHT_UP is history, not a new customer turn.
// ═══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { isolateOwnerFiles, shippedOwnerHashes } from './helpers/isolate-owner-files.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-sess-in-'));
const REPO = process.cwd();
const hashesBefore = shippedOwnerHashes();
isolateOwnerFiles(TMP);

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.KILL_FILE = path.join(TMP, 'kill.json');
process.env.TENANT_ID = 'khanewal-demo';
delete process.env.SESSION_INBOUND_ACTIVATED;

const { initAudit, auditTail } = await import('../src/sentinel/audit.js');
const { initIdempotency, claimEvent } = await import('../src/sentinel/idempotency.js');
const inbound = await import('../src/sentinel/sessionInbound.js');

initAudit();
initIdempotency();

function msg({ id = '3EB0TEST01', from = '923001119999', text = 'ping', fromMe = false, jid, history = false } = {}) {
  const remoteJid = jid || (from + '@s.whatsapp.net');
  const message = history
    ? { protocolMessage: { type: 5, historySyncNotification: { fileLength: 1 } } }
    : { conversation: text };
  return { key: { id, remoteJid, fromMe }, message };
}

async function ingest(event, extra = {}) {
  const delivered = extra.delivered || [];
  const deliver = extra.deliver || (async (normalized) => { delivered.push(normalized); });
  const out = await inbound.ingestSessionUpsert(event, { activated: extra.activated !== false, deliver, ...extra });
  return { ...out, delivered };
}

function openPending() {
  inbound.noteProcessStart();
  inbound.noteConnectionUpdate({ connection: 'open' });
}

function openCaughtUp() {
  openPending();
  inbound.noteConnectionUpdate({ receivedPendingNotifications: true });
}

test('SI0. default is NOT activated; ingest is not a second brain', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const r = await inbound.ingestSessionUpsert(
    { type: 'notify', messages: [msg()] },
    { deliver: async () => { throw new Error('must not deliver'); } },
  );
  assert.equal(r.results[0].reason, 'NOT_ACTIVATED');
  const idx = fs.readFileSync(path.join(REPO, 'src/index.js'), 'utf8');
  assert.equal(idx.includes('makeWASocket'), false);
  assert.match(idx, /handleIncomingMessage/);
  assert.match(idx, /sessionInboundHandlers/);
});

test('SI1. notify while connected+catchup-pending → durable claim + existing deliver shape', async () => {
  inbound.resetSessionInboundState();
  openPending();
  assert.equal(inbound.isCaughtUp(), false, 'CONNECTED is not CAUGHT_UP');
  const { delivered, results } = await ingest({ type: 'notify', messages: [msg({ id: '3EB0N1', text: 'menu' })] });
  assert.equal(results[0].accepted, true);
  assert.equal(results[0].upsertType, 'notify');
  assert.equal(delivered[0].from, '923001119999');
  assert.equal(delivered[0].id, '3EB0N1');
  assert.equal(delivered[0].type, 'text');
  assert.equal(delivered[0].text.body, 'menu');
  assert.equal(claimEvent(inbound.sessionClaimId('3EB0N1')), false, 'already claimed in durable store');
});

test('SI2. append during catch-up is accepted (outage mail, not discarded)', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const { delivered, results } = await ingest({ type: 'append', messages: [msg({ id: '3EB0A1', text: 'hello after outage' })] });
  assert.equal(results[0].accepted, true);
  assert.equal(results[0].upsertType, 'append');
  assert.equal(delivered[0].text.body, 'hello after outage');
});

test('SI3. append after CAUGHT_UP is stale history — not a new customer turn', async () => {
  inbound.resetSessionInboundState();
  openCaughtUp();
  assert.equal(inbound.isCaughtUp(), true);
  const { delivered, results } = await ingest({ type: 'append', messages: [msg({ id: '3EB0OLD', text: 'old chat' })] });
  assert.equal(results[0].accepted, false);
  assert.equal(results[0].reason, 'SKIP_STALE_APPEND');
  assert.equal(delivered.length, 0);
  assert.equal(claimEvent(inbound.sessionClaimId('3EB0OLD')), true, 'stale append is not burned as a customer event');
});

test('SI4. notify after CAUGHT_UP is live inbound', async () => {
  inbound.resetSessionInboundState();
  openCaughtUp();
  const { delivered, results } = await ingest({ type: 'notify', messages: [msg({ id: '3EB0LIVE', text: 'hi' })] });
  assert.equal(results[0].accepted, true);
  assert.equal(delivered[0].id, '3EB0LIVE');
});

test('SI5. mixed notify then append of the SAME id → one deliver, second DUPLICATE', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const delivered = [];
  const a = await ingest({ type: 'notify', messages: [msg({ id: '3EB0MIX', text: 'one' })] }, { delivered });
  const b = await ingest({ type: 'append', messages: [msg({ id: '3EB0MIX', text: 'one' })] }, { delivered });
  assert.equal(a.results[0].accepted, true);
  assert.equal(b.results[0].duplicate, true);
  assert.equal(b.results[0].reason, 'DUPLICATE');
  assert.equal(delivered.length, 1);
  assert.ok(auditTail(50).some((e) => e.type === 'EVENT_DUPLICATE'));
});

test('SI6. append then notify of the SAME id → still one effect', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const delivered = [];
  await ingest({ type: 'append', messages: [msg({ id: '3EB0MIX2', text: 'x' })] }, { delivered });
  const b = await ingest({ type: 'notify', messages: [msg({ id: '3EB0MIX2', text: 'x' })] }, { delivered });
  assert.equal(b.results[0].reason, 'DUPLICATE');
  assert.equal(delivered.length, 1);
});

test('SI7. durable duplicate survives process restart (existing claimEvent store)', () => {
  inbound.resetSessionInboundState();
  const id = inbound.sessionClaimId('3EB0RESTART');
  assert.equal(claimEvent(id), true);
  const r = spawnSync(process.execPath, ['tests/fixtures/idem-claim.js', id], {
    env: { ...process.env, IDEM_DIR: process.env.IDEM_DIR },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, 'child process sees EEXIST duplicate');
});

test('SI8. catch-up gate: socket open does not set CAUGHT_UP until pending notifications flush', () => {
  inbound.resetSessionInboundState();
  inbound.noteProcessStart();
  const a = inbound.noteConnectionUpdate({ connection: 'open' });
  assert.equal(a.socket, 'CONNECTED');
  assert.equal(a.catchup, 'PENDING');
  assert.equal(a.receivedPendingNotifications, false);
  assert.equal(inbound.isCaughtUp(), false);
  const b = inbound.noteConnectionUpdate({ receivedPendingNotifications: true });
  assert.equal(b.catchup, 'CAUGHT_UP');
  assert.equal(inbound.isCaughtUp(), true);
});

test('SI9. reconnect 408/428 → C, catchup PENDING, ingest held until open', async () => {
  inbound.resetSessionInboundState();
  openCaughtUp();
  const c = inbound.noteConnectionUpdate({ connection: 'close', statusCode: 408 });
  assert.equal(c.recovery, 'C');
  assert.equal(c.socket, 'RECONNECTING');
  assert.equal(c.catchup, 'PENDING');
  assert.equal(inbound.isCaughtUp(), false);
  const held = await ingest({ type: 'append', messages: [msg({ id: '3EB0NET', text: 'during outage' })] });
  assert.equal(held.results[0].reason, 'SOCKET_HOLD');
  const marker = path.join(process.env.IDEM_DIR, 'sess_3EB0NET');
  assert.equal(fs.existsSync(marker), false, 'held events are not claimed (so catch-up can take them)');
  inbound.noteConnectionUpdate({ connection: 'open' });
  const after = await ingest({ type: 'append', messages: [msg({ id: '3EB0NET', text: 'during outage' })] });
  assert.equal(after.results[0].accepted, true);
  const r428 = inbound.classifyClose(428);
  assert.equal(r428, 'C');
});

test('SI10. process stop (B) holds ingest; restore catch-up can accept the same id', async () => {
  inbound.resetSessionInboundState();
  openPending();
  inbound.noteProcessStop();
  assert.equal(inbound.getSessionInboundState().recovery, 'B');
  const held = await ingest({ type: 'notify', messages: [msg({ id: '3EB0SHUT', text: 'during shutdown' })] });
  assert.equal(held.results[0].reason, 'SOCKET_HOLD');
  openPending();
  const after = await ingest({ type: 'append', messages: [msg({ id: '3EB0SHUT', text: 'during shutdown' })] });
  assert.equal(after.results[0].accepted, true);
});

test('SI11. crash during catch-up after claim → replay is DUPLICATE (existing CAP-001 semantics)', async () => {
  inbound.resetSessionInboundState();
  openPending();
  let once = 0;
  const deliver = async () => {
    once += 1;
    if (once === 1) throw new Error('crash after claim');
  };
  const a = await ingest({ type: 'append', messages: [msg({ id: '3EB0CRASH', text: 'x' })] }, { deliver });
  assert.equal(a.results[0].reason, 'DELIVER_FAILED');
  assert.equal(a.results[0].claimed, true);
  const b = await ingest({ type: 'append', messages: [msg({ id: '3EB0CRASH', text: 'x' })] }, { deliver });
  assert.equal(b.results[0].reason, 'DUPLICATE');
  assert.equal(once, 1, 'deliver not retried after durable claim — same as Cloud webhook');
});

test('SI12. multiple messages in one outage upsert — each claimed independently', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const { delivered, results } = await ingest({
    type: 'append',
    messages: [
      msg({ id: '3EB0M1', text: 'one' }),
      msg({ id: '3EB0M2', text: 'two' }),
      msg({ id: '3EB0M3', text: 'three' }),
    ],
  });
  assert.equal(results.filter((r) => r.accepted).length, 3);
  assert.equal(delivered.length, 3);
  assert.deepEqual(delivered.map((d) => d.id), ['3EB0M1', '3EB0M2', '3EB0M3']);
});

test('SI13. history protocol append is skipped and cannot become a customer turn later', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const a = await ingest({ type: 'append', messages: [msg({ id: '3EB0HIST', history: true })] });
  assert.equal(a.results[0].reason, 'SKIP_HISTORY');
  const b = await ingest({ type: 'notify', messages: [msg({ id: '3EB0HIST', text: 'spoof' })] });
  assert.equal(b.results[0].reason, 'DUPLICATE');
});

test('SI14. fromMe / groups / missing id never reach deliver', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const delivered = [];
  const a = await ingest({ type: 'notify', messages: [msg({ id: 'ME1', fromMe: true })] }, { delivered });
  const b = await ingest({ type: 'notify', messages: [msg({ id: 'G1', jid: '120@g.us', text: 'g' })] }, { delivered });
  const c = await ingest({ type: 'notify', messages: [{ key: { remoteJid: '923001119999@s.whatsapp.net' }, message: { conversation: 'x' } }] }, { delivered });
  assert.equal(a.results[0].reason, 'SKIP_FROM_ME');
  assert.equal(b.results[0].reason, 'SKIP_NON_CUSTOMER');
  assert.equal(c.results[0].reason, 'SKIP_NO_ID');
  assert.equal(delivered.length, 0);
});

test('SI15. 401 close is D — ingest rejected, no QR implied', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const d = inbound.noteConnectionUpdate({ connection: 'close', statusCode: 401 });
  assert.equal(d.recovery, 'D');
  assert.equal(d.socket, 'AUTH_REQUIRED');
  assert.equal(inbound.recoveryFor('D').retry, 'none without owner re-pair');
  const r = await ingest({ type: 'notify', messages: [msg({ id: '3EB0AUTH' })] });
  assert.equal(r.results[0].reason, 'AUTH_REQUIRED');
  assert.equal(inbound.classifyClose(401), 'D');
});

test('SI16. recovery machines A/B/C/D stay distinct', () => {
  const A = inbound.recoveryFor('A');
  const B = inbound.recoveryFor('B');
  const C = inbound.recoveryFor('C');
  const D = inbound.recoveryFor('D');
  assert.equal(A.name, 'customer_device_offline');
  assert.match(A.automatic_action, /none/);
  assert.equal(B.state, 'STOPPED');
  assert.match(B.retry, /no QR/);
  assert.equal(C.state, 'RECONNECTING');
  assert.match(C.retry, /not logout/);
  assert.equal(D.state, 'AUTH_REQUIRED');
  assert.notEqual(A.state, B.state);
  assert.notEqual(B.state, C.state);
  assert.notEqual(C.state, D.state);
  assert.equal(inbound.recoveryFor('A').outbound.includes('not activated') || inbound.recoveryFor('A').outbound.includes('unchanged'), true);
});

test('SI17. no second business path: deliver is the only processor; no session library strings in src', () => {
  const src = fs.readFileSync(path.join(REPO, 'src/sentinel/sessionInbound.js'), 'utf8');
  assert.match(src, /claimEvent/);
  assert.match(src, /handleIncomingMessage/);
  assert.equal(/baileys|whatsapp-web\.js|wppconnect|makeWASocket/i.test(src), false);
  assert.equal(/writeFileSync|writeFile\(|renameSync/.test(src), false);
  const inboundJs = fs.readFileSync(path.join(REPO, 'src/sentinel/sessionInbound.js'), 'utf8');
  assert.equal(inboundJs.includes('from \'./firewall.js\''), false);
  assert.equal(inboundJs.includes('from \'./outbox.js\''), false);
});

test('SI18. unknown upsert type is not a customer turn', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const { delivered, results } = await ingest({ type: 'prepend', messages: [msg({ id: '3EB0PRE', text: 'x' })] });
  assert.equal(results[0].accepted, false);
  assert.ok(['SKIP_UNKNOWN_TYPE', 'SKIP_STALE_APPEND'].includes(results[0].reason) || results[0].reason === 'SKIP_UNKNOWN_TYPE');
  assert.equal(delivered.length, 0);
});

test('SI19. missing deliver rejects BEFORE claim; replay remains possible', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const r = await inbound.ingestSessionUpsert(
    { type: 'notify', messages: [msg({ id: '3EB0NODLV', text: 'x' })] },
    { activated: true },
  );
  assert.equal(r.results[0].reason, 'NO_DELIVER');
  assert.equal(r.results[0].claimed, false);
  const marker = path.join(process.env.IDEM_DIR, 'sess_3EB0NODLV');
  assert.equal(fs.existsSync(marker), false, 'NO_DELIVER must not poison the durable store');
  const replay = await ingest({ type: 'notify', messages: [msg({ id: '3EB0NODLV', text: 'x' })] });
  assert.equal(replay.results[0].accepted, true, 'same id is still deliverable after NO_DELIVER');
  assert.equal(fs.existsSync(marker), true);
});

test('SI20. append before RPN (catch-up pending) is accepted', async () => {
  inbound.resetSessionInboundState();
  openPending();
  assert.equal(inbound.isCaughtUp(), false);
  const { results } = await ingest({ type: 'append', messages: [msg({ id: '3EB0PRE-RPN', text: 'outage' })] });
  assert.equal(results[0].accepted, true);
  assert.equal(inbound.getSessionInboundState().catchup, 'PENDING');
});

test('SI21. append during RPN transition is not lost; CAUGHT_UP waits for drain', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const delivered = [];
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const slow = ingest(
    { type: 'append', messages: [msg({ id: '3EB0SLOW', text: 'in-flight' })] },
    { delivered, deliver: async (n) => { await blocker; delivered.push(n); } },
  );
  const midState = inbound.noteConnectionUpdate({ receivedPendingNotifications: true });
  assert.equal(midState.catchup, 'DRAINING');
  assert.equal(inbound.isCaughtUp(), false, 'RPN does not confirm CAUGHT_UP while ingest is in-flight');
  const during = ingest({ type: 'append', messages: [msg({ id: '3EB0DRAIN', text: 'during drain' })] }, { delivered });
  release();
  const a = await slow;
  const b = await during;
  await inbound.flushSessionInbound();
  assert.equal(a.results[0].accepted, true);
  assert.equal(b.results[0].accepted, true);
  assert.equal(delivered.map((d) => d.id).sort().join(','), '3EB0DRAIN,3EB0SLOW');
  assert.equal(inbound.isCaughtUp(), true, 'CAUGHT_UP confirmed only after drain');
});

test('SI22. append after confirmed CAUGHT_UP is SKIP_STALE_APPEND, not a silent drop', async () => {
  inbound.resetSessionInboundState();
  openCaughtUp();
  const { delivered, results } = await ingest({ type: 'append', messages: [msg({ id: '3EB0AFTER', text: 'history' })] });
  assert.equal(results[0].accepted, false);
  assert.equal(results[0].reason, 'SKIP_STALE_APPEND');
  assert.equal(delivered.length, 0);
  assert.equal(fs.existsSync(path.join(process.env.IDEM_DIR, 'sess_3EB0AFTER')), false);
});

test('SI23. same event in notify + append is one effect either order', async () => {
  inbound.resetSessionInboundState();
  openPending();
  const d1 = [];
  await ingest({ type: 'notify', messages: [msg({ id: '3EB0NA', text: 'n' })] }, { delivered: d1 });
  const later = await ingest({ type: 'append', messages: [msg({ id: '3EB0NA', text: 'n' })] }, { delivered: d1 });
  assert.equal(d1.length, 1);
  assert.equal(later.results[0].reason, 'DUPLICATE');

  inbound.resetSessionInboundState();
  openPending();
  const d2 = [];
  await ingest({ type: 'append', messages: [msg({ id: '3EB0AN', text: 'a' })] }, { delivered: d2 });
  const later2 = await ingest({ type: 'notify', messages: [msg({ id: '3EB0AN', text: 'a' })] }, { delivered: d2 });
  assert.equal(d2.length, 1);
  assert.equal(later2.results[0].reason, 'DUPLICATE');
});

test('SI24. reconnect then append: held during close, accepted after open pending', async () => {
  inbound.resetSessionInboundState();
  openCaughtUp();
  inbound.noteConnectionUpdate({ connection: 'close', statusCode: 408 });
  const held = await ingest({ type: 'append', messages: [msg({ id: '3EB0RC', text: 'after net' })] });
  assert.equal(held.results[0].reason, 'SOCKET_HOLD');
  inbound.noteConnectionUpdate({ connection: 'open' });
  assert.equal(inbound.isCaughtUp(), false);
  const after = await ingest({ type: 'append', messages: [msg({ id: '3EB0RC', text: 'after net' })] });
  assert.equal(after.results[0].accepted, true);
});

test('SI25. state reset then catch-up: PENDING until RPN, then CAUGHT_UP', async () => {
  inbound.resetSessionInboundState();
  openCaughtUp();
  inbound.resetSessionInboundState();
  assert.equal(inbound.getSessionInboundState().catchup, 'PENDING');
  assert.equal(inbound.isCaughtUp(), false);
  openPending();
  const { results } = await ingest({ type: 'append', messages: [msg({ id: '3EB0RST', text: 'after reset' })] });
  assert.equal(results[0].accepted, true);
  inbound.noteConnectionUpdate({ receivedPendingNotifications: true });
  await inbound.flushSessionInbound();
  assert.equal(inbound.isCaughtUp(), true);
  const stale = await ingest({ type: 'append', messages: [msg({ id: '3EB0RST2', text: 'too late' })] });
  assert.equal(stale.results[0].reason, 'SKIP_STALE_APPEND');
});

test('ISO. shipped owner files unchanged', () => {
  assert.deepEqual(shippedOwnerHashes(), hashesBefore);
});
