// ─────────────────────────────────────────────────────────────
//  SENTINEL AUDIT TRAIL (§19) — append-only, hash-chained, PII-masked
//  Har entry pichli entry ka hash rakhti hai → tampering detect hoti hai
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { ensureDir } from './store.js';

let lastHash = 'GENESIS';

export function initAudit() {
  ensureDir(path.dirname(config.auditFile));
  try {
    const lines = fs.readFileSync(config.auditFile, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) lastHash = JSON.parse(lines[lines.length - 1]).hash;
  } catch { /* fresh start */ }
}

// Phone numbers mask kar do: 92300111222 → 9230****222 (§ privacy)
export function redact(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (!config.redactPii) return s;
  return s.replace(/\b(\d{4})\d{4,5}(\d{3})\b/g, '$1****$2');
}

export function audit(type, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    payload: safeParse(redact(payload)),
    prev: lastHash,
  };
  entry.hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ts: entry.ts, type: entry.type, payload: entry.payload, prev: entry.prev }))
    .digest('hex');
  lastHash = entry.hash;
  try {
    fs.appendFileSync(config.auditFile, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('AUDIT WRITE FAILED:', e.message); // last resort — never throw into message path
  }
  return entry;
}

export function auditTail(n = 20) {
  try {
    return fs.readFileSync(config.auditFile, 'utf8').trim().split('\n').filter(Boolean).slice(-n).map(JSON.parse);
  } catch {
    return [];
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return { note: s }; }
}
