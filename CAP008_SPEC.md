# CAP-008 — HUMAN FALLBACK CORE · AUTHORITATIVE SPECIFICATION
**Version:** 2.0 — supersedes the 2026-09-07 draft (draft retained in gitless history as `CAP008_SPEC.md` v1 content; this file is now the contract).
**Status:** SPEC FROZEN for this cycle. Build order: this file → code → tests → adversarial → live drill → VR → registry → STOP.
**Governing law:** Sentinel §12/§16/§27/§30 + fast-track build directive 2026-09-08. Scope: CAP-008 ONLY. No reservation/payment/marketing/voice/vision/calling changes.

---

## 1 · CONVERSATION STATES (exact set)

```
AI_ACTIVE            AI/flows may answer; default state
ESCALATION_PENDING   escalation recorded, ack Ms. sent, entering queue
QUEUED               visible in staff inbox, unclaimed
CLAIMED              owned by exactly one staff member, no human msg yet
HUMAN_ACTIVE         owner staff has sent ≥1 reply
RESOLVED             human marked done; AI still suspended
AI_RESUMABLE         staff explicitly authorized AI return (committed → AI_ACTIVE)
CLOSED               resolved without AI return (archival end-state)
SLA_BREACHED         ≡ sla_status marker: BREACHED (see §8) overlaid on QUEUED/CLAIMED/HUMAN_ACTIVE
```

**Design note (mandated clarity):** `SLA_BREACHED` is implemented as a first-class *sla status* (audit event `SLA_BREACHED` + `sla_status: BREACHED` + inbox label), **not** a competing core state — replacing `CLAIMED` on breach would destroy ownership and break the claim invariant. The directive's sla vocabulary (WITHIN_SLA / BREACHED / RESOLVED) is preserved verbatim in `sla_status`.

### Legal transition table (only these; all else = `ILLEGAL_TRANSITION → 409` + `TRANSITION_REJECTED` audit)

| From | To | Via action | Actor |
|---|---|---|---|
| AI_ACTIVE | ESCALATION_PENDING | `escalate(reason)` | system |
| ESCALATION_PENDING | QUEUED | `escalate` (2nd step, same tx) | system |
| CLOSED | ESCALATION_PENDING | `escalate` (audit `REOPENED`) | system |
| QUEUED | CLAIMED | `claim(actionId)` | OWNER/STAFF (atomic, §4) |
| CLAIMED | QUEUED | `unclaim` | claimedBy or OWNER |
| CLAIMED | HUMAN_ACTIVE | first `reply` (implicit) | claimedBy |
| CLAIMED | RESOLVED | `resolve(actionId)` | claimedBy or OWNER |
| HUMAN_ACTIVE | RESOLVED | `resolve(actionId)` | claimedBy or OWNER |
| RESOLVED | AI_RESUMABLE → AI_ACTIVE | `return-to-ai(actionId)` (two states, one commit) | claimedBy or OWNER |
| RESOLVED | CLOSED | `close(actionId)` | claimedBy or OWNER |

Never legal (examples of rejection): QUEUED→RESOLVED, QUEUED→HUMAN_ACTIVE, AI_ACTIVE→CLAIMED, RESOLVED→HUMAN_ACTIVE, CLOSED→CLAIMED.

## 2 · STAFF AUTHENTICATION

- Roles: **OWNER, STAFF** — nothing broader.
- Credentials: **never hardcoded, never plaintext.** `data/staff.json` (git-ignored, 0600 dir) seeded on first boot from env `STAFF_SEED_JSON` (array of `{id,password,role}`); stored as scrypt(salt·64)+hash. **Boot refusal in LIVE if `STAFF_SEED_JSON` unset when no staff file exists.**
- Sessions: random 32-byte token → httpOnly, sameSite=lax cookie (12h TTL; `SESSION_SECRET` env required in LIVE). **Server-side session store** `data/sessions/{token}.json` {staffId, role, tenant, csrf, expiresAt} — browser never holds truth. Expired/garbage/absent → `401 SESSION_EXPIRED|SESSION_INVALID`, audited.
- CSRF: per-session token, required on every mutating POST (form field or `x-csrf`) → `403 CSRF_MISMATCH`.
- Login: `POST /inbox/login`; failures audited (`LOGIN_FAILED`), success audited (`LOGIN_OK`, staffId only, never password).
- All inbox reads/writes carry `actor={staffId,role,tenant}`; **staffId enters every inbox audit entry** (STEP 11).

## 3 · TENANT / CONVERSATION ISOLATION

- `TENANT_ID` env (demo default `khanewal-demo`). Staff records pin `tenant`; conversations pin `tenant`.
- Server-side authorization for every inbox access: `authenticate(req) → actor` then `authorize(actor, conv) = actor.tenant === conv.tenant && role ∈ {OWNER,STAFF}` → else `403 TENANT_DENY` (audited, **zero conversation bytes in response**).
- **The LLM never touches authorization.** Brain only *requests* escalation; backend validates reason ∧ performs transitions.

## 4 · CLAIM / LOCK (atomic)

- Claim lock = exclusive file create: `open('wx')` on `data/conversations/{tenant}/claims/{phone}.lock` (O_EXCL — atomic **across processes**, not just the event loop). Lock body: `{staffId, claimedAt}`.
- Concurrent claims: exactly one 200 `CLAIMED`; loser gets `409 ALREADY_CLAIMED {claimedBy}` + audit. **No silent overwrite.** Non-owner reply attempts → `403 NOT_OWNER`.
- Lock released on: unclaim, resolve, close, return-to-ai commit. Server is the only source of ownership (refresh-safe, STEP 12).

## 5 · AI SUPPRESSION (server-side, double-walled)

1. **Inbound wall:** `handleIncomingMessage` checks `isSuppressed(phone)` for states {ESCALATION_PENDING, QUEUED, CLAIMED, HUMAN_ACTIVE} → message logged into conversation context, audit `AI_SUPPRESSED`, **no flow, no AI, no auto-send.** Superset of the mandated minimum (CLAIMED/HUMAN_ACTIVE), chosen so a queued customer never gets competing bot chatter. *Consent law outranks suppression: opt-out keywords still execute.*
2. **Outbound chokepoint:** the single `wa.send()` path carries mandatory `meta.source`; injected guard `authorizeOutbound(phone, meta)` rejects when conversation is human-owned unless `meta.source==='HUMAN' ∧ meta.staffId===claimedBy` → else `AI_SEND_BLOCKED_HUMAN_ACTIVE` (throws + audit). **Invariant: HUMAN_ACTIVE can never produce an autonomous AI customer message — not via UI, not via LLM, not via code path.**

## 6 · CONTEXT TRANSFER (labeled truth)

Conversation view shows: customer identity + phone (staff is authenticated sensitive-zone — allowed; audit logs only masked), DISPLAY NAME (profile), **last 20 messages each tagged `[CUSTOMER MESSAGE]`, `[BOT]`, or `[STAFF•<id>]`,** escalation `reason` (controlled set), `state` + SLA clock, **VERIFIED FACTS** panel (only server-derived: name, opt-in state, lastSeen, conversation SLA fields) and — only if an AI ran — an `AI INFERENCE (ESTIMATED, NOT FACT)` strip carrying intent label. Never presented as fact.

## 7 · HUMAN MESSAGE PATH (no parallel pipe)

```
staff reply → authorize(actor, conv) → ownership check (claimedBy===actor) → actionId dedupe
→ conversation HUMAN_ACTIVE transition → wa.sendText ≡ outbox.enqueue(payload, meta{source:HUMAN,staffId,actionId})
→ provider → result → audit HUMAN_MESSAGE_SENT {actor, actionId, outboxJobId}
```
No raw axios calls from inbox. Provider failure → existing outbox retry/DLQ/UNKNOWN semantics (Phase 2A proven). Provider result UNKNOWN → **no automatic resend beyond outbox policy** (at-least-once boundary documented).

## 8 · SLA (measured, honest)

Fields on conversation: `queued_at, claimed_at, first_human_response_at, resolved_at, sla_deadline, sla_status ∈ {WITHIN_SLA, BREACHED, RESOLVED}`.
- Store hours 10:00–22:00 PKT. Deadline = in-hours ? queued_at + `SLA_MINUTES_IN_HOURS` (default 5) : next 10:00 PKT + 5 min.
- 60s sweep: human-owned ∧ deadline passed ∧ WITHIN_SLA → `sla_status=BREACHED`, audit `SLA_BREACHED`, owner alert via outbox (once).
- **Wording law:** customer acks say "team ka target 5 minute hai" (in hours) / "store band hai — kal subah 10 baje ke baad baat ho gi" (after hours). The old fixed *"5 minute mein aapko khud baat ho gi"* promise is deleted from `router.js`/`brain.js` in this cycle — it was unmeasurable, therefore unhonest.

## 9 · ESCALATION REASONS (closed set — backend validates)

`CUSTOMER_REQUESTED_HUMAN · AI_UNCERTAIN · COMPLAINT · PAYMENT · PRICE_EXCEPTION · PRODUCT_EXCEPTION · TECHNICAL_FAILURE · POLICY_LIMIT · UNKNOWN`
Model may **recommend** (`intent`→ reason map: complaint→COMPLAINT, ai_error→TECHNICAL_FAILURE, payment→PAYMENT, else AI_UNCERTAIN; `menu_staff`→CUSTOMER_REQUESTED_HUMAN). Backend rejects anything outside the set → falls back `UNKNOWN` + audit.

## 10 · RETURN TO AI

Explicit `POST …/return-to-ai {actionId}` by claimedBy/OWNER from RESOLVED only → AI_RESUMABLE → committed AI_ACTIVE (audit `AI_RESUMED`). **Never** by timeout, typing-stop, or tab close (STEP 12: claim survives browser close — deterministic ownership until explicit action).

## 11 · AUDIT (event set + envelope)

`ESCALATED · ASSIGNED · CLAIMED · UNCLAIMED · HUMAN_MESSAGE_SENT · RESOLVED · REOPENED · AI_RESUMED · SLA_BREACHED · TRANSITION_REJECTED · LOGIN_OK · LOGIN_FAILED · SESSION_EXPIRED · TENANT_DENY · AI_SEND_BLOCKED_HUMAN_ACTIVE · CSRF_MISMATCH · AI_SUPPRESSED`
Entry envelope: `{ts, type, payload:{actor{staffId,role}, tenant, conversation, prev_state, new_state, reason, actionId}}` — phone numbers always masked by existing `redact()`. No raw message bodies in audit (PII boundary).

## 12 · FAILURE HANDLING (tested, not asserted)

| Failure | Behavior |
|---|---|
| Claimed, browser closes | Ownership persists in lock+state; next staff sees ALREADY_CLAIMED; OWNER may unclaim |
| Provider result UNKNOWN after staff send | Outbox honest states; no bespoke resend; audit gap states preserved |
| Simultaneous claims | §4 atomic — exactly one winner |
| AI send while HUMAN_ACTIVE | §5 wall 2 — blocked server-side + audit |
| Session lost mid-conversation | Mutations 401; read 401; naught else. Fail-closed. |
| State write fails | atomic tmp+rename; failure surfaces `500 STATE_WRITE_FAILED`, conversation never *appears* resolved on silent error (resolve only commits after write returns) |
| Browser reload | All state from server (`GET /inbox/c/:phone` renders from disk) |

## 13 · UI (smallest functional)

- `GET /inbox` — table: customer (name/masked-last3… actually staff needs identity: full phone in this authenticated page — sensitive zone), last message snippet, state pill, assigned staff, unread/priority (⚑ queued-first sort), SLA badge (✅/⏳/🔥BREACHED).
- `GET /inbox/c/:phone` — labeled history (§6), facts panel, escalation reason, claim/unclaim, reply box, resolve, return-to-AI (RESOLVED only), state + SLA fields.
- Inline CSS only (preview-safe), zero JS frameworks, zero dashboards/charts/themes.

## 14 · SECURITY TESTS (all 12, EXPECTED/ACTUAL/PROVES/N⊄)

1 unauth inbox read · 2 wrong-tenant read · 3 simultaneous claim race · 4 AI send while HUMAN_ACTIVE · 5 forged transition (QUEUED→resolve) · 6 forged token · 7 expired session · 8 replayed claim (same actionId) · 9 replayed resolve · 10 replayed staff message · 11 claim survives "refresh" (server re-read) · 12 provider timeout after staff send (bounded retry, no duplicate beyond policy).

## 15 · PRODUCTION CLAIM BOUNDARY

This build can earn at most **PILOT**: code+tests+adversarial+local drill. `VERIFIED_PRODUCTION` additionally requires real-WhatsApp pilot (Phase 5): real staff, real customers, real deliverability, SLA observed in the wild.

## 16 · DEBTS

DEBT-17 (audit rotation), DEBT-18 (customers-DB sensitive-zone controls) remain open — out of scope here. If an undocumented dependency blocks work → report `BLOCKED — DEPENDENCY` and stop. (None anticipated: all 2A primitives exist.)

## 17 · VERIFICATION LOOP

spec ✔ → implement only CAP-008 → `npm test` → adversarial 12 → live drill (login→escalate→claim→suppress→reply→resolve→return-to-AI) → audit inspection → VR record → registry `CAP-008: PROTOTYPE → PILOT` → **STOP** (no CAP-009 without authorization).

**Definition of Done (fast-track 12):** spec ✔ code ✔ unit green ✔ adversarial green ✔ live drill ✔ audit verified ✔ suppression verified ✔ race verified ✔ recovery verified ✔ VR ✔ registry ✔ honest limitations recorded ✔.
