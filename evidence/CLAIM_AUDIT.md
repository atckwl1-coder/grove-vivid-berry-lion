# ⚖️ PHASE 2A CLAIM AUDIT (independent re-evaluation) — 2026-09-07

Classes: PROVEN / PARTIALLY PROVEN / NOT PROVEN / FALSE-INCORRECT

| # | Claim | Verdict | Exact proof artifact | Evidence still missing |
|---|---|---|---|---|
| 1 | 10/10 tests pass | PROVEN | evidence/test-output.txt (`# pass 10 / # fail 0`); reproduce: `npm install && npm test`, Node v20.20.2 | — |
| 2 | Forged webhook blocked | PROVEN | tests 3+4 green; live demo line `WEBHOOK_FORGED` with zero processing entries | — |
| 3 | Replay suppressed | PROVEN | test 2 green + demo `EVENT_DUPLICATE`, delivered count static | — |
| 4 | Exactly-one side effect | PARTIALLY PROVEN | Proven classes: accepted-event dedupe (test 2/demo), retry→single SENT (test 6), crash-before-final (8a), crash-after-final discard (8b) | Provider-half-open case (Meta receives, response lost → retry duplicates at provider; design answers with truthful UNKNOWN, not false exactly-once); multi-process concurrency; missing provider-half-open test |
| 5 | PII masking | PARTIALLY PROVEN | Audit channel: test 9 + demo lines `9230****567` | Whole-system PII: customers DB + message logs store full text/numbers unmasked; demo console prints full payload (labeled DEMO) |
| 6 | Tamper-evident audit chain | PARTIALLY PROVEN | `CHAIN: INTACT`, GENESIS-anchored dump | Dedicated negative tamper-detection test + verifier tool absent; audit-file truncation/deletion breaks standalone verifiability (discovered during export) → rotation/segment design needed (DEBT-17 candidate) |
| 7 | Boot gate | PROVEN | test 5; `process.exit(1)` path in src/index.js | Post-boot secret-removal case out of scope (acceptable) |
| 8 | Outbox reliability | PARTIALLY PROVEN | tests 6/7/8a/8b | Real Meta error mapping (5xx/131049/rate-limit), disk-full, soak, throughput, multi-day durability |
| 9 | Crash recovery | PARTIALLY PROVEN | tests 8a/8b | Crash-during-atomicWriteJson untested (tmp-suffix design only); host fsync semantics unexamined; mass-stranded-job recovery untested |
| 10 | Post-send bookkeeping protection | PARTIALLY PROVEN | original triple-send defect documented, fixed structurally (`SENT_WITH_AUDIT_GAP`), suite green | Dedicated regression test injecting a throwing auditFn post-send asserting no-resend — ABSENT (structure+review only) |
| 11 | CAP-001 = PILOT | PROVEN (status assignment) | VR-2026-09-06-01: 5/5 proofs; PILOT precisely because real-Meta end-to-end outstanding | Sub-fact "works against real Meta Cloud API": NOT PROVEN → Phase-5 gate |
| 12 | CAP-011 = PILOT | PROVEN (status assignment) | VR-2026-09-06-02 | Sub-fact "survives real Meta failure modes": NOT PROVEN → Phase-5 gate |

Correction on record: an early Phase-2A summary implied "no double-send" before verification; the suite then caught a bookkeeping-resend defect (4 failing tests), it was fixed and re-proven. Final landed claim = row 4, PARTIALLY PROVEN — not blanket PROVEN.
