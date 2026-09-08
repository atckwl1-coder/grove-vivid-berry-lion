# AUDIT TRAIL — SPECIFICATION
# STATUS: DERIVED EXTRACTION — created 2026-09-07 at reviewer request.
# PROVENANCE: content assembled verbatim from the artifact(s) listed below.
# These files did NOT exist during Phase-2A verification; they are faithful
# copies from the governing artifacts, not originals. No content invented.
# SOURCES:
#   - src/sentinel/audit.js  (SHA256: c468487e7fb48617334e736d2a2dfcce7b9dc1447a3feaab4e8ad12d0c510478)
#   - evidence/audit-trail-dump.jsonl  (SHA256: 1ee2d22a4ac96b69f396fb31c56be202c5df68fd27e83be8f2f7d7661cb012fc)
---
## Executable specification (complete source, verbatim)

```javascript
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

```

## Live entry schema (verbatim evidence capture)

```json
{"ts":"2026-09-07T16:51:21.803Z","type":"BOOT","payload":{"mode":"DEMO","port":3000,"sentinel":"phase2a","signatureEnforcement":true},"prev":"GENESIS","hash":"4b0a33d8fdd9d6d504ce4ae82fea7fd5b2a3cbdc9ff0d2451415dfeb63c424d9"}
{"ts":"2026-09-07T16:51:27.989Z","type":"WEBHOOK_FORGED","payload":{"hadHeader":true},"prev":"4b0a33d8fdd9d6d504ce4ae82fea7fd5b2a3cbdc9ff0d2451415dfeb63c424d9","hash":"dd325800df62d34d861b672f8f36f9a9cdba09d5c198cf4f45eb09af987bd484"}
{"ts":"2026-09-07T16:51:27.996Z","type":"EVENT_RECEIVED","payload":{"id":"wamid.evidence-001","from":"9230****567","type":"text"},"prev":"dd325800df62d34d861b672f8f36f9a9cdba09d5c198cf4f45eb09af987bd484","hash":"7b18e1446f8ac8bc8e83666d8b168bd38903e8cb862178acae57896c360fe430"}
{"ts":"2026-09-07T16:51:27.998Z","type":"OUTBOX_QUEUED","payload":{"id":"job-mtrh9n5p-d07d62af","to":"9230****567","msgType":"interactive"},"prev":"7b18e1446f8ac8bc8e83666d8b168bd38903e8cb862178acae57896c360fe430","hash":"49fd2a87d2cfb04b8bf927a38e525d3c510dfcf43ff1103b5a53d8230e52505a"}
{"ts":"2026-09-07T16:51:27.998Z","type":"EVENT_PROCESSED","payload":{"id":"wamid.evidence-001"},"prev":"49fd2a87d2cfb04b8bf927a38e525d3c510dfcf43ff1103b5a53d8230e52505a","hash":"60ec7594c920973a6cacd7d7c64e684ed5eb99b2a2773bff79b8cb70f6923292"}
{"ts":"2026-09-07T16:51:29.006Z","type":"EVENT_DUPLICATE","payload":{"id":"wamid.evidence-001"},"prev":"60ec7594c920973a6cacd7d7c64e684ed5eb99b2a2773bff79b8cb70f6923292","hash":"4c88a6d6664fdf49bb9d53d79c8a87dca92c5de1662b979b633109de799e30c9"}
{"ts":"2026-09-07T16:51:29.805Z","type":"OUTBOX_SENT","payload":{"id":"job-mtrh9n5p-d07d62af","to":"9230****567","attempts":0},"prev":"4c88a6d6664fdf49bb9d53d79c8a87dca92c5de1662b979b633109de799e30c9","hash":"9d05201a1e8fc3576f631fe60f3f6656a62a9269265969d3e5a76b535b26f8ee"}

```
