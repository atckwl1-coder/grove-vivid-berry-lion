/**
 * WhatsApp session credential directory.
 * Distinct from CAP-008 SESSIONS_DIR (staff cookies).
 * Never log file contents. ACL 0700.
 */
import fs from 'fs';
import path from 'path';
import { config } from '../../config.js';
import { ensureDir } from '../store.js';

export function waSessionDir(override) {
  return path.resolve(override || config.waSessionDir || './data/wa-session');
}

export function ensureWaSessionDir(dir) {
  const d = waSessionDir(dir);
  ensureDir(d);
  try { fs.chmodSync(d, 0o700); } catch { /* platform may ignore */ }
  return d;
}

export function credsPresent(dir) {
  const file = path.join(waSessionDir(dir), 'creds.json');
  try {
    return fs.existsSync(file) && fs.statSync(file).size > 32;
  } catch {
    return false;
  }
}

/** Last-4 digits of the linked session identity. Never returns the full number or keys. */
export function maskedMeIdentity(dir) {
  const file = path.join(waSessionDir(dir), 'creds.json');
  try {
    const creds = JSON.parse(fs.readFileSync(file, 'utf8'));
    const raw = String(creds?.me?.id || '');
    const digits = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (digits.length >= 8) return `TEST …${digits.slice(-4)}`;
    return credsPresent(dir) ? 'TEST (linked)' : 'none';
  } catch {
    return credsPresent(dir) ? 'TEST (linked)' : 'none';
  }
}

export function markCorrupted(dir, note) {
  const d = ensureWaSessionDir(dir);
  const flag = path.join(d, 'CORRUPTED');
  fs.writeFileSync(flag, String(note || 'corrupted').slice(0, 200));
  try { fs.chmodSync(flag, 0o600); } catch { /* */ }
  return flag;
}

export function isCorrupted(dir) {
  return fs.existsSync(path.join(waSessionDir(dir), 'CORRUPTED'));
}
