# SENTINEL CONTINUATION STATE

A fresh AI agent must read this file first, then `docs/evidence/M2_FREEZE.md`, then inspect git, then run the existing suite before modifying code.

This file is a preservation checkpoint. It is **not** production certification.

------------------------------------------------------------
CURRENT CHECKPOINT
------------------------------------------------------------

M2 COMPLETE
V1-5.1 COMPLETE
Current state = DEMO/PILOT

------------------------------------------------------------
LAST ACCEPTED M2 COMMIT
------------------------------------------------------------

399afde156098337b141a4015e2c6eadc0555abb
`fix: enforce single active pairing socket`

At freeze: checked out as HEAD of `feature/m2-live-blocker-fix`.
Not merged to `main` (`main` = `64fd32a` at freeze).

------------------------------------------------------------
LAST TEST RESULT
------------------------------------------------------------

432/432 ×2 consecutive processes (`node scripts/run-tests.mjs`)

------------------------------------------------------------
WHAT IS FROZEN
------------------------------------------------------------

- M2 session transport adapter (defined scope: companion + generation guard + retry serialization + CONNECTED/NEEDS_QR reuse)
- V1-5.1 controlled pilot readiness (staff paid confirmation, monetary normalize, cross-SKU protection, D-010 record)
- V1-6 product layer and post-freeze staff product already in history
- P2 Action Firewall
- CAP-055 Kill Switch
- CAP-008 Human Fallback
- Outbox
- Idempotency
- Session inbound protections
- Number Firewall
- Catalog authority
- Negotiation floor controls
- Owner source-of-truth files (`products.json`, `negotiation-rules.json`, `sales-skills.json`)

------------------------------------------------------------
WHAT IS NOT PROVEN
------------------------------------------------------------

- real live WhatsApp operation
- production readiness
- live delivery behavior (never call SUBMITTED/SENT “DELIVERED”)
- B-2 live Meta smoke (BLOCKED / NOT RUN)
- ban-proof / official WhatsApp automation (do not write these words)
- other documented UNKNOWN/PARTIAL KPIs

Owner-file fact vs V1-5.1 narrative:

- Reno 16 floor = **186800 RESOLVED** (current owner file)
- Reno 16F: V1-5.1 freeze recorded **UNRESOLVED**; **current owner file** on this tree is **138600 RESOLVED**. Do not revert without new owner instruction.

------------------------------------------------------------
KNOWN NON-BLOCKING M2 CONCERNS
------------------------------------------------------------

1. `resetAuth()` + `start()` does not await `lastEnd`.
   OWNER UI uses `retryPairing()`, which does.

2. CONNECTED reconnect `attach()` can replace a companion handle without calling `end()`
   on the previous handle.
   Existing report states the previous handle is already closed and generation guard
   protects against stale events.

Do not fix these during ordinary product work unless authorized.

------------------------------------------------------------
DO NOT REOPEN
------------------------------------------------------------

- M2 architecture
- P2 firewall
- kill switch
- CAP-008 semantics
- outbox architecture
- owner pricing floors
- completed V1-5.1 work
- QR redesign
- speculative governance

------------------------------------------------------------
NEXT INTENDED DEVELOPMENT DIRECTION
------------------------------------------------------------

After this preservation checkpoint, the next development phase is:

RAPID PRODUCT CAPABILITY INTEGRATION

Priority areas:

1. Lead Qualification
2. Sales / Conversation Intelligence
3. Customer CRM / Memory
4. Customer Care
5. Staff Operations
6. Owner Intelligence

Use multiple specialized agents where safe.

Do NOT start these features from this preservation commit.

------------------------------------------------------------
TRANSPORT BOUNDARY
------------------------------------------------------------

M2 TRANSPORT ADAPTER: IMPLEMENTED / TESTED

REAL WHATSAPP LIVE OPERATION: NOT PROVEN BY THIS M2 TEST SUITE

Preserve the current selector:

- DEMO remains default
- Cloud still works
- session requires explicit selection
- do not silently replace Cloud as default
- do not treat M2 as permission to bypass P2 / kill / outbox / CAP-008

------------------------------------------------------------
RESUME INSTRUCTION
------------------------------------------------------------

A future agent must:

1. Read `SENTINEL_CONTINUATION_STATE.md`
2. Read `docs/evidence/M2_FREEZE.md`
3. Inspect git status/log
4. Verify current HEAD
5. Run the existing suite before modifying code
6. Continue from the frozen checkpoint
7. Never assume this file means production readiness
