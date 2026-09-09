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

---

## VR-2026-09-07-03 — PHASE 2A.1 REMEDIATION (P0 fast-track)

- **Claim (per item):** R1 missing-dir recovery · R2a restart-persistent idempotency · R2b no-resend-after-success · R3 true-SIGKILL recovery · R4 complete PII boundary (logger/demo/retention) · R5/R6 terminology truth enforced by lint.
- **Method:** 7 new targeted tests appended to suite (tests/phase2a1.remediation.test.js) + LIVE adversarial demo (real server kill → restart → replay): evidence/restart-replay-demo.txt
- **Results:** `npm test` → **18/18 PASS** (10 original green + 7 new + boundary lint). Failures encountered DURING remediation (recorded, not hidden): (a) R3 fixture exited instantly — unref'd outbox timer has no event-loop anchor in a naked process; fixture keep-alive added; (b) R5/R6 lint originally self-matched the forbidden phrases in its OWN assertion text — dynamically-built patterns now. Both fixed before this record.
- **Live adversarial proof:** signed event processed on boot#1 → server hard-killed → boot#2 replay → EVENT_DUPLICATE, total processes across both boots = 1. (evidence/restart-replay-demo.txt)
- **Result:** PASS — all six mandated P0 items closed.
- **Limitations (unchanged honesty):** at-least-once at provider boundary remains (by design, truthful UNKNOWN); audit rotation (DEBT-17) untouched per scope freeze; PII boundary now: redacted surfaces (logs/audit/demo) vs sensitive zone (DB+job files, server-only, 7-day outbox retention GC added).
- **Registry:** change_log entry appended; CAP-001/CAP-011 remain PILOT (limitation rows trimmed where R-items closed them).

**Suite:** `npm test` → 18/18 ✅ · restart-attack demo ✅ · terminology lint repo-wide ✅

---

## VR-2026-09-08-01 — CAP-008 HUMAN FALLBACK CORE (Phase 2B first unit)

- **Claim:** Human fallback is now a REAL mechanism: escalate→queue→claim(atomic)→AI suppressed (2 server-side walls)→reply via durable outbox→resolve→explicit return-to-AI; SLA measured; tenant-scoped staff auth; every transition audited.
- **Method:** `tests/cap008.test.js` (19 tests: 7 functional pipeline + 12 adversarial per directive STEP 14) + live server drill (`evidence/cap008-live-drill.txt`).
- **Results:** full suite **37/37 PASS** (10 phase-2A + 8 remediation + 19 CAP-008), 4.7s. Live drill (DEMO mode, signed webhooks): CUSTOMER_REQUESTED escalated → QUEUED → 2 inbound msgs suppressed (AI_SUPPRESSED×2 audited, zero outbound) → hassan CLAIMED → boss ALREADY_CLAIMED/CLAIM_CONFLICT → reply SENT_VIA_OUTBOX → HUMAN_ACTIVE (first_human_response_at set) → RESOLVED → explicit return → AI_ACTIVE → next inbound answered by bot. Server killed & restarted: state+7-history restored from disk, 0 stray locks, sessions live server-side.
- **Defects found & fixed during verification (recorded, not hidden):** T-1 redacted PII in audit conversation IDs broke test-side lookups (tests now compare masked form — masking stays, assert fixed); T-2 handleAction wasn't async → HUMAN_MESSAGE_SENT lacked outboxJob (fixed: awaited); T-3 time-of-day-dependent ack assertion (fixed: invariant substring); T-4 two banned-phrase literals in new test file caught by our own repo lint (wording fixed — proof the R5/R6 guard works); T-5 inbox syntax error from sed edit (fixed).
- **Result:** PASS.
- **Limitations (honest):** single-instance deployment (claim lock is O_EXCL on local FS — multi-node needs DB/Redis locking); SLA granularity = 60s sweep; provider UNKNOWN-after-send remains at-least-once (2A documented boundary); inbox is plain server-rendered HTML (by design); demo sessions secret-seeded — production needs real STAFF_SEED_JSON + SESSION_SECRET + HTTPS cookie hardening (`Secure` flag pending on login route — marked debt below).
- **Registry:** CAP-008-human-inbox: BLOCKED → **PILOT**. The §18 "zero-bug fallback unproven" STOP condition is LIFTED for the system. DEBT-19 registered: add `Secure` cookie + login rate-limit before internet exposure. DEBT-17/18 still open, untouched per scope.

**Suite:** `npm test` → 37/37 ✅ · live drill ✅ · adversarial 12/12 ✅

---

## VR-2026-09-08-02 — CAP-055 OWNER KILL SWITCH (global autonomy brake)

- **Claim:** Authenticated OWNER can stop/resume ALL autonomous external side effects; deterministic; server-side; fail-closed on unreadable state; survives process death; humans keep working; idempotent commands; full audit.
- **Method:** `tests/cap055.test.js` (14 tests covering ALL 15 mandated adversarial cases + functional cycle) + live two-phase drill with REAL process kill between (`evidence/cap055-live-drill.txt`).
- **Results:** full suite **51/51 PASS** (10+8+19+14), ~7s. Race rule implemented + tested (KS6/KS15): two walls — enqueue gate refuses new autonomous sends (`KILL_SWITCH_ACTIVE` throw) and execute gate in outbox holds due jobs (`HELD_KILLSWITCH`, explicit state). Live drill: baseline EMI delivered → OWNER stop (audit) → customer msgs silent (`KILL_SEND_BLOCKED`, and blocked-at-enqueue so NO zombie jobs sat in queue) → STAFF stop attempt 403 `KILL_SWITCH_DENIED` → anon status 401 → **process killed; restarted: state file STOPPED, stopped_by=boss intact, still silent** → resume required typed `confirm:'RESUME'`+reason → ACTIVE → subsequent EMI delivered. Audit chain verbatim in evidence file.
- **Defects found & fixed during verification (recorded):** KC-1 KS7 timing race in the TEST itself (120ms covered both fail+retry) → deterministic flakyAlways flag design; KC-2 my own comment tripped the repo overclaim lint (self-enforcement works); KC-3 earlier `process.exit(0)` test teardown truncated node:test runner IPC → phantom file-level "deserialize" failure under multi-file runs → replaced with graceful `server.closeAllConnections()` teardown (fixes the undici keep-alive child-hang properly too).
- **Result:** PASS.
- **Limitations (honest):** PILOT-grade owner auth (bearer session, plain HTTP here — HTTPS+Secure+rate-limit = DEBT-19); single-instance semantics (multi-node kill needs shared state); provider-accepted in-flight messages cannot be recalled (spec §4 boundary — we never claim otherwise); state file lacks checksum/backup (corruption fails CLOSED which is safe but blocks autonomy until repair — availability trade-off consciously chosen for a safety control).
- **Registry:** CAP-055-owner-kill-switch: REQUIRED_NOT_BUILT → **PILOT**.

**Suite:** `npm test` → 51/51 ✅ · race deterministic ✅ · restart-persistent ✅ · adversarial 15/15 ✅

---

## VR-2026-09-08-03 — P2 CENTRAL ACTION FIREWALL (authorization boundary)

- **Claim:** every autonomous state-changing external send now passes a deterministic server-side firewall BEFORE the outbox; closed action-class set; precedence law enforced; fail-closed everywhere; composes (not replaces) CAP-055/CAP-008.
- **Authoritative-doc inventory (declared, per evidence law):** mandated Signal docs (CLAUDE.md, SPEC.md, BUILD_PLAN.md, docs/*, .claude/ai-bridge/*, GPT_AUDIT F1–F35, PROGRESS/STATE/HANDOFF/BLOCKERS.md, standalone P2 task card) are **ABSENT from this workspace — used as NOT-AVAILABLE, not fabricated**. Contract derived from: the authorization prompt + user's earlier roadmap line (stage order + decision set) + existing proven specs.
- **Method:** `tests/p2firewall.test.js` (16 blocks incl. bypass static-scan, replay, concurrency twin, injection, kill composition, audit-chain integrity, privacy, fail-closed internals, restart idempotency) + live drill `evidence/p2-firewall-live-drill.txt` (ALLOW→KILL-DENY→resume-ALLOW with traceId-linked KILL_SEND_BLOCKED).
- **Results:** suite **67/67 PASS** via new deterministic sequential runner (node20 multi-file IPC race workaround). Live: baseline `FIREWALL_DECISION ALLOW ALL_STAGES_PASS class=MSG.AI_TEXT` (phone masked) → owner STOP → `DENY/KILL/KILL_SWITCH_ACTIVE` + `EVENT_FAILED` (nothing queued — no zombie) → RESUME → ALLOW; deliveries exactly [deliver, silence, deliver].
- **AI-audit checkpoint — HONEST SUBSTITUTE (labeled):** .claude/ai-bridge absent ⇒ same-session independent inspection of the full `git diff main` instead (NOT a fresh-context external auditor — limitation). Findings:
  - AF-1 **FIXED** — outbox.enqueue dropped unknown meta keys (firewall decision lost on jobs) → `...meta` preserved.
  - AF-2 **FIXED** — `AI_SYSTEM_ACK` was allowed when the conversation didn't even exist → window-only rule (any ack outside a true ESCALATION_PENDING window now DENY + audit).
  - AF-3 **ACCEPTED** — test-runner multi-file IPC flakiness (node v20.20.2) → sequential runner; suppressed flakiness, root cause in runner not product.
  - AF-4 **ACCEPTED** — per-send kill state file read (pilot scale fine; revisit with SQLite migration trigger rule).
  - AF-5 **ACCEPTED** — legacy setSendGuard/setKillGate now post-ALLOW shims; can never double-audit (firewall denies first on stopped; guards audit only on block-on-allow-path).
  - AF-6 **DEFERRED → DEBT-20** — scheduler owner-brief tags source AI (semantic mismatch with MSG.SYSTEM_ALERT; behaviorally identical today — both autonomous).
  - AF-7 **ACCEPTED** — ESCALATE decision type wired but unused by current class set (spec-documented, not invented into use).
  - AF-8 **FIXED(retro)** — drill scripts signed webhooks with an awk field bug (`$3`→empty) making earlier cap055 live customer-message legs invalid (posts were WEBHOOK_FORGED-rejected — kill endpoints unaffected); re-run with fixed signing: real baseline delivery + real silence + restart persistence (`evidence/cap055-live-drill-v2.txt`).
  - AF-9 **ACCEPTED** — node test-runner multi-file AND single-file child-IPC corruption under load; suites now run in-process per file via scripts/run-tests.mjs.
  - AF-10 **FIXED (during post-merge replay re-verification)** — KS6/KS15 race test was itself racy (HTTP stop roundtrip vs 15ms poll tick; ~1/9 flake). Reconstructed deterministically: sync `enqueue + stopAll` in one event-loop turn = structurally no tick between. Verified: 12/12 consecutive clean full-suite runs post-fix. This replay cycle also re-confirmed merged main stays green and caught the flake honestly (replay re-verification policy paid off).
- **Result:** PASS (sandbox grade). Ceiling: **PILOT**.
- **Limitations:** single-instance only; decision point = enqueue (+ kill re-check at execution); direct outbox.enqueue callers outside whatsapp.js are proven absent by static scan TODAY (hostile future code is a review matter, declared NOT-PROOFABLE by tests); UNKNOWN lives at provider boundary as before.

**Suite:** `npm test` → 67/67 ✅ (5 files, sequential deterministic runner) · adversarial incl. injection/replay/race ✅ · live firewall drill ✅

---

## VR-2026-09-08-04 — P2 AUDIT-INTEGRITY REMEDIATION (governance gap closure; NO product change)

- **Trigger:** user's audit-integrity directive — the P2 report's audit checkpoint was honestly labeled a same-session substitute; that is NOT the mandated fresh-context audit.
- **Inspection results (commands + outputs recorded in GPT_AUDIT.md §A):** `.claude/ai-bridge/` absent from working tree AND all 8 commits; `AUDIT_PROTOCOL.md` never existed; **F1–F35 never existed in this workspace** (`git grep` over full history → only my own absence-declarations); no auditor-dispatch mechanism exists.
- **Truth ruling:** audit checkpoint for P2 (and all shipped capabilities) = **BLOCKED — NOT PROVEN (external-audit dimension)**, not retroactively "passed". Implementation-side verification remains valid on its own merits.
- **CAP-055 AF-10 regression verification (mandated):** `git show 4abc296 --stat` → test-file only (6+/4−); `git diff` src/ across the merge → empty (zero product-code change); race rule proven intact in source (`HELD_KILLSWITCH` gate + onKill hooks unchanged); targeted `cap055` 4/4 clean (14/14 each); full suite 5/5 clean (67/67); kill semantics + hold/resume semantics unchanged — **the AF-10 change is test-determinism-only (PROVEN)**. EXPECTED/ACTUAL embedded above. **Proves:** no behavior delta from AF-10. **Does NOT prove:** anything about Meta-real execution (demo transport remains).
- **P2 implementation re-inspection (bounded, no rebuild):** centralized enforcement (static call in whatsapp.send — W1 scan), no bypass transport, CAP-055 composition, closed classes, precedence, fail-closed, CAP-008 authz reuse, evidence gate, idempotency replay-deny, audit provenance w/ traceId, UNKNOWN preserved at provider boundary, concurrency (claim O_EXCL), restart (disk markers) — all as previously verified; suite re-run green post-merge.
- **Deliverables:** GPT_AUDIT.md (real ledger; dispositions preserved append-only; audit-gate table), BLOCKERS.md (B-1 exact unblock), PROGRESS.md, STATE.md, HANDOFF.md (compact pointers — created only now, because the directive explicitly required them; before this, governance lived in VR+registry and that remains authoritative).
- **Result:** REMEDIATION COMPLETE for documentation; AUDIT GATE stays OPEN until real auditor infrastructure exists. P2 status: **PILOT (audit-gate blocked)** — unchanged, not promoted, not demoted.

**Suite:** `npm test` → 67/67 ✅ (5 of 5 clean runs this cycle) · cap055 targeted 4/4 ✅ · zero product diff ✅

---

## VR-2026-09-09-01 — V1-0 TRUTH CUT (phantom reservation/booking/token removed; no-lie invariant restored)

- **Mandate:** remove the phantom reservation / fake booking behavior from every customer-facing path; replace false claims with truthful behavior; build NOTHING new (no reservation capability, no persistence, no slots, no token semantics); CAP-008/CAP-055/P2 unmodified.
- **Scope basis:** V1 COMPLETION AUDIT (12-section inventory, delivered 2026-09-09; durable copy = `V1_COMPLETION_AUDIT.md`). V1-0 = "kill phantom reservation tokens + any other lying texts".
- **False behaviors found (keyword sweep: reservation/reserved/booking/booked/token/visit/confirmed/slot + appointment/watch/NK-/24 ghante/hold — src, scripts, tests, root docs; every hit inspected):**
  1. `flows/router.js` reserve intent — "✅ RESERVED! 🎉 … 24 ghante tak aapke naam par … Token: NK-…" (phantom success + fake token + fake hold). **FIXED.**
  2. `flows/router.js` reserve OOS branch — "watch … stock aate hi sab se pehle aapko khabar milegi" (phantom subscription; no watchlist exists). **FIXED (folded into honest single path; stock-0 reported truthfully).**
  3. `flows/router.js` menu_visit — "Token mil jayega — store par wait nahi karna parega!" + wrote false `state:'BOOKING'` (no consumer existed). **FIXED (honest deferral; state line removed).**
  4. `flows/router.js` menu rows — "Store Visit Book Karein / Token lein, line mein na lagein" and "Phone doctor + slot booking". **FIXED (labels truthful; ids/handlers untouched).**
  5. `flows/router.js` trade-in button — "Visit book karein". **FIXED → "Timing & pata".**
  6. `services/emi.js` — "'visit' likh kar appointment lein". **FIXED → "timing aur pata mil jayega".**
  7. `services/brain.js` demo fallback — suggested "reserve {id}" command (feature absent). **FIXED.**
  8. `services/brain.js` LLM system prompt — no rule preventing the LLM from promising reservations/tokens/holds. **FIXED (new hard rule 6).**
  9. `data/products.json` policies.reserve — "Phone 24 ghante ke liye aapke naam par lock ho jata hai, bilkul free" (phantom policy; **quotable by the LLM** — system prompt embeds `JSON.stringify(policies)`). **FIXED.**
  - Inspected, NO change (reasons recorded): `customers.js` `reservations: []` dead bucket (no reader, no customer-facing effect); `tradein.js` "Final value store par confirm hogi" (true in-store process, not a booking claim); `brain.js` "confirm kar ke batata hoon"→handoff (true); session/verify tokens in auth/webhook (staff-side infra); README env token (infra).
- **Implementation:** 3 code files + 1 data file + 1 test file + `.gitignore` (see §files). Smallest safe change: only the false claims and their direct enablers; every flow handler's id, control flow, and return contract preserved.
- **Latent defect found+fixed inside the touched path:** bare `reserve` → `findProduct('')` matched the FIRST product (`name.includes('')` is always true) — old code phantom-"reserved" a3x on a bare word; new code quotes a3x's price as if asked. Empty-query guard added (reserve path only; `findProduct` itself untouched — other callers already guarded).
- **Repo defect exposed by the cut, minimally fixed:** `src/data/products.json` was git-IGNORED by the unanchored `data/` pattern since the retro git-init (a fresh clone has no catalog → boot failure). `.gitignore` anchored to `/data/` (runtime `./data` still ignored) and the file is first-time tracked. No content of the file changed beyond the phantom policy string.
- **Mandated verification (EXPECTED / ACTUAL / PROVES / DOES-NOT-PROVE):**
  1. *Previous phantom response cannot be produced* — EXP: "reserve reno13" yields zero of {RESERVED, Token, NK-\d+, 24 ghante, aapke naam par}; ACT: T1 asserted clean through real signed-webhook→firewall→outbox path; PROVES: phantom unproducible via the reserve flow; DOES-NOT-PROVE: that a real reservation capability exists (it does not) or LLM-path behavior (prompt rule 6, non-deterministic).
  2. *No fake token generated* — EXP: no /NK-\d+/ anywhere; ACT: T2 (bare intent) + T9 (global scan of every delivery) clean; static scan: zero phantom strings in executable code (only in explanatory comments); PROVES: no token is produced on any tested path; DOES-NOT-PROVE: future code can't reintroduce one (review matter).
  3. *No nonexistent reservation represented as successful* — EXP: no success claim; no booking state; ACT: T1/T2/T4 — reply is a deferral; customer record stays `state:'IDLE'` (asserted from DB file); PROVES: no fake reservation state written; DOES-NOT-PROVE: LLM won't improvise one (rule 6 mitigates).
  4. *No slot/availability falsely claimed* — EXP: visit flow admits "slot confirm nahi kar sakte"; stock-0 reported as "0 pieces"; no watch promise; ACT: T3 (stock patched to 0 in-flight, file restored byte-exact) + T4 clean; PROVES: availability truthfully reported, no phantom subscription; DOES-NOT-PROVE: that catalog data is live (V1-2 staleness).
  5. *Replacement message truthful* — EXP: every factual line maps to a real source (price/stock ← products.json; timing ← policies; staff ← CAP-008 proven); ACT: T5 + T1 asserted per-line; PROVES: message claims only system-backed facts/actions; DOES-NOT-PROVE: data freshness (owner-maintained JSON).
  6. *Menu remains functional* — EXP: all 6 rows present with working handlers; ACT: T6 — full list delivered, ids intact, labels honest; PROVES: menu behavior preserved; DOES-NOT-PROVE: menu_repair tap destination quality (no handler — pre-existing, AI-generic; recorded).
  7. *CAP-008 green* — ACT: 19/19 (pre-merge ×3 suites + post-merge ×2; file untouched in diff); PROVES: no regression in human-fallback core; DOES-NOT-PROVE: real-WhatsApp staff pilot (Phase 5).
  8. *CAP-055 green* — ACT: 14/14, 3 targeted runs + in-suite; file untouched in diff; PROVES: kill-switch regression-free; DOES-NOT-PROVE: Meta-real stop semantics (demo transport).
  9. *P2 green* — ACT: 16/16; firewall.js untouched; every v1truth delivery passed through the P2 firewall (spy outbox = post-firewall); PROVES: no firewall regression, new sends pass closed-class policy; DOES-NOT-PROVE: external audit gate (B-1 remains OPEN for all).
  10. *No unrelated behavior changed* — EXP: diff = exactly the truth-cut hunks; ACT: `git diff` reviewed hunk-by-hunk (5 router hunks, 2 brain, 1 emi, 1 data, .gitignore anchor); T10 location flow byte-identical in assertions; suite 78/78; PROVES: no unrelated behavior delta on tested surfaces; DOES-NOT-PROVE: untested surfaces (none changed per diff).
- **Runs:** focused `tests/v1truth.test.js` 11/11 (after 2 test-expectation fixes: bare-intent guard behavior + pre-existing trade-in match priority pinned, see findings); full suite **78/78 ×3** pre-merge + **×2** post-merge (files=6: cap008 19, cap055 14, p2firewall 16, phase2a 10, remediation 8, v1truth 11); cap055 targeted 14/14 ×3.
- **Out-of-scope findings recorded (NOT fixed — each needs its own authorization):** (a) trade-in substring-match priority: `a57` matches the `a5` row first → Rs.8,000 instead of a57-row Rs.12,000 (estimate stays honestly labeled); (b) location flow ships a "demo link — asli pin yahan lagega" disclosure string in customer messages (demo artifact in live text); (c) dead `db.reservations: []` bucket; (d) `menu_repair` row has no router handler (falls to AI-generic).
- **Result:** PASS (sandbox grade). V1-0 CLOSED. CAP-006 row: REDESIGN_REQUIRED → NOT_PROVEN (capability absent; honest deferral proven). Nothing promoted. Audit gate B-1 remains OPEN for everything shipped.

**Suite:** `npm test` → **78/78** ✅ (6 files) · focused v1truth 11/11 ✅ · cap055 14/14 ×3 ✅ · zero phantom strings in executable code ✅
