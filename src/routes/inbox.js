// ─────────────────────────────────────────────────────────────
//  CAP-008 — INBOX ROUTES (server-side authorization ONLY — §3)
//  Every mutation: auth → tenant → role → csrf → actionId dedupe → FSM
// ─────────────────────────────────────────────────────────────
import express from 'express';
import { config } from '../config.js';
import * as auth from '../sentinel/auth.js';
import * as conv from '../sentinel/conversations.js';
import * as wa from '../services/whatsapp.js';
import * as kill from '../sentinel/killswitch.js';
import { getCustomer, recentMessages, statedSalesFor, confirmPaidSale, listFollowups, unpaidStatedSales } from '../services/customers.js';
import { audit, auditTail } from '../sentinel/audit.js';
import { loginPage, listPage, convoPage, errorPage } from '../inbox/views.js';
import { qualificationOf } from '../services/qualification.js';
import { profileOf } from '../services/profile.js';
import { ownerSnapshot } from '../services/ops.js';
import { opsPage } from '../inbox/opsViews.js';
import { b2Preflight } from '../services/b2preflight.js';

export const inboxRouter = express.Router();

const wantsJson = (req) => req.query.json === '1' || (req.headers.accept || '').includes('application/json');

// ── auth helpers ──
function deny(req, res, code, msg) {
  if (wantsJson(req)) return res.status(code).json({ error: msg });
  if (code === 401) return res.status(401).send(loginPage(msg));
  return res.status(code).send(`<meta charset=utf-8><h3>${code} — ${msg}</h3><p><a href="/inbox">back</a></p>`);
}
function requireAuth(req, res) {
  const actor = auth.authenticate(req);
  if (actor.error) { deny(req, res, 401, actor.error); return null; }
  return actor;
}
function requireCsrf(actor, req, res) {
  if (!auth.checkCsrf(actor, req)) { deny(req, res, 403, 'CSRF_MISMATCH'); return false; }
  return true;
}
function requireOwner(actor, req, res) {
  if (actor.role !== 'OWNER') { deny(req, res, 403, 'OWNER_ONLY'); return false; }
  return true;
}
// Tenant+existence gate: wrong tenant gets 404 with ZERO conversation bytes (§3)
function requireConversation(actor, req, res) {
  const phone = req.params.phone;
  const c = conv.getConversation(phone, actor.tenant);
  if (!c) {
    audit('TENANT_DENY', { actor: { staffId: actor.staffId, role: actor.role }, tenant: actor.tenant, conversation: `${actor.tenant}:${phone}`, reason: 'not_in_tenant' });
    deny(req, res, 404, 'NOT_FOUND');
    return null;
  }
  return c;
}
// Process serves one tenant (config.tenantId). Foreign-tenant sessions get 404
// with ZERO conversation/sale bytes — same convention as requireConversation.
function requireHomeTenant(actor, req, res) {
  if (String(actor.tenant || '') !== String(config.tenantId || '')) {
    audit('TENANT_DENY', {
      actor: { staffId: actor.staffId, role: actor.role },
      tenant: actor.tenant,
      conversation: `${actor.tenant}:${req.params.phone || ''}`,
      reason: 'foreign_tenant',
    });
    deny(req, res, 404, 'NOT_FOUND');
    return false;
  }
  return true;
}
const redir = (res, phone, note) => res.redirect(`/inbox/c/${encodeURIComponent(phone)}${note ? `?note=${encodeURIComponent(note)}` : ''}`);
const httpCode = (e) => ({ NOT_FOUND: 404, ILLEGAL_TRANSITION: 409, NOT_OWNER: 403, ALREADY_CLAIMED: 409, ACTION_ID_REQUIRED: 400, NO_STATED_SALE: 409, EMPTY_BODY: 400 }[e.code] || 500);

async function handleAction(req, res, fn, okNote) {
  const actor = requireAuth(req, res); if (!actor) return;
  if (!requireCsrf(actor, req, res)) return;
  const c = requireConversation(actor, req, res); if (!c) return;
  try {
    conv.requireActionId(req.body?.actionId);
    const out = await fn(c, actor, req.body.actionId);
    const status = out.status || 'OK';
    if (wantsJson(req)) return res.json({ ok: true, status, conversation: sanitize(c, out), sale: out.sale || null });
    const note = status === 'ALREADY_APPLIED' ? 'ALREADY_APPLIED: no duplicate effect (idempotent)' :
      status === 'ALREADY_CLAIMED' ? `ALREADY_CLAIMED by ${out.claimedBy}` :
      status === 'ALREADY_CONFIRMED' ? 'ALREADY_CONFIRMED: paid sale already recorded (no duplicate follow-up)' :
      `${okNote} ✔`;
    return redir(res, c.phone, note);
  } catch (e) {
    if (wantsJson(req)) return res.status(httpCode(e)).json({ ok: false, error: e.code || 'ERROR', detail: String(e.message).slice(0, 120) });
    return res.status(httpCode(e)).send(errorPage(actor, `${e.code || 'ERROR'}: ${e.message}`));
  }
}
const sanitize = (c, out) => ({ id: c.id, phone: c.phone, state: out.conv?.state || c.state, claimedBy: out.conv?.claimedBy ?? c.claimedBy, slaStatus: c.slaStatus });

// ── LOGIN / LOGOUT (§2) ──
inboxRouter.get('/inbox/login', (_req, res) => res.send(loginPage()));
inboxRouter.post('/inbox/login', (req, res) => {
  const { id, password } = req.body || {};
  const sess = auth.verifyLogin(String(id || ''), String(password || ''));
  if (!sess) return deny(req, res, 401, 'LOGIN_FAILED');
  res.setHeader('Set-Cookie', auth.sessionCookie(sess.token));
  if (wantsJson(req)) return res.json({ ok: true, staffId: sess.staffId, role: sess.role, tenant: sess.tenant, csrf: sess.csrf, sessionToken: sess.token });
  return res.redirect('/inbox');
});
inboxRouter.get('/inbox/logout', (req, res) => {
  const token = auth.parseCookie(req.headers.cookie, 'noor_session');
  if (token) auth.destroySession(token);
  res.setHeader('Set-Cookie', auth.clearCookie());
  res.redirect('/inbox/login');
});

// ── LIST (§13) ──
inboxRouter.get('/inbox', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) return;
  const list = conv.listConversations(actor.tenant).map((c) => {
    const cust = getCustomer(c.phone);
    const q = cust?.stateData?.qualification || null;
    return { ...c, lastMessage: recentMessages(c.phone, 1)[0]?.text || '', qualification: q };
  });
  if (wantsJson(req)) return res.json({ ok: true, conversations: list.map((c) => ({ id: c.id, phone: c.phone, state: c.state, claimedBy: c.claimedBy, unread: c.unread, reason: c.reason, slaStatus: c.slaStatus, stage: c.qualification?.stage || null, lead_score: c.qualification?.lead_score ?? null })) });
  return res.send(listPage(actor, list, kill.peekState(), authCsrf(req), req.query.err || '', req.query.note || '', unpaidStatedSales()));
});

// ── CONVERSATION VIEW (§6 context + §13) ──
inboxRouter.get('/inbox/c/:phone', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) return;
  const c = requireConversation(actor, req, res); if (!c) return;
  const sales = statedSalesFor(c.phone);
  const followups = listFollowups().filter((f) => f.phone === c.phone);
  const qualification = qualificationOf(c.phone);
  const profile = profileOf(c.phone);
  const brief = {
    qualification, profile, sales, followups,
    negotiation: getCustomer(c.phone)?.stateData?.negotiation || null,
    suppressed: conv.isSuppressed(c.phone),
  };
  if (wantsJson(req)) return res.json({ ok: true, conversation: c, messages: recentMessages(c.phone, 20), sales, followups, qualification, profile });
  return res.send(convoPage(actor, c, recentMessages(c.phone, 20), authCsrf(req), req.query.err || '', req.query.note || '', sales, brief));
});
const authCsrf = (req) => auth.authenticate(req)?.csrf || '';


// ── OWNER OPS (deterministic snapshot; not a live-delivery claim) ──
inboxRouter.get('/inbox/ops', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) return;
  if (!requireOwner(actor, req, res)) return;
  const snap = ownerSnapshot({ tenant: actor.tenant });
  if (wantsJson(req)) return res.json({ ok: true, snap });
  return res.send(opsPage(actor, snap, authCsrf(req), unpaidStatedSales()));
});
inboxRouter.get('/inbox/b2', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) return;
  if (!requireOwner(actor, req, res)) return;
  const report = b2Preflight();
  if (wantsJson(req)) return res.json({ ok: true, b2: report, note: 'NOT evidence of a live test' });
  const rows = (report.checks || []).map((c) => `<tr><td>${c.id}</td><td>${c.status}</td><td>${String(c.evidence || '').slice(0, 220)}</td></tr>`).join('');
  res.send(`<!doctype html><meta charset=utf-8><title>B-2 preflight</title>
  <h3>B-2 preflight (code/config only)</h3>
  <p>CURRENT TRANSPORT = ${report.current_transport} · QR = ${report.qr_session} · live delivery = ${report.live_delivery}</p>
  <p><b>This page is NOT evidence of a live test. B-2 remains OPEN.</b></p>
  <table border=1 cellpadding=6><tr><th>check</th><th>status</th><th>evidence</th></tr>${rows}</table>
  <p><a href="/inbox">back</a></p>`);
});

// ── OWNER-ONLY: audit viewer (role separation proof) ──
inboxRouter.get('/inbox/audit', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) return;
  if (!requireOwner(actor, req, res)) return;
  const tail = auditTail(50);
  if (wantsJson(req)) return res.json({ ok: true, entries: tail });
  return res.send(`<meta charset=utf-8><title>audit</title><h3>Audit tail (owner-only)</h3><pre style="font-size:11px;white-space:pre-wrap">${tail.map((e) => JSON.stringify(e)).join('\n').replace(/</g, '&lt;')}</pre><p><a href="/inbox">back</a></p>`);
});

// ── MUTATIONS (§4 claim / §§8-11) ──
inboxRouter.post('/inbox/c/:phone/claim', (req, res) =>
  handleAction(req, res, (c, actor, actionId) => conv.claim(c.phone, actor, actionId), 'CLAIMED'));

inboxRouter.post('/inbox/c/:phone/unclaim', (req, res) =>
  handleAction(req, res, (c, actor, actionId) => conv.unclaim(c.phone, actor, actionId), 'UNCLAIMED'));

inboxRouter.post('/inbox/c/:phone/resolve', (req, res) =>
  handleAction(req, res, (c, actor, actionId) => conv.resolve(c.phone, actor, actionId), 'RESOLVED'));

inboxRouter.post('/inbox/c/:phone/return-to-ai', (req, res) =>
  handleAction(req, res, (c, actor, actionId) => conv.returnToAi(c.phone, actor, actionId), 'BACK WITH AI'));

inboxRouter.post('/inbox/c/:phone/close', (req, res) =>
  handleAction(req, res, (c, actor, actionId) => conv.closeConv(c.phone, actor, actionId), 'CLOSED'));

// V1-5.1: staff marks a stated purchase as PAID. Internal business state —
// NOT an outbound WhatsApp send. Kill switch does not apply. P2/outbox
// are not on this path. A later Day-10 follow-up (if any) still uses the
// existing kill/firewall/outbox send path.
//
// Conversation row is NOT required. Auth + CSRF + home-tenant + an
// engine-recorded stated sale are sufficient. CAP-008 FSM is not invoked.
inboxRouter.post('/inbox/c/:phone/confirm-paid', (req, res) => handleConfirmPaid(req, res));

async function handleConfirmPaid(req, res) {
  const actor = requireAuth(req, res); if (!actor) return;
  if (!requireCsrf(actor, req, res)) return;
  if (!requireHomeTenant(actor, req, res)) return;
  const phone = String(req.params.phone || '').trim();
  if (!phone) { deny(req, res, 404, 'NOT_FOUND'); return; }
  try {
    conv.requireActionId(req.body?.actionId);
    const product = String(req.body?.product || '').trim() || undefined;
    const at = String(req.body?.at || '').trim() || undefined;
    const prior = statedSalesFor(phone);
    const already = prior.some((r) => r.verification === 'paid'
      && r.outcome === 'sale'
      && (!product || r.product === product)
      && (!at || r.at === at));
    const rec = confirmPaidSale({
      phone,
      product,
      at,
      staffId: actor.staffId,
      source: 'staff',
      actionId: req.body.actionId,
    });
    if (!rec) {
      const e = new Error('NO_STATED_SALE: customer has no engine-recorded stated purchase to confirm');
      e.code = 'NO_STATED_SALE';
      throw e;
    }
    const status = already ? 'ALREADY_CONFIRMED' : 'PAID_CONFIRMED';
    const sale = {
      phone: rec.phone,
      product: rec.product,
      at: rec.at,
      verification: rec.verification,
      staffId: rec.sale_confirmation?.staffId,
    };
    const c = conv.getConversation(phone, actor.tenant);
    if (wantsJson(req)) {
      return res.json({ ok: true, status, conversation: c ? sanitize(c, { conv: c, sale }) : null, sale });
    }
    const note = status === 'ALREADY_CONFIRMED'
      ? 'ALREADY_CONFIRMED: paid sale already recorded (no duplicate follow-up)'
      : 'PAID CONFIRMED ✔';
    if (c) return redir(res, phone, note);
    return res.redirect(`/inbox?note=${encodeURIComponent(note)}`);
  } catch (e) {
    if (wantsJson(req)) return res.status(httpCode(e)).json({ ok: false, error: e.code || 'ERROR', detail: String(e.message).slice(0, 120) });
    return res.status(httpCode(e)).send(errorPage(actor, `${e.code || 'ERROR'}: ${e.message}`));
  }
}

// ── HUMAN REPLY (§7: outbox path only; §5 guard double-checks at chokepoint) ──
inboxRouter.post('/inbox/c/:phone/reply', (req, res) =>
  handleAction(req, res, async (c, actor, actionId) => {
    const body = String(req.body?.body || '').trim();
    if (!body) { const e = new Error('EMPTY_BODY'); e.code = 'EMPTY_BODY'; throw e; }
    // Policy: you must own it to speak. No silent takeover — OWNER tab pehle
    // claim kare (uniform rule, matches chokepoint guard).
    if (!['CLAIMED', 'HUMAN_ACTIVE'].includes(c.state)) {
      const e = new Error(`ILLEGAL_TRANSITION reply in ${c.state} — claim first`); e.code = 'ILLEGAL_TRANSITION'; throw e;
    }
    if (c.claimedBy !== actor.staffId) { const e = new Error(`NOT_OWNER held_by:${c.claimedBy}`); e.code = 'NOT_OWNER'; throw e; }
    if (c.appliedActions.includes(actionId)) return { conv: c, status: 'ALREADY_APPLIED' };
    // ⛓ send through THE outbox. meta.source=HUMAN passes the chokepoint guard;
    //   any AI-source send to a human-owned customer would THROW here instead.
    const job = await wa.enqueueAsHuman(c.phone, body, { staffId: actor.staffId, tenant: actor.tenant, conversation: c.id, actionId });
    const convAfter = conv.noteHumanMessage(c.phone, actor, actionId, job.id);
    return { conv: convAfter, status: 'SENT_VIA_OUTBOX' };
  }, 'Reply queued'));

// ── CAP-055 KILL SWITCH (OWNER-only mutations; STATUS staff-readable & audited) ──
inboxRouter.get('/inbox/kill', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) return;
  const s = kill.status(actor, null);
  if (wantsJson(req)) return res.json({ ok: true, kill: s });
  return res.redirect('/inbox'); // banner carries it
});

function killCmd(res, fn) {
  try {
    const out = fn();
    return res.json({ ok: true, status: out.status, state: out.state });
  } catch (e) {
    const code = { CONFIRMATION_REQUIRED: 400, REASON_REQUIRED: 400, ACTION_ID_REQUIRED: 400 }[e.code] || 500;
    return res.status(code).json({ ok: false, error: e.code });
  }
}
inboxRouter.post('/inbox/kill/status', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) return;
  return res.json({ ok: true, kill: kill.status(actor, req.body?.actionId) });
});
inboxRouter.post('/inbox/kill/stop', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) { kill.denied(req, null, 'unauthenticated_stop'); return; }
  if (actor.role !== 'OWNER') { kill.denied(req, actor, 'staff_role_cannot_stop'); return res.status(403).json({ ok: false, error: 'KILL_SWITCH_DENIED' }); }
  if (!auth.checkCsrf(actor, req)) return res.status(403).json({ ok: false, error: 'CSRF_MISMATCH' });
  return killCmd(res, () => kill.stopAll(actor, req.body?.actionId, req.body?.reason));
});
inboxRouter.post('/inbox/kill/resume', (req, res) => {
  const actor = requireAuth(req, res); if (!actor) { kill.denied(req, null, 'unauthenticated_resume'); return; }
  if (actor.role !== 'OWNER') { kill.denied(req, actor, 'staff_role_cannot_resume'); return res.status(403).json({ ok: false, error: 'KILL_SWITCH_DENIED' }); }
  if (!auth.checkCsrf(actor, req)) return res.status(403).json({ ok: false, error: 'CSRF_MISMATCH' });
  return killCmd(res, () => kill.resumeAll(actor, req.body?.actionId, req.body?.reason, req.body?.confirm));
});

export default inboxRouter;
