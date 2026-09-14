# SENTINEL CONTINUATION STATE

A fresh AI agent must read this file first, then `docs/evidence/LIVE_CORE_BASELINE.md`, then `docs/evidence/M2_FREEZE.md`, then inspect git, then run the existing suite before modifying code.

This file is a preservation checkpoint. It is **not** production certification.

------------------------------------------------------------
CURRENT CHECKPOINT
------------------------------------------------------------

LIVE CORE CHECKPOINT (dedicated TEST number)
M2 COMPLETE
V1-5.1 COMPLETE
Current state = DEMO/PILOT

------------------------------------------------------------
LAST LIVE-TESTED APPLICATION COMMIT
------------------------------------------------------------

8e7cb2be5e73c67e11c53776d89a24c04430914b
`fix: resolve session LID identity and pin library handshake`

This freeze commit records that live proof. It does not change brain, firewall,
outbox, kill, CAP-008, or session inbound semantics.

------------------------------------------------------------
LAST TEST RESULT
------------------------------------------------------------

435/435 ×2 consecutive processes (`node scripts/run-tests.mjs`, 2026-09-14)

------------------------------------------------------------
WHAT IS LIVE-PROVEN (TEST number only)
------------------------------------------------------------

- session restore to CONNECTED without QR
- restart restore
- real 1:1 inbound (notify, customer PN, not @lid)
- durable `sess:<provider-id>` claim taken once
- existing Sentinel brain
- P2 firewall ALLOW → durable outbox → session adapter accept (job SENT)
- fromMe echo skipped
- SENT/SUBMITTED/outbox SENT is **not** customer DELIVERED

Evidence: `evidence/m2-live-core-2026-09-14.txt`

------------------------------------------------------------
WHAT IS NOT PROVEN
------------------------------------------------------------

- receivedPendingNotifications / CAUGHT_UP
- network-outage catch-up / multiple outage messages
- CAP-008 live staff claim + HUMAN reply
- kill switch ON/OFF around a live customer turn
- duplicate live replay of the same inbound
- phone-UI DELIVERED/READ
- store / customer-facing number
- production readiness
- B-2 live Meta smoke (BLOCKED / NOT RUN)
- ban-proof / official WhatsApp automation (do not write these words)

Owner-file fact:

- Reno 16 floor = **186800 RESOLVED** (current owner file)
- Reno 16F floor = **138600 RESOLVED** (current owner file)

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

Live catch-up (RPN / CAUGHT_UP) remains the unfinished live-core item.

After live core is accepted, the next product phase remains:

RAPID PRODUCT CAPABILITY INTEGRATION

Do not start store-number activation from this checkpoint.

------------------------------------------------------------
TRANSPORT BOUNDARY
------------------------------------------------------------

M2 TRANSPORT ADAPTER: IMPLEMENTED / TESTED
DEDICATED TEST NUMBER 1:1: LIVE-PROVEN
CAUGHT_UP / OUTAGE CATCH-UP: NOT-PROVEN
STORE NUMBER: NOT USED
REAL PRODUCTION DELIVERY: NOT PROVEN

Preserve the current selector:

- DEMO remains default
- Cloud still works
- session requires explicit selection
- do not silently replace Cloud as default
- do not treat this checkpoint as permission to bypass P2 / kill / outbox / CAP-008

------------------------------------------------------------
RESUME INSTRUCTION
------------------------------------------------------------

A future agent must:

1. Read `SENTINEL_CONTINUATION_STATE.md`
2. Read `docs/evidence/LIVE_CORE_BASELINE.md`
3. Read `docs/evidence/M2_FREEZE.md`
4. Inspect git status/log
5. Verify current HEAD
6. Run the existing suite before modifying code
7. Never assume this file means production readiness or CAUGHT_UP
