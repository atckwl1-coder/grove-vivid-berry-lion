/**
 * THE ONLY src/ file that may import the session library.
 * Not imported by brain, firewall, outbox, CRM, or the WhatsApp facade.
 * M0-proven pin: @whiskeysockets/baileys 6.7.24
 */
import { installSessionLibraryConsoleGuard } from './libraryConsoleGuard.js';
import { audit } from '../audit.js';

installSessionLibraryConsoleGuard();

function silentLogger() {
  const noop = () => {};
  const log = {
    level: 'silent',
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child() { return log; },
  };
  return log;
}

/**
 * WA emits receivedPendingNotifications only on the ib/offline stanza.
 * If offline_preview never arrives, Baileys never requests the batch and
 * RPN never fires. Request the same offline_batch Baileys sends on preview.
 * Does NOT mark CAUGHT_UP — sessionInbound still waits for the real RPN event.
 */
function requestOfflineBatch(sock) {
  if (typeof sock?.sendNode !== 'function') return;
  Promise.resolve(sock.sendNode({
    tag: 'ib',
    attrs: {},
    content: [{ tag: 'offline_batch', attrs: { count: '100' } }],
  })).catch(() => { /* best-effort protocol nudge; catch-up stays PENDING */ });
}

export async function openLibrarySocket({ authDir } = {}) {
  const lib = await import('@whiskeysockets/baileys');
  const {
    default: makeWASocket,
    Browsers,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
  } = lib;

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  let version;
  try {
    version = (await fetchLatestBaileysVersion()).version;
  } catch {
    version = undefined;
  }

  const sock = makeWASocket({
    auth: state,
    version,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    logger: silentLogger(),
  });
  sock.ev.on('creds.update', saveCreds);

  let rpn = false;
  let batchRequested = false;
  sock.ev.on('connection.update', (update = {}) => {
    if (update.receivedPendingNotifications === true) rpn = true;
    if (update.connection === 'open' && !rpn && !batchRequested) {
      batchRequested = true;
      if (typeof sock.ev.flush === 'function') {
        try { sock.ev.flush(); } catch { /* local buffer only */ }
      }
      if (typeof sock.sendNode === 'function') {
        audit('SESSION_PROTOCOL', { op: 'offline_batch_requested' });
        requestOfflineBatch(sock);
      } else {
        audit('SESSION_PROTOCOL', { op: 'offline_batch_skipped' });
      }
    }
  });

  return sock;
}

export const LIBRARY_PIN = '6.7.24';
