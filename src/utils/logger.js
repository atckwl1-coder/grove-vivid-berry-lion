// PII-boundary-aware logger (2A.1): har line pehle redact hoti hai.
// RULE: primary data store (DB/outbox payloads) = sensitive zone, server-only,
// documented. ALL log/console surfaces = redacted zone. Exception kabhi nahi.
import { redact } from '../sentinel/audit.js';

const stamp = () => new Date().toISOString();
const scrub = (a) => (typeof a === 'string' ? redact(a) : a);

export const log = {
  info: (...a) => console.log(`[${stamp()}] ℹ️`, ...a.map(scrub)),
  warn: (...a) => console.warn(`[${stamp()}] ⚠️`, ...a.map(scrub)),
  error: (...a) => console.error(`[${stamp()}] ❌`, ...a.map(scrub)),
};
