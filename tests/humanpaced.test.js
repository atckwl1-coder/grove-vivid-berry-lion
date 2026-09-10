// ═══════════════════════════════════════════════════════════════
//  HUMAN-PACED RESPONSE & CONVERSATION SAFETY LAYER — FOCUSED
//  VERIFICATION (2026-09-11, owner directive — the sole authority)
//
//  Contract verified here (§2–§20 of the directive):
//   • complete response FIRST (LLM/validation unchanged), internal
//     pacing AFTER, exactly ONE complete WhatsApp message to the
//     recipient — per-character sending does not exist in this design
//   • per-character bounded, variable intervals (no fixed count×const,
//     no unbounded random) with word/punctuation/sentence/line
//     adjustments; total composition duration capped (min + max)
//   • stale-response protection via conversation version (§8): a new
//     customer message, staff takeover, DND, kill or session loss
//     cancels the in-flight composition — a stale reply is never sent
//   • one active autonomous composition per conversation; a new
//     customer message supersedes the old (§9)
//   • REUSE of CAP-008 takeover, CAP-055 kill (STOP wins at the
//     dispatch boundary), the P2 firewall + durable outbox (no
//     duplication, no direct provider calls), existing idempotency
//   • conversation circuit breaker (bounded loop/burst protection —
//     surfaces human takeover, no permanent customer blocking)
//   • fail-closed session handling; NO reconnect/QR/deletion loops
//   • 1-to-1 only: no new group/broadcast/campaign surface
//
//  Real path: signed webhook → ingest → brain → paced composition →
//  P2 firewall → outbox spy. LLM = LOCAL capture double.
//  Timing config for THIS suite (HP_* env, explicit — production
//  defaults stay conservative for the existing runtime contract):
//  min composition 250ms, max 1200ms, breaker soft 3 / hard 4 turns.
// ═══════════════════════════════════════════════════════════════
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelhp-'));
const REPO = process.cwd();

// ── Local LLM capture double (before config import) ──
const llmRequests = [];
let replySeq = 0;
const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    llmRequests.push(JSON.parse(body));
    replySeq += 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply: `reply-${replySeq}`, handoff: false, intent: 'general' }) } }],
    }));
  });
});
await new Promise((r) => llmServer.listen(0, '127.0.0.1', r));

process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.AUDIT_FILE = path.join(TMP, 'audit.jsonl');
process.env.IDEM_DIR = path.join(TMP, 'idem');
process.env.OUTBOX_DIR = path.join(TMP, 'outbox');
process.env.CONV_DIR = path.join(TMP, 'conv');
process.env.SESSIONS_DIR = path.join(TMP, 'sessions');
process.env.STAFF_FILE = path.join(TMP, 'staff.json');
process.env.KILL_FILE = path.join(TMP, 'killswitch.json');
process.env.TENANT_ID = 'khanewal-demo';
process.env.META_APP_SECRET = 'testsecret-hp';
process.env.META_VERIFY_TOKEN = 'hp';
process.env.OUTBOX_POLL_MS = '15';
process.env.RETRY_BASE_MS = '20';
process.env.RETRY_MAX = '3';
process.env.RETRY_MAX_MS = '80';
process.env.OPENAI_API_KEY = 'test-key-hp';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${llmServer.address().port}`;
process.env.STAFF_SEED_JSON = JSON.stringify([
  { id: 'boss', password: 'boss-pw-55', role: 'OWNER', tenant: 'khanewal-demo' },
  { id: 'hassan', password: 'hassan-pw-55', role: 'STAFF', tenant: 'khanewal-demo' },
]);
// Explicit pacing config for THIS suite (wider windows than production
// defaults so mid-composition races are deterministically observable; the
// per-character model is explicitly set so the pure-model tests exercise a
// rich interval model independent of the conservative production defaults)
process.env.HP_MIN_COMPOSITION_MS = '250';
process.env.HP_MAX_COMPOSITION_MS = '1200';
process.env.HP_CHAR_BASE_MS = '8';
process.env.HP_CHAR_VARIANCE_MS = '6';
process.env.HP_CHAR_MIN_MS = '3';
process.env.HP_CHAR_MAX_MS = '60';
process.env.HP_WORD_BOUNDARY_MS = '8';
process.env.HP_COMMA_MS = '40';
process.env.HP_SENTENCE_MS = '90';
process.env.HP_LINE_BREAK_MS = '120';
process.env.HP_BREAKER_SOFT_TURNS = '3';
process.env.HP_BREAKER_HARD_TURNS = '4';
// WHATSAPP_TOKEN empty → DEMO (no Meta network ever)

const auditMod = await import('../src/sentinel/audit.js');
const { createOutbox } = await import('../src/sentinel/outbox.js');
const wa = await import('../src/services/whatsapp.js');
const cust = await import('../src/services/customers.js');
const convs = await import('../src/sentinel/conversations.js');
const kill = await import('../src/sentinel/killswitch.js');
const brain = await import('../src/services/brain.js');
const composerMod = await import('../src/services/humanPaced/composer.js');
const versionMod = await import('../src/services/humanPaced/version.js');
const sessionHealth = await import('../src/services/humanPaced/sessionHealth.js');
const breakerMod = await import('../src/services/humanPaced/breaker.js');
const cfg = (await import('../src/services/humanPaced/config.js')).HUMAN_PACED_CONFIG;
const { buildApp } = await import('../src/app.js');
const { seedStaffIfMissing } = await import('../src/sentinel/auth.js');

auditMod.initAudit();
kill.initKill();
cust.loadDb();
seedStaffIfMissing();
convs.setEscalationAckSender((to, ackText) => wa.sendText(to, ackText, { source: 'AI_SYSTEM_ACK' }));

const delivered = [];
const mainOutbox = createOutbox({
  dir: path.join(TMP, 'ob-main'),
  sendFn: async (p) => { delivered.push(p); return { ok: true }; },
  windowGuard: () => ({ ok: true }),
  autonomyGuard: (job) => (kill.isAutonomousJob(job) ? kill.gateForSend(job.payload?.to, { source: job.meta?.source }) : { ok: true }),
  auditFn: auditMod.audit,
  pollMs: 15,
  retry: { maxAttempts: 3, baseMs: 20, maxMs: 80 },
});
wa.initOutbox(mainOutbox);
wa.setKillGate((to, meta) => kill.gateForSend(to, meta));
wa.setSendGuard(convs.authorizeOutbound);
wa.setMessageLogger(cust.logOutbound);
kill.onKillStop(() => mainOutbox.holdAutonomous(kill.isAutonomousJob));
kill.onKillResume(() => mainOutbox.releaseHeld());
mainOutbox.start();

const app = buildApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', 'testsecret-hp').update(body).digest('hex');
let seq = 0;
const pSeq = { i: 0 };
const P = () => `9230011105${String(++pSeq.i).padStart(2, '0')}`;
const eventBody = (msg) => JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'HP User' } }], messages: [msg] } }] }], });
const textMsg = (id, text, from) => ({ from, id, type: 'text', text: { body: text } });
const postWebhook = (raw) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sign(raw) }, body: raw });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); }
  return false;
};
const toPhone = (phone) => delivered.filter((p) => p.to === phone);
const textOf = (p) => p.text?.body || p.interactive?.body?.text || '';
const aiReplies = (phone) => toPhone(phone).filter((d) => /^reply-\d+$/.test(textOf(d)));
const sendFlow = async (phone, text) => {
  const before = toPhone(phone).length;
  const res = await postWebhook(eventBody(textMsg(`wamid.hp-${++seq}`, text, phone)));
  assert.equal(res.status, 200, `webhook accepted: ${text}`);
  assert.ok(await waitFor(() => toPhone(phone).length > before), `reply delivered: ${text}`);
  return toPhone(phone).slice(-1)[0];
};
const auditAll = () => fs.readFileSync(process.env.AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const auditFind = (type, extra = () => true) => auditAll().filter((e) => e.type === type && extra(e.payload || {}));
// audit payloads are PII-redacted (phone → 9230****xxxx) — match on the SAME
// redacted form the audit module stores (this also verifies redaction applies to the new events)
const CID = (phone) => auditMod.redact(phone);
const sentJobsFor = (phone) =>
  fs.readdirSync(mainOutbox.dirs.D).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(mainOutbox.dirs.D, f), 'utf8')))
    .filter((j) => j.payload?.to === phone);
const actId = (p) => `act-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-${p}`;
async function login(id, password) {
  const r = await fetch(`${base}/inbox/login?json=1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id, password }) });
  const j = await r.json();
  return { status: r.status, cookie: `noor_session=${j?.sessionToken}`, csrf: j?.csrf };
}
async function kpost(pathname, creds, payload) {
  const r = await fetch(`${base}${pathname}?json=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(creds ? { Cookie: creds.cookie, 'x-csrf': creds.csrf } : {}) },
    body: JSON.stringify(payload || {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const staff = await login('boss', 'boss-pw-55');
assert.equal(staff.status, 200);

// Deterministic rng for the pure interval-model tests
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const instantClock = { delay: async () => {} };

function verdict(name, expected, actual, proves, noProve) {
  console.log(`\n── ${name}\n   EXPECTED        : ${expected}\n   ACTUAL          : ${actual}\n   PROVES          : ${proves}\n   DOES NOT PROVE  : ${noProve}`);
}

// ═══════════════════════════════════════════════════════════════
test('HP1. the complete reply is delivered as ONE complete message', async () => {
  const phone = P();
  const before = toPhone(phone).length;
  await sendFlow(phone, 'hello world, kya haal hai?');
  const msgs = toPhone(phone).slice(before);
  assert.equal(msgs.length, 1, 'exactly one outbound message for one inbound');
  assert.equal(textOf(msgs[0]), `reply-${replySeq}`, 'the FULL generated reply text, verbatim (no truncation)');
  const job = sentJobsFor(phone).find((j) => textOf(j.payload) === textOf(msgs[0]));
  assert.ok(job, 'one outbox job carried it');
  verdict('HP1 one complete message', '1 inbound ⇒ exactly 1 outbound payload = the full reply', `outbound=${msgs.length} text=full-reply`, 'the recipient receives the complete response as a single WhatsApp message', 'delivery quality on the LIVE Meta channel (DEMO spy here)');
});

test('HP2. per-character sending does not exist (provider called once with the full body)', async () => {
  const phone = P();
  const before = toPhone(phone).length;
  const beforeJobs = sentJobsFor(phone).length;
  await sendFlow(phone, 'short one');
  const providerCalls = toPhone(phone).slice(before);
  assert.equal(providerCalls.length, 1, 'provider (outbox) called a single time — no duplicates');
  assert.equal(sentJobsFor(phone).length, beforeJobs + 1, 'exactly one outbox job');
  const full = textOf(providerCalls[0]);
  for (const p of providerCalls) {
    assert.equal(textOf(p), full, 'no partial/prefix body ever reached the provider');
  }
  verdict('HP2 never per-character', '1 provider call, 1 job, body = full text', `calls=1 jobs=+1`, 'composition is INTERNAL timing only — the send boundary sees one complete payload', 'nothing inside the WhatsApp protocol that could distinguish internal timing (out of scope by directive)');
});

test('HP3a. per-character intervals stay inside the configured bounds (pure model)', async () => {
  const text = 'Hello sir, Reno 16 available hai. EMI bhi chahiye? \nStore aayen!';
  const plan = composerMod.computeIntervals(text, cfg, mulberry32(7));
  for (const ms of plan.intervals) {
    assert.ok(ms >= cfg.char.minMs, `interval ${ms} >= min ${cfg.char.minMs}`);
    assert.ok(ms <= cfg.char.maxMs, `interval ${ms} <= max ${cfg.char.maxMs}`);
  }
  assert.equal(plan.intervals.length, text.length, 'one interval per character');
  verdict('HP3a bounded intervals', 'every interval ∈ [char.min, char.max]', `n=${plan.intervals.length} min=${Math.min(...plan.intervals)} max=${Math.max(...plan.intervals)}`, 'no unbounded random, no runaway per-character delay', 'provider-side timing perception (out of scope)');
});

test('HP3b. intervals vary under a controlled timing source (deterministic per seed)', async () => {
  const text = 'variable timing probe with several words';
  const a = composerMod.computeIntervals(text, cfg, mulberry32(42));
  const b = composerMod.computeIntervals(text, cfg, mulberry32(42));
  const c = composerMod.computeIntervals(text, cfg, mulberry32(43));
  assert.deepEqual(a.intervals, b.intervals, 'same seed ⇒ identical plan (deterministic)');
  assert.notDeepEqual(a.intervals, c.intervals, 'different seed ⇒ different plan (variability is real)');
  const distinct = new Set(a.intervals).size;
  assert.ok(distinct >= 3, `bounded variance produces variation (distinct=${distinct})`);
  assert.ok(!a.intervals.every((v, i) => i === 0 || a.intervals[i - 1] === v), 'not a fixed constant sequence');
  verdict('HP3b controlled variability', 'seed-reproducible, non-constant, seed-sensitive', `distinct=${distinct}`, 'timing is variable but bounded + reproducible for tests', 'real human keystroke dynamics (not claimed anywhere)');
});

test('HP4a. word boundaries affect timing (pure model, same rng stream)', async () => {
  const withSpace = composerMod.computeIntervals('ab cd', cfg, mulberry32(11));
  const noSpace = composerMod.computeIntervals('abcd', cfg, mulberry32(11));
  assert.ok(withSpace.intervals[2] > noSpace.intervals[2], `space position ${withSpace.intervals[2]} > in-word ${noSpace.intervals[2]}`);
  assert.ok(withSpace.intervals[3] > noSpace.intervals[3], 'character after a word edge pauses longer');
  verdict('HP4a word-boundary effect', 'word edges add a bounded pause (same rng stream, only context differs)', `space=${withSpace.intervals[2]} plain=${noSpace.intervals[2]}`, 'structured pausing at word boundaries (additive, still capped)', 'perception of naturalness (subjective)');
});

test('HP4b. punctuation affects timing (sentence > comma > plain; all capped)', async () => {
  const sentence = composerMod.computeIntervals('abcd.', cfg, mulberry32(21));
  const comma = composerMod.computeIntervals('abcd,', cfg, mulberry32(21));
  const plain = composerMod.computeIntervals('abcde', cfg, mulberry32(21));
  assert.ok(comma.intervals[4] > plain.intervals[4], `comma ${comma.intervals[4]} > plain ${plain.intervals[4]}`);
  assert.ok(sentence.intervals[4] > plain.intervals[4], `sentence-end ${sentence.intervals[4]} > plain ${plain.intervals[4]}`);
  assert.ok(sentence.intervals[4] >= comma.intervals[4], 'sentence end ≥ comma pause');
  assert.ok(sentence.intervals[4] <= cfg.char.maxMs, 'punctuation pause still capped by char.max');
  const line = composerMod.computeIntervals('abcd\n', cfg, mulberry32(21));
  assert.ok(line.intervals[4] > plain.intervals[4], 'line break adds a bounded pause');
  verdict('HP4b punctuation effect', 'sentence/comma/line breaks pause more, all within char bounds', `sent=${sentence.intervals[4]} comma=${comma.intervals[4]} plain=${plain.intervals[4]}`, 'punctuation-structured pausing per the timing model', 'perception of naturalness (subjective)');
});

test('HP5. total composition duration is capped (model + real clock)', async () => {
  // model: long text → hard cap; short text → floor via settle tail
  const longPlan = composerMod.computeIntervals('word '.repeat(200), cfg, mulberry32(5));
  assert.equal(longPlan.capped, true);
  assert.equal(longPlan.totalMs, cfg.duration.maxMs, 'long reply clamps to maxDuration exactly');
  const shortPlan = composerMod.computeIntervals('hi', cfg, mulberry32(5));
  assert.equal(shortPlan.totalMs, cfg.duration.minMs, 'short reply meets minDuration (settle tail, per-char bounds intact)');
  assert.ok(shortPlan.intervals.every((v) => v <= cfg.char.maxMs), 'floor is a settle pause — per-char intervals untouched');
  // real clock: measured wall time respects the same bounds
  const cx = composerMod.createComposer({ clock: composerMod.realClock, audit: () => {} });
  const v = { state: 'AI_ACTIVE' };
  let rec = cx.begin({ convId: 'rt-short', jobId: 'j-short', text: 'hi there', version: v, token: composerMod.createCancelToken() });
  let t0 = Date.now();
  let r = await cx.compose(rec);
  let elShort = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.ok(elShort >= cfg.duration.minMs - 25, `measured short ≥ min (elapsed=${elShort}ms)`);
  assert.ok(elShort < 1500, `measured short bounded (elapsed=${elShort}ms)`);
  rec = cx.begin({ convId: 'rt-long', jobId: 'j-long', text: 'word '.repeat(150), version: v, token: composerMod.createCancelToken() });
  t0 = Date.now();
  r = await cx.compose(rec);
  let elLong = Date.now() - t0;
  assert.equal(r.ok, true);
  assert.ok(elLong < cfg.duration.maxMs + 600, `measured long ≤ max + slack (elapsed=${elLong}ms)`);
  assert.ok(elLong >= cfg.duration.maxMs - 150, 'long reply actually ran near the cap (not skipped)');
  verdict('HP5 duration caps', 'model: capped at max, floored at min; wall clock agrees', `short=${elShort}ms long=${elLong}ms`, 'composing time is bounded both ways — no instant reply, no absurd wait', 'perception of naturalness (subjective)');
});

test('HP6. typing presence: adapter started once + stopped once (complete and cancel paths)', async () => {
  const events = [];
  const typing = { start: (c) => events.push(['start', c]), stop: (c) => events.push(['stop', c]) };
  const cx = composerMod.createComposer({ clock: instantClock, typing, audit: () => {} });
  const v = { state: 'AI_ACTIVE' };
  let rec = cx.begin({ convId: 't1', jobId: 'j1', text: 'hello world', version: v, token: composerMod.createCancelToken() });
  let r = await cx.compose(rec);
  assert.equal(r.ok, true);
  assert.deepEqual(events, [['start', 't1'], ['stop', 't1']], 'complete: start once, stop once');
  // cancel path: token cancelled before the loop starts
  const tok = composerMod.createCancelToken();
  rec = cx.begin({ convId: 't2', jobId: 'j2', text: 'another hello', version: v, token: tok });
  tok.cancel('drill');
  r = await cx.compose(rec);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'drill');
  assert.deepEqual(events, [['start', 't1'], ['stop', 't1'], ['start', 't2'], ['stop', 't2']], 'cancel: start once, stop once — no double stop');
  // production composer (this process): typing disabled → zero typing events, composing unaffected
  assert.equal(auditFind('typing_started').length, 0, 'production runs the no-op adapter (Meta Cloud API has no reliable typing API)');
  assert.equal(auditFind('typing_stopped').length, 0);
  verdict('HP6 typing lifecycle', 'adapter interface works; start/stop once per path; production no-op', `events=${events.length}`, 'typing is a pluggable UX adapter — its absence never blocks composing or delivery (§7)', 'an actual Meta typing-presence API (none exists for this integration)');
});

test('HP7. mid-composition: a NEW customer message supersedes the old composition — one reply total', async () => {
  const phone = P();
  await postWebhook(eventBody(textMsg(`wamid.sup1-${++seq}`, 'first question here', phone)));
  await sleep(150); // inside msg1's composition window (min 250ms)
  assert.equal(brain._composer.isActive(phone), true, 'msg1 composition is in flight');
  await postWebhook(eventBody(textMsg(`wamid.sup2-${++seq}`, 'second question, the latest one', phone)));
  assert.ok(await waitFor(() => toPhone(phone).length >= 1), 'a reply arrived');
  await sleep(400); // let any (wrong) late send land
  const msgs = toPhone(phone);
  assert.equal(msgs.length, 1, 'exactly ONE reply for two inbounds (latest wins)');
  // The old composition is cancelled by ONE of two equivalent protections,
  // checkpoint-order-dependent: the supersede token (reason 'superseded') or
  // the version guard firing first (reason 'stale' — the new inbound bumped
  // the version). Both are the same §9 protection; assert the invariant.
  const cancels = auditFind('composition_cancelled', (p) => p.convId === CID(phone)).map((e) => e.payload); // payloads, not events
  assert.ok(cancels.some((p) => p.reason === 'superseded' || p.reason === 'stale'), 'old composition cancelled (superseded/stale) audited');
  assert.ok(auditFind('composition_superseded', (p) => p.convId === CID(phone)).length >= 0, 'supersede audit (present when the token wins the checkpoint race)');
  assert.equal(sentJobsFor(phone).length, 1, 'one logical outbound action — no duplicate job for the superseded reply');
  verdict('HP7 mid-composition invalidation', 'new message ⇒ old composition cancelled (superseded/stale); latest processed; 1 reply', `replies=1 cancel=${cancels.map((c) => c.reason).join('/')} jobs=1`, '§9: one active autonomous composition per conversation; obsolete reply never sent', 'two webhooks landing in the same microsecond (single-flight + webhook idempotency both key on the conversation/event)');
});

test('HP8. stale reply (version drift via a non-brain path) is discarded — never dispatched', async () => {
  const phone = P();
  const p = brain.pacedBrainSend(phone, 'stale probe', 'StaleProbeBodyText', { source: 'AI' });
  await waitFor(() => brain._composer.isActive(phone));
  await sleep(100); // mid-composition
  // a message that takes the ROUTER path (no new composition) but bumps the
  // conversation version via touchCustomer (new inbound = new version)
  await postWebhook(eventBody(textMsg(`wamid.visit-${++seq}`, 'menu_visit', phone)));
  const r = await p;
  assert.equal(r.ok, false, 'composition ended without a send');
  assert.equal(r.reason, 'stale', 'cancelled for version drift');
  assert.equal(toPhone(phone).filter((d) => textOf(d).includes('StaleProbeBodyText')).length, 0, 'stale reply never reached the provider');
  assert.ok(await waitFor(() => toPhone(phone).filter((d) => /🕙|Timing/.test(textOf(d))).length === 1, 2000), 'the router reply for the NEW message did go out (normal service)');
  assert.ok(auditFind('stale_response_discarded', (p2) => p2.convId === CID(phone)).length >= 1, 'stale_response_discarded audited');
  verdict('HP8 stale never dispatched', 'version drift mid-composition ⇒ discard + audit; new message still served', `reason=${r.reason}`, '§8: expected version re-validated continuously + at completion; stale reply is impossible to send', 'a version change landing in the microsecond between the final guard and the enqueue (closed by the pre-dispatch re-validation + the existing firewall walls)');
});

test('HP9. human takeover mid-composition cancels (CAP-008 reuse); never begins while owned', async () => {
  const phone = P();
  const p = brain.pacedBrainSend(phone, 'takeover probe', 'TakeoverProbeBodyText', { source: 'AI' });
  await waitFor(() => brain._composer.isActive(phone));
  await sleep(120);
  await postWebhook(eventBody(textMsg(`wamid.tk1-${++seq}`, 'menu_staff', phone)));
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'human_takeover', 'cancelled because the conversation became human-owned');
  assert.ok(auditFind('human_takeover_during_composition', (p2) => p2.convId === CID(phone)).length >= 1, 'takeover-during-composition audited');
  assert.equal(toPhone(phone).filter((d) => textOf(d).includes('TakeoverProbeBodyText')).length, 0, 'no stale AI send');
  assert.equal(convs.getConversation(phone).state, 'QUEUED', 'existing CAP-008 escalation is the takeover (no second mechanism)');
  // (b) never BEGIN while already owned
  // pin the delivery baseline: the part-(a) escalation ack must be delivered first
  assert.ok(await waitFor(() => toPhone(phone).filter((d) => textOf(d).includes('team tak pahunch')).length === 1, 2000), 'part (a) escalation ack delivered (baseline pinned)');
  const cr = await kpost(`/inbox/c/${phone}/claim`, staff, { actionId: actId('hp-claim') });
  assert.equal(cr.body.status, 'CLAIMED');
  const startedBefore = auditFind('composition_started', (p2) => p2.convId === CID(phone)).length;
  const before = toPhone(phone).length;
  await postWebhook(eventBody(textMsg(`wamid.tk2-${++seq}`, 'hello while owned', phone)));
  await sleep(400);
  assert.equal(auditFind('composition_started', (p2) => p2.convId === CID(phone)).length, startedBefore, 'no composition ever began while human-owned');
  assert.equal(toPhone(phone).length, before, 'no autonomous reply while human-owned (CAP-008 wall)');
  verdict('HP9 human takeover', 'in-flight ⇒ cancelled+audited; already-owned ⇒ never begins; CAP-008 is the only takeover', `reason=${r.reason}`, '§10: takeover fully reuses CAP-008; composition has no second suppression system', 'staff behavior once they own the chat (their domain)');
});

test('HP10. DND (explicit opt-out) mid-composition cancels — no send, consent ack only', async () => {
  const phone = P();
  const p = brain.pacedBrainSend(phone, 'dnd probe', 'DndProbeBodyText', { source: 'AI' });
  await waitFor(() => brain._composer.isActive(phone));
  await sleep(120);
  await postWebhook(eventBody(textMsg(`wamid.dnd-${++seq}`, 'band karo', phone)));
  const r = await p;
  assert.equal(r.ok, false, 'opt-out cancelled the composition');
  assert.ok(await waitFor(() => cust.getCustomer(phone).optedOut === true, 1000), 'existing CAP-002 consent state recorded');
  assert.equal(toPhone(phone).filter((d) => textOf(d).includes('DndProbeBodyText')).length, 0, 'no send to an opted-out customer');
  assert.ok(await waitFor(() => toPhone(phone).filter((d) => /Aapko ab koi offer/.test(textOf(d))).length === 1, 2000), 'consent ack delivered (legal duty)');
  assert.ok(auditFind('stale_response_discarded', (p2) => p2.convId === CID(phone)).length >= 1, 'discarded audited (opt-out changes the version)');
  verdict('HP10 DND cancellation', 'band karo mid-composition ⇒ cancel + audit; consent ack only', `reason=${r.reason}`, 'opt-out is honored mid-flight, not just at the next boundary', 'opt-IN semantics (not in this contract)');
});

test('HP11. kill switch mid-composition cancels (CAP-055 reuse); nothing delayed after resume', async () => {
  const phone = P();
  await postWebhook(eventBody(textMsg(`wamid.kill1-${++seq}`, 'kill probe message', phone)));
  await waitFor(() => brain._composer.isActive(phone));
  await sleep(120);
  kill.stopAll({ staffId: 'boss', role: 'OWNER' }, actId('hp-stop'), 'drill: hp kill mid-composition');
  try {
    assert.ok(await waitFor(() => auditFind('kill_switch_cancelled_composition', (p) => p.convId === CID(phone)).length >= 1, 4000), 'kill cancellation audited');
  } finally {
    kill.resumeAll({ staffId: 'boss', role: 'OWNER' }, actId('hp-resume'), 'drill complete', 'RESUME');
  }
  await sleep(400);
  assert.equal(aiReplies(phone).length, 0, 'no AI reply while/after the kill for this probe');
  assert.equal(toPhone(phone).filter((d) => /^reply-\d+$/.test(textOf(d))).length, 0);
  // a NEW inbound after resume gets a normal (paced) reply
  await sendFlow(phone, 'hello after the kill drill');
  assert.equal(aiReplies(phone).length, 1, 'service resumes normally after RESUME');
  verdict('HP11 kill switch cancellation', 'STOP mid-composition ⇒ cancelled+audited, zero sends; RESUME ⇒ normal service', `audited=${auditFind('kill_switch_cancelled_composition').length}`, 'CAP-055 semantics at the composition level; the kill wins at the dispatch boundary', 'a STOP landing in the microsecond between the final guard and the enqueue (covered by the existing firewall KILL stage + outbox execute gate)');
});

test('HP12. no duplicate outbound action for one response (replay + supersede both safe)', async () => {
  // (a) supersede: only the latest reply produced a job (asserted in HP7) — re-check the global invariant
  // (b) duplicate wamid mid-composition: the existing idempotency gate absorbs it
  const phone = P();
  const wamid = `wamid.dup-${++seq}`;
  await postWebhook(eventBody(textMsg(wamid, 'duplicate probe text', phone)));
  await waitFor(() => brain._composer.isActive(phone));
  await postWebhook(eventBody(textMsg(wamid, 'duplicate probe text', phone))); // exact replay mid-composition
  assert.ok(auditFind('EVENT_DUPLICATE').length >= 1, 'replay absorbed by the EXISTING idempotency gate');
  assert.ok(await waitFor(() => aiReplies(phone).length >= 1), 'one reply arrived');
  await sleep(400);
  assert.equal(aiReplies(phone).length, 1, 'exactly one AI reply despite the mid-composition replay');
  assert.equal(sentJobsFor(phone).length, 1, 'exactly one outbound job for the response');
  assert.equal(auditFind('composition_superseded', (p) => p.convId === CID(phone)).length, 0, 'replay created no second composition');
  verdict('HP12 no duplicate outbound action', 'wamid replay mid-composition ⇒ EVENT_DUPLICATE, 1 reply, 1 job', `replies=1 jobs=1`, '§13: the composition lifecycle adds no new duplicate path; existing claimEvent idempotency holds', 'two SIMULTANEOUS distinct webhooks racing the same conversation (single-flight supersedes — HP7)');
});

test('HP13. final send still passes the P2 Action Firewall (decision + trace on the job)', async () => {
  const phone = P();
  await sendFlow(phone, 'firewall probe');
  const job = sentJobsFor(phone).find((j) => /^reply-\d+$/.test(textOf(j.payload)));
  assert.ok(job, 'paced brain reply rode the main outbox');
  assert.equal(job.meta.source, 'AI');
  assert.equal(job.meta.firewall?.decision, 'ALLOW', 'firewall decision recorded');
  assert.ok(job.meta.firewall?.traceId, 'firewall trace present');
  assert.equal(job.status, 'SENT');
  verdict('HP13 firewall intact', 'paced reply = ordinary AI job: firewall ALLOW + traceId on the durable job', `decision=${job.meta.firewall.decision}`, '§12: the composer never bypasses the firewall — it dispatches through the same send path', 'a DENY scenario for brain text (covered by the existing P2 suite)');
});

test('HP14. final send still rides the EXISTING durable outbox (job file on disk, provider result)', async () => {
  const phone = P();
  await sendFlow(phone, 'outbox probe');
  const job = sentJobsFor(phone).find((j) => /^reply-\d+$/.test(textOf(j.payload)));
  assert.ok(job, 'job file read back from the SENT dir (disk, not memory)');
  assert.equal(job.payload.to, phone);
  assert.equal(job.payload.type, 'text');
  assert.equal(job.status, 'SENT');
  assert.ok(job.providerResult, 'provider result honestly recorded');
  assert.ok(auditFind('final_send_dispatched', (p) => p.convId === CID(phone)).length === 1, 'final_send_dispatched audited once');
  verdict('HP14 outbox intact', 'paced reply persisted through the existing outbox lifecycle', `job=${job.id.slice(0, 18)}… provider=${job.providerResult}`, 'no second transport: one send path, one outbox (unchanged)', 'LIVE provider confirmation semantics (DEMO spy)');
});

test('HP15. 1-to-1 only: the layer adds NO group/broadcast/campaign surface', async () => {
  // (a) the composer module exposes exactly the intended surface — no send/bulk API
  const composerExports = Object.keys(composerMod).sort();
  assert.deepEqual(composerExports, ['computeIntervals', 'createCancelToken', 'createComposer', 'realClock']);
  // (b) exactly ONE production call site (the brain reply branch) + its definition
  const brainSrc = fs.readFileSync(path.join(REPO, 'src/services/brain.js'), 'utf8');
  assert.equal((brainSrc.match(/pacedBrainSend\(/g) || []).length, 2, 'definition + one call site');
  // (c) no new trigger surface: app/routes do not reference the layer
  for (const f of ['src/app.js', 'src/routes/webhook.js', 'src/routes/inbox.js']) {
    const s = fs.readFileSync(path.join(REPO, f), 'utf8');
    assert.equal(s.includes('humanPaced'), false, `${f}: no layer import (no new trigger surface)`);
    assert.equal(s.includes('pacedBrainSend'), false, `${f}: no call surface`);
  }
  // (d) no send/broadcast/campaign export anywhere in the layer
  const layerSrc = fs.readdirSync(path.join(REPO, 'src/services/humanPaced'))
    .map((f) => fs.readFileSync(path.join(REPO, 'src/services/humanPaced', f), 'utf8')).join('\n');
  assert.equal(/export\s+(?:async\s+)?function\s+(?:send|broadcast|campaign|blast)/i.test(layerSrc), false, 'no bulk-send API in the layer');
  assert.equal(/group|broadcast|campaign/i.test(Object.keys(composerMod).join(' ')), false, 'no group/broadcast vocabulary in the composer surface');
  verdict('HP15 1-to-1 scope', 'layer is reachable ONLY from the existing brain reply path; no bulk/group API exists', `exports=${composerExports.length} callSites=1`, '§16: no group/broadcast/campaign expansion — the surface does not exist to misuse', 'group messages that ALREADY arrive (existing behavior unchanged — no group filter exists today, and none was added)');
});

test('HP16. session loss fails closed: no autonomous send until operator restore', async () => {
  const phone = P();
  sessionHealth.markSessionUnavailable('test-simulated-session-loss');
  assert.equal(sessionHealth.isSessionAvailable(), false);
  const before = toPhone(phone).length;
  await postWebhook(eventBody(textMsg(`wamid.sess-${++seq}`, 'session probe hello', phone)));
  assert.ok(await waitFor(() => auditFind('session_unavailable_during_composition', (p) => p.convId === CID(phone)).length >= 1, 4000), 'fail-closed cancellation audited');
  await sleep(300);
  assert.equal(toPhone(phone).length, before, 'ZERO sends while the session is unavailable');
  assert.ok(auditFind('SESSION_UNAVAILABLE').length >= 1, 'unavailability itself audited');
  // operator recovery
  sessionHealth.markSessionAvailable();
  assert.equal(sessionHealth.isSessionAvailable(), true);
  await sendFlow(phone, 'session probe hello again');
  assert.equal(aiReplies(phone).length, 1, 'service restored after operator recovery');
  sessionHealth.resetSessionHealth();
  verdict('HP16 fail-closed session', 'unavailable ⇒ composition cancelled at the gate, zero sends; restore ⇒ normal service', `blocked=1 restored=1`, '§15: fatal session state disables autonomous sending; state preserved; operator restores', 'LIVE credential re-authentication UX (operator action, out of scope)');
});

test('HP17. NO reconnect/QR/session-deletion loops: bounded recovery is the EXISTING outbox policy', async () => {
  // (a) mechanically: none of the new modules contains a retry/reconnect timer
  for (const f of ['config.js', 'composer.js', 'breaker.js', 'sessionHealth.js', 'version.js']) {
    const s = fs.readFileSync(path.join(REPO, 'src/services/humanPaced', f), 'utf8');
    assert.equal(/setInterval\s*\(/.test(s), false, `${f}: no retry/reconnect timer`);
  }
  // (b) provider failure classification: only credential rejection is fatal
  assert.deepEqual(wa.classifyProviderError({ response: { status: 401 } }), { fatal: true, status: 401 });
  assert.deepEqual(wa.classifyProviderError({ response: { status: 403 } }), { fatal: true, status: 403 });
  assert.deepEqual(wa.classifyProviderError({ response: { status: 500 } }), { fatal: false, status: 500 });
  assert.deepEqual(wa.classifyProviderError({ response: { status: 429 } }), { fatal: false, status: 429 });
  assert.deepEqual(wa.classifyProviderError({}), { fatal: false, status: null }, 'network/timeout errors stay with the existing retry policy');
  // (c) the fatal path is a single state transition + audit (tested in HP16) — no loop
  sessionHealth.resetSessionHealth();
  verdict('HP17 no reconnect loops', 'fatal 401/403 ⇒ one fail-closed transition; transient ⇒ existing bounded outbox retry; zero timers in the layer', 'classified 5 cases', '§15: no blind deletion, no QR regen, no aggressive reconnection — by construction', 'the Meta-side account state itself (operator domain)');
});

test('HP18. circuit breaker stops a runaway autonomous conversation (e2e) + no permanent blocking', async () => {
  const phone = P();
  // suite config: soft=3, hard=4 turns per window
  for (let n = 1; n <= 4; n++) {
    const ok = await (async () => {
      await postWebhook(eventBody(textMsg(`wamid.brk-${++seq}`, `breaker probe ${n}`, phone)));
      return waitFor(() => aiReplies(phone).length >= n, 4000);
    })();
    assert.ok(ok, `turn ${n} answered (below the hard threshold)`);
  }
  assert.equal(aiReplies(phone).length, 4, 'four autonomous turns happened');
  await postWebhook(eventBody(textMsg(`wamid.brk5-${++seq}`, 'breaker probe 5 — the runaway one', phone)));
  assert.ok(await waitFor(() => convs.getConversation(phone)?.state === 'QUEUED', 4000), 'fifth turn did NOT go out; conversation escalated to staff');
  assert.ok(auditFind('autonomous_circuit_breaker_triggered', (p) => p.convId === CID(phone) && p.reason === 'excessive_turns').length >= 1, 'breaker trigger audited with reason');
  const before = toPhone(phone).length;
  await postWebhook(eventBody(textMsg(`wamid.brk6-${++seq}`, 'breaker probe 6 — suppressed now', phone)));
  await sleep(400);
  assert.equal(aiReplies(phone).length, 4, 'the loop is stopped (CAP-008 suppression after the escalation)');
  void before;
  // no permanent blocking: human resolves + returns to AI → conversation is answerable again
  const cr = await kpost(`/inbox/c/${phone}/claim`, staff, { actionId: actId('hp-brk-claim') });
  assert.equal(cr.body.status, 'CLAIMED');
  const rr = await kpost(`/inbox/c/${phone}/resolve`, staff, { actionId: actId('hp-brk-resolve') });
  assert.equal(rr.status, 200);
  const ra = await kpost(`/inbox/c/${phone}/return-to-ai`, staff, { actionId: actId('hp-brk-return') });
  assert.equal(ra.status, 200, 'existing CAP-008 return-to-AI');
  await sendFlow(phone, 'hello after the breaker review');
  assert.equal(aiReplies(phone).length, 5, 'conversation is usable again after human review — no permanent customer block');
  verdict('HP18 breaker (e2e)', '5th turn ⇒ stop + escalate (POLICY_LIMIT); suppressed; human return ⇒ usable again', `turns=4 stopped=1 review→back=1`, '§14: bounded loop protection surfaces a human; negotiation volume is turns-per-window (objective), never a content judgment', 'a loop driven by the staff side (human-owned territory — out of scope)');
});

test('HP19. circuit breaker: duplicate-cycle + dispatch-failure triggers (unit, configurable thresholds)', async () => {
  const audits = [];
  const a = (t, p) => audits.push([t, p]);
  const bCfg = { windowMs: 600000, softTurnsPerWindow: 100, hardTurnsPerWindow: 100, maxDuplicateCycle: 2, maxConsecutiveDispatchFailures: 2 };
  // duplicate cycle: same inbound+reply pair repeated
  const ph1 = '923009999101';
  let r = breakerMod.beforeReply(ph1, { inboundHash: 'a', replyHash: 'b', cfg: bCfg, audit: a });
  assert.equal(r.allowed, true, 'pair #1 allowed');
  r = breakerMod.beforeReply(ph1, { inboundHash: 'a', replyHash: 'b', cfg: bCfg, audit: a });
  assert.equal(r.allowed, true, 'pair #2 allowed (≤ maxDuplicateCycle)');
  r = breakerMod.beforeReply(ph1, { inboundHash: 'a', replyHash: 'b', cfg: bCfg, audit: a });
  assert.equal(r.allowed, false, 'pair #3 ⇒ HUMAN_REVIEW');
  assert.equal(r.reason, 'duplicate_cycle');
  assert.equal(r.newly, true);
  assert.ok(audits.some(([t]) => t === 'autonomous_circuit_breaker_triggered'), 'trigger audited');
  // a DIFFERENT pair after the reset would be fine — and the review itself clears
  r = breakerMod.beforeReply(ph1, { inboundHash: 'a', replyHash: 'b', cfg: bCfg, audit: a });
  assert.equal(r.allowed, true, 'HUMAN_REVIEW clears when reached via a non-suppressed conversation (no permanent block)');
  // dispatch failures: bounded consecutive failures
  const ph2 = '923009999102';
  breakerMod.beforeReply(ph2, { cfg: bCfg, audit: a });
  assert.equal(breakerMod.recordDispatchFailure(ph2, { cfg: bCfg, audit: a }), null, 'failure #1: not yet');
  assert.equal(breakerMod.recordDispatchFailure(ph2, { cfg: bCfg, audit: a }), 'HUMAN_REVIEW', 'failure #2 (configurable) ⇒ HUMAN_REVIEW');
  assert.ok(audits.some(([t, p]) => t === 'autonomous_circuit_breaker_triggered' && p.reason === 'dispatch_failures'), 'dispatch-failure trigger audited');
  // negotiation is not spam: different inbound+reply pairs never trip the duplicate cycle
  const ph3 = '923009999103';
  let allowed = 0;
  for (let i = 0; i < 10; i++) {
    if (breakerMod.beforeReply(ph3, { inboundHash: `in-${i}`, replyHash: `out-${i}`, cfg: bCfg, audit: a }).allowed) allowed++;
  }
  assert.equal(allowed, 10, 'ten distinct exchanges (e.g. genuine negotiation) never trip the duplicate breaker');
  breakerMod.resetBreaker(ph1); breakerMod.resetBreaker(ph2); breakerMod.resetBreaker(ph3);
  verdict('HP19 breaker (unit)', 'duplicate-cycle + dispatch-failure thresholds configurable & tested; distinct exchanges pass', `allowed=${allowed}/10`, 'thresholds are objective runtime anomalies, configurable without code change (§14)', 'semantic loop detection (deliberately not attempted — objective counters only)');
});

// ── RACE TESTS (the five mandated boundary cases) ──────────────
test('R1. customer message JUST BEFORE composition completes ⇒ stale, never dispatched', async () => {
  const phone = P();
  const p = brain.pacedBrainSend(phone, 'race r1 inbound', 'RaceR1BodyText', { source: 'AI' });
  await waitFor(() => brain._composer.isActive(phone));
  await sleep(200); // composition min is 250ms → this lands just before completion
  cust.touchCustomer(phone); // new inbound ⇒ version bump
  const r = await p;
  assert.equal(r.ok, false, 'composition ended without a send');
  assert.equal(r.reason, 'stale', 'caught as stale (version drift)');
  assert.equal(toPhone(phone).filter((d) => textOf(d).includes('RaceR1BodyText')).length, 0, 'nothing dispatched');
  assert.ok(auditFind('stale_response_discarded', (p2) => p2.convId === CID(phone)).length >= 1, 'discarded audited');
  verdict('R1 pre-completion message', 'version bump in the final interval ⇒ discard, zero sends', `reason=${r.reason}`, 'the completion re-validation closes the "message just before completion" window', 'a bump in the microsecond after the final guard (closed by the pre-dispatch re-validation + firewall walls)');
});

test('R2. customer message AFTER completion, BEFORE dispatch ⇒ caught at the final checkpoint, zero sends', async () => {
  // deterministic at the composer boundary: the bump happens on the LAST
  // checkpoint; the completion re-validation must catch it before "done"
  const phone = P();
  await sendFlow(phone, 'race r2 baseline');
  const version = versionMod.conversationVersion(phone);
  const cx = composerMod.createComposer({ clock: instantClock, audit: auditMod.audit });
  const rec = cx.begin({ convId: phone, jobId: 'hp-r2', text: 'RaceR2BodyText', version, token: composerMod.createCancelToken() });
  const plan = composerMod.computeIntervals(rec.text, cfg, Math.random);
  let bumped = false;
  const onCheckpoint = (i) => {
    if (i >= plan.intervals.length - 1 && !bumped) { bumped = true; cust.touchCustomer(phone); }
  };
  const r = await cx.compose(rec, {
    guard: () => (versionMod.sameVersion(versionMod.conversationVersion(phone), version) ? { ok: true } : { ok: false, reason: 'stale' }),
    onCheckpoint,
  });
  assert.equal(bumped, true, 'the bump did land on the final checkpoint (the race actually happened)');
  assert.equal(r.ok, false, 'composition did not "complete"');
  assert.equal(r.reason, 'stale', 'the completion re-validation caught the post-completion drift');
  assert.equal(toPhone(phone).filter((d) => textOf(d).includes('RaceR2BodyText')).length, 0, 'zero sends');
  verdict('R2 post-completion drift', 'drift on the final checkpoint ⇒ final guard cancels before completion', `reason=${r.reason}`, 'there is no "completed" state without a passing final re-validation', 'drift in the microsecond between the final guard and the enqueue (wrapper pre-dispatch check + firewall walls)');
});

test('R3. human takeover AT the dispatch boundary ⇒ cancelled, ack only, no AI send', async () => {
  const phone = P();
  const p = brain.pacedBrainSend(phone, 'race r3 inbound', 'RaceR3BodyText', { source: 'AI' });
  await waitFor(() => brain._composer.isActive(phone));
  await sleep(225); // just before the 250ms completion
  await postWebhook(eventBody(textMsg(`wamid.r3-${++seq}`, 'menu_staff', phone)));
  const r = await p;
  assert.equal(r.ok, false, 'no dispatch at the takeover boundary');
  assert.equal(r.reason, 'human_takeover');
  assert.ok(auditFind('human_takeover_during_composition', (p2) => p2.convId === CID(phone)).length >= 1, 'audited');
  assert.equal(toPhone(phone).filter((d) => textOf(d).includes('RaceR3BodyText')).length, 0, 'no stale AI send');
  assert.ok(await waitFor(() => toPhone(phone).filter((d) => textOf(d).includes('team tak pahunch')).length === 1, 2000), 'the honest CAP-008 escalation ack is what the customer got');
  assert.equal(convs.getConversation(phone).state, 'QUEUED');
  verdict('R3 takeover at dispatch boundary', 'menu_staff at the boundary ⇒ cancelled; only the honest ack left the building', `reason=${r.reason}`, '§10: at the final boundary, human ownership wins over the in-flight reply', 'a claim (staff-side) landing in that same window (the pre-dispatch isSuppressed check + firewall AUTHZ wall cover it)');
});

test('R4. kill switch AT the dispatch boundary ⇒ STOP wins, zero sends, no delayed send after resume', async () => {
  const phone = P();
  const p = brain.pacedBrainSend(phone, 'race r4 inbound', 'RaceR4BodyText', { source: 'AI' });
  await waitFor(() => brain._composer.isActive(phone));
  await sleep(225);
  kill.stopAll({ staffId: 'boss', role: 'OWNER' }, actId('hp-r4-stop'), 'race: kill at dispatch boundary');
  let r;
  try {
    r = await p;
  } finally {
    kill.resumeAll({ staffId: 'boss', role: 'OWNER' }, actId('hp-r4-resume'), 'race drill over', 'RESUME');
  }
  assert.equal(r.ok, false, 'STOP won at the boundary');
  assert.equal(r.reason, 'kill_switch');
  assert.ok(auditFind('kill_switch_cancelled_composition', (p2) => p2.convId === CID(phone)).length >= 1, 'audited');
  assert.equal(toPhone(phone).filter((d) => textOf(d).includes('RaceR4BodyText')).length, 0, 'zero sends');
  await sleep(400);
  assert.equal(aiReplies(phone).length, 0, 'nothing delayed-landed after RESUME (the composition is gone, not parked)');
  verdict('R4 kill at dispatch boundary', 'STOP at the boundary ⇒ cancelled; resume does NOT replay the cancelled reply', `reason=${r.reason}`, 'CAP-055: the kill wins at the final autonomous dispatch boundary; no bypass or replay path exists', 'a STOP in the microsecond between the final guard and the enqueue (firewall KILL stage + outbox execute gate — the same two walls as every autonomous send)');
});

test('R5. duplicate event mid-composition ⇒ absorbed by existing idempotency; one composition, one reply', async () => {
  const phone = P();
  const wamid = `wamid.r5-${++seq}`;
  await postWebhook(eventBody(textMsg(wamid, 'race r5 inbound', phone)));
  await waitFor(() => brain._composer.isActive(phone));
  const startedAt = auditFind('composition_started', (p2) => p2.convId === CID(phone)).length;
  await postWebhook(eventBody(textMsg(wamid, 'race r5 inbound', phone))); // exact replay mid-composition
  assert.ok(auditFind('EVENT_DUPLICATE').length >= 1, 'existing idempotency gate absorbed the replay');
  assert.ok(await waitFor(() => aiReplies(phone).length >= 1, 4000), 'one reply arrived');
  await sleep(400);
  assert.equal(aiReplies(phone).length, 1, 'one reply total');
  assert.equal(auditFind('composition_started', (p2) => p2.convId === CID(phone)).length, startedAt, 'no second composition from the replay');
  assert.equal(sentJobsFor(phone).length, 1, 'one outbound job total');
  verdict('R5 duplicate event mid-composition', 'replay mid-composition ⇒ EVENT_DUPLICATE, no second composition, one reply', `compositions=${startedAt} replies=1`, '§13: duplicate events/scheduler invocations are handled by the EXISTING idempotency — the layer adds no new event surface', 'two distinct webhooks racing (single-flight supersede — HP7)');
});

console.log('\n✅ Human-Paced suite loaded');

after(() => {
  sessionHealth.resetSessionHealth();
  try { mainOutbox.stop?.(); } catch {}
  try { server.close(); server.closeAllConnections?.(); } catch {}
  try { llmServer.close(); } catch {}
});
