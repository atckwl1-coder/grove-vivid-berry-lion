# VERIFICATION TEST MATRIX
# STATUS: DERIVED EXTRACTION — created 2026-09-07 at reviewer request.
# PROVENANCE: content assembled verbatim from the artifact(s) listed below.
# These files did NOT exist during Phase-2A verification; they are faithful
# copies from the governing artifacts, not originals. No content invented.
# SOURCES:
#   - VERIFICATION_LOG.md  (SHA256: 24f7068e1f8d6659750b3b7a95b33c3f6884a422354d76db1a502237018c6cba)
#   - tests/phase2a.test.js  (SHA256: bb398a60f41143fe9ecb3007911f37d864c83812d03acb517a4d434121797e84)
---
## Results matrices (verbatim — VERIFICATION_LOG.md)

```markdown
# 📜 SENTINEL VERIFICATION LOG (§35)
# A claim without a verification record is not considered proven.

---

## VR-2026-09-06-01 — CAP-001 Verified Event Ingestion + Idempotency

- **Claim:** Inbound events are HMAC-authenticated, deduplicated by wamid, and audit-logged before processing.
- **Environment:** Node v20.20.2, sandbox, DEMO transport (no Meta network calls) — *limitation noted honestly.*
- **Method:** 5 automated tests (node:test) + live adversarial attack on running server (curl).
- **Results:**

| # | Test / Attack | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | Valid signed event | processed, reply delivered ONCE | 1 delivery, EVENT_RECEIVED+PROCESSED audited | ✅ PASS |
| 2 | Replay same wamid (valid sig) | suppressed | EVENT_DUPLICATE, 0 extra deliveries | ✅ PASS |
| 3 | Forged signature | blocked, zero side effects | WEBHOOK_FORGED, 0 deliveries | ✅ PASS |
| 4 | Unsigned request (secret set) | blocked | blocked, 0 deliveries | ✅ PASS |
| 5 | LIVE boot without appSecret | boot refusal | `SENTINEL BOOT REFUSAL` thrown | ✅ PASS |

- **Acceptance criteria from contract:** 0/10 duplicates ✅ · 100% forged rejected (1/1 + fuzz via tests) ✅ · boot gate ✅
- **Result:** PASS
- **Timestamp:** 2026-09-06
- **Provider/model version:** n/a (no LLM involved — deterministic)
- **Known limitations (truth):** Verified against *simulated* Meta payloads in DEMO. Real Cloud API webhook contract (field paths, real signature secrecy, Meta retry cadence) = **NOT PROVEN until Phase-5 live validation.** Status granted: **PILOT**, not VERIFIED_PRODUCTION.

---

## VR-2026-09-06-02 — CAP-011 Durable Outbox

- **Claim:** No outbound message is silently lost; no success is fabricated; crashes recover honestly; retries can't duplicate.
- **Method:** 5 automated tests incl. chaos/recovery + code-path adversarial review.
- **Results:**

| # | Test | Expected | Actual | Result |
|---|---|---|---|---|
| 6 | Provider fails ×2 then OK | retry w/ backoff → SENT, attempts=2 recorded | exact | ✅ PASS |
| 7 | Provider permanently dead | DLQ after maxAttempts + OUTBOX_DLQ audit | exact | ✅ PASS |
| 8a | Crash mid-send (stranded SENDING) | requeued as UNKNOWN_REQUEUED, sent exactly once | 1 send, honest audit label | ✅ PASS |
| 8b | Crash AFTER final write | recovery DISCARDS, never re-sends | 0 sends, RECOVERY_DISCARDED_ALREADY_FINAL | ✅ PASS |
| 9 | PII in audit | masked (`9230****222`) | regex-verified absent raw | ✅ PASS |
| 10 | Corrupt state file | explicit fallback, no crash | exact | ✅ PASS |

- **Adversarial finding DURING verification (documented honestly):** first implementation conflated *bookkeeping failure* with *send failure* → would triple-send a succeeded message. Caught by test suite (4 failing tests), fixed structurally: after send success, bookkeeping errors produce `SENT_WITH_AUDIT_GAP`, never a retry. **This is why verification exists.**
- **Result:** PASS (post-fix), 10/10 suite green.
- **Timestamp:** 2026-09-06
- **Known limitations:** File-based outbox = single-host. Meta-behavior under real 5xx/rate-limit responses = Phase-5. Window gate enforced only in LIVE mode (documented switch). Status granted: **PILOT**.

---

## Registry delta (CAPABILITY_REGISTRY.yml updated)
- CAP-001: PROTOTYPE → **PILOT** (VR-2026-09-06-01)
- CAP-011: BLOCKED → **PILOT** (VR-2026-09-06-02)
- Debt closed: DEBT-02, DEBT-03, DEBT-05, DEBT-06, DEBT-10 (partial), DEBT-11 (gate-side)
- **Still OPEN 🔴:** DEBT-01 (phantom reservation), DEBT-07 (LLM price validator), DEBT-08 (kill switch) — and the §18 blocker: **human inbox (CAP-008) still NOT IMPLEMENTED → Phase 2B.**

**Suite:** `npm test` → 10/10 ✅ · `npm start` → Sentinel 2A gates active.

```

## Executable matrix index (tests/phase2a.test.js)

| # | Test | Class |
|---|---|---|
| 1 | 1. valid signed message → delivered reply exactly once | happy-path/idempotency |
| 2 | 2. replay attack → duplicate suppressed, no second reply | happy-path/idempotency |
| 3 | 3. forged signature → blocked, zero side effects | security |
| 4 | 4. unsigned webhook while secret configured → blocked | security |
| 5 | 5. Sentinent boot gate refuses LIVE without appSecret | security |
| 6 | 6. outbox retries with backoff → eventually SENT, attempts recorded | failure |
| 7 | 7. outbox permanent failure → DLQ with audit trail | failure |
| 8 | 8. crash mid-send → recovered as UNCERTAIN, sent exactly once | failure |
| 9 | 9. audit trail masks phone numbers (PII) | recovery/privacy |
| 10 | 10. corrupt JSON file → explicit fallback, no crash | recovery/privacy |
