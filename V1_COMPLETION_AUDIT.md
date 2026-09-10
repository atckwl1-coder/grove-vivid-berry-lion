# SENTINEL — V1 COMPLETION AUDIT (2026-09-09)

**Kind:** analysis-only inventory of the CURRENT product (not architecture). No implementation occurred in the audit itself.
**Docs-read status:** `CLAUDE.md` / `SPEC.md` / `BUILD_PLAN.md` / `docs/DECISIONS.md` / `docs/GATES.md` / `docs/RUNBOOK.md` — **DO NOT EXIST** in this workspace (verified by inspection; proven over full git history in VR-2026-09-08-04).
**Authoritative requirements actually present:** `FEASIBILITY_AUDIT.md` (8-over-claim verdict, GO-with-conditions), `CAPABILITY_REGISTRY.yml` (CAP-001…CAP-049 + CAP-008/055 + P2 + system rows, per-row debts), shipped specs (CAP-001, CAP-008, CAP055, P2-firewall, OUTBOX, IDEMPOTENCY, AUDIT-TRAIL, PHASE2A/2A1), `PROGRESS/STATE/HANDOFF/BLOCKERS.md`, `VERIFICATION_LOG.md`, `src/` (27 files, all read).
**Truth rule applied:** stub/route/UI/fixture ≠ COMPLETE; absent requirement = UNKNOWN / NOT SPECIFIED (no invented pricing rules, negotiation bounds, follow-up timing, segmentation, or metrics).

## 1. EXACT CURRENT PRODUCT SCOPE (as of audit; V1-0 now applied — see status footer)

A webhook-upsert → **verified-ingest → dedupe → brain (rules/flows/LLM) → escalation → outbox** WhatsApp concierge for the OPPO Khanewal store, with: (a) working staff inbox + human-fallback FSM (CAP-008), (b) owner kill switch with two enforcement walls (CAP-055), (c) central action firewall on every external send (P2), (d) durable outbox with retries/crash-recovery, (e) tamper-chained audit, (f) demo transport (Meta live calls written, never exercised), (g) owner morning-brief cron, (h) consent keywords + unwired anti-ban governor, (i) EMI + trade-in + catalog flows on an owner-maintained JSON, (j) STT/vision = labeled stubs. Mode: **DEMO**; real Meta traffic: **never done**.

## 2. COMPLETE (product behavior actually implemented; PILOT ceiling preserved)

| Capability | Evidence |
|---|---|
| Event ingestion w/ signature verification + idempotency (CAP-001) | `src/routes/webhook.js`, `sentinel/idempotency.js`; VR-2026-09-06-01, PILOT |
| Durable outbox + retry/DLQ + crash-recovery, no double-send (CAP-011) | `sentinel/outbox.js` incl. `recover()` at boot; VR-2026-09-06-02 |
| Human fallback: escalate→ACK→inbox→claim→reply→resolve→return-to-AI (CAP-008) | `sentinel/conversations.js`, `routes/inbox.js`; VR-2026-09-08-01, PILOT (real-WhatsApp staff pilot still owed) |
| Owner kill switch, two walls, fail-closed corruption (CAP-055) | `sentinel/killswitch.js`; walls in `whatsapp.js`+`outbox.js`; VR-2026-09-08-02 |
| Central action firewall on all sends, closed classes, fail-closed stages (P2) | `sentinel/firewall.js` statically wired in `whatsapp.send()`; VR-2026-09-08-03; **audit-gate BLOCKED (preserved, not promoted)** |
| Tamper-chained audit + redaction boundaries | `sentinel/audit.js`; 2A + 2A.1 VRs |
| Interactive menus/buttons/list flows | `flows/router.js` menu/EMI/trade-in paths — work in demo |
| Catalog-locked answers *as wired*: LLM prompt hard-restricted to catalog; fallback quotes only catalog | `brain.js` system prompt; `catalog.js` reads `src/data/products.json` |

## 3. PARTIALLY COMPLETE

| Capability | Real state + evidence | Missing |
|---|---|---|
| Autonomous conversation handling | Single-turn LLM call — `brain.js:think()` sends ONLY system + one user message; **no conversation history passed**; customer context = counters/state blobs in `customers.js` | Multi-turn transcript memory (→ **V1-1**) |
| Authoritative-answer grounding | Catalog JSON exists, owner-maintained, `updated: 2026-09-05`, self-labeled **SAMPLE prices** | Staleness semantics (VERIFIED/STALE `observed_at`); a week-old price is quoted with full confidence (→ **V1-2** / P3) |
| EMI wizard (CAP-004) | Works; flat 3%/month math | Disclosure wording (registry note) |
| Trade-in text estimate (CAP-005) | Works vs `tradeInTable`; ESTIMATED wording verified | Vision condition-grading (stub); substring-match priority defect found in V1-0 (a57→a5 row, recorded) |
| Consent ledger (CAP-002) | stop/offers keywords → consent state; CONSENT_ACK is firewall-tagged | Confirm-step + QR/receipt capture (TB-4) — PROTOTYPE |
| Problem detection → escalation | LLM intent → closed reason set — works when LLM key present | In DEMO (no key) only word-list fallback detects complaints |
| Owner morning brief (CAP-012) | Real cron 9AM PKT | Quality-rating check = heartbeat TODO; misclass DEBT-20 |
| Anti-ban governor (CAP-007 logic) | `governor.js` fully written (quiet hours, caps, engagement floor) | **Unwired — zero callers** (grep-verified); campaigns impossible anyway (OFF by rule) |

## 4. NOT IMPLEMENTED (intended product features)

| Feature | Evidence of absence |
|---|---|
| Post-purchase follow-up (CAP-032 Day0/3/15/30) | ~~grep `follow.?up|post.?purchase` over src = **0 hits** (→ V1-4, needs owner cadence spec)~~ — **V1-4 (2026-09-10, VR-2026-09-10-03): first touch live** (`src/services/followups.js` — single Day-10 satisfaction check per customer-stated sale; the full journey still unbuilt by directive) |
| Satisfaction/issue follow-up engine | 0 hits; complaints only escalate at receipt time |
| Deterministic negotiation/floor engine (CAP-039) | 0 hits; feasibility §1 #7 demands rules-engine + LLM-phrasing; **no floors/limits exist anywhere** (→ V1-3, needs owner rules) |
| Voice-note STT (CAP-020) | `media.js` returns null — labeled stub, Whisper TODO |
| Vision trade-in / photo analysis (CAP-022) | `media.js` honest demo reply only |
| Store-visit token booking persistence (CAP-049) | no slot store exists; **as of V1-0 the visit flow no longer claims it** |
| **Reservation (CAP-006)** — was "actively lying", now **honestly absent** | pre-V1-0: `router.js` issued "RESERVED + token NK-…/24h" with nothing persisted (registry: REDESIGN_REQUIRED — truth violation). **V1-0 (2026-09-09): phantom removed, honest deferral live, capability NOT IMPLEMENTED by design (no persistence/slots/tokens invented). Status → NOT_PROVEN. VR-2026-09-09-01.** |

Also absent (verified): **task/commitment extraction — no requirement found in any authoritative doc → NOT SPECIFIED, not a designed gap.**

## 5. BLOCKED

| Capability | Blocker |
|---|---|
| Everything shipped — **external audit gate** | B-1: auditor infra absent (GPT_AUDIT.md §A). Governance-only; preserved per directive |
| Any VERIFIED_PRODUCTION claim | B-2: real Meta pilot (Phase 5) never run |
| Campaigns / outbound marketing (CAP-007) | OFF by fast-track law; governor unwired (DEBT-09); quality-rating integration TODO |
| Negotiation engine (V1-3) | **Requirement absent** — no floor prices / max-discount / margin rules in any doc; building them = fabrication; owner input required |
| Follow-up cadence (V1-4) | ~~**Requirement absent** — no timing/content spec present; CAP-032 claim only~~ — **supplied by the owner in the V1-4 directive (2026-09-10): single follow-up ~Day 10 + approved message + response routing; implemented (VR-2026-09-10-03)** |
| OPPO warranty API, PTA API, video-call demos, Saraiki, review-gating | Externally infeasible / policy-violating — verified in FEASIBILITY_AUDIT §1 (conditions 1–6) |

## 6. OPTIONAL / POST-V1 (not required for the store workflow)

CAP-020/021 voice (ur/pa), CAP-022..024 vision/TTS, CAP-023 price-match, CAP-025..029 PTA/warranty/payments/calling, CAP-030 festival engine, CAP-031 referrals, CAP-033 watchlist, CAP-034 dead-chat, CAP-035 review requests, CAP-036 staff copilot, CAP-037 competitor radar, CAP-040 dream visualizer, CAP-041 voice clone, CAP-042 family graph, CAP-043..045 targeting/segment-of-one, CAP-046..048 doctor/lost-phone/free-service, marketing beyond governor wiring, DEBT-17 rotation tooling (at hardening time), DEBT-19 cookie hardening (pre-internet-exposure only).

## 7–8. V1-REQUIRED LIST — exact priority order (with authoritative source)

| # | V1 capability | Why V1 (business workflow) | Authoritative source | Status |
|---|---|---|---|---|
| **V1-0** | Kill phantom reservation tokens + all lying texts | customer-facing "confirms" that confirm nothing break the no-lie law | registry CAP-006 row; FEASIBILITY truth rule | **CLOSED 2026-09-09 — VR-2026-09-09-01** (commit `b9e6eb6`, merge `36ca9df`) |
| **V1-1** | Conversation memory / multi-turn context | "autonomously handling conversations" is the product's spine; model is amnesiac per message | user's core objective + `brain.js` evidence | **CLOSED 2026-09-09 — VR-2026-09-09-02** (commit `47a2c16`, merge `bad2d30`) |
| **V1-2** | Catalog authority semantics (staleness on quoted prices + owner-update ritual) | shop workflow = quoting REAL prices; any JSON date is silently "today" | CAP-003 registry row (`observed_at VERIFIED|STALE`); P3 standby | **CLOSED 2026-09-09 — VR-2026-09-09-03** (commit `e95fdb9`, merge `b62ed87`) |
| **V1-3** | Deterministic negotiation rules engine (bounded floors; LLM only phrases) | "strong negotiation within approved business rules"; LLM price authority forbidden | FEASIBILITY §1 #7 + CAP-039 row | **CLOSED 2026-09-10 — VR-2026-09-10-01** (commit `bab727f`, merge `c331a1f`) — owner floors supplied: reno16 floor (RESOLVED — **corrected to the owner-supplied dealer-price boundary Rs. 186,800 on 2026-09-10, VR-2026-09-10-02**; the 186,499 recorded at closure time was a mis-recorded value); reno16f 139k–142k (UNRESOLVED → no autonomous concession, tracked as B-7) |
| **V1-4** | Post-purchase / satisfaction follow-up cadence (opt-in, consent-gated, kill-switch-compatible) | sales don't end at purchase | CAP-032 row | **CLOSED 2026-09-10 — VR-2026-09-10-03** (commit `f113e50`, merge `51fb389`) — owner spec supplied in the V1-4 directive (single follow-up ~Day 10, owner-approved message, positive→close / issue→existing support path, no chasing). Delivered as the CAP-032 **first touch** — the full Day0/3/15/30 journey remains out of scope per the cycle directive. 155/155 (17 new) |
| **V1-5** | Real-pilot readiness: Meta webhook live, live-mode smoke list, DEBT-19 cookie/rate-limit, quality-rating unwiring | without it nothing is more than a demo | CAP-011 PILOT notes ("real Meta pending Phase-5"); BLOCKERS B-2 | open |

## 9. DEPENDENCIES

`V1-0 → none` (pure removal) ✔ done · `V1-1 → none product-internal` (transcript store must respect DEBT-18 sensitive zone) · `V1-2 → independent; CONSUMES the P2 firewall EVIDENCE stage` · `V1-3 → blocked on owner floors; must run through P2 policy stage (deterministic engine, LLM never sets numbers)` · `V1-4 → requires CAP-002 consent + CAP-055 (both complete); P2 classes already cover customer outbound` · `V1-5 → requires V1-0..V1-2 shipped (don't pilot a lying or amnesiac bot)` · all inherit the existing foundations (CAP-008/055/P2) untouched.

## 10. BIGGEST ACTUAL BLOCKERS TO A USABLE V1

1. ~~**Requirement holes, not code holes:** floors (V1-3) and follow-up cadence (V1-4) don't exist anywhere — owner input required; fabricating them is forbidden.~~ — **both holes closed by owner input (2026-09-10): floors → V1-3 + VR-2026-09-10-02 correction; follow-up spec → V1-4 (VR-2026-09-10-03).**
2. ~~**LLM amnesia** (no message history to the model)~~ — **closed by V1-1 (2026-09-09): bounded per-customer multi-turn context in `think()` (12 entries × 500 chars, derived-only, DEBT-18 compliant).**
3. **Data authority is a hand-edited SAMPLE JSON** — acceptable for demo, unacceptable as price truth without staleness + owner-update ritual (→ V1-2). *(V1-0 side-effect: file is now at least version-controlled.)*
4. ~~An actively-false UX in the menu ("RESERVED" phantom tokens)~~ — **removed by V1-0 (2026-09-09).**
5. **No real WhatsApp run has ever happened** — every transport claim is demo-bound (B-2).
6. (Non-blocker, preserved) External audit gate B-1 — governance only, does not stall product.

## 11. WHAT SHOULD EXPLICITLY NOT BE BUILT

- Any `.claude/ai-bridge` / auditor infrastructure, AI supervisor, self-selecting roadmap loops, meta-governance tooling (directive + preserved limitation).
- Outbound marketing engine (CAP-007) until consent confirm+receipts (TB-4) AND live quality-rating integration exist.
- Video-call demos, business-initiated calls, Saraiki claims, Google review-gating, PTA "API" checks — externally impossible or policy-violating (FEASIBILITY §1, verified).
- Staff copilot, referrals, segment-of-one, family graph, voice clone, dream visualizer, festival engine — scale-curve features for a store that hasn't made one bot-mediated sale yet.
- Anything touching CAP-008, CAP-055, or the P2 firewall — foundations are proven; re-opening them is regression risk, not value.

## 12. RECOMMENDED FIRST V1 IMPLEMENTATION TASK (as recommended at audit time)

V1-0 + V1-1 combined ("truth cut + memory"): (a) remove/replace phantom reservation + lying texts; then (b) wire bounded conversation history into `think()`. **Executed in two authorized cycles:** (a) done as **V1-0 (this cycle, VR-2026-09-09-01)**; (b) = **V1-1, awaiting explicit authorization.**

---

## V1-3 closure record (2026-09-10)

- **Contract:** from CAP-039 registry row + owner mandate 2026-09-10 ONLY — "Best-price offers within floor"; "deterministic engine owns numbers; LLM may ONLY phrase"; floors: reno16 start 200,000 / floor 186,499 (RESOLVED), reno16f start 150,000 / range 139,000–142,000 (UNRESOLVED — do NOT guess); value before price; no discount without context; learning changes tactics, owner rules change authority. Documented assumptions (mandate silent): 1% step (owner-tunable), 1 concession/turn, explicit price-to-pay opens the concession gate, re-open at last authorized position, sale = `customer_statement` (no payment system).
  - *Correction 2026-09-10 (VR-2026-09-10-02, marked — original line preserved): the authorized Reno 16 floor is the owner-supplied dealer-price boundary **Rs. 186,800** (selling price 200,000 + dealer price 186,800 + intent "sell above dealer price, never reduce into the dealer-price level"), used exactly — not derived/rounded/altered. The 186,499 above was a mis-recorded value and is superseded; the correction changed only the owner rules file + directly-dependent test literals (diff: 2 files), engine unchanged, re-verified (138/138; burn-down to exactly 186,800, never below).*
- **Implemented:** `negotiation-rules.json` (owner floors + policy, read-only to the bot) · `sales-skills.json` (12 metadata-structured skills; gated skills unrankable) · `negotiation.js` (deterministic engine: signals → value-first gate → bounded 1%-step concessions → floor = final position → CAP-008 PRICE_EXCEPTION past floor; never below floor; no-authority fail-closed; re-open at last position) · catalog rows reno16/16F (owner prices, approved value stack with unquotable-conditional Google claims, no stock = no claim) · router flow + brain rule 9 · `catalogEvidence()` + optional-field guards · `db.negotiations` outcome store (existing DB; derived skill stats; learning re-ranks value tactics only — static-proven no write paths).
- **Verification:** `tests/v13negotiation.test.js` 32/32 on the real path (webhook → flows/brain → firewall → outbox spy; LLM capture double; all mandated adversarial cases incl. exact floor 186,499 burn-down, no-guess unresolved floor, below-floor refusal, walk/return, learning promote/demote + authority immutability, CAP-055 hold, P2 job decision, CAP-008 escalation + silence); suite 138/138 ×5 (×2 post-merge); cap055 14/14 ×5; foundations byte-untouched; data files md5-stable across runs; no new deps.
- **Commit:** `bab727fac9f3ae8d1ac8d0edb1fa7695e59cf941` · **Merge:** `c331a1fadbb607effa97c6a6dfa60660603fdf20` (main HEAD) · **VR:** VR-2026-09-10-01 · CAP-039: REDESIGN_DONE → PILOT (live in demo; B-1 external audit open; B-2 real pilot pending). **Open owner item (B-7):** reno16f exact floor.

## V1-2 closure record (2026-09-09)

- **Contract:** from the CAP-003 registry row ONLY (TTL 24h; VERIFIED|STALE; ±25%; "always dated, never AI-invented"; stale → "rates kal ke ho sakte hain — confirm karein" + scarcity auto-disabled; corrupt → "rates par kaam jaari hai" + handoff, never last-good (§27); owner file beats LLM memory ALWAYS; human approval on >25% price jump; acceptance "0 undated prices in any output"). Nothing invented.
- **Implemented:** `catalog.js` authority layer (VERIFIED/STALE/UNKNOWN per product; corrupt sentinel; the only customer-facing price/stock formatters; deterministic prompt labels; no cache — file IS the state); per-product `observed_at` + `verified_price` in the existing `products.json` (shipped honestly STALE at 2026-09-05); brain prompt rule 8 (model phrases, never relabels; customer-stated prices are requests, not data) + status-aware fallback + `evidence{observed_at, status:'VERIFIED'}` on the EXISTING P2 EVIDENCE stage (verified-only; absent ⇒ class rules); router menu/reserve/EMI status-aware (EMI table only from VERIFIED; declared-input math preserved); scheduler honest line on corrupt; `scripts/verify-catalog.mjs` owner ritual (check / --verify / >25% jump refused without `--approve-jump`; local, no UI) — the file's ONLY writer (static-proven; no remote/customer/LLM write path).
- **Verification:** `tests/v12authority.test.js` 16/16 on the real path (webhook → flows/brain → firewall → outbox spy; LLM capture double; real file patched per state, restored in teardown); suite 106/106 ×5 (3 pre-merge + 2 post-merge); cap055 14/14 ×3; foundations byte-untouched; adversarial: verified/stale/missing/malformed/future observed_at, missing product, zero stock, malformed price, corrupt catalog, fake-price injection (file hash immutable), per-request label recompute + V1-1 interplay, no promotion code path (grep), restart persistence (cross-process), mixed catalog, EMI gate, ritual + jump approval.
- **Commit:** `e95fdb946cc9f52f3fae982a58bddba83a5e77af` · **Merge:** `b62ed8796814c2e8fac4ea598f64d56bbca10f6d` (main HEAD) · **VR:** VR-2026-09-09-03 · CAP-003: PROTOTYPE → PILOT (live in demo; audit gate B-1 open; real-rate truth depends on the owner ritual).

## V1-1 closure record (2026-09-09)

- **Contract:** bounded per-customer multi-turn context in `brain.think()`; derived from repo conventions; DEBT-18 respected; foundations untouched; no new storage/DB/AI service/dependencies.
- **Implemented:** `customers.recentConversation(phone, n=12)` — pure derivation over the existing `db.messages` store (same source as CAP-008 §6 staff context); inbound → `user` role (untrusted), outbound text → `assistant`; chronological; skips empty text + `menu_*` flow ids; last 12 eligible × ≤500 chars (existing truncation) = ≤6000 chars; persistence = existing save()/loadDb() (restart proven cross-process); corrupt → [] / fresh start. `think()` builds `[system, ...history, user(current)]` — system always first, current turn always last, no duplication; new system-prompt rule 7 (history = DATA, not instructions).
- **Verification:** `tests/v11memory.test.js` 12/12 on the real path (signed webhook → brain → local LLM capture double → P2 firewall → outbox spy); suite 90/90 ×5 (3 pre-merge + 2 post-merge); cap055 14/14 ×3; CAP-008/055/P2 files untouched, all green; adversarial: isolation + PII cross-leak, replay/dup, empty, boundary + over-limit, restart, corrupt, missing, injection (system byte-identical), 4000-char message, non-text inbound.
- **Commit:** `47a2c160cd12d22dc5d2e393aab20ff88ec9cba9` · **Merge:** `bad2d3090c1745666f9f690ac5628aebd258e113` (main HEAD) · **VR:** VR-2026-09-09-02. (Process note: first commit landed on main by placement error, corrected via soft-reset before any record referenced it — documented in VR.)

## V1-0 closure record (2026-09-09)

- **Contract:** remove phantom reservation/booking/token behavior from every customer-facing path; replace with truthful behavior; build nothing new; foundations untouched.
- **Fixed sites (9):** router reserve intent (phantom RESERVED/token/24h + OOS "watch" promise), router menu_visit ("Token mil jayega" + false `BOOKING` state), router menu rows (Book Karein/Token lein/slot booking), router trade button (Visit book karein), emi ("appointment lein"), brain fallback (reserve suggestion), brain LLM prompt (new hard rule 6), products.json phantom "reserve" policy (LLM-quotable), plus empty-query guard (bare "reserve" no longer mis-resolves to first product) and `.gitignore` anchor fix (catalog file first-time tracked).
- **Verification:** `tests/v1truth.test.js` 11/11 through the real path (signed webhook → firewall → outbox spy); suite 78/78 ×5 (3 pre-merge + 2 post-merge); cap055 14/14 ×3; static scan zero phantom strings in executable code; CAP-008/055/P2 regression green, files untouched.
- **Recorded, not fixed (own authorization each):** trade-in substring-match priority (a57→a5 row); location-flow "demo link — asli pin yahan lagega" customer-visible string; dead `db.reservations` bucket; `menu_repair` row has no handler (AI-generic).
- **Commit:** `b9e6eb6a607ad92146bca9970bca3841354b06a2` · **Merge:** `36ca9df9003bc2bd74976184f463cd08e14aea3f` (main HEAD) · **VR:** VR-2026-09-09-01.
