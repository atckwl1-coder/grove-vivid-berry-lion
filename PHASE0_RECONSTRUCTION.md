# 🏛️ PROJECT SENTINEL — PHASE 0: FORENSIC RECONSTRUCTION
**Target system:** `noor-whatsapp-bot` skeleton (existing codebase)
**Date:** 2026-09-05 · **Rule in force:** Read-only. No code modified.

> Prior artifact: `FEASIBILITY_AUDIT.md` (Phase 1 — Truth Audit, delivered 2026-09-05). This document completes Phase 0 and converts Phase-1 findings into the Sentinel registry format (`CAPABILITY_REGISTRY.yml`).

---

## A. SYSTEM INVENTORY (what actually exists)

| Layer | File | What it really does today |
|---|---|---|
| Entry | `src/index.js` | Express on 0.0.0.0:3000; `GET /` status; `GET /health`; mounts webhook; loads JSON DB; starts cron scheduler |
| Config | `src/config.js`, `.env.example` | Env-driven; `isLive()` gates real Meta sends vs DEMO console prints |
| Webhook | `src/routes/webhook.js` | GET verification ✅; POST: immediate 200; signature check **only if `META_APP_SECRET` set**; iterates messages → `handleIncomingMessage` |
| Brain | `src/services/brain.js` | markRead → media stubs → opt-out regex → opt-in regex → flow router → LLM (JSON mode, catalog-locked prompt) → rule-based fallback in DEMO; handoff → owner alert + state=HUMAN |
| Flows | `src/flows/router.js` | Menu list, phones list, EMI flow, trade-in flow, **reserve flow**, visit booking, location, staff request |
| Commerce | `emi.js`, `tradein.js`, `catalog.js`, `data/products.json` | Deterministic math/table lookups ✅; products.json = owner-maintained sample prices (marked SAMPLE ✅) |
| Compliance | `src/services/governor.js` | 6-check `canSendMarketing`, pacing, quiet hours, warm-up limits — **exported but never called by any live path** |
| Memory | `src/services/customers.js` | Whole-file JSON DB; engagement score; consent log; **non-atomic writes** |
| Media | `src/services/media.js` | Stubs only (NOT IMPLEMENTED — honestly labeled in code ✅) |
| Scheduler | `src/workers/scheduler.js` | 9AM PKT owner brief; hourly quality heartbeat (log only — no Meta API call yet) |
| Deps | `package.json` | express, axios, dotenv, node-cron — all pure JS, no native builds ✅ |

**Runtime status:** runs in DEMO mode (verified by live test 2026-09-05 — 3 simulated webhook messages, correct replies). LIVE mode (real Meta tokens) has **never been executed → NOT PROVEN.**

---

## B. ACTUAL DATA FLOW (inbound message, exact trace)

```
Meta webhook POST
  → 200 OK immediately (correct)
  → signature check ONLY IF appSecret configured        ⚠️ TB-1
  → NO duplicate-event detection                        ⚠️ TB-2
  → brain.handleIncomingMessage
       → wa.markRead (external side effect, unlogged)   ⚠️ TB-3
       → audio/image → stubs (fail-closed, honest)      ✅
       → regex opt-out → consent mutation (audited ✅)
       → regex "offers" → consent=TRUE on 1 keyword     ⚠️ TB-4
       → flows.routeFlow
            → "reserve" → tells customer "RESERVED ✅" 
               but NEVER writes reservation,            🔴 TB-5
               NEVER decrements stock (phantom lock)
       → LLM think() → JSON reply
            → NO post-generation price validation       ⚠️ TB-6
            → on LLM error → handoff message            ✅ intent
            → handoff = owner WhatsApp alert only;
               NO staff inbox/queue/SLA exists          🔴 TB-7
  → every send: demo-print or live POST; fire-and-forget ⚠️ TB-8
  → engagement score +2 on ANY inbound msg              ⚠️ TB-9
```

## C. TRUST BOUNDARIES (current vs required)

| # | Boundary | Current | Sentinel requirement | Gap |
|---|---|---|---|---|
| TB-1 | Webhook authenticity | Optional signature | Mandatory in LIVE | **Must refuse to boot LIVE without appSecret** |
| TB-2 | Event identity | None — Meta retried deliveries would double-process | wamid idempotency store | **Missing** |
| TB-3 | Side-effect logging | Console only | Audit log per action (§19) | Missing audit trail |
| TB-4 | Consent authority | Single keyword = opt-in | Consent requires explicit, logged, confirmable intent (QR context / double-keyword confirm / receipt capture) | Weak consent evidence |
| TB-5 | **Reservation truthfulness** | Customer told stock locked; nothing is locked | Deterministic atomic decrement + reservation row, or honest wording | 🔴 **Truth violation — top debt** |
| TB-6 | LLM as de-facto price authority | Prices in prompt; unvalidated free text out | Post-generation validator: every PKR figure must trace to catalog/computation | Missing — prompt-injection & hallucination exposure |
| TB-7 | Human fallback | Claims handoff; **no staff inbox exists** (§18 violation by definition) | Inbox, assignment, SLA, audit, return-to-AI | 🔴 **HUMAN FALLBACK = NOT IMPLEMENTED** (legally/morally cannot be claimed) |
| TB-8 | Send durability | Fire-and-forget; failures lost | Outbox + retry + DLQ | Missing |
| TB-9 | Scoring integrity | Any message (even spam/attack) raises engagement | Score from meaningful events only, decay, capped | Trivially gameable |
| TB-10 | Owner identity | `OWNER_PHONE` env only, no command auth | Owner commands (STOP ALL) need authenticated channel | Missing (needed before kill-switch) |
| TB-11 | products.json integrity | Unvalidated hand-edited file | Schema validation + sanity bounds + staleness state | Missing |

## D. AUTONOMOUS ACTIONS CURRENTLY EXECUTABLE (Sentinel §11 audit)

| Action | Current trigger | True autonomy level | Policy check before execution? | Verdict |
|---|---|---|---|---|
| Mark message read | every inbound | L4 | none | Acceptable risk; needs audit log |
| Auto-reply to any text | every inbound | L4 | none (no per-sender rate cap) | Needs rate cap + spend circuit-breaker |
| Mutate consent (out/in) | regex | L4 state change | deterministic regex ✅ logged ✅ | Valid; strengthen opt-in evidence (TB-4) |
| Issue reservation token | keyword | **claims L5-adjacent (stock commitment)** | stock check exists; **no atomicity, no record** | 🔴 BLOCKED until redesigned |
| Escalate & alert owner | LLM/handoff | L3→notify | n/a | Valid once staff inbox exists |
| Daily owner brief | cron | L4 send | **no 24h-window awareness — will fail or violate outside window in LIVE** | Redesign: window-aware or template |
| Campaign sends | `sendCampaign` | L4 marketing | Governor ✅ exists | Dormant — must register as dormant capability; never wire without Governor |
| AI discount/price promises | LLM text | **would be L5 if acted on** | none | Must be made textually impossible via validator + wording rules |

## E. TECHNICAL DEBT REGISTER

| ID | Debt | Severity | Sentinel section | Fix phase |
|---|---|---|---|---|
| DEBT-01 | Phantom reservation (TB-5) | 🔴 Critical | §1, §26 | P2 redesign before any reservation claim |
| DEBT-02 | Human fallback not real (TB-7) | 🔴 Critical | §18, §37 stop condition | P2 |
| DEBT-03 | No idempotency (TB-2) | 🔴 High | §16 | P2 |
| DEBT-04 | Non-atomic whole-file DB writes | 🔴 High | §31 | P2 (atomic temp-rename → SQLite) |
| DEBT-05 | Optional webhook signature | 🔴 High | §5/§30 | P2 |
| DEBT-06 | No outbox/retry/DLQ | 🔴 High | §17 | P2 |
| DEBT-07 | Unvalidated LLM output on price paths (TB-6) | 🔴 High | §20, §3 | P3 |
| DEBT-08 | No global kill switch / feature flags | 🟡 Med | §36 | P2 |
| DEBT-09 | Governor unwired to any active path | 🟡 Med | §33 | P4 (wire at campaign build) |
| DEBT-10 | PII in console logs & demo payloads (phone numbers printed) | 🟡 Med | §31/privacy | P2 (redaction modes) |
| DEBT-11 | Scheduler not 24h-window-aware | 🟡 Med | §17 | P2 |
| DEBT-12 | products.json: no schema/sanity/staleness enforcement | 🟡 Med | §28 | P2 |
| DEBT-13 | Zero automated tests (happy-path demo only) | 🔴 High | §22 | P3 harness |
| DEBT-14 | No backups of consent ledger | 🟡 Med | §31 | P2 |
| DEBT-15 | Engagement gameability (TB-9) | 🟢 Low | §36 | P4 |
| DEBT-16 | No model/version/prompt tracking on AI replies | 🟡 Med | §21 | P3 |

## F. EXTERNAL DEPENDENCIES — CURRENT PROOF STATE

| Dependency | Proof state | Required before |
|---|---|---|
| Meta Cloud API (messaging) | Verified by docs + standard behavior; **our LIVE send path never executed → NOT PROVEN end-to-end** | P5 live validation |
| Meta quality-rating field | Docs-verified; unwired here | P2 owner-brief real data |
| LLM provider (OpenAI-compatible) | Endpoint contract assumed OpenAI schema; **not contract-tested → NOT PROVEN** | P3 contract tests |
| Whisper-class STT ur/pa | Docs-verified support; accuracy on Khanewal audio NOT PROVEN | P3 benchmark dataset |
| Vision LLM | Capability plausible; accuracy NOT PROVEN (needs n=50 study) | P3/P5 |
| PTA DIRBS | ❌ No public API (verified) | Feature permanently redesigned (guided flow) |
| OPPO PK warranty | ❌ Web-form only, no API confirmed | Deep-link + staff-assisted only |
| WhatsApp Calling | Voice-only; inbound OK in PK; outbound tier-gated ≥2000/24h (docs-verified) | P5, scope-limited |
| JazzCash/Easypaisa PSP | Merchant APIs exist (aggregators verified); our account NOT PROVEN | P5 onboarding |
| Co-existence (app+API same number) for +92 | Vendor-claimed; provider-specific → NOT PROVEN until BSP contract signed | Before promising number reuse |

## G. PHASE-0 CONCLUSION

The skeleton is an honest **PROTOTYPE**: its deterministic features (menu, EMI, trade-in, catalog) behave as designed in demo, and its media stubs fail closed. But per Sentinel law it currently holds:
- **0 capabilities at VERIFIED PRODUCTION**
- **2 critical truth violations** (DEBT-01 phantom reservation, DEBT-07 unvalidated LLM prices)
- **1 §37 STOP condition already active**: *human fallback promised but absent* → **entire AI-handoff claim BLOCKED — NOT PROVEN** until staff inbox exists.

**No code was modified in this phase.** Phase-1 truth audit (`FEASIBILITY_AUDIT.md`) + this reconstruction + `CAPABILITY_REGISTRY.yml` constitute the complete findings package.

---
**Gate:** Awaiting approval to produce the *implementation specification* for the first bounded capability (Phase 2 start): **Verified Event Ingestion — signature-mandatory + idempotent + audited + outbox-backed.** One capability, then attack it, verify it, register it, and only then continue.
