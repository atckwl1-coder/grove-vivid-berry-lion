# B-2 LIVE SMOKE CHECKLIST

**Status:** OPERATOR PREP ONLY.  
**This document is NOT evidence of a live test.**  
**CURRENT TRANSPORT = Meta Cloud API**  
**QR / SESSION / Baileys = NOT IMPLEMENTED** (do not start a QR adapter during this run).  
**Live delivery = IMPLEMENTED BUT UNPROVEN.**  
**B-2 remains OPEN.** It is **BLOCKED / NOT RUN** until a real WABA run is recorded. No Meta credentials or authorized handset in this environment.

A completed paper copy of this list, a DEMO suite pass, or a `b2Preflight()` dump is **not** a live-success claim. Do not mark B-2 closed. Do not write VERIFIED_PRODUCTION. Do not report customer DELIVERED.

---

## 0. Authorization gate (must be true before any live send)

Record date/time, operator, and the written authorization for a live WABA window. If authorization is missing, **stop**. This checklist does not grant it.

| Field | Record |
|---|---|
| Date / window | |
| Operator | |
| Authorized WABA / test number (not a production customer unless authorized) | |
| Authorization reference | |
| `b2Preflight()` captured? (code/config only) | YES / NO |

Run `b2Preflight()` from the installed tree **before** pointing webhooks at Meta. It inspects code and config only. It makes **no** Graph API call. READY checks are not live proof.

Required live env (values never pasted into tickets/chat): `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`. Boot must refuse LIVE without `META_APP_SECRET`.

---

## 1. Inbound webhook HMAC

**Purpose:** prove Meta-signed inbound events are accepted and forged ones are not processed.

1. Subscribe the Cloud API app webhook to this host `/webhook` with `META_VERIFY_TOKEN`. GET verify must return the challenge.
2. From the authorized test handset, send one text to the WABA number.
3. Confirm `x-hub-signature-256` is present on the POST and the process audits `EVENT_RECEIVED` then `EVENT_PROCESSED` for that `wamid`.
4. Confirm the raw body used for HMAC is the exact bytes Meta sent (`req.rawBody`).

**EXPECTED:** signed inbound → processed.  
**FAIL if:** unsigned/forged event is processed in LIVE, or LIVE is running with empty `META_APP_SECRET`.

**RECORD:** wamid, audit types, HTTP 200 to Meta (the handler always 200s first — 200 is **not** authenticity proof; the audit is).

Pass? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## 2. Duplicate wamid

**Purpose:** prove replay does not double-process.

1. Capture the `wamid` from step 1.
2. Replay the **same** signed payload (same `messages[].id`) against `/webhook`.
3. Confirm `claimEvent(wamid)` rejects the second delivery.

**EXPECTED:** first delivery `EVENT_RECEIVED` / `EVENT_PROCESSED`; second `EVENT_DUPLICATE`; no second AI/outbox job for that id.  
**FAIL if:** two customer-facing sends for one wamid.

**RECORD:** wamid, both audit lines, outbox job count for that inbound.

Pass? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## 3. AI / catalog reply

**Purpose:** one real inbound produces one catalog-honest outbound on the existing Cloud API path.

1. Send a catalog question from the test handset (e.g. a listed model price/stock question).
2. Confirm the reply is composed from `catalog()` (dated VERIFIED/STALE/UNKNOWN wording). Corrupt catalog must hand off, not invent prices.
3. Confirm the send entered the **one** send path: P2 firewall → durable outbox → `deliverToMeta` (Graph `/{phoneNumberId}/messages`).
4. Model-generated money copy must pass `numberFirewall.validateMonetaryReply`. Deterministic catalog/EMI copy is not that gate.

**EXPECTED:** one reply, catalog authority intact, no QR/session path involved.  
**FAIL if:** invented price, second transport, or a send that skipped outbox.

**RECORD:** inbound wamid, outbox job id, catalog `observed_at` / status used, Graph accept id if any.

Pass? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## 4. Outbox SENT vs SUBMITTED honesty (DELIVERED never claimed)

**Purpose:** keep provider-accept language honest. This transport cannot prove the customer received the message.

State mapping in this tree:

| Layer | Honest status | Meaning |
|---|---|---|
| Outbox enqueue | `QUEUED` | persistence only; not a send |
| Outbox after `sendFn` HTTP success | `SENT` | Graph API accepted the POST |
| Follow-up observer (maps outbox `SENT`) | `SUBMITTED` | same fact as provider accept |
| Crash mid-send | `UNKNOWN_REQUEUED` | execution result unknown |
| Terminal failure | `DLQ` / follow-up `FAILED` | not silent success |
| Customer device receipt | **never written** | **DELIVERED is never claimed** |

1. After step 3, read the outbox job file under `sent/` (or follow-up row if this was a care send).
2. Confirm enqueue was `QUEUED` and only a provider-terminal callback moved it to `SENT` / follow-up `SUBMITTED`.
3. Confirm no code path, UI, or operator note says `DELIVERED`.
4. A Graph `messages` id in `providerResult` is accept evidence only.

**EXPECTED:** SENT (outbox) / SUBMITTED (follow-up) = provider accept. DELIVERED absent.  
**FAIL if:** enqueue marked SENT/SUBMITTED, or anyone claims DELIVERED.

**RECORD:** job id, outbox status, follow-up status if any, Graph message id (not a delivery receipt).

Pass? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## 5. Human takeover

**Purpose:** staff claim suppresses AI; human reply uses the same outbox with `source=HUMAN`.

1. From the test handset, trigger staff (`*staff*` / `menu_staff` or an escalation).
2. Sign in to CAP-008 inbox. Conversation must exist in this tenant (404 otherwise — no cross-tenant leak).
3. `POST /inbox/c/:phone/claim` (auth + CSRF + actionId). State `QUEUED → CLAIMED`.
4. Send a further customer text. AI must stay suppressed (`isSuppressed`).
5. `POST /inbox/c/:phone/reply` as the claimant. Reply is `enqueueAsHuman` → outbox (`SENT_VIA_OUTBOX` is queued, not DELIVERED).

**EXPECTED:** AI silent while claimed; one human outbox job; P2 still evaluated.  
**FAIL if:** AI replies after claim, or human reply bypasses outbox.

**RECORD:** conversation state transitions, human job id, suppression evidence.

Pass? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## 6. Staff confirm-paid

**Purpose:** paid is a staff (or future POS) confirmation of an **existing** stated sale. Not a payment gateway. Not an outbound send.

1. An **existing unpaid stated sale** is required (`outcome=sale`, `verification≠paid`). A CAP-008 conversation row is **not** required. Staff may also `POST /inbox/stated-sale` for a catalog SKU, then confirm-paid.
2. `POST /inbox/c/:phone/confirm-paid` (auth + CSRF + tenant + actionId).
3. Confirm `verification=paid`, audit `SALE_PAID_CONFIRMED` (repeat → `SALE_PAID_ALREADY_CONFIRMED`, no duplicate follow-up).
4. Confirm LLM/router/negotiation cannot call `confirmPaidSale`.
5. Confirm kill switch does **not** block this DB write. A later Day-10 send still uses kill / P2 / outbox.

**EXPECTED:** paid flag on existing sale; no Graph send from this action.  
**FAIL if:** paid invented without a stated sale, or confirm-paid sends WhatsApp.

**RECORD:** phone, product, audit types, follow-up id count.

Pass? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## 7. Kill stop / resume

**Purpose:** OWNER brake stops autonomous side effects; resume is deliberate.

1. As OWNER (not STAFF): `POST /inbox/kill/stop` with CSRF + actionId + reason. State `AUTOMATION_STOPPED`. Audit `KILL_SWITCH_STOPPED`.
2. STAFF stop must 403 `KILL_SWITCH_DENIED`.
3. Trigger an AI-bound send (inbound or due follow-up). Autonomous jobs become `HELD_KILLSWITCH` / send gate `KILL_SWITCH_ACTIVE`. HUMAN + CONSENT_ACK remain allowed.
4. Resume: `POST /inbox/kill/resume` with `confirm: "RESUME"`, reason ≥ 4 chars, new actionId. State `AUTOMATION_ACTIVE`. Held jobs return to `QUEUED` (normal gates still apply).

**EXPECTED:** STOP is easy and fail-safe; RESUME is heavier; AI does not sneak through STOPPED.  
**FAIL if:** STAFF can stop, or AI sends while STOPPED.

**RECORD:** peek/status before/after, held job ids, denied STAFF attempt.

Pass? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## 8. Failure evidence (must be captured on the same window)

These are negative tests. A live run that only shows happy-path 200s is incomplete.

### 8a. Forged signature

1. POST `/webhook` with a valid-looking body and a wrong `x-hub-signature-256` (or none) while `META_APP_SECRET` is set.
2. **EXPECTED:** handler still returns 200 to Meta (anti-retry), audits `WEBHOOK_FORGED`, does **not** `EVENT_RECEIVED` / process / enqueue.
3. **FAIL if:** forged payload is processed.

### 8b. Kill during send

1. Enqueue (or have due) an autonomous outbox job. Flip kill STOP before `sendFn` runs (execute-layer gate in `processJob`).
2. **EXPECTED:** job `HELD_KILLSWITCH`, no Graph POST for that autonomous job, audit `OUTBOX_HELD` / `KILL_SEND_BLOCKED` as applicable. In-flight `SENDING` crash stays `UNKNOWN_REQUEUED` (honest), never fake SENT.
3. **FAIL if:** autonomous Graph send proceeds after STOP, or the job is marked SENT without a provider call.

**RECORD:** forged audit line; held job file; timestamps proving STOP vs sendFn.

Pass 8a? `YES / NO / NOT RUN`  
Pass 8b? `YES / NO / NOT RUN`  
Evidence pointer: ________________________________

---

## Honesty rules for the evidence pack

1. This document is NOT evidence of a live test until the rows above are filled from a **real WABA** window and stored under `evidence/` with timestamps.
2. **CURRENT TRANSPORT = Meta Cloud API.** Do not add Baileys, whatsapp-web.js, WPPConnect, QR pairing, or a second send path.
3. Outbox `SENT` ≠ customer receipt. Follow-up `SUBMITTED` ≠ `DELIVERED`. **DELIVERED is never claimed.**
4. HTTP 200 on `/webhook` is not HMAC proof. Graph 200 is not DELIVERED.
5. `b2Preflight()` READY in DEMO (`is_live=false`) is config/code readiness, not live delivery.
6. **B-2 remains OPEN.** It is **BLOCKED / NOT RUN** until that real WABA run is recorded. Nothing in this file closes it.
