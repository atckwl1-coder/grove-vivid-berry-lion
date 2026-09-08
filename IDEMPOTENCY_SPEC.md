# IDEMPOTENCY — SPECIFICATION
# STATUS: DERIVED EXTRACTION — created 2026-09-07 at reviewer request.
# PROVENANCE: content assembled verbatim from the artifact(s) listed below.
# These files did NOT exist during Phase-2A verification; they are faithful
# copies from the governing artifacts, not originals. No content invented.
# SOURCES:
#   - CAPABILITY_REGISTRY.yml  (SHA256: d0a6e5f7f9bbb678c6caa6f97b5ba762183fc4d04cb6d48063a2647dcb6a629f)
#   - src/sentinel/idempotency.js  (SHA256: fc66b070eca398f9ea98e2b836866eaf5bc516391956683e3ef00c12e52c70a2)
---
## Governing contract

```yaml
  CAP-001-verified-event-ingestion:
    claim: "Every Meta webhook is authenticated, deduplicated, and durably logged BEFORE any processing."
    purpose: "Foundation of all trust; kills duplicate-reply and spoofing (DEBT-02/03/05)."
    inputs:
      - {field: "X-Hub-Signature-256", source: meta_webhook_header, authority: meta_hmac_with_app_secret, freshness: per_request}
      - {field: "message.wamid", source: meta_webhook_payload, authority: meta, freshness: per_request}
    processing: {type: rule_engine, algorithm: "HMAC-SHA256 compare + seen-set", deterministic: true, model: none, version: n/a}
    output: {type: "event_envelope{VERIFIED|FAILED|DUPLICATE}", evidence_grade: A}
    permissions: {can_read: [webhook_payload], can_infer: [], can_recommend: [], can_execute: [log_event], human_approval_required: false}
    failure_states:
      insufficient_data: "REJECT 400, log"
      authentication_failure: "REJECT 403, alert owner, never process"
      provider_failure: "n/a (we are receiver)"
      timeout: "n/a"
      model_uncertainty: "n/a"
    verification:
      method: "attack suite: replay same webhook 10x → 1 effect; forged signature → rejected; LIVE boot without secret → refused"
      acceptance_criteria: "0/10 duplicates; 100% forged rejected; boot gate proven"
      reproducibility: "jest integration, any machine"
    production_status: PILOT   # VR-2026-09-06-01: 5/5 attack+happy-path proofs green; real Meta traffic pending (Phase-5)
    autonomy_level: L4
    risk_level: LOW
    last_verification_date: "2026-09-06"
    verification_record: VERIFICATION_LOG.md#VR-2026-09-06-01
```

## Executable specification (complete source, verbatim)

```javascript
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
  try {
    const fd = fs.openSync(file, 'wx'); // atomically fails if exists
    fs.writeSync(fd, new Date().toISOString());
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
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

```
