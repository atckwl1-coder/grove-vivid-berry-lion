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

---

## TERMINOLOGY AMENDMENT — 2026-09-07 (Phase 2A.1 remediation, append-only; original claims above preserved)

Independent review flagged over-strong wording. Corrective action taken without rewriting history:

1. **"Exactly once" is retired.** Accurate semantics: **single delivery per accepted event** (dedupe), and **at-least-once to the provider under retry**, with truthful UNKNOWN states where transmission outcome is unknowable. Test names/comments updated; a lint test now forbids the phrase repo-wide.
2. **"Tamper-proof" was never valid; the system is tamper-EVIDENT** (detection, not prevention). Lint test enforces.
3. Audit-file limitation found during evidence export (truncation breaks GENESIS anchoring) is registered as DEBT-17 — rotation/segment design deferred per P0 scope freeze.
