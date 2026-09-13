/**
 * Session transport adapter.
 *
 * ONLY a transport. No brain / CRM / negotiation / firewall / outbox import.
 * Reconnect lives here — not in humanPaced/sessionHealth.js.
 * Default factory is injected; live library is loaded only by librarySocket.js.
 */
import { audit } from '../audit.js';
import { createMachine } from './states.js';
import { mapCloudPayload } from './payload.js';
import { credsPresent, ensureWaSessionDir, isCorrupted } from './store.js';

const SEND_TIMEOUT_MS = 15000;
const MAX_QR = 24;
const RECONNECT_MS = 1500;

function withTimeout(promise, ms, code = 'SESSION_SEND_TIMEOUT') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const e = new Error(code);
      e.code = code;
      reject(e);
    }, ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export function createSessionAdapter(opts = {}) {
  const authDir = opts.authDir;
  const openSocket = opts.openSocket;
  const onUpsert = opts.onUpsert;
  const onConnection = opts.onConnection;
  const auditFn = opts.auditFn || audit;
  const reconnectMs = Number.isFinite(opts.reconnectMs) ? opts.reconnectMs : RECONNECT_MS;

  const machine = createMachine((rec) => {
    auditFn('SESSION_TRANSPORT', { state: rec.next, prev: rec.prev, reason: rec.reason });
  });

  let sock = null;
  let qrPayload = null;
  let qrSeq = 0;
  let starting = false;
  let reconnectTimer = null;
  let stopped = true;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function forgetQr() {
    qrPayload = null;
  }

  function publicState() {
    return {
      state: machine.state,
      qrAvailable: Boolean(qrPayload),
      qrSeq,
      creds: credsPresent(authDir),
      corrupted: isCorrupted(authDir),
    };
  }

  function health() {
    const available = machine.state === 'CONNECTED';
    return {
      available,
      state: machine.state,
      reason: available ? null : machine.state,
    };
  }

  /** Owner-only consumer. Returns QR string once; never logs it. */
  function takeQr(actor) {
    if (!actor || actor.role !== 'OWNER') {
      const e = new Error('OWNER_ONLY');
      e.code = 'OWNER_ONLY';
      throw e;
    }
    const q = qrPayload;
    return q;
  }

  function attach(socket) {
    sock = socket;
    const ev = socket?.ev;
    if (!ev || typeof ev.on !== 'function') return;

    ev.on('connection.update', (update = {}) => {
      const { connection, qr, lastDisconnect } = update;
      if (qr) {
        qrSeq += 1;
        if (qrSeq > MAX_QR) {
          forgetQr();
          machine.set('AUTH_REQUIRED', 'QR pairing window exhausted');
          if (typeof onConnection === 'function') onConnection({ ...update, connection: 'close', statusCode: 401 });
          return;
        }
        qrPayload = String(qr);
        machine.set('NEEDS_QR', 'library emitted qr');
        auditFn('SESSION_QR', { seq: qrSeq, available: true });
      }
      if (connection === 'open') {
        forgetQr();
        machine.set('CONNECTED', 'socket open');
      }
      if (connection === 'close') {
        const status = lastDisconnect?.error?.output?.statusCode
          ?? lastDisconnect?.statusCode
          ?? lastDisconnect
          ?? null;
        sock = null;
        if (status === 401) {
          clearReconnect();
          machine.set('AUTH_REQUIRED', 'loggedOut/401 — no auto QR loop');
        } else if (stopped) {
          machine.set('STOPPED', 'closed after stop');
        } else {
          machine.set('RECONNECTING', 'socket close status=' + String(status));
          scheduleReconnect();
        }
      }
      if (typeof onConnection === 'function') onConnection(update);
    });

    ev.on('messages.upsert', (event) => {
      if (typeof onUpsert === 'function') {
        Promise.resolve(onUpsert(event)).catch((err) => {
          auditFn('SESSION_INBOUND_ADAPTER_ERROR', { error: String(err?.message || err).slice(0, 160) });
        });
      }
    });
  }

  function scheduleReconnect() {
    clearReconnect();
    if (stopped) return;
    if (machine.state === 'AUTH_REQUIRED' || machine.state === 'CORRUPTED' || machine.state === 'DISABLED') return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (stopped) return;
      start().catch((err) => {
        machine.set('DEGRADED', String(err?.message || err).slice(0, 80));
      });
    }, reconnectMs);
    if (reconnectTimer.unref) reconnectTimer.unref();
  }

  async function start() {
    if (machine.state === 'DISABLED') return publicState();
    if (isCorrupted(authDir)) {
      machine.set('CORRUPTED', 'CORRUPTED flag present');
      machine.set('AUTH_REQUIRED', 'corrupted session — operator action required');
      return publicState();
    }
    stopped = false;
    if (starting) return publicState();
    starting = true;
    clearReconnect();
    machine.set('STARTING', 'adapter start');
    try {
      ensureWaSessionDir(authDir);
      const factory = openSocket || (await import('./librarySocket.js')).openLibrarySocket;
      if (typeof factory !== 'function') {
        machine.set('DISABLED', 'no socket factory');
        const e = new Error('SESSION_SOCKET_FACTORY_MISSING');
        e.code = 'SESSION_SOCKET_FACTORY_MISSING';
        throw e;
      }
      machine.set('CONNECTING', credsPresent(authDir) ? 'restore existing creds' : 'fresh socket');
      const socket = await factory({ authDir: ensureWaSessionDir(authDir) });
      attach(socket);
      return publicState();
    } catch (err) {
      if (machine.state !== 'DISABLED' && machine.state !== 'AUTH_REQUIRED' && machine.state !== 'CORRUPTED') {
        machine.set('DEGRADED', String(err?.message || err).slice(0, 80));
      }
      throw err;
    } finally {
      starting = false;
    }
  }

  async function stop() {
    stopped = true;
    clearReconnect();
    forgetQr();
    try {
      if (sock?.end) await sock.end();
      else if (sock?.ws?.close) sock.ws.close();
    } catch { /* stop is best-effort */ }
    sock = null;
    machine.set('STOPPED', 'adapter stop');
    return publicState();
  }

  async function sendFn(payload) {
    if (machine.state !== 'CONNECTED' || !sock || typeof sock.sendMessage !== 'function') {
      const e = new Error('SESSION_NOT_CONNECTED');
      e.code = 'SESSION_NOT_CONNECTED';
      throw e;
    }
    const mapped = mapCloudPayload(payload);
    const result = await withTimeout(Promise.resolve(sock.sendMessage(mapped.jid, mapped.content)), SEND_TIMEOUT_MS);
    return {
      ok: true,
      submitted: true,
      delivered: false,
      evidence: 'adapter_accepted',
      provider: 'session',
      id: result?.key?.id || null,
      fallback: Boolean(mapped.fallback),
    };
  }

  async function startTyping(_phone, jid) {
    if (machine.state !== 'CONNECTED' || typeof sock?.sendPresenceUpdate !== 'function') return null;
    try {
      await sock.sendPresenceUpdate('composing', jid);
      return { ok: true, evidence: 'adapter_accepted' };
    } catch {
      return null;
    }
  }

  async function markRead(keys) {
    if (machine.state !== 'CONNECTED' || typeof sock?.readMessages !== 'function') return null;
    try {
      await sock.readMessages(keys);
      return { ok: true, evidence: 'adapter_accepted' };
    } catch {
      return null;
    }
  }

  return {
    start,
    stop,
    sendFn,
    startTyping,
    markRead,
    takeQr,
    health,
    getState: publicState,
    get machineState() { return machine.state; },
    history: () => machine.history(),
  };
}
