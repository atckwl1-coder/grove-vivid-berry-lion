# CAP-055 — OWNER KILL SWITCH · AUTHORITATIVE SPECIFICATION
**Cycle scope:** CAP-055 ONLY. No Action Firewall, no CAP-009, no pricing/reservation/marketing work. The kill-switch interface is designed as a **mandatory global gate** that the future Action Firewall will consume (`gateForSend(meta)` + outbox `autonomyGuard`).

---

## 1 · AUTHENTICATION (how the owner is authenticated)

- Mechanism: **existing CAP-008 staff auth** — scrypt-hashed credentials seeded from secure env config (`STAFF_SEED_JSON`), server-side session tokens (32-byte random, 12h TTL), role check. STOP/RESUME require **role=OWNER**. STATUS readable by any authenticated staff.
- `OWNER_PHONE` (a WhatsApp number) is **NOT** used as authentication — possession of a phone/SIM ≠ identity. Explicitly rejected as an auth factor.
- If credentials file is missing/unreadable at the moment of a command → `401 SESSION_INVALID` (fail-closed), `KILL_SWITCH_DENIED` audited.
- **PILOT-strength disclaimer (explicit):** bearer sessions over plain HTTP are DEMO/PILOT-grade. Before internet exposure: HTTPS + `Secure` cookies + login rate-limit (DEBT-19). Production-grade would add hardware-key/TOTP — out of scope this cycle.
- Secrets: never hardcoded, never logged; `verifyLogin` never audits passwords; rotation = re-seed `STAFF_SEED_JSON` + delete `staff.json`/sessions dir (documented in README section below).

## 2 · COMMANDS

| Command | Endpoint | Role | Body | Confirmation |
|---|---|---|---|---|
| `STOP ALL` | `POST /inbox/kill/stop` | OWNER | `{actionId, reason?}` | none needed — **fail-safe: stopping must be trivially easy** |
| `STATUS` | `POST /inbox/kill/status` or `GET /inbox/kill?json=1` | OWNER/STAFF | `{actionId?}` | audited as command (`KILL_SWITCH_STATUS_CHECKED`) |
| `RESUME ALL` | `POST /inbox/kill/resume` | OWNER | `{actionId, reason, confirm:'RESUME'}` | **stronger than STOP**: typed token `RESUME` + mandatory reason (399/400 `CONFIRMATION_REQUIRED`, `REASON_REQUIRED`) |

- Resume is NEVER triggered by: restart, browser reopen, timeout, provider recovery, LLM suggestion. Only an authenticated OWNER POST. Every resume audits `KILL_SWITCH_RESUMED`.
- Web inbox banner (all staff): CURRENT STATE pill; OWNER sees STOP button / RESUME form (with typed-confirm input).
- **WhatsApp is NOT a kill-switch channel.** Customer text "STOP ALL" flows through normal bot handling — assertably no effect on the switch (adversarial test 4).

## 3 · STATE

```json
{ "state": "AUTOMATION_ACTIVE"|"AUTOMATION_STOPPED",
  "stopped_at": iso|null, "stopped_by": staffId|null, "reason": str|null,
  "resumed_at": iso|null, "resumed_by": staffId|null,
  "applied_actions": [actionId...], "updatedAt": iso }
```
- File: `data/killswitch.json`, atomic tmp+rename write. **Survives restart (file-backed).**
- **Fail-closed law:** ENOENT at first boot → create genesis ACTIVE (audited); **corrupt/unparseable state → treated as AUTOMATION_STOPPED + `KILL_STATE_UNREADABLE` audit.** Never "unreadable ⇒ assume ACTIVE".
- `applied_actions` = per-switch action-id ledger (idempotency, §6).

## 4 · STOP SEMANTICS (exactly)

Effect boundary, no overclaim:
```text
future autonomous external actions → BLOCKED (enqueue-layer + execute-layer)
already SENT / provider-accepted   → cannot be undone — we never claim otherwise
in-flight SENDING                  → race decides per §7 deterministic rule
```
Outbox states when STOP ALL executes:
| Job state | Behavior |
|---|---|
| QUEUED / RETRY_SCHEDULED (autonomous source) | immediately swept to `HELD_KILLSWITCH` (file stays in Q with `status=HELD_KILLSWITCH`, `nextAttemptAt=Infinity`, `heldAt`); audit `OUTBOX_HELD {count}` |
| SENDING (provider call already issued) | cannot be recalled; its result bookkeeping continues (Honest-UNKNOWN semantics intact) |
| UNKNOWN (crash-recovered, re-queued) | treated as autonomous due-job ⇒ HELD like QUEUED |
| SENT / DLQ | untouched (history) |
On `RESUME ALL`: held jobs → `status=QUEUED`, `nextAttemptAt=now`, audit `OUTBOX_HELD_RELEASED {count}`. They then flow through normal gates.

## 5 · HUMAN ACTIONS WHILE STOPPED
Allowed through both layers, enforced by actor tag — **not** by UI:
- `meta.source = 'HUMAN'` (staff reply, claimant-gated by CAP-008 ownership) → allowed
- `meta.source = 'CONSENT_ACK'` (reply to a customer's own opt-out/opt-in keyword — legal duty, user-triggered) → allowed
- **Blocked while stopped:** `AI`, `AI_SYSTEM_ACK`, `SYSTEM` (owner alerts too — kill switch means silence-of-autonomy; audit records what was blocked), `MARKETING`/`CAMPAIGN` (already OFF), any untagged send.
Escalation acks blocked ⇒ `ACK_SEND_FAILED` audited; conversation still queues for staff (inbox remains functional — that's the point of the fallback).

## 6 · IDEMPOTENCY
- Every command carries `actionId` (`[A-Za-z0-9-]{8,80}`). Replay of an applied actionId → `ALREADY_APPLIED`, no state flip, no duplicate audit of the transition.
- Repeated STOPs with fresh actionIds → state stays STOPPED; each audited with `prev_state=STOPPED, new_state=STOPPED, note:'already_stopped'`. Same for RESUME/ACTIVE. Deterministic, never inconsistent.

## 7 · CRITICAL RACE RULE (deterministic, named)
**RULE:** *stop-time wins at the check instant.* The execute-layer gate in `processJob` reads state synchronously immediately before the provider call; the enqueue-layer gate blocks new enqueues. Therefore:
- STOP committed at time T ⇒ any autonomous job whose dispatch-check runs ≥ T is HELD. No "probably stopped."
- A provider call already in flight when T lands may complete (boundary — outside Sentinel's reach). We never retract it.
- Enqueue racing STOP: if the enqueue-layer read happens before T, the job lands in Q with a future attempt — and the STOP sweep (holdAutonomous) marks it HELD; whichever ordering, the job cannot reach the provider after T. **Two walls ⇒ the union is total.**

## 8 · AUDIT EVENT SET
`KILL_SWITCH_STOPPED · KILL_SWITCH_RESUMED · KILL_SWITCH_STATUS_CHECKED · KILL_SWITCH_DENIED · KILL_STATE_UNREADABLE · KILL_SEND_BLOCKED · OUTBOX_HELD · OUTBOX_HELD_RELEASED`
Envelope: actor{staffId,role}, actionId, prev_state, new_state, reason, ts (+ held/released job counts). No secrets, no raw bodies beyond 120-char reason.

## 9 · FAILURE DEFAULT
Unreadable state ⇒ STOPPED (fail-closed). Session store unreadable ⇒ commands 401 (fail-closed). Plain-English: *if safety cannot be verified, autonomy stays off.*

## 10 · ADVERSARIAL TEST MATRIX (15 + functional)
1 unauth STOP → 401+DENIED · 2 unauth RESUME → 401 · 3 forged owner credential → denied, no state change · 4 customer "STOP ALL" via WhatsApp → zero effect · 5 LLM-path RESUME → impossible (no code path; asserted via customer route) · 6 STOP with QUEUED autonomous job → HELD, provider untouched · 7 STOP during scheduled retry → no second attempt until RESUME · 8 STOP survives process restart · 9 STOP×3 idempotent · 10 RESUME×2 idempotent · 11 STAFF tries STOP → 403+DENIED · 12 malformed commands → 400/404 · 13 corrupt state file ⇒ fail-closed STOPPED + audit + held job · 14 auth failure ⇒ no state change (state file mtime/content verified untouched) · 15 **race test §7** (job ready + STOP ≈ same time → after T, HELD; control run without STOP → delivered).

## 11 · PRODUCTION BOUNDARY (honest scope)
Proven: while the Sentinel process is alive, state store reachable-and-readable, and every external action passes through the Sentinel outbox/chokepoint, autonomous sends stop deterministically at T and resume only via OWNER command.
NOT PROVEN (labeled): provider-side in-flight messages already accepted; anything bypassing the Sentinel process (raw Meta dashboard sends); clock/host failure killing the sweeper while state STOPPED (outbox held anyway); real WhatsApp pilot behavior (Phase 5).

## 12 · VERIFICATION LOOP
spec ✔ → implement → full suite green (37 now) + ~17 new → adversarial 15/15 → restart test → live drill (STOP → silence → restart-still-stopped → RESUME → held job drains) → VR record → registry CAP-055 → PILOT → **STOP.**
