// ─────────────────────────────────────────────────────────────
//  EVENT IDENTITY / IDEMPOTENCY (§16)
//  Marker-file claiming: fs 'wx' = atomic create-if-absent.
//  Crash-safe by design — ya to file bani (claimed) ya nahi (duplicate).
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { ensureDir } from './store.js';

export function initIdempotency() {
  ensureDir(config.idemDir);
}

const safe = (id) => String(id).replace(/[^a-zA-Z0-9._-]/g, '_');

/** @returns true = fresh event (ab process karo) · false = duplicate (skip) */
export function claimEvent(eventId) {
  const file = path.join(config.idemDir, safe(eventId));
  const first = claimOnce(file);
  if (first === null) {
    // R1 FIX: marker dir missing at runtime (deleted / never initialized)
    // → recreate and retry ONCE. Availability defect must not become silent data loss.
    ensureDir(config.idemDir);
    return claimOnce(file);
  }
  return first;
}

function claimOnce(file) {
  try {
    const fd = fs.openSync(file, 'wx'); // atomically fails if exists
    fs.writeSync(fd, new Date().toISOString());
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false; // duplicate — normal, suppress
    if (e.code === 'ENOENT') return null;  // missing dir — recoverable, caller retries once
    throw e;                               // everything else — real failure, surface it
  }
}

// Best-effort cleanup (markers are tiny; 30 din ka retention)
export function gcIdempotency(days = 30) {
  const cutoff = Date.now() - days * 86400_000;
  for (const f of fs.readdirSync(config.idemDir)) {
    try {
      const st = fs.statSync(path.join(config.idemDir, f));
      if (st.mtimeMs < cutoff) fs.rmSync(path.join(config.idemDir, f), { force: true });
    } catch { /* ignore */ }
  }
}
