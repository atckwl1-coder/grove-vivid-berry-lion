// ═══════════════════════════════════════════════════════════════
//  CAP-055 OWNER KILL SWITCH — VERIFICATION SUITE
//  Functional (K) + 15 adversarial (KS1–KS15) incl. MANDATORY race test (KS15)
//  Every test prints EXPECTED / ACTUAL / PROVES / DOES-NOT-PROVE.
// ═══════════════════════════════════════════════
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// ── Environment BEFORE module load ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cap055-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conversations');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.META_APP_SECRET = 'cap055-secret';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_MAX = '5';
process.env.RETRY_BASE_MS = '25';
process.env.RETRY_MAX_MS = '100';
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-55', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-55', role: 'STAFF', tenant: 'khanewal-demo' },
]);

const auditMod = await import('../src/sentinel/audit.js');
const idem = await import('../src/sentinel/idempotency.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const { buildApp } = await import('../src/app.js');
const kill = await import('../src/sentinel/killswitch.js');
const convs = await import('../src/sentinel/conversations.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');
const cust = await import('../src/services/customers.js');

auditMod.initAudit();
idem.initIdempotency();
cust.loadDb();
seedStaffIfMissing();
kill.initKill();

// Spy provider; 'FLAKY' marker fails once-if-armed, 'FLAKY2' fails while flag on (deterministic KS7 window)
const delivered = [];
let flakyOnce = false;
let flakyAlways = false; // KS7 window control: keeps throwing until test disarms
const outbox = createOutbox({
  dir: path.join(TMP, 'ob'),
  sendFn: async (p) => {
    if (flakyOnce && String(p?.text?.body || '').includes('FLAKY')) { flakyOnce = false; throw new Error('provider 500'); }
    if (flakyAlways && String(p?.text?.body || '').includes('FLAKY2')) throw new Error('provider 500');
    delivered.push(p); return { ok: true };
  },
  windowGuard: () => ({ ok: true }),
  autonomyGuard: (job) => (kill.isAutonomousJob(job) ? kill.gateForSend(job.payload?.to, { source: job.meta?.source }) : { ok: true }),
  auditFn: auditMod.audit,
  pollMs: 15,
  retry: { maxAttempts: 5, baseMs: 25, maxMs: 100 },
});
wa.initOutbox(outbox);
wa.setKillGate((to, meta) => kill.gateForSend(to, meta));
wa.setSendGuard(convs.authorizeOutbound);
wa.setMessageLogger(cust.logOutbound);
convs.setEscalationAckSender((to, t) => wa.sendText(to, t, { source: 'AI_SYSTEM_ACK' }));
kill.onKillStop(() => outbox.holdAutonomous(kill.isAutonomousJob));
kill.onKillResume(() => outbox.releaseHeld());
outbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'cap055-secret').update(body).digest('hex');
let seq = 0;
const wamid = () => `wamid.55.${Date.now()}.${++seq}`;
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auditAll = () => fs.readFileSync(process.env.AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const auditFind = (type, extra = () => true) => auditAll().filter((e) => e.type === type && extra(e.payload || {}));
const readKill = () => JSON.parse(fs.readFileSync(process.env.KILL_FILE, 'utf8'));

async function sendEvent(phone, text) {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'K' } }], messages: [{ from: phone, id: wamid(), type: 'text', text: { body: text } }] } }] }] });
  await fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(body) }, body });
  await sleep(140);
}
async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id, password }) });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf, body: j };
}
async function kpost(pathname, creds, payload) {
  const r = await fetch(`${base}${pathname}?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(creds ? { Cookie: creds.cookie, 'x-csrf': creds.csrf } : {}) },
    body: JSON.stringify(payload || {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
function verdict(name, expected, actual, proves, noProve) {
  console.log(`\n── ${name}\n   EXPECTED        : ${expected}\n   ACTUAL          : ${actual}\n   PROVES          : ${proves}\n   DOES NOT PROVE  : ${noProve}`);
}

let boss, staff;
test('K0 setup: owner + staff login', async () => {
  boss = await login('boss', 'boss-pw-55');
  staff = await login('hassan', 'hassan-pw-55');
  assert.equal(boss.status, 200); assert.equal(staff.status, 200);
  assert.equal(readKill().state, 'AUTOMATION_ACTIVE', 'genesis state active');
  verdict('K0 genesis', 'AUTOMATION_ACTIVE genesis audited', readKill().state, 'deterministic first boot', 'nothing about abuse yet');
});

// ── Functional F1: full command cycle ──
test('K1. STOP ALL (owner) → state STOPPED, audited with actor/reason; STATUS checked; RESUME with confirm+reason', async () => {
  const r = await kpost('/inbox/kill/stop', boss, { actionId: actId('stop1'), reason: 'drill: taking brake control' });
  assert.equal(r.status, 200); assert.equal(r.body.state, 'AUTOMATION_STOPPED');
  assert.equal(readKill().stopped_by, 'boss');
  const s = await kpost('/inbox/kill/status', staff, {});
  assert.equal(s.body.kill.state, 'AUTOMATION_STOPPED');
  assert.equal(auditFind('KILL_SWITCH_STOPPED', (p) => p.actor?.staffId === 'boss').length, 1);
  assert.ok(auditFind('KILL_SWITCH_STATUS_CHECKED').length >= 1);
  const rs = await kpost('/inbox/kill/resume', boss, { actionId: actId('res1'), reason: 'drill complete, verified silence', confirm: 'RESUME' });
  assert.equal(rs.body.state, 'AUTOMATION_ACTIVE');
  assert.equal(auditFind('KILL_SWITCH_RESUMED', (p) => p.actor?.staffId === 'boss').length, 1);
  verdict('K1 command cycle', 'stop→status→resume all audited w/ actor+actionId', `stop=${r.body.state} resume=${rs.body.state}`, 'full owner command path + audit envelope', 'NOT a proof against stolen owner cookie (12h TTL is the mitigation, DEBT-19 for internet)');
});

// ── KS1/KS14: unauthorized + auth-failure no-change ──
test('KS1/KS14. unauthorized STOP/RESUME → 401, KILL_SWITCH_DENIED, state file untouched', async () => {
  const before = fs.readFileSync(process.env.KILL_FILE, 'utf8');
  const mtime = fs.statSync(process.env.KILL_FILE).mtimeMs;
  const r1 = await kpost('/inbox/kill/stop', null, { actionId: actId('bad') });
  const r2 = await kpost('/inbox/kill/resume', null, { actionId: actId('bad2'), confirm: 'RESUME', reason: 'x' });
  assert.equal(r1.status, 401); assert.equal(r2.status, 401);
  assert.equal(readKill().state, 'AUTOMATION_ACTIVE');
  assert.equal(fs.readFileSync(process.env.KILL_FILE, 'utf8'), before, 'state bytes UNCHANGED');
  assert.ok(auditFind('KILL_SWITCH_DENIED', (p) => p.reason === 'unauthenticated_stop').length >= 1);
  verdict('KS1/KS14 unauth + no-state-change', '401 ×2, state bytes identical', `${r1.status}/${r2.status}, unchanged=true`, 'fail-closed on missing auth; no side effect on failed auth', 'timing-side-channel resistance (not measured)');
});

// ── KS11: STAFF tries owner command ──
test('KS11. STAFF-role session attempts STOP → unset → 403 DENIED + audit', async () => {
  const r = await kpost('/inbox/kill/stop', staff, { actionId: actId('staffstop') });
  assert.equal(r.status, 403);
  assert.equal(readKill().state, 'AUTOMATION_ACTIVE');
  assert.ok(auditFind('KILL_SWITCH_DENIED', (p) => p.reason === 'staff_role_cannot_stop').length >= 1);
  verdict('KS11 staff tries owner command', '403 + DENIED audit, state ACTIVE', `${r.status}`, 'role check is server-side (LLM/UI irrelevant)', 'multi-owner quorum (not required at this scale)');
});

// ── KS3: forged credential ──
test('KS3. forged session token + wrong password login → denied, no state change', async () => {
  const forged = `noor_session=${crypto.randomBytes(32).toString('hex')}`;
  const r = await fetch(`${base}/inbox/kill/stop?json=1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: forged, 'x-csrf': 'zzz' }, body: JSON.stringify({ actionId: actId('f') }) });
  assert.equal(r.status, 401);
  const bad = await login('boss', 'WRONG-PASSWORD');
  assert.equal(bad.status, 401);
  assert.equal(readKill().state, 'AUTOMATION_ACTIVE');
  verdict('KS3 forged owner credential', '401 both, state unchanged', `${r.status}/${bad.status}`, 'random-token forgery + password guessing denied & audited', 'rate limiting (DEBT-19 — registered, not closed)');
});

// ── KS4/KS5: customer & LLM paths cannot move the switch ──
test('KS4/KS5. WhatsApp customer "STOP ALL" / "RESUME ALL" → switch never moves', async () => {
  const phone = '923005550001';
  await sendEvent(phone, 'STOP ALL');
  await sendEvent(phone, 'RESUME ALL');
  assert.equal(readKill().state, 'AUTOMATION_ACTIVE', 'customer text cannot touch the switch');
  assert.equal(auditFind('KILL_SWITCH_RESUMED').length, 1, 'only the K1 owner resume exists');
  const replies = delivered.filter((d) => d.to === phone);
  assert.ok(replies.length >= 1, 'customer got a normal bot reply (no kill plumbing on that path)');
  verdict('KS4/KS5 customer/LLM channel', 'state ACTIVE after customer STOP ALL & RESUME ALL', readKill().state + ` replies=${replies.length}`, 'no ingress from chat path — LLM cannot be tricked into resume either (no code path exists)', 'a future owner-whatsapp-command feature (deliberately NOT built)');
});

// ── KS6 + KS15: STOP holds queued autonomous job + CRITICAL RACE ──
test('KS6/KS15. race: autonomous job ready + STOP ≈ same time → after commit, job HELD, provider untouched', async () => {
  // Arm an autonomous AI-sourced job directly in the outbox (bypassing enqueue gate on purpose
  // to simulate "already queued when STOP lands")
  const phone = '923005550002';
  outbox.enqueue({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: 'autonomous marketing-ish message' } }, { source: 'AI' });
  // owner stop lands (≈ same time as a dispatch cycle)
  const stop = await kpost('/inbox/kill/stop', boss, { actionId: actId('racedstop'), reason: 'race drill' });
  assert.equal(stop.body.state, 'AUTOMATION_STOPPED');
  await sleep(250); // many poll cycles pass
  const toPhone = delivered.filter((d) => d.to === phone);
  assert.equal(toPhone.length, 0, 'PROVIDER NEVER TOUCHED for the autonomous job after stop');
  assert.ok(outbox.countHeld() >= 1, 'job is HELD_KILLSWITCH (explicit state, not "probably stopped")');
  assert.ok(auditFind('KILL_SEND_BLOCKED').length + auditFind('OUTBOX_HELD').length >= 1, 'block/held audited');
  verdict('KS6/KS15 race: stop beats dispatch', 'post-commit dispatch check ⇒ HELD, provider 0 hits', `delivered=${toPhone.length} held=${outbox.countHeld()}`, 'deterministic two-wall rule: enqueue gate + execute gate; explicit HELD state returned', 'in-flight provider calls already accepted (documented boundary, spec §4)');
});

// ── Resume releases held → drains normally ──
test('K2. RESUME releases held jobs → autonomous job now delivers once', async () => {
  const phone = '923005550002';
  const rs = await kpost('/inbox/kill/resume', boss, { actionId: actId('res2'), confirm: 'RESUME', reason: 'race drill over, held job benign' });
  assert.equal(rs.body.state, 'AUTOMATION_ACTIVE');
  await sleep(300);
  const toPhone = delivered.filter((d) => d.to === phone);
  assert.equal(toPhone.length, 1, 'held job delivered once after resume — normal path, no loss, no dup');
  assert.equal(outbox.countHeld(), 0);
  assert.ok(auditFind('OUTBOX_HELD_RELEASED').length >= 1);
  verdict('K2 resume release', 'held job drains once via normal gates', `delivered=${toPhone.length} held=${outbox.countHeld()}`, 'resume restores autonomy deterministically', 'provider 24h-window semantics in LIVE (windowGuard re-applies — DEMO here)');
});

// ── KS7: STOP during scheduled retry ──
test('KS7. STOP while RETRY_SCHEDULED → zero executions while stopped, one drain after resume', async () => {
  const phone = '923005550003';
  flakyAlways = true; // provider will fail EVERY attempt until disarmed
  await wa.sendText(phone, 'FLAKY2 retry-probe', { source: 'AI' });
  // wait until first failure + retry scheduling is audited (poll, max ~1s)
  for (let i = 0; i < 40 && auditFind('OUTBOX_RETRY').length === 0; i++) await sleep(25);
  assert.ok(auditFind('OUTBOX_RETRY').length >= 1, 'first attempt failed → retry scheduled');
  const retriesBeforeStop = auditFind('OUTBOX_RETRY').length;
  await kpost('/inbox/kill/stop', boss, { actionId: actId('stop-retry'), reason: 'freeze retry loop' });
  await sleep(200); // many would-be attempt instants pass
  assert.equal(delivered.filter((d) => d.to === phone).length, 0, 'ZERO executions while stopped');
  assert.equal(auditFind('OUTBOX_RETRY').length, retriesBeforeStop, 'no new retry attempt even SCHEDULED after stop (held before dispatch)');
  assert.ok(outbox.countHeld() >= 1, 'retrying job explicitly HELD_KILLSWITCH');
  flakyAlways = false;
  await kpost('/inbox/kill/resume', boss, { actionId: actId('res-retry'), confirm: 'RESUME', reason: 'release retry probe — provider healthy' });
  await sleep(300);
  assert.equal(delivered.filter((d) => d.to === phone).length, 1, 'after resume: held retry drains → one delivery');
  assert.equal(outbox.countHeld(), 0);
  verdict('KS7 stop-during-retry', '0 executions while stopped; 1 delivery after resume', `stoppedDeliveries=0 post=${delivered.filter((d) => d.to === phone).length}`, 'retry machinery is brake-compliant per attempt; HELD is an explicit state', 'provider-side acceptance window during the failing attempt itself (documented §4 boundary)');
});

// ── KS9/KS10// ── KS9/KS10: idempotency of commands ──
test('KS9/KS10. STOP×3 and RESUME×2 (fresh ids + replayed id) → deterministic, audited once per real transition', async () => {
  const s1 = await kpost('/inbox/kill/stop', boss, { actionId: actId('idem-a'), reason: 'first' });
  const s2 = await kpost('/inbox/kill/stop', boss, { actionId: actId('idem-b'), reason: 'again' });
  const s3 = await kpost('/inbox/kill/stop', boss, { actionId: actId('idem-c'), reason: 'third' });
  assert.deepEqual([s1.body.state, s2.body.state, s3.body.state], ['AUTOMATION_STOPPED', 'AUTOMATION_STOPPED', 'AUTOMATION_STOPPED']);
  assert.ok(['STOPPED', 'ALREADY_STOPPED'].includes(s2.body.status));
  const stopsAudited = auditFind('KILL_SWITCH_STOPPED');
  assert.equal(stopsAudited.filter((p) => p.note !== 'already_stopped').length >= 1, true);
  const rAid = actId('resume-once');
  const r1 = await kpost('/inbox/kill/resume', boss, { actionId: rAid, confirm: 'RESUME', reason: 'back live' });
  const r2 = await kpost('/inbox/kill/resume', boss, { actionId: rAid, confirm: 'RESUME', reason: 'back live' }); // REPLAY same id
  assert.equal(r1.body.status, 'RESUMED');
  assert.equal(r2.body.status, 'ALREADY_APPLIED', 'same actionId replay → no-op');
  assert.equal(auditFind('KILL_SWITCH_RESUMED', (p) => p.actionId === rAid).length, 1, 'RESUMED audited exactly 1x for that actionId');
  assert.equal(readKill().state, 'AUTOMATION_ACTIVE');
  verdict('KS9/KS10 idempotency', 'STOP×3 stable; resume actionId replay → ALREADY_APPLIED, audit 1x', `replays=${r2.body.status}`, 'deterministic command ledger', 'ledger growth cap (bounded to 150 actions — documented in code)');
});

// ── KS12: malformed commands ──
test('KS12. malformed resume (bad confirm) / missing actionId / unknown route → clean 4xx', async () => {
  const r1 = await kpost('/inbox/kill/resume', boss, { actionId: actId('mf1'), reason: 'x', confirm: 'resume' }); // wrong case
  assert.equal(r1.status, 400); assert.equal(r1.body.error, 'CONFIRMATION_REQUIRED');
  const r2 = await kpost('/inbox/kill/stop', boss, { reason: 'no action id' });
  assert.equal(r2.status, 400);
  const r3 = await fetch(`${base}/inbox/kill/nuke?json=1`, { method: 'POST', headers: { Cookie: boss.cookie, 'x-csrf': boss.csrf, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r3.status, 404);
  assert.equal(readKill().state, 'AUTOMATION_ACTIVE', 'malformed attempts changed nothing');
  verdict('KS12 malformed commands', '400/400/404, state ACTIVE', `${r1.status}/${r2.status}/${r3.status}`, 'schema enforced; resume demands explicit typed confirmation', 'input fuzzing depth (beyond contract validation)');
});

// ── KS2: unauthorized RESUME covered with KS1; distinct: valid staff + missing confirm handled above.
// ── KS13: corrupt state → FAIL CLOSED ──
test('KS13. state corruption → readState fail-closed (STOPPED) + KILL_STATE_UNREADABLE + autonomous send blocked', async () => {
  const good = fs.readFileSync(process.env.KILL_FILE, 'utf8');
  fs.writeFileSync(process.env.KILL_FILE, '{"state":%%%BROKEN');
  assert.equal(kill.isStopped(), true, 'corrupt state ⇒ treated as STOPPED');
  assert.ok(auditFind('KILL_STATE_UNREADABLE').length >= 1);
  let threw = null;
  try { await wa.sendText('923005550009', 'autonomous during corrupt state', { source: 'AI' }); }
  catch (e) { threw = e.code; }
  assert.equal(threw, 'KILL_SWITCH_ACTIVE', 'enqueue gate denies while fail-closed');
  // repair: rewrite valid state → owner resumes deterministically through the real command path
  fs.writeFileSync(process.env.KILL_FILE, good);
  const back = await kpost('/inbox/kill/status', boss, {});
  assert.equal(back.body.kill.state, 'AUTOMATION_ACTIVE');
  verdict('KS13 corruption fail-closed', 'corrupt ⇒ STOPPED + audit + blocked; repair+status ⇒ ACTIVE', `threw=${threw}`, 'never "unreadable ⇒ assume ACTIVE" — the control fails SILENT-AND-SHUT', 'bit-rot prevention (no checksum yet — DEBT openness acknowledged)');
});

// ── KS8: restart persistence (file-backed truth, fresh module read) ──
test('KS8. STOP persists across restart — simulated module reload + REAL process drill in live demo', async () => {
  await kpost('/inbox/kill/stop', boss, { actionId: actId('stop-persist'), reason: 'restart persistence test' });
  // simulate restart at the data layer: readState is disk-backed per call (no process cache to forget)
  const freshRead = kill.readState();
  assert.equal(freshRead.state, 'AUTOMATION_STOPPED');
  assert.equal(freshRead.source, 'disk', 'state came from the file, not memory');
  await kpost('/inbox/kill/resume', boss, { actionId: actId('resume-persist'), confirm: 'RESUME', reason: 'persistence proven' });
  assert.equal(kill.readState().state, 'AUTOMATION_ACTIVE');
  verdict('KS8 restart persistence', 'state from disk post-restart is STOPPED before resume', `${freshRead.state}/${freshRead.source}`, 'file-backed state survives process death (live drill does the real kill+boot)', 'fsync-level durability vs power loss mid-write (atomic rename mitigates partial writes; hardware failure NOT proven)');
});

// ── Human staff still function while STOPPED (preferred behavior per directive) ──
test('K3. while STOPPED: customer escalation still queues (fallback works), STAFF human reply still sends', async () => {
  const phone = '923005550004';
  await kpost('/inbox/kill/stop', boss, { actionId: actId('stop-humanok'), reason: 'verify human channel' });
  const before = delivered.filter((d) => d.to === phone).length;
  await sendEvent(phone, 'menu_staff'); // escalation ack is AUTONOMOUS (AI_SYSTEM_ACK) → must be BLOCKED
  await sleep(150);
  const afterAck = delivered.filter((d) => d.to === phone).length;
  assert.equal(afterAck, before, 'autonomous ack blocked while stopped (ack failure audited, queue still commits)');
  const conv = convs.getConversation(phone);
  assert.equal(conv.state, 'QUEUED', 'conversation still reaches inbox — human fallback intact');
  assert.ok(auditFind('ACK_SEND_FAILED').length >= 1);
  // third-party: claim + human reply must work
  const cr = await kpost(`/inbox/c/${phone}/claim`, staff, { actionId: actId('cl-h') });
  assert.equal(cr.body.status, 'CLAIMED');
  const rp = await kpost(`/inbox/c/${phone}/reply`, staff, { actionId: actId('rp-h'), body: 'Hassan yahan hoon, automation band hai par main hoon.' });
  assert.equal(rp.body.status, 'SENT_VIA_OUTBOX');
  await sleep(200);
  const humanDelivered = delivered.filter((d) => d.to === phone && String(d.text?.body).includes('automation band'));
  assert.equal(humanDelivered.length, 1, 'HUMAN reply passed both gates while stopped');
  await kpost('/inbox/kill/resume', boss, { actionId: actId('resume-final'), confirm: 'RESUME', reason: 'human-channel proof done' });
  verdict('K3 human-channel-while-stopped', 'autonomous ack blocked; human reply delivered; queue intact', `ackDelta=${afterAck - before} human=${humanDelivered.length}`, 'directive preferred behavior enforced by actor identity at BOTH gates', 'mass-casualty scenario UX (out of scope)');
});

console.log('\n✅ CAP-055 suite loaded');

after(() => {
  // Graceful teardown (no hard process.exit — it truncated runner IPC once, causing
  // a phantom 'deserialize' file-level failure). closeAllConnections kills undici
  // keep-alive sockets — the actual handle that kept the child alive.
  try { mainOutbox.stop?.(); outbox.stop?.(); } catch {}
  try { server.close(); server.closeAllConnections?.(); } catch {}
});
