# CAP-001 EVENT INGESTION — SPEC
# STATUS: DERIVED EXTRACTION — created 2026-09-07 at reviewer request.
# PROVENANCE: content assembled verbatim from the artifact(s) listed below.
# These files did NOT exist during Phase-2A verification; they are faithful
# copies from the governing artifacts, not originals. No content invented.
# SOURCES:
#   - CAPABILITY_REGISTRY.yml  (SHA256: d0a6e5f7f9bbb678c6caa6f97b5ba762183fc4d04cb6d48063a2647dcb6a629f)
#   - PHASE2A_SPEC.md  (SHA256: ccc8ddfad65d330089ec27da1f7cfe8bde6fc96092e880817c1a344c51c4c793)
---
## Capability contract (verbatim from CAPABILITY_REGISTRY.yml)

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

## Phase-2A implementation spec (verbatim)

```markdown
# PHASE 2A — IMPLEMENTATION SPECIFICATION
### Verified Event Ingestion + Idempotency + Audit Trail + Durable Outbox
**Covers:** CAP-001, CAP-011 (partially CAP-002 posture) · **Sentinel §40 format**

---

**CLAIM**
Every inbound Meta event is authenticated (HMAC), deduplicated (wamid), and audit-logged BEFORE any processing. Every outbound message travels a durable outbox (queue → send → retry/backoff → DLQ) with truthful states (QUEUED/SENDING/SENT/FAILED/DLQ/UNKNOWN) and a 24h-window gate in LIVE mode. No fake success anywhere (§27).

**EVIDENCE**
- Meta webhook signing via `X-Hub-Signature-256` (HMAC-SHA256, app secret) — documented provider behavior (Phase-0 S1, verified).
- Meta retries non-200 webhooks (documented) → dedupe required.
- 24h customer-service window for free-form messages (documented) → gate required in LIVE.
- Local crash-safety: atomic rename + marker files are POSIX-guaranteed atomic on same filesystem.

**AUTHORITY**
Signature secret = Meta app secret (env). Event identity = Meta-assigned `wamid`. Window state = our DB `lastSeen` (Grade B). Outbox alone may send; nothing bypasses it.

**DEPENDENCIES**
Express raw-body capture (exists), fs rename atomicity, config env, customers.lastSeen. No new npm deps.

**FAILURE MODES** (all must become explicit states)
forged signature → 403 + audit · replayed wamid → suppressed + audit · crash mid-send → boot recovery marks UNKNOWN_REQUEUED (never assumed) · provider 5xx → backoff retry ×5 → DLQ + audit · window closed (LIVE) → DLQ with reason, never sent · concurrent same-job → rename-lock makes one winner.

**SECURITY**
Secret from env only · timingSafeEqual compare · boot REFUSAL if LIVE without appSecret · PII redaction in audit (phone masking default ON) · hash-chained audit entries (tamper-evident: each entry hashes previous hash).

**VERIFICATION** (node:test, zero new deps)
1. valid signed msg → processed once · 2. replay → duplicate suppressed · 3. forged → 403, zero effects · 4. unsigned (secret set) → 403 · 5. boot gate throws for LIVE-without-secret · 6. outbox retry×2 → success, attempts recorded · 7. permanent failure → DLQ + audit · 8. crash recovery: mid-flight job requeued once; already-final job discarded · 9. PII masked in audit file · 10. corrupt JSON read → fallback. **Plus live adversarial demo:** replay + forgery curl attacks against running server.

**REAL-WORLD STATUS:** PARTIALLY → PILOT after tests (real Meta traffic still pending; will be PROVEN in Phase 5).

**IMPLEMENTATION:**
`src/sentinel/{store,audit,idempotency,gates,outbox}.js` (new) · `src/app.js` (new, testable app builder) · modified: `config.js, index.js, routes/webhook.js, services/whatsapp.js, package.json, .env.example`

```
