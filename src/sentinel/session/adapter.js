/**
 * Session transport adapter.
 *
 * ONLY a transport. No brain / CRM / negotiation / firewall / outbox import.
 * Reconnect lives here — not in humanPaced/sessionHealth.js.
 * Default factory is injected; live library is loaded only by librarySocket.js.
 *
 * AUTH_REQUIRED is a hard in-process lock until explicit owner resetAuth()
 * or a new adapter instance (process restart). Late socket-open cannot
 * become CONNECTED. Reconnect is bounded (same defaults as outbox retry).
 */
import { audit } from '../audit.js';
import { createMachine } from './states.js';
import { mapCloudPayload } from './payload.js';
import { credsPresent, ensureWaSessionDir, isCorrupted } from './store.js';

const SEND_TIMEOUT_MS = 15000;
export const MAX_QR = 24;
/** Matches config.retry.baseMs default — no extra retry framework. */
export const RECONNECT_MS = 1500;
/** Matches config.retry.maxAttempts default. */
export const MAX_RECONNECT_ATTEMPTS = 5;

function closeStatus(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode
    ?? lastDisconnect?.statusCode
    ?? lastDisconnect
    ?? null;
}

function isPairingTimeout(status) {
  return Number(status) === 408;
}

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

function terminalAuth(state) {
  return state === 'AUTH_REQUIRED' || state === 'CORRUPTED' || state === 'DISABLED';
}

export function createSessionAdapter(opts = {}) {
  const authDir = opts.authDir;
  const openSocket = opts.openSocket;
  const onUpsert = opts.onUpsert;
  const onConnection = opts.onConnection;
  const auditFn = opts.auditFn || audit;
  const reconnectMs = Number.isFinite(opts.reconnectMs) ? opts.reconnectMs : RECONNECT_MS;
  const maxReconnectAttempts = Number.isFinite(opts.maxReconnectAttempts)
    ? opts.maxReconnectAttempts
    : MAX_RECONNECT_ATTEMPTS;

  const machine = createMachine((rec) => {
    auditFn('SESSION_TRANSPORT', { state: rec.next, prev: rec.prev, reason: rec.reason });
  });

  let sock = null;
  let companion = null;
  let gen = 0;
  let lastEnd = Promise.resolve();
  let opChain = Promise.resolve();
  let qrPayload = null;
  let qrSeq = 0;
  let starting = false;
  let reconnectTimer = null;
  let stopped = true;
  let authLocked = false;
  let reconnectAttempts = 0;
  let pairingHold = false;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function forgetQr() {
    qrPayload = null;
  }

  function isLiveSocket(socket, capturedGen) {
    return Boolean(socket) && capturedGen === gen && socket === companion;
  }

  function bumpGeneration() {
    gen += 1;
    return gen;
  }

  function releaseSocket(old, reason) {
    if (old && sock === old) sock = null;
    if (old && companion === old) companion = null;
    bumpGeneration();
    if (!old) return lastEnd;
    lastEnd = Promise.resolve()
      .then(() => {
        if (typeof old.end === 'function') return old.end();
        if (old.ws && typeof old.ws.close === 'function') old.ws.close();
        return null;
      })
      .catch(() => {});
    auditFn('SESSION_SOCKET', { socket: 'RETIRED', reason: String(reason || 'release').slice(0, 80), gen });
    return lastEnd;
  }

  async function enqueue(fn) {
    const run = opChain.then(fn, fn);
    opChain = run.catch(() => {});
    return run;
  }

  function lockAuth(reason) {
    authLocked = true;
    clearReconnect();
    forgetQr();
    pairingHold = false;
    const old = sock;
    sock = null;
    releaseSocket(old, reason);
    machine.set('AUTH_REQUIRED', reason);
  }

  function qrPhase() {
    if (pairingHold) return 'EXPIRED';
    if (machine.state === 'NEEDS_QR' && qrPayload) return 'ACTIVE';
    if (machine.state === 'NEEDS_QR') return 'EXPIRED';
    return 'NONE';
  }

  function publicState() {
    const phase = qrPhase();
    return {
      state: machine.state,
      qrAvailable: phase === 'ACTIVE',
      qrSeq,
      qrPhase: phase,
      creds: credsPresent(authDir),
      corrupted: isCorrupted(authDir),
      pairingHold,
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

  /** Owner-only consumer. Returns QR string; never logs it. */
  function takeQr(actor) {
    if (!actor || actor.role !== 'OWNER') {
      const e = new Error('OWNER_ONLY');
      e.code = 'OWNER_ONLY';
      throw e;
    }
    const q = qrPayload;
    return q;
  }

  /**
   * Owner-only: clear AUTH_REQUIRED lock so start() may re-pair.
   * Does not delete persisted credentials.
   */
  function resetAuth(actor) {
    if (!actor || actor.role !== 'OWNER') {
      const e = new Error('OWNER_ONLY');
      e.code = 'OWNER_ONLY';
      throw e;
    }
    authLocked = false;
    reconnectAttempts = 0;
    qrSeq = 0;
    pairingHold = false;
    forgetQr();
    clearReconnect();
    const old = sock;
    sock = null;
    releaseSocket(old, 'owner reset auth lock');
    machine.set('STOPPED', 'owner reset auth lock');
    return publicState();
  }

  /** Owner-only: end current socket, then start exactly one new pairing companion. */
  async function retryPairing(actor) {
    if (!actor || actor.role !== 'OWNER') {
      const e = new Error('OWNER_ONLY');
      e.code = 'OWNER_ONLY';
      throw e;
    }
    return enqueue(async () => {
      resetAuth(actor);
      await lastEnd;
      return start({ ownerRetry: true });
    });
  }

  function attach(socket) {
    if (companion && companion !== socket) bumpGeneration();
    companion = socket;
    sock = socket;
    const capturedGen = gen;
    const ev = socket?.ev;
    if (!ev || typeof ev.on !== 'function') return;

    ev.on('connection.update', (update = {}) => {
      if (!isLiveSocket(socket, capturedGen)) return;
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        if (authLocked || terminalAuth(machine.state) || machine.state === 'DEGRADED') {
          forgetQr();
        } else {
          qrSeq += 1;
          if (qrSeq > MAX_QR) {
            lockAuth('QR pairing window exhausted');
            if (typeof onConnection === 'function') {
              onConnection({ ...update, connection: 'close', statusCode: 401 });
            }
            try { if (socket?.end) socket.end(); } catch { /* best-effort */ }
            return;
          }
          qrPayload = String(qr);
          pairingHold = false;
          machine.set('NEEDS_QR', 'library emitted qr');
          auditFn('SESSION_QR', { seq: qrSeq, available: true });
        }
      }

      if (connection === 'open') {
        if (!isLiveSocket(socket, capturedGen)) return;
        if (authLocked || terminalAuth(machine.state)) {
          forgetQr();
          sock = null;
          try { if (socket?.end) socket.end(); } catch { /* refuse live use */ }
        } else {
          forgetQr();
          pairingHold = false;
          reconnectAttempts = 0;
          sock = socket;
          machine.set('CONNECTED', 'socket open');
        }
      }

      if (connection === 'close') {
        if (!isLiveSocket(socket, capturedGen)) return;
        const status = closeStatus(lastDisconnect);
        /* Pairing window: 408 timedOut/connectionLost must NOT mint a new
         * companion. QR may still refresh on THIS socket. Owner retry
         * is the only way to replace it. */
        if (machine.state === 'NEEDS_QR' && isPairingTimeout(status)) {
          clearReconnect();
          forgetQr();
          pairingHold = true;
          auditFn('SESSION_PAIRING_HOLD', { status: 408, seq: qrSeq, qrAvailable: false });
        } else {
          if (sock === socket) sock = null;
          if (authLocked || machine.state === 'AUTH_REQUIRED') {
            clearReconnect();
            forgetQr();
          } else if (status === 401) {
            lockAuth('loggedOut/401 — no auto QR loop');
          } else if (stopped) {
            machine.set('STOPPED', 'closed after stop');
          } else if (machine.state === 'DEGRADED' || machine.state === 'DISABLED' || machine.state === 'CORRUPTED') {
            /* stay — no reconnect */
          } else {
            machine.set('RECONNECTING', 'socket close status=' + String(status));
            scheduleReconnect();
          }
        }
      }

      if (isLiveSocket(socket, capturedGen) && typeof onConnection === 'function') onConnection(update);
    });

    ev.on('messages.upsert', (event) => {
      if (!isLiveSocket(socket, capturedGen)) return;
      if (typeof onUpsert === 'function') {
        Promise.resolve(onUpsert(event)).catch((err) => {
          auditFn('SESSION_INBOUND_ADAPTER_ERROR', { error: String(err?.message || err).slice(0, 160) });
        });
      }
    });
  }

  function scheduleReconnect() {
    clearReconnect();
    if (stopped || authLocked || terminalAuth(machine.state) || machine.state === 'DEGRADED' || machine.state === 'NEEDS_QR') return;
    reconnectAttempts += 1;
    if (reconnectAttempts > maxReconnectAttempts) {
      machine.set('DEGRADED', 'reconnect budget exhausted');
      return;
    }
    const delay = reconnectMs * reconnectAttempts;
    const capturedGen = gen;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (capturedGen !== gen) return;
      if (stopped || authLocked || terminalAuth(machine.state)) return;
      start({ fromReconnect: true }).catch((err) => {
        if (!authLocked && machine.state !== 'AUTH_REQUIRED') {
          machine.set('DEGRADED', String(err?.message || err).slice(0, 80));
        }
      });
    }, delay);
    if (reconnectTimer.unref) reconnectTimer.unref();
  }

  async function start(startOpts = {}) {
    if (machine.state === 'DISABLED') return publicState();
    if (isCorrupted(authDir)) {
      machine.set('CORRUPTED', 'CORRUPTED flag present');
      lockAuth('corrupted session — operator action required');
      return publicState();
    }
    if (authLocked || machine.state === 'AUTH_REQUIRED') {
      machine.set('AUTH_REQUIRED', 'auth locked until owner reset');
      return publicState();
    }
    if (!startOpts.ownerRetry && sock && machine.state === 'CONNECTED') {
      return publicState();
    }
    /* Do not replace an active pairing companion. Owner retry only. */
    if (machine.state === 'NEEDS_QR' && !startOpts.ownerRetry) {
      return publicState();
    }
    if (startOpts.ownerRetry) await lastEnd;
    stopped = false;
    if (starting) return publicState();
    starting = true;
    clearReconnect();
    if (!startOpts.fromReconnect) reconnectAttempts = 0;
    machine.set('STARTING', 'adapter start');
    const capturedGen = gen;
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
      if (authLocked || machine.state === 'AUTH_REQUIRED' || capturedGen !== gen) {
        try { if (socket?.end) await socket.end(); } catch { /* */ }
        return publicState();
      }
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
    const old = sock;
    sock = null;
    if (companion === old) companion = null;
    await releaseSocket(old, 'adapter stop');
    if (authLocked || machine.state === 'AUTH_REQUIRED') {
      machine.set('AUTH_REQUIRED', 'stopped — auth still locked');
    } else {
      machine.set('STOPPED', 'adapter stop');
    }
    return publicState();
  }

  async function sendFn(payload) {
    if (authLocked || machine.state !== 'CONNECTED' || !sock || typeof sock.sendMessage !== 'function') {
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
    if (authLocked || machine.state !== 'CONNECTED' || typeof sock?.sendPresenceUpdate !== 'function') return null;
    try {
      await sock.sendPresenceUpdate('composing', jid);
      return { ok: true, evidence: 'adapter_accepted' };
    } catch {
      return null;
    }
  }

  async function markRead(keys) {
    if (authLocked || machine.state !== 'CONNECTED' || typeof sock?.readMessages !== 'function') return null;
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
    resetAuth,
    retryPairing,
    health,
    getState: publicState,
    get machineState() { return machine.state; },
    history: () => machine.history(),
  };
}
