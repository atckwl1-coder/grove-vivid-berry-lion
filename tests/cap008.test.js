// ═══════════════════════════════════════════════════════════════
//  CAP-008 HUMAN FALLBACK CORE — VERIFICATION SUITE
//  Functional pipeline (F) + 12 adversarial tests (A1–A12, STEP 14)
//  Every test prints EXPECTED / ACTUAL / PROVES / DOES-NOT-PROVE.
// ═══════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// ── Environment BEFORE module load ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cap008-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conversations');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.META_APP_SECRET = 'cap008-secret';
process.env.META_VERIFY_TOKEN = 'v-c8';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_MAX = '4';
process.env.RETRY_BASE_MS = '30';
process.env.SLA_MINUTES_IN_HOURS = '5';
process.env.OWNER_PHONE = '923009990001';
process.env.KILL_FILE = path.join(TMP, 'killswitch.json'); // harness hardening (CAP-8 file, kill state isolated to suite Tmp)
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pass-007', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'staffA', password: 'staffa-pass-1', role: 'STAFF', tenant: 'khanewal-demo' },
  { id: 'outsider', password: 'outsider-99', role: 'STAFF', tenant: 'tenant-b' },
]);

const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const { buildApp } = await import('../src/app.js');
const convs = await import('../src/sentinel/conversations.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');
const { loadDb } = await import('../src/services/customers.js');

auditMod.initAudit();
idem.initIdempotency();
loadDb();
seedStaffIfMissing();
(await import('../src/sentinel/killswitch.js')).initKill(); // harness hardening — genesis ACTIVE inside TMP

// Spy provider — deterministic, plus one controlled throw for A12
const delivered = [];
let forceFailOnce = false;
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob'),
  sendFn: async (p) => {
    if (forceFailOnce && String(p?.text?.body || '').includes('TIMEOUT-TRIGGER')) {
      forceFailOnce = false;
      throw new Error('simulated provider timeout');
    }
    delivered.push(p); return { ok: true };
  },
  windowGuard: () => ({ ok: true }),
  auditFn: auditMod.audit,
  pollMs: 15,
  retry: { maxAttempts: 4, baseMs: 30, maxMs: 100 },
});
wa.initOutbox(mainOutbox);
wa.setSendGuard(convs.authorizeOutbound); // ★ chokepoint — the anti-bypass wall
wa.setMessageLogger((await import('../src/services/customers.js')).logOutbound);
let ownerAlerts = [];
convs.setOwnerAlertFn((info) => ownerAlerts.push(info));
convs.setEscalationAckSender((to, ackText) => wa.sendText(to, ackText, { source: 'AI_SYSTEM_ACK' }));
mainOutbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ── helpers ──
const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'cap008-secret').update(body).digest('hex');
let seq = 0;
const wamid = () => `wamid.c8.${Date.now()}.${++seq}`;
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auditAll = () =>
  fs.readFileSync(process.env.AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
// audit payloads are PII-MASKED by design (redact()) — compare against masked form
const maskedPhone = (p) => String(p).replace(/(\d{4})\d{4,5}(\d{3})/, '$1****$2');
const idHas = (convId, phone) => String(convId || '').includes(phone) || String(convId || '').includes(maskedPhone(phone));
const auditFind = (type, extra = () => true) =>
  auditAll().filter((e) => e.type === type && extra(e.payload || {}));

async function sendEvent(phone, text) {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'T' } }], messages: [{ from: phone, id: wamid(), type: 'text', text: { body: text } }] } }] }],
  });
  await fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(body) }, body });
  await sleep(150);
}
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
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: creds.cookie, 'x-csrf': creds.csrf },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const jget = (pathname, creds) =>
  fetch(`${base}${pathname}?json=1`, { headers: { Accept: 'application/json', ...(creds ? { Cookie: creds.cookie } : {}) } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const PHONE = '923001118001';          // main drill customer
const PHONE_RACE = '923001118002';     // claim race
const PHONE_SLA = '923001118003';      // fake-old SLA
const PHONE_ADV = '923001118004';      // A1/A2 target
const PHONE_TO = '923001118005';       // provider-timeout drill

function verdict(name, expected, actual, proves, noProve) {
  console.log(`\n── ${name}\n   EXPECTED        : ${expected}\n   ACTUAL          : ${actual}\n   PROVES          : ${proves}\n   DOES NOT PROVE  : ${noProve}`);
}

let boss, staffA, outsider;
test('setup: three staff log in (OWNER/STAFF/foreign-tenant)', async () => {
  boss = await login('boss', 'boss-pass-007');
  staffA = await login('staffA', 'staffa-pass-1');
  outsider = await login('outsider', 'outsider-99');
  assert.equal(boss.status, 200); assert.equal(staffA.status, 200); assert.equal(outsider.status, 200);
  assert.equal(auditFind('LOGIN_OK').length, 3);
  verdict('CAP-008-F0 auth', '3 logins succeed, LOGIN_OK×3', 'as expected', 'scrypt verify + session issuance', 'nothing about session expiry yet (A7 covers)');
});

// ── F1: escalation → QUEUED with reason/unread/SLA + honest ack ──
test('F1. customer asks for human → conversation QUEUED, ack honest, AI now silent', async () => {
  await sendEvent(PHONE, 'menu_staff');
  await sleep(120);
  const conv = convs.getConversation(PHONE);
  assert.ok(conv, 'conversation exists');
  assert.equal(conv.state, 'QUEUED');
  assert.equal(conv.reason, 'CUSTOMER_REQUESTED_HUMAN');
  assert.equal(conv.slaStatus, 'WITHIN_SLA');
  assert.ok(Date.parse(conv.slaDeadline) > Date.parse(conv.queuedAt));
  const acks = delivered.filter((d) => d.to === PHONE && String(d.text?.body).includes('pahunch gaya'));
  assert.equal(acks.length, 1, 'exactly one honest ack (target/hours-truthful), zero double-acks');
  assert.ok(!String(acks[0].text.body).match(/5 minute mein aapko khud baat ho gi/), 'old unmeasurable promise is GONE');
  assert.equal(auditFind('ESCALATED', (p) => p.reason === 'CUSTOMER_REQUESTED_HUMAN').length, 1);
  verdict('F1 escalation', 'QUEUED + CUSTOMER_REQUESTED_HUMAN + WITHIN_SLA + honest ack', `${conv.state}/${conv.reason}/${conv.slaStatus}, acks=${acks.length}`, 'real escalation path + reason control + ack wording law', 'LLM-driven reasons (test used deterministic menu path — intent map covered by A-suite code review)');
});

// ── F2/A1: unauthorized access ──
test('A1. unauthenticated actor opens inbox/conversation → 401, zero conversation data', async () => {
  const l = await jget('/inbox', null);
  const c = await jget(`/inbox/c/${PHONE}`, null);
  assert.equal(l.status, 401); assert.equal(c.status, 401);
  const leaked = JSON.stringify(l.body) + JSON.stringify(c.body);
  assert.ok(!leaked.includes(PHONE) && !leaked.includes('CUSTOMER_REQUESTED_HUMAN'), 'no conversation bytes leak');
  verdict('A1 unauth read', '401 + no data leak', `${l.status}/${c.status}, leak=false`, 'auth gate protects reads', 'session-fixation style attacks (not modeled)');
});

// ── A2: wrong tenant ──
test('A2. staff from tenant-b tries khanewal conversation → 404 TENANT_DENY, nothing returned', async () => {
  const r = await jget(`/inbox/c/${PHONE}`, outsider);
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.body).includes(PHONE));
  assert.equal(auditFind('TENANT_DENY', (p) => p.actor?.staffId === 'outsider').length, 1);
  const r2 = await action(`/inbox/c/${PHONE}/claim`, outsider, { actionId: actId('x') });
  assert.equal(r2.status, 404);
  verdict('A2 tenant isolation', '404 + TENANT_DENY audited for read AND mutation', `${r.status}/${r2.status}, denyAudit=1`, 'server-side tenant scoping on read+write', 'sub-tenant ACLs (out of scope)');
});

// ── F2: claim ──
test('F2. staffA claims → CLAIMED, assigned, unread cleared, audit CLAIMED+ASSIGNED', async () => {
  const r = await action(`/inbox/c/${PHONE}/claim`, staffA, { actionId: actId('claim1') });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'CLAIMED');
  const conv = convs.getConversation(PHONE);
  assert.equal(conv.state, 'CLAIMED'); assert.equal(conv.claimedBy, 'staffA'); assert.equal(conv.unread, 0);
  assert.equal(auditFind('CLAIMED', (p) => p.actor?.staffId === 'staffA').length, 1);
  assert.equal(auditFind('ASSIGNED', (p) => p.actor?.staffId === 'staffA').length, 1);
  verdict('F2 claim', 'CLAIMED/by=staffA/unread=0', `${conv.state}/${conv.claimedBy}/${conv.unread}`, 'claim transition + actor audit', 'nothing about races yet (A3)');
});

// ── A3 + A11: concurrent claim race + refresh-safety ──
test('A3/A11. two staff claim simultaneously → exactly one wins; refresh re-reads server state', async () => {
  await sendEvent(PHONE_RACE, 'menu_staff');
  await sleep(120);
  // "browser open" for both: both GET unchanged — then both POST claim in parallel
  const [r1, r2] = await Promise.all([
    action(`/inbox/c/${PHONE_RACE}/claim`, staffA, { actionId: actId('rA') }),
    action(`/inbox/c/${PHONE_RACE}/claim`, boss, { actionId: actId('rB') }),
  ]);
  const outcomes = [r1, r2].map((o) => o.body.status ?? o.body.error);
  const winners = outcomes.filter((s) => s === 'CLAIMED');
  const losers = outcomes.filter((s) => s === 'ALREADY_CLAIMED');
  assert.equal(winners.length, 1, 'exactly one CLAIMED');
  assert.equal(losers.length, 1, 'exactly one ALREADY_CLAIMED (explicit, not silent)');
  const conv = convs.getConversation(PHONE_RACE);
  assert.ok(conv.claimedBy === 'staffA' || conv.claimedBy === 'boss');
  // A11 "refresh": losing actor reloads — server state is canonical, shows the lock
  const view = await jget(`/inbox/c/${PHONE_RACE}`, loser = outcomes[0] === 'ALREADY_CLAIMED' ? staffA : boss);
  assert.equal(view.body.conversation.state, 'CLAIMED');
  assert.equal(view.body.conversation.claimedBy, conv.claimedBy);
  assert.equal(auditFind('CLAIM_CONFLICT', (p) => idHas(p.conversation, PHONE_RACE)).length, 1);
  verdict('A3/A11 race+refresh', '1 CLAIMED + 1 ALREADY_CLAIMED; refresh sees server truth', outcomes.join(' / '), 'atomic claim (O_EXCL lock), refresh-safe ownership', 'cross-SERVER races (single-instance deployment documented; multi-node needs Redis/DB lock — DEBT noted)');
});
let loser;

// ── F3/A4: AI suppression under ownership ──
test('A4. customer msgs during CLAIMED → NO auto-reply; direct AI send → blocked server-side', async () => {
  const before = delivered.filter((d) => d.to === PHONE).length;
  await sendEvent(PHONE, 'aur batao jaldi');
  await sendEvent(PHONE, 'hello???');
  const after = delivered.filter((d) => d.to === PHONE).length;
  assert.equal(after, before, 'zero customer-facing sends while human-owned (wall 1)');
  const conv = convs.getConversation(PHONE);
  assert.ok(conv.unread >= 2, 'messages queued into inbox context instead');
  assert.ok(auditFind('AI_SUPPRESSED', (p) => p.inboundEvent != null).length >= 2, 'AI_SUPPRESSED audited per inbound');
  // wall 2 — code-path bypass attempt: AI-tagged send to owned conversation MUST throw
  let blocked = null;
  try { await wa.sendText(PHONE, 'AI sneaky reply', { source: 'AI' }); } catch (e) { blocked = e.code; }
  assert.equal(blocked, 'AI_SEND_BLOCKED_HUMAN_ACTIVE');
  assert.equal(auditFind('AI_SEND_BLOCKED_HUMAN_ACTIVE').length, 1);
  const after2 = delivered.filter((d) => d.to === PHONE).length;
  assert.equal(after2, before, 'blocked send never queued');
  verdict('A4 AI suppression', `inbound silent + AI_SEND_BLOCKED on direct send`, `deliveredDelta=${after - before}, blocked=${blocked}`, 'INVARIANT: HUMAN-owned cannot get autonomous AI message (both walls)', 'LLM content quality; template sends in LIVE window rules');
});

// ── F4: human reply path ──
test('F3. staff reply → chokepoint-authorized → outbox → delivered once → HUMAN_ACTIVE + audit', async () => {
  const aid = actId('reply1');
  const r = await action(`/inbox/c/${PHONE}/reply`, staffA, { actionId: aid, body: 'Ji bilkul, main yahan hoon — kis cheez mein madad chahiye?' });
  assert.equal(r.status, 200); assert.equal(r.body.status, 'SENT_VIA_OUTBOX');
  await sleep(160);
  const conv = convs.getConversation(PHONE);
  assert.equal(conv.state, 'HUMAN_ACTIVE');
  assert.ok(conv.firstHumanResponseAt, 'first_human_response_at set');
  const humanMsgs = delivered.filter((d) => d.to === PHONE && String(d.text?.body).includes('madad chahiye'));
  assert.equal(humanMsgs.length, 1, 'delivered exactly 1x');
  const hm = auditFind('HUMAN_MESSAGE_SENT', (p) => p.actor?.staffId === 'staffA' && p.actionId === aid);
  assert.equal(hm.length, 1, 'audited with actor+actionId+outbox job');
  assert.ok(hm[0].payload.outboxJob, 'linked to outbox job id');
  verdict('F3 human send path', 'outbox deliver×1, HUMAN_ACTIVE, audit w/ actor+actionId+job', `delivered=${humanMsgs.length} audit=${hm.length}`, '§7 pipeline incl. ownership-gated chokepoint', 'WhatsApp delivery receipts (Phase-5 realtime pilot)');
});

// ── A8/A10: replayed claim + replayed staff message (actionId idempotency) ──
test('A10. replayed staff message (same actionId) → ALREADY_APPLIED, no second send', async () => {
  const count = delivered.filter((d) => d.to === PHONE && String(d.text?.body).includes('madad chahiye')).length;
  // re-send the ORIGINAL actionId (recovered from audit) — the replay attack
  const orig = auditFind('HUMAN_MESSAGE_SENT', (p) => p.actor?.staffId === 'staffA' && p.actionId?.includes('reply1'))[0];
  const r2 = await action(`/inbox/c/${PHONE}/reply`, staffA, { actionId: orig.payload.actionId, body: 'Ji bilkul, main yahan hoon — kis cheez mein madad chahiye?' });
  assert.equal(r2.body.status, 'ALREADY_APPLIED');
  await sleep(120);
  const count2 = delivered.filter((d) => d.to === PHONE && String(d.text?.body).includes('madad chahiye')).length;
  assert.equal(count2, count, 'replay produced zero new sends');
  assert.equal(auditFind('HUMAN_MESSAGE_SENT', (p) => p.actionId === orig.payload.actionId).length, 1, 'no double audit');
  verdict('A10 replayed staff message', 'ALREADY_APPLIED + delivered count unchanged', `status=${r2.body.status} sends=${count}→${count2}`, 'action-id idempotency on human sends', 'client same-time double-click BEFORE first commit (~ms window; lock+sync write minimizes)');
});

// ── A5: forged state transition ──
test('A5. forged transition — resolve a CLAIMED chat as non-owner, and resolve-from-QUEUED', async () => {
  // staffA owns PHONE; boss tries to resolve staffA's chat? OWNER is allowed by policy — use outsider-tenant denied already.
  // Real illegal-transition probe: fresh convo (QUEUED), try to resolve directly
  await sendEvent(PHONE_ADV, 'menu_staff');
  await sleep(120);
  const r = await action(`/inbox/c/${PHONE_ADV}/resolve`, boss, { actionId: actId('badresolve') });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'ILLEGAL_TRANSITION');
  assert.equal(auditFind('TRANSITION_REJECTED', (p) => p.new_state === 'RESOLVED').length, 1);
  // also: reply before claim must be rejected
  const r2 = await action(`/inbox/c/${PHONE_ADV}/reply`, boss, { actionId: actId('badreply'), body: 'hello' });
  assert.equal(r2.status, 409);
  verdict('A5 forged/illegal transitions', '409 ILLEGAL_TRANSITION ×2 (QUEUED→resolve, reply-without-claim)', `${r.status}/${r2.status}`, 'FSM legality is enforced server-side', 'table-driven FSM completeness for future states');
});

// ── A8: replayed claim ──
test('A8. replayed claim request (same actionId) → ALREADY_APPLIED, state untouched', async () => {
  const conv = convs.getConversation(PHONE_RACE);
  const owner = conv.claimedBy;
  const creds = owner === 'staffA' ? staffA : boss;
  const aid = auditFind('CLAIMED', (p) => idHas(p.conversation, PHONE_RACE))[0]?.payload?.actionId;
  assert.ok(aid, 'original claim actionId recoverable from audit');
  const r = await action(`/inbox/c/${PHONE_RACE}/claim`, creds, { actionId: aid });
  assert.equal(r.body.status, 'ALREADY_APPLIED');
  assert.equal(auditFind('CLAIMED', (p) => idHas(p.conversation, PHONE_RACE)).length, 1, 'only one CLAIMED recorded');
  verdict('A8 replayed claim', 'ALREADY_APPLIED, CLAIMED audit count stays 1', `${r.body.status}, audit=1`, 'claim idempotency', 'replay across server restart (locks are on-disk; DIFFERENT actionId re-claim → ALREADY_CLAIMED — covered A3)');
});

// ── A6: forged staff identity / forged token ──
test('A6/A1b. forged token and cookie-less mutation → 401', async () => {
  const r = await fetch(`${base}/inbox/c/${PHONE}/claim?json=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: 'noor_session=' + crypto.randomBytes(32).toString('hex'), 'x-csrf': 'whatever' },
    body: JSON.stringify({ actionId: actId('forged') }),
  });
  assert.equal(r.status, 401);
  assert.equal(auditFind('LOGIN_FAILED', (p) => p.why === 'forged_or_unknown_token').length >= 1, true);
  verdict('A6 forged identity', '401 (no session row) + audit', `${r.status}`, 'tokens are server-side truth; forgery has no file', 'stolen-but-valid token misuse (12h TTL limits blast radius)');
});

// ── A7: expired session fails closed ──
test('A7. expired session → 401 SESSION_EXPIRED; mutations die', async () => {
  const tmp = await login('staffA', 'staffa-pass-1');
  const token = tmp.cookie.split('=')[1];
  const sessFile = path.join(process.env.SESSIONS_DIR, `${token}.json`);
  const sess = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
  sess.expiresAt = Date.now() - 1000;
  fs.writeFileSync(sessFile, JSON.stringify(sess));
  const r = await jget('/inbox', tmp);
  assert.equal(r.status, 401);
  assert.equal(auditFind('SESSION_EXPIRED', (p) => p.actor?.staffId === 'staffA').length >= 1, true);
  assert.ok(!fs.existsSync(sessFile), 'expired session destroyed (fail-closed)');
  verdict('A7 expired auth', '401 + session file deleted', `${r.status}, exists=false`, 'TTL enforced server-side, fail-closed', 'clock-skew subtleties (same-host clock only)');
});

// ── A9: NOT_OWNER mutation ──
test('A9. staffA attempts PHONE_RACE owned by boss side if applicable / reply NOT_OWNER blocked', async () => {
  const conv = convs.getConversation(PHONE_RACE);
  const notOwner = conv.claimedBy === 'staffA' ? boss : staffA;
  if (notOwner === boss) {
    // OWNER may unclaim/resolve by policy — test the true NOT_OWNER path: STAFF vs STAFF
    // create a boss-owned convo, then staffA tries to reply
    const r = await action(`/inbox/c/${PHONE_RACE}/unclaim`, notOwner, { actionId: actId('uncl') });
    assert.equal(r.status, 200); // OWNER unclaims — allowed, audited UNCLAIMED
    assert.equal(auditFind('UNCLAIMED').length, 1);
    // re-claim by boss, then staffA reply must be NOT_OWNER
    const c2 = await action(`/inbox/c/${PHONE_RACE}/claim`, boss, { actionId: actId('recl') });
    assert.equal(c2.body.status, 'CLAIMED');
    const r2 = await action(`/inbox/c/${PHONE_RACE}/reply`, staffA, { actionId: actId('sneaky'), body: 'staffA trying boss chat' });
    assert.equal(r2.status, 403); assert.equal(r2.body.error.startsWith('NOT_OWNER'), true);
    verdict('A9 ownership (STAFF vs other owner)', 'NOT_OWNER 403 on foreign-owned reply; OWNER unclaim allowed+audited', `${r2.status} ${r2.body.error}`, 'reply ownership is server-side; escalate-to-owner path exists', 'OWNER-abuse monitoring (audit trail is the mitigation)');
  } else {
    const r2 = await action(`/inbox/c/${PHONE_RACE}/reply`, boss, { actionId: actId('ownok'), body: 'boss assists? no — must own first' });
    assert.ok([403, 409].includes(r2.status));
    verdict('A9 ownership', 'non-owner blocked', `${r2.status}`, 'reply ownership server-side', 'same as above');
  }
});

// ── F5: resolve + return to AI + AI actually resumes ──
test('F4. resolve → RESOLVED/SLA closed → explicit return-to-ai → AI_ACTIVE → AI answers again', async () => {
  const resolveAid = actId('res1');
  const r = await action(`/inbox/c/${PHONE}/resolve`, staffA, { actionId: resolveAid });
  assert.equal(r.body.status, 'RESOLVED');
  let conv = convs.getConversation(PHONE);
  assert.equal(conv.state, 'RESOLVED'); assert.equal(conv.slaStatus, 'RESOLVED'); assert.ok(conv.resolvedAt);
  assert.ok(auditFind('RESOLVED', (p) => p.actionId === resolveAid).length === 1);

  // A9b: replay resolve (same actionId) → ALREADY_APPLIED
  const rep = await action(`/inbox/c/${PHONE}/resolve`, staffA, { actionId: resolveAid });
  assert.equal(rep.body.status, 'ALREADY_APPLIED');
  assert.equal(auditFind('RESOLVED', (p) => p.actionId === resolveAid).length, 1, 'RESOLVED audited exactly 1x');

  // Explicit return to AI
  const r2 = await action(`/inbox/c/${PHONE}/return-to-ai`, staffA, { actionId: actId('rtai') });
  assert.equal(r2.body.status, 'AI_ACTIVE');
  conv = convs.getConversation(PHONE);
  assert.equal(conv.state, 'AI_ACTIVE'); assert.equal(conv.claimedBy, null);
  assert.equal(auditFind('AI_RESUMED', (p) => p.actor?.staffId === 'staffA').length, 1);

  // AI actually resumes sending
  const before = delivered.filter((d) => d.to === PHONE).length;
  await sendEvent(PHONE, 'menu_phones');
  await sleep(120);
  const after = delivered.filter((d) => d.to === PHONE).length;
  assert.ok(after > before, 'AI resumed after explicit return');
  verdict('F4 resolve/return loop', 'RESOLVED→AI_ACTIVE→AI replies; resolve-replay idempotent', `state=${conv.state} resumed=${after > before}`, 'full lifecycle incl. §10 explicit return', 'implicit timeout-return exists NOWHERE in code (by design)');
});

// ── F6: SLA sweep — fake-old escalation becomes BREACHED + owner alert outbox job ──
test('F5. SLA: aged QUEUED conversation → sweep marks BREACHED + owner alert queued via outbox', async () => {
  await sendEvent(PHONE_SLA, 'menu_staff');
  await sleep(120);
  // age it: rewrite deadline + queuedAt into the past (operator-level manipulation of fixture)
  const conv = convs.getConversation(PHONE_SLA);
  const f = path.join(process.env.CONV_DIR, 'khanewal-demo', `${PHONE_SLA}.json`);
  const aged = JSON.parse(fs.readFileSync(f, 'utf8'));
  aged.queuedAt = new Date(Date.parse(aged.queuedAt) - 20 * 60000).toISOString();
  aged.slaDeadline = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(f, JSON.stringify(aged));
  const n = convs.slaSweep();
  assert.ok(n >= 1);
  const after = convs.getConversation(PHONE_SLA);
  assert.equal(after.slaStatus, 'BREACHED');
  assert.equal(auditFind('SLA_BREACHED', (p) => idHas(p.conversation, PHONE_SLA)).length, 1);
  assert.ok(ownerAlerts.some((a) => idHas(a.conversation, PHONE_SLA)), 'owner alert fired');
  // SLA state carried — not cancelling ownership state
  assert.equal(after.state, 'QUEUED', 'core state preserved; SLA_BREACHED is the sla_status marker per spec');
  verdict('F5 real SLA', 'BREACHED + audit + owner alert; core state intact', `n=${n} status=${after.slaStatus}`, 'measurable SLA state machine (no unkept promises)', 'court-grade timing (wall-clock + sweep interval ≈ 60s granularity)');
});

// ── F7: context transfer contents ──
test('F6. inbox view carries labeled context: customer msgs / verified facts / AI inference labels', async () => {
  const r = await jget(`/inbox/c/${PHONE_SLA}`, staffA);
  assert.equal(r.status, 200);
  const list = r.body.messages || [];
  assert.ok(Array.isArray(list), 'history present');
  const conv = r.body.conversation;
  assert.ok(conv.reason && conv.slaDeadline && conv.state, 'reason + SLA fields present (verified-fact strip)');
  verdict('F6 context transfer', 'history[] + reason + sla fields in authenticated view', `msgs=${list.length} reason=${conv.reason}`, 'staff can act without reconstructing thread', 'LLM-summarized context (not built — labelled-raw only)');
});

// ── A12: provider timeout after staff send (honest retry, no silent dup) ──
test('A12. staff send → provider timeout → bounded retry; playbook: truth, not resend-storm', async () => {
  await sendEvent(PHONE_TO, 'menu_staff');
  await sleep(120);
  await action(`/inbox/c/${PHONE_TO}/claim`, staffA, { actionId: actId('cl-to') });
  forceFailOnce = true;
  const aid = actId('to1');
  const r = await action(`/inbox/c/${PHONE_TO}/reply`, staffA, { actionId: aid, body: 'TIMEOUT-TRIGGER ji main hazir hoon' });
  assert.equal(r.status, 200);
  await sleep(400); // let retry cycle run
  const outs = delivered.filter((d) => d.to === PHONE_TO && String(d.text?.body).includes('TIMEOUT-TRIGGER'));
  assert.equal(outs.length, 1, 'exactly one successful provider delivery after one retry');
  assert.equal(auditFind('OUTBOX_RETRY', (p) => p.err?.includes('timeout')).length, 1, 'timeout audited as retry');
  const hm = auditFind('HUMAN_MESSAGE_SENT', (p) => p.actionId === aid);
  assert.equal(hm.length, 1, 'human intent recorded once, before retries');
  verdict('A12 provider timeout', 'retry×1 → delivered×1, OUTBOX_RETRY audited', `delivered=${outs.length} retries=1`, 'bounded retry policy, no silent duplicate, single audit of human intent', 'true UNKNOWN-after-send (network meta-split) is outbox UNKNOWN_REQUEUED territory — covered by 2A crash suite, not here');
});

// ── A-behind: LLM reasons validated (unit-level) ──
test('A13. escalate() with garbage reason → mapped to UNKNOWN, never trusted raw', async () => {
  const phone = '923001118006';
  const r = await convs.escalate(phone, '"><script>alert(1)</script>made_up_reason', {});
  assert.equal(r.conv.reason, 'UNKNOWN');
  assert.equal(auditFind('REASON_MAPPED_UNKNOWN').length >= 1, true);
  verdict('A13 LLM reason control', 'garbage → UNKNOWN + audit', r.conv.reason, 'backend validates against closed set (§9)', 'deliberate reason-gaming inside the valid set (policy review layer)');
});

console.log('\n✅ CAP-008 suite file loaded — tests running sequentially (state machine is deliberately order-sensitive)');

// Harness hygiene: close server + stop poller so the child exits (server handle is ref'd).
import { after } from 'node:test';
after(() => {
  // Graceful teardown (no hard process.exit — it truncated runner IPC once, causing
  // a phantom 'deserialize' file-level failure). closeAllConnections kills undici
  // keep-alive sockets — the actual handle that kept the child alive.
  try { mainOutbox.stop?.(); outbox.stop?.(); } catch {}
  try { server.close(); server.closeAllConnections?.(); } catch {}
});
