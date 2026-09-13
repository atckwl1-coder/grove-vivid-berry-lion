/**
 * Swallow libsignal / session-library console dumps of Signal session objects.
 * Installed before the session library runs. Does not write secrets anywhere.
 */

let installed = false;

const PHRASE = /^(Closing session:|Opening session:|Closing open session in favor|Removing old closed session:|Session already closed|Session already open|Migrating session to:|Failed to decrypt message with any known session|Session error:|Decrypted message with closed session|V1 session storage migration error)/;

export function looksLikeSignalKeyMaterial(arg) {
  if (arg == null) return false;
  if (typeof arg === 'string') {
    return /currentRatchet|privKey:\s*<Buffer|rootKey:\s*<Buffer|pendingPreKey/.test(arg);
  }
  if (typeof arg !== 'object') return false;
  if (arg.currentRatchet || arg.pendingPreKey) return true;
  if (arg.privKey && arg.pubKey) return true;
  if (arg.rootKey && (arg.ephemeralKeyPair || arg._chains)) return true;
  if (arg._chains && arg.indexInfo) return true;
  return false;
}

export function shouldDropLibraryConsoleArgs(args) {
  if (!args || !args.length) return false;
  const first = args[0];
  if (typeof first === 'string' && PHRASE.test(first)) return true;
  for (const a of args) {
    if (looksLikeSignalKeyMaterial(a)) return true;
  }
  return false;
}

export function installSessionLibraryConsoleGuard() {
  if (installed) return;
  installed = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'dir']) {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      if (shouldDropLibraryConsoleArgs(args)) return;
      orig(...args);
    };
  }
}

export function libraryConsoleGuardInstalled() {
  return installed;
}
