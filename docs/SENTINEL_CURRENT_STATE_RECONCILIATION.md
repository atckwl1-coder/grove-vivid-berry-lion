# SENTINEL CURRENT STATE RECONCILIATION

**HISTORICAL.** Permanent copy of the 2026-09-12 freeze-time inspection. **Not a VR. Not production certification. Not current HEAD.**

Current product state is `STATE.md` on `main` `6b507e9159f9e95e6be994242373899782904cbc` (suite **332/332**). Historical freeze tag `sentinel-v1.6-pilot-freeze` → `f92a3f8d…`.

Superseded claims in this file (do not treat as current):
- suite 292/292 (was true at freeze; now 332/332)
- “confirm-paid still needs an existing CAP-008 conversation” (removed 2026-09-13, `286d390`)
- inspection HEAD `0f887ec` (freeze later pinned V1-6 at `f92a3f8d`; current main is ahead)

Does not rewrite git history. Does not fabricate live WhatsApp evidence. B-2 remains **BLOCKED / NOT RUN**. Typing is code-verified, not live-proven. `SENT`/`SUBMITTED` ≠ `DELIVERED`. Catalog remains **STALE** until owner re-verify. Nothing is `VERIFIED_PRODUCTION`.

---
Inspection baseline HEAD: `0f887ec54e38245adc1f4001a3e03a15ee434ac6`
(branch `main`; subject: typing-presence records — VR-2026-09-11-02).
V1-5′ through V1-6 existed only in the working tree at inspection time; this freeze commit is the first git preservation of that tree.

---

## A. CURRENT HEAD / WORKTREE (at inspection)

| Fact | Value |
|---|---|
| Repo | `SENTINEL_GROK_HANDOFF/REPOSITORY` |
| Branch | `main` |
| Baseline HEAD | `0f887ec54e38245adc1f4001a3e03a15ee434ac6` |
| HEAD subject | `docs: typing-presence integration records — VR-2026-09-11-02…` |
| HEAD date | 2026-09-10 17:05:20 +0000 |
| Commits on `main` before freeze | 34 |
| Tags before freeze | none |
| Working tree at inspection | dirty — 27 modified, 25 untracked |

There were **zero git commits** for V1-5′, DEBT-07 hardening, V1-5.1, or V1-6 before this freeze.

Safety cores `firewall.js`, `killswitch.js`, `conversations.js`, `idempotency.js`, `auth.js`, `gates.js`, `package.json`, and `config.js` were byte-identical to baseline HEAD.

Owner JSON hashes (unchanged vs baseline HEAD):

- `src/data/products.json` `2f10d77e0d1f3b1b3cb81fa43c9da2c376ab213bfc8e0570b7ede56a4b5dd8ea`
- `src/data/negotiation-rules.json` `c4414e14e890214da583aa6ca4bd7e6d888b48a9ae470321fdc65094e9eb6e61`
- `src/data/sales-skills.json` `18841306ab7ae761489b00eac2c3771e690622294dc5ee02e7216ddfec6c236b`

Reno 16 floor **186800 RESOLVED**. Reno 16F **UNRESOLVED** (`floor: null`, range 139000–142000).

Dependencies: `axios`, `dotenv`, `express`, `node-cron`. No WhatsApp session client.

---

## B. MILESTONE HISTORY

| Milestone | In git before freeze? | In working tree? | Tests (as recorded) | Current status |
|---|---|---|---|---|
| V1-0 … V1-4, human-paced, typing | Yes, through `0f887ec` | yes | last committed suite era 189/189 | **VERIFIED** in DEMO at commit time; live WhatsApp **IMPLEMENTED BUT UNPROVEN** |
| **V1-5′ Pilot Safety Gate** | No | yes | 12 files **217/217 ×2** (`evidence/v15-pilot-safety-gate.txt`) | **VERIFIED** in DEMO. **NOT** `VERIFIED_PRODUCTION`. |
| **DEBT-07 architectural hardening** | No | yes (stacked on V1-5′) | no separate VR; absorbed into later 241/292 runs | **VERIFIED** as code + later suite. Boundary **IMPLEMENTED**; live model **UNPROVEN**. |
| **V1-5.1 Controlled Pilot Readiness** | No | yes | 13 files **241/241 ×2** (`evidence/v151-pilot-readiness.txt`) | **VERIFIED** in DEMO. Staff paid control **IMPLEMENTED**; PSP **NOT IMPLEMENTED**. D-010 is a decision record. |
| **V1-6 Rapid Feature Integration** | No | yes | 19 files **292/292 ×2** (`evidence/v16-feature-integration.txt`) | **VERIFIED** in DEMO. Product layer **IMPLEMENTED**. B-2 **OPEN**; live delivery **IMPLEMENTED BUT UNPROVEN**. |

Intended session sequence ended at V1-5.1. V1-6 ran as an extra sprint. It is preserved here because it is valid completed work in the tree, not because it was the original freeze target.

---

## C. FEATURES CURRENTLY IMPLEMENTED

**V1-5′ added:** `src/sentinel/numberFirewall.js`; fail-closed customer DB boot; `store.atomicWriteJson` fsync; follow-up delivery via outbox `onTerminal` (QUEUED/SUBMITTED/UNKNOWN/FAILED — enqueue is not DELIVERED); paid vs stated; `"reno16 ki price?"` → engine; owner-file test isolation + `CATALOG_NOW_MS`.

**DEBT-07 added:** `brain.deliverModelOutput` / `pacedBrainSend` re-check; `whatsapp.send` refuses `origin=MODEL_OUTPUT` without `monetaryValidated`; validator **not** moved into P2 or `outbox.enqueue`; photo stub enters the helper.

**V1-5.1 added:** `POST /inbox/c/:phone/confirm-paid` (auth+CSRF+tenant); Unicode/ZWSP normalize; MODEL_OUTPUT fail-closed on opaque residue; exclusive “Reno 16 Rs. 150,000”; `D010_TRANSPORT_PREFLIGHT.md`.

**V1-6 added:** qualification, profile/CRM, compare/recommend, setup-help copy, paid-issue → CAP-008, inbox CRM brief, OWNER `/inbox/ops` + `/inbox/b2`, `b2Preflight()`, `B2_LIVE_SMOKE_CHECKLIST.md`.

**Still NOT IMPLEMENTED:** QR/Baileys/WhatsApp Web, SQLite, payments/POS, STT, vision, marketing (CAP-007 OFF), PTA/OPPO API, 16F floor.

---

## D. SAFETY CONTRACT STATUS

Inspected in source at freeze, not only tests.

| Contract | Status |
|---|---|
| Reno 16 floor = 186,800 | **HELD** |
| Reno 16F UNRESOLVED | **HELD** |
| numberFirewall | **HELD** (pure module; customer budget not allow-listed) |
| model-output validation | **HELD** |
| P2 Action Firewall | **HELD** (`firewall.js` unmodified vs baseline HEAD) |
| CAP-055 kill | **HELD** (`killswitch.js` unmodified) |
| CAP-008 human fallback | **HELD** (`conversations.js` unmodified; inbox extended) |
| outbox | **HELD** (architecture same; `onTerminal` observer only; does not inspect amounts) |
| idempotency | **HELD** (`idempotency.js` unmodified) |
| paid-sale authority | **HELD** (`confirmPaidSale` is staff/customers; LLM/router/qualification/profile/compare/care/ops do not call it) |
| customer-statement ≠ paid | **HELD** |
| owner source-of-truth | **HELD** |
| no fabricated DELIVERED | **HELD** at the control layer |
| no direct AI privileged action | **HELD** |
| no second send path | **HELD** (`whatsapp.send` → P2 → outbox) |

Known remaining hole (pre-V1-6, documented): a caller that `sendText`s model copy **without** `origin=MODEL_OUTPUT` is not distinguishable from catalog copy at the transport.

---

## E. TRANSPORT STATUS

- **CURRENT TRANSPORT = Meta Cloud API** (`graph.facebook.com/.../messages`).
- **QR / SESSION / Baileys / WhatsApp Web = NOT IMPLEMENTED.**
- No banned client tokens in `src/` (case-insensitive scan at inspection).
- D-010 is a decision record only; `src/index.js` does not import it.
- **B-2 remains OPEN.** Live delivery **IMPLEMENTED BUT UNPROVEN**.
- `b2Preflight()` is code/config inspect, no Graph call. `B2_LIVE_SMOKE_CHECKLIST.md` is operator prep, **not** live evidence.

---

## F. TEST STATUS

Last recorded full run before freeze (working tree, two consecutive processes, no code change since):

```
RUN 1  SUITE TOTAL: files=19 pass=292 fail=0
RUN 2  SUITE TOTAL: files=19 pass=292 fail=0
```

19 files / 292 `test()` cases: prior 189 + v15safety 34 + v151pilot 18 + V1-6 51.

This document does not claim a new suite run by itself. Post-freeze suite status is in `docs/SENTINEL_FREEZE_RECORD.md`.

---

## G. DOCUMENTATION STATUS (at inspection)

Docs described the working tree. Git described typing-presence. That split is why this freeze exists.

`VERIFICATION_LOG.md` last VR at inspection: **VR-2026-09-11-02** (typing). V1-5′ / DEBT-07 / V1-5.1 / V1-6 had evidence files but **no VR entries**. This freeze does not invent those VRs.

---

## H. SCOPE DRIFT FOUND

Process drift: intended sequence was V1-5′ → adversarial verify → DEBT-07 → stop at V1-5.1. V1-6 then ran.

Not recommended for rollback solely because it was extra. Feature classes at inspection:

| V1-6 feature | Class |
|---|---|
| Lead qualification | A aligned |
| Customer profile / CRM facts | A aligned |
| Compare Reno 16 vs 16F | A aligned |
| Recommend (explicit trigger) | A with B (slightly early before live traffic) |
| Setup-help copy | A aligned |
| Paid-issue → CAP-008 | A aligned |
| Staff CRM brief | A aligned |
| Owner ops snapshot | A / light B |
| B-2 preflight + checklist | A aligned; D if treated as live proof |

Nothing in V1-6 is C (SQLite, payments, STT, vision, marketing, QR). No second transport.

---

## I. RISKS INTRODUCED BY V1-6

1. Durability (uncommitted tree) — addressed by this freeze, not by new features.
2. CUSTOMER_STATED facts in the LLM system prompt (labeled untrusted). DEBT-07 still gates numbers.
3. Heuristic CRM stages can be wrong; not price authority.
4. Compare/setup/recommend use `wa.sendText` (catalog copy, not MODEL_OUTPUT). Do not interpolate stated budget as a store price on that path.
5. Router order: compare/setup/care/recommend before negotiation (intended; recommend trigger was tightened after M4).
6. Operator misread of `b2Preflight()` READY / ops completeness as live WABA success.
7. Registry CAP-056–059 PILOT without VR ids.
8. `b2preflight.js` imports `confirmPaidSale` for `typeof` only (no write).

None of these reopen P2, kill, CAP-008 FSM, floors, or QR.

---

## J. ITEMS THAT SHOULD REMAIN UNCHANGED

- Reno 16 floor **186800**; Reno 16F **UNRESOLVED**
- `firewall.js` / `killswitch.js` / conversations FSM / outbox architecture / idempotency
- numberFirewall **outside** P2/outbox
- `confirmPaidSale` staff-only
- Marketing OFF; no anti-ban
- CURRENT TRANSPORT = Meta Cloud API; **no QR/Baileys**
- Owner JSON bytes
- No SQLite / POS / STT / vision / PTA API as a drive-by

---

## K. ITEMS THAT ACTUALLY NEED ATTENTION (after freeze)

1. `VERIFICATION_LOG.md` still lacks VR entries for V1-5′ / DEBT-07 / V1-5.1 / V1-6.
2. ~~`confirm-paid` still needs an existing CAP-008 conversation.~~ **SUPERSEDED 2026-09-13** (`286d390` on current `main`).
3. B-2 is still OPEN. Preflight must not close it.
4. B-7 Reno 16F floor still owner-blocked.
5. Flat allow-list collisions (A3x / trade-in next to “Reno 16”) remain.

---

## L. CURRENT SINGLE NEXT PRIORITY (at inspection)

At inspection the next priority was: pin the working tree to git so `main` HEAD contains V1-5′ + DEBT-07 + V1-5.1 + V1-6.

This freeze **is** that preservation. It is **not** B-2 live cutover, not QR, not production certification.

After freeze, do not start another milestone from this document.

---

## Labels (honest)

| Item | Label |
|---|---|
| Sandbox suite last recorded | **VERIFIED** 292/292 ×2 (**pre-freeze historical**; current `main` is 332/332) |
| Owner floors / hashes | **VERIFIED** |
| Meta Cloud API send path | **IMPLEMENTED BUT UNPROVEN** |
| B-2 live WABA | **OPEN** |
| QR / session transport | **NOT IMPLEMENTED** |
| Reno 16F floor | **UNRESOLVED** / **UNKNOWN** |
| Production | **DEMO/PILOT** — not `VERIFIED_PRODUCTION` |
| External audit (B-1) | **OPEN** |
