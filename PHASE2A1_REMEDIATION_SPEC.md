# PHASE 2A.1 — REMEDIATION SPEC (P0 only, nothing beyond)

| # | Item | Defect/Gap | Fix | Test that proves it |
|---|---|---|---|---|
| R1 | **Idempotency missing-directory defect** | `claimEvent()` throws ENOENT if marker dir deleted at runtime / never initialized → webhook falls to `WEBHOOK_ERROR`, event unprocessed (availability defect) | On ENOENT: recreate dir, retry claim once; then truth returns | Delete dir → claim works → duplicate still detected |
| R2a | **Restart-persistence idempotency** | Untested: does dedupe survive a real process restart? (markers are on disk — claim untested) | No code change expected; test proves disk persistence | Child process A claims wamid → child process B (fresh boot, same dir) → duplicate |
| R2b | Dedicated **post-send bookkeeping-failure test** | The triple-send fix (SENT_WITH_AUDIT_GAP) has no targeted regression test | None (fix shipped) | sendFn ok + auditFn throws on OUTBOX_SENT ⇒ sendFn called EXACTLY once, job SENT_WITH_AUDIT_GAP, queue empty |
| R3 | **True process-kill recovery** | Current crash tests simulate by planting files | Real `SIGKILL` child mid-send → real boot recovery | Stranded job recovered as UNKNOWN_REQUEUED, provider touched exactly once post-recovery |
| R4 | **Complete PII boundary** | audit masked ✔; but `logger` prints raw, `demoDeliver` prints full payload incl. phone; job files retain forever | `logger` + demo output pass through `redact()`; outbox retention GC (sent/dlq > 7d purged) | Intercepted console output contains masked number; old job files purged, fresh kept |
| R5 | **"Exactly once" terminology** | Suite/comments claimed stronger semantics than proven (row 4, claim audit) | Rename tests/comments to truthful "single delivery per accepted event / tested crash class" | Lint test: `/\bexactly[- ]once\b/i` absent from src/ + tests/ |
| R6 | **"Tamper" → "tamper-evident"** | Terminology drift | Same lint discipline | Lint test: `tamper-proof` absent; `tamper-evident` present in audit header |

**Explicitly out of scope (frozen):**DEBT-17 audit rotation design, staff inbox (that's CAP-008 next), any feature work.
**Termination rule:** when 10 old + 7 new tests are green and the live restart-attack demo passes → STOP, report, spec CAP-008.
