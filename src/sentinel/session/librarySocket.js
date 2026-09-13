/**
 * THE ONLY src/ file that may import the session library.
 * Not imported by brain, firewall, outbox, CRM, or the WhatsApp facade.
 * M0-proven pin: @whiskeysockets/baileys 6.7.24
 */
import { useMultiFileAuthState } from '@whiskeysockets/baileys';

function silentLogger() {
  const noop = () => {};
  const log = {
    level: 'silent',
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child() { return log; },
  };
  return log;
}

export async function openLibrarySocket({ authDir } = {}) {
  const lib = await import('@whiskeysockets/baileys');
  const {
    default: makeWASocket,
    Browsers,
    fetchLatestBaileysVersion,
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
  return sock;
}

export const LIBRARY_PIN = '6.7.24';
