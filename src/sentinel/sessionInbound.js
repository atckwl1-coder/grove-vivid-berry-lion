/**
 * Session inbound catch-up + durable idempotency.
 *
 * NOT a live companion client. NOT a send path. NOT activated at boot.
 * Does not import a session library. Does not call Meta.
 *
 * Path (when a future cycle activates ingest):
 *   session upsert {messages, type: notify|append}
 *     → normalize to Cloud-shaped {from,id,type,text}
 *     → claimEvent('sess:' + provider key.id)   // existing durable store
 *     → deliver(normalized)                     // existing handleIncomingMessage
 *
 * CONNECTED (socket open) is not CAUGHT_UP. CAUGHT_UP is only after
 * receivedPendingNotifications=true (library offline flush complete).
 *
 * append during catch-up is outage mail and MUST be considered.
 * append after CAUGHT_UP is history/backfill and is not a new customer turn.
 * That split is library-typed (notify vs append + pending-notifications),
 * not an invented age in seconds.
 *
 * Recovery machines (not equivalent):
 *   A customer device offline — sender-side; Sentinel does nothing.
 *   B process stopped        — no socket; on boot catch-up PENDING.
 *   C process alive, network down — RECONNECTING; catch-up PENDING.
 *   D auth-invalid / logged-out — AUTH_REQUIRED; no QR loop; no ingest.
 */
import { claimEvent } from './idempotency.js';
import { audit } from './audit.js';

export const SESSION_CLAIM_PREFIX = 'sess:';
export const UPSERT_NOTIFY = 'notify';
export const UPSERT_APPEND = 'append';

const AUTH_INVALID = new Set([401]); // logged-out
const NETWORK_CLOSE = new Set([408, 428, 440, 503, 515]); // timeout / close / replace / restart

const EMPTY_STATE = () => ({
  socket: 'STOPPED',
  catchup: 'PENDING',
  receivedPendingNotifications: false,
  lastDisconnect: null,
  recovery: 'B',
  inbound: 'hold',
  outbound: 'not_activated',
});

let state = EMPTY_STATE();

export function resetSessionInboundState() {
  state = EMPTY_STATE();
  return snapshot();
}

function snapshot() {
  return { ...state };
}

export function getSessionInboundState() {
  return snapshot();
}

export function isCaughtUp() {
  return state.catchup === 'CAUGHT_UP' && state.socket === 'CONNECTED'
    && state.receivedPendingNotifications === true
    && state.recovery !== 'D';
}

export function sessionClaimId(providerId) {
  return SESSION_CLAIM_PREFIX + String(providerId);
}

export const RECOVERY = Object.freeze({
  A: Object.freeze({
    id: 'A',
    name: 'customer_device_offline',
    state: 'sentinel_uninvolved',
    automatic_action: 'none — sender queues on their own device',
    inbound: 'nothing until the sender network delivers to WhatsApp',
    outbound: 'unchanged / not activated',
    retry: 'n/a (not a Sentinel failure)',
    escalation: 'none',
  }),
  B: Object.freeze({
    id: 'B',
    name: 'sentinel_process_stopped',
    state: 'STOPPED',
    automatic_action: 'on boot: restore creds, socket CONNECTING, catchup PENDING',
    inbound: 'none while down; after restore, notify+append through durable claim',
    outbound: 'not_activated',
    retry: 'process restart from saved creds — no QR loop',
    escalation: 'if restore yields 401 → D',
  }),
  C: Object.freeze({
    id: 'C',
    name: 'sentinel_alive_network_down',
    state: 'RECONNECTING',
    automatic_action: 'reconnect from saved creds; catchup PENDING until pending notifications flush',
    inbound: 'hold until socket open; then notify+append through durable claim',
    outbound: 'not_activated',
    retry: 'library reconnect (408/428) — not logout',
    escalation: 'if 401 → D',
  }),
  D: Object.freeze({
    id: 'D',
    name: 'session_auth_invalid',
    state: 'AUTH_REQUIRED',
    automatic_action: 'stop ingest; do not auto-loop QR',
    inbound: 'reject — cannot decrypt or restore',
    outbound: 'blocked',
    retry: 'none without owner re-pair',
    escalation: 'owner-authorized re-pair only',
  }),
});

export function recoveryFor(kind) {
  return RECOVERY[kind] || null;
}

export function classifyClose(statusCode) {
  const n = Number(statusCode);
  if (AUTH_INVALID.has(n)) return 'D';
  if (NETWORK_CLOSE.has(n) || Number.isFinite(n)) return 'C';
  return 'C';
}

export function noteProcessStop() {
  state.socket = 'STOPPED';
  state.catchup = 'PENDING';
  state.receivedPendingNotifications = false;
  state.recovery = 'B';
  state.inbound = 'hold';
  state.outbound = 'not_activated';
  audit('SESSION_SOCKET', { socket: state.socket, catchup: state.catchup, recovery: 'B' });
  return snapshot();
}

export function noteProcessStart() {
  // Boot after B: we are not CONNECTED and not CAUGHT_UP until the library says so.
  state.socket = 'CONNECTING';
  state.catchup = 'PENDING';
  state.receivedPendingNotifications = false;
  state.recovery = 'B';
  state.inbound = 'hold';
  state.outbound = 'not_activated';
  audit('SESSION_SOCKET', { socket: state.socket, catchup: state.catchup, recovery: 'B', note: 'boot' });
  return snapshot();
}

export function noteConnectionUpdate(update = {}) {
  const connection = update.connection;
  const rpn = update.receivedPendingNotifications;
  const status = update.lastDisconnect?.error?.output?.statusCode
    ?? update.lastDisconnect?.statusCode
    ?? update.statusCode
    ?? null;

  if (connection === 'connecting') {
    state.socket = 'CONNECTING';
    state.catchup = 'PENDING';
    state.receivedPendingNotifications = false;
    state.inbound = 'hold';
    if (state.recovery !== 'D') state.recovery = state.recovery === 'B' ? 'B' : 'C';
  }

  if (connection === 'open') {
    state.socket = 'CONNECTED';
    state.lastDisconnect = null;
    if (state.recovery === 'D') {
      /* stay D until owner re-pair — open after 401 is not trusted here */
    } else {
      state.recovery = 'C'; // process is alive
      if (rpn === true) markCaughtUp();
      else {
        state.catchup = 'PENDING';
        state.receivedPendingNotifications = false;
        state.inbound = 'catchup';
      }
    }
  }

  if (connection === 'close') {
    state.lastDisconnect = status;
    const kind = classifyClose(status);
    if (kind === 'D') {
      state.socket = 'AUTH_REQUIRED';
      state.catchup = 'PENDING';
      state.receivedPendingNotifications = false;
      state.recovery = 'D';
      state.inbound = 'reject';
      state.outbound = 'blocked';
    } else {
      state.socket = 'RECONNECTING';
      state.catchup = 'PENDING';
      state.receivedPendingNotifications = false;
      state.recovery = 'C';
      state.inbound = 'hold';
      state.outbound = 'not_activated';
    }
  }

  if (rpn === true && state.socket === 'CONNECTED' && state.recovery !== 'D') {
    markCaughtUp();
  }

  audit('SESSION_SOCKET', {
    socket: state.socket,
    catchup: state.catchup,
    recovery: state.recovery,
    receivedPendingNotifications: state.receivedPendingNotifications,
    lastDisconnect: state.lastDisconnect,
  });
  return snapshot();
}

function markCaughtUp() {
  state.catchup = 'CAUGHT_UP';
  state.receivedPendingNotifications = true;
  state.inbound = 'live';
  audit('SESSION_CATCHUP', { catchup: 'CAUGHT_UP' });
}

export function digitsFromJid(jid) {
  if (jid == null) return null;
  const s = String(jid).trim();
  if (!s) return null;
  const user = s.split('@')[0].split(':')[0];
  const digits = user.replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return null;
  return digits;
}

export function isGroupJid(jid) {
  return String(jid || '').includes('@g.us');
}

export function isStatusJid(jid) {
  const s = String(jid || '');
  return s === 'status@broadcast' || s.endsWith('@broadcast');
}

export function providerIdOf(msg) {
  const id = msg?.key?.id;
  return (typeof id === 'string' && id.length > 0) ? id : null;
}

export function isHistoryProtocol(msg) {
  const m = msg?.message;
  if (!m || typeof m !== 'object') return false;
  if (m.protocolMessage && (m.protocolMessage.historySyncNotification || m.protocolMessage.type === 5)) {
    return true;
  }
  if (m.messageStubType) return true;
  const hasBody = Boolean(m.conversation || m.extendedTextMessage?.text);
  if (m.senderKeyDistributionMessage && !hasBody) return true;
  return false;
}

export function normalizeSessionMessage(msg) {
  const id = providerIdOf(msg);
  if (!id) return { ok: false, reason: 'SKIP_NO_ID' };
  if (msg?.key?.fromMe) return { ok: false, reason: 'SKIP_FROM_ME', id };
  const jid = msg?.key?.remoteJid;
  if (isGroupJid(jid) || isStatusJid(jid)) return { ok: false, reason: 'SKIP_NON_CUSTOMER', id };
  const from = digitsFromJid(jid);
  if (!from) return { ok: false, reason: 'SKIP_BAD_JID', id };
  if (isHistoryProtocol(msg)) return { ok: false, reason: 'SKIP_HISTORY', id };

  const body = msg?.message?.conversation
    || msg?.message?.extendedTextMessage?.text
    || '';
  const type = body ? 'text' : (msg?.message?.imageMessage ? 'image' : (msg?.message?.audioMessage ? 'audio' : 'text'));
  const normalized = {
    id,
    from,
    type,
    text: body ? { body } : undefined,
    image: msg?.message?.imageMessage ? { caption: msg.message.imageMessage.caption || '' } : undefined,
    audio: msg?.message?.audioMessage ? { id: msg.message.audioMessage.id || id } : undefined,
  };
  return { ok: true, id, normalized };
}

function upsertTypeOk(type) {
  return type === UPSERT_NOTIFY || type === UPSERT_APPEND;
}

function shouldAcceptType(type) {
  if (type === UPSERT_NOTIFY) return { ok: true };
  if (type === UPSERT_APPEND) {
    if (state.catchup === 'CAUGHT_UP' && state.receivedPendingNotifications) {
      return { ok: false, reason: 'SKIP_STALE_APPEND' };
    }
    // PENDING / DRAINING: append is the offline buffer. Accept.
    return { ok: true };
  }
  return { ok: false, reason: 'SKIP_UNKNOWN_TYPE' };
}

function activated(ctx) {
  if (ctx && ctx.activated === true) return true;
  return process.env.SESSION_INBOUND_ACTIVATED === '1';
}

/**
 * Ingest one library upsert. Default: NOT activated (no customer-inbox).
 * Pass { activated: true, deliver } from tests / a future authorized wire.
 * deliver MUST be the existing incoming handler (handleIncomingMessage).
 */
export async function ingestSessionUpsert(event = {}, ctx = {}) {
  if (!activated(ctx)) {
    return { accepted: 0, results: [{ accepted: false, reason: 'NOT_ACTIVATED' }], state: snapshot() };
  }
  if (state.recovery === 'D' || state.socket === 'AUTH_REQUIRED') {
    return { accepted: 0, results: [{ accepted: false, reason: 'AUTH_REQUIRED' }], state: snapshot() };
  }
  if (state.socket === 'STOPPED' || state.socket === 'CONNECTING' || state.socket === 'RECONNECTING') {
    // Socket not open: do not claim (claim-then-drop would poison durable store).
    return { accepted: 0, results: [{ accepted: false, reason: 'SOCKET_HOLD', socket: state.socket }], state: snapshot() };
  }

  const type = event.type;
  const typeGate = shouldAcceptType(type);
  const messages = Array.isArray(event.messages) ? event.messages : [];
  const results = [];
  let accepted = 0;

  for (const msg of messages) {
    const n = normalizeSessionMessage(msg);
    if (!n.ok) {
      if (n.reason === 'SKIP_HISTORY' && n.id) {
        // Burn history ids so they can never become a customer turn later.
        claimEvent(sessionClaimId(n.id));
      }
      audit('SESSION_INBOUND_SKIP', { reason: n.reason, id: n.id || null, upsertType: type });
      results.push({ accepted: false, reason: n.reason, id: n.id || null });
      continue;
    }
    if (!typeGate.ok) {
      audit('SESSION_INBOUND_SKIP', { reason: typeGate.reason, id: n.id, upsertType: type });
      results.push({ accepted: false, reason: typeGate.reason, id: n.id, upsertType: type });
      continue;
    }
    if (!upsertTypeOk(type)) {
      results.push({ accepted: false, reason: 'SKIP_UNKNOWN_TYPE', id: n.id });
      continue;
    }

    const claimId = sessionClaimId(n.id);
    const fresh = claimEvent(claimId);
    if (!fresh) {
      audit('EVENT_DUPLICATE', { id: n.id, path: 'session', upsertType: type });
      results.push({ accepted: false, duplicate: true, reason: 'DUPLICATE', id: n.id, upsertType: type });
      continue;
    }

    audit('EVENT_RECEIVED', { id: n.id, from: n.normalized.from, type: n.normalized.type, path: 'session', upsertType: type, catchup: state.catchup });
    try {
      if (typeof ctx.deliver !== 'function') {
        // Fail closed AFTER claim would poison. Only reachable if a caller
        // activates ingest without a deliver — treat as EVENT_FAILED and
        // do not invent a second processor.
        audit('EVENT_FAILED', { id: n.id, error: 'NO_DELIVER' });
        results.push({ accepted: false, reason: 'NO_DELIVER', id: n.id, claimed: true });
        continue;
      }
      await ctx.deliver(n.normalized, ctx.profileName || '');
      audit('EVENT_PROCESSED', { id: n.id, path: 'session' });
      accepted += 1;
      results.push({ accepted: true, reason: 'CLAIMED', id: n.id, upsertType: type, normalized: n.normalized });
    } catch (err) {
      audit('EVENT_FAILED', { id: n.id, error: String(err?.message || err) });
      results.push({ accepted: false, reason: 'DELIVER_FAILED', id: n.id, claimed: true, error: String(err?.message || err) });
    }
  }

  return { accepted, results, state: snapshot() };
}
