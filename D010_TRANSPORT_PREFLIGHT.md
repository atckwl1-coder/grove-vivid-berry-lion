# D-010 — TRANSPORT PREFLIGHT (decision record + current runtime)

**Status:** DECISION / PREFLIGHT, with M2 adapter present.  
**Date:** 2026-09-12 (record) / 2026-09-13 (M2 adapter)  
**CURRENT TRANSPORT = Meta Cloud API** when `SENTINEL_TRANSPORT=cloud` (or unset + LIVE creds).  
**Default unset + no Meta creds = DEMO.**  
**QR / session adapter:** implemented under `src/sentinel/session/`, selected only by `SENTINEL_TRANSPORT=session`. Not the default.  
**Not an implementation** of stealth, dual-send, or unofficial evasion. One send path remains `whatsapp.send()` → P2 firewall → durable outbox → selected adapter.

---
---

## Current installation (fact)

Inspected 2026-09-12 against this tree:

- Dependencies: `axios`, `dotenv`, `express`, `node-cron`. **No** Baileys, whatsapp-web.js, WPPConnect, QR library, or WhatsApp WebSocket client.
- `src/services/whatsapp.js` talks to `https://graph.facebook.com/{version}/{phoneNumberId}/messages`.
- `isLive()` = `WHATSAPP_TOKEN && PHONE_NUMBER_ID`. Otherwise DEMO (no Meta network).
- Live Cloud API delivery: **IMPLEMENTED BUT UNPROVEN** (**B-2 BLOCKED / NOT RUN** — no live credentials).

---

## Option A — Meta Cloud API (dedicated WABA number)

**Architecture.** Official WhatsApp Business Platform. HTTPS Graph API. Webhooks for inbound. System-user token. No phone-session, no QR.

**Operational requirements.** Meta Business verification; WABA; a phone number **not** tied to a consumer WhatsApp account (or migrated); `META_APP_SECRET` for webhook HMAC; display-name; messaging limit tier.

**Cost model.** Platform per-message pricing. Customer inbound is not charged. As of Meta’s published pricing (docs updated around the Oct 1, 2026 change): non-template messages historically free *inside* the 24h customer-service window; **from 1 Oct 2026 Meta charges utility (and announced service) messages even inside that window** — exact PKR rates are **UNKNOWN** here (market table not pinned in this repo). Marketing templates are billed. This is a billing fact, not a safety fact.

**Reliability.** Meta-operated. Webhook retries on non-200. Outbox in this repo already models retry / DLQ / UNKNOWN.

**Session dependency.** None. Token + phone-number ID. 401/403 is treated as fatal session-unavailable for autonomous composing (existing adapter).

**Account risk.** Official path. Quality rating / restrictions are real and documented. Not a ToS-violation ban in the unofficial-client sense.

**Policy / ToS.** This **is** the official API.

**Delivery behavior.** Provider accept ≠ customer DELIVERED. This repo already refuses to claim DELIVERED.

**24h window.** User message opens a 24h customer-service window. Outside it, only approved templates. Sentinel’s Day-10 follow-up already defers free-form sends when the window is closed (`SCHEDULED`, not fake SENT).

**Day-10 implications.** Utility/care templates would be needed for out-of-window care. **Not implemented.** Inside window, free-form is allowed by the API (and billed under the 2026 utility change — UNKNOWN rate).

**Typing / read.** Official typing indicator on the same messages endpoint (wired 2026-09-11). **Code-verified in DEMO; not live-proven.** Read receipts exist; not used as delivery proof.

**Interactive menus.** Official buttons + lists (already used).

**Failure recovery.** Rotate token; outbox drain; kill switch. No QR regen loop exists or should exist.

**What would change in Sentinel.** Mostly **nothing structurally** — this is the current adapter. LIVE smoke (B-2) is the missing evidence, not a new transport.

**Fit for this store.** The architecture already assumes A.

---

## Option B — Official WhatsApp Business app coexistence

**Architecture.** Meta’s “onboard WhatsApp Business app users” / coexistence: the **same** number stays on the WhatsApp Business **app** and is also connected to Cloud API. Not a second unofficial API. Official Embedded Signup path ([Meta docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)).

**Operational requirements.** Business app 2.24.17+; app must be opened periodically (partner docs cite ~13 days — treat as **UNKNOWN** until read on the live Meta help page at cutover); companion devices unlink on onboard and must be re-linked; group chats stay in the app and do **not** sync to Cloud API; broadcast lists restricted.

**Cost model.** App-sent messages are treated as free of Cloud API charges (Meta/partner docs). API-sent messages follow Cloud API pricing. App replies do **not** open/renew the Cloud API 24h window (reported consistently by partner docs; confirm on Meta’s page before relying).

**Reliability.** Two inboxes. Echo webhooks (`smb_message_echoes`) if subscribed. Risk: staff reply in the phone app while Sentinel also replies.

**Session dependency.** The **phone app** must stay alive. That is a new operational dependency Sentinel does not have today.

**Account risk.** Official, with coexistence limits (partner docs: no standard business verification / blue badge / Calling API on some coexistence numbers — **UNKNOWN** for this WABA until Meta’s current eligibility table is checked at onboarding).

**Policy / ToS.** Official.

**Delivery / 24h / Day-10 / typing / menus.** API side = same as A. App side is a parallel human channel that can desync CAP-008 ownership if not disciplined.

**Failure recovery.** If the phone is lost or the app isn’t opened, coexistence can degrade. Dedicated Cloud API (A) does not have that phone-heartbeat.

**What would change in Sentinel.** Webhook handling for echo events; a rule that app-sent echoes must **not** be treated as customer inbound; staff process so CAP-008 and the phone app don’t double-reply. **No QR.** Still Cloud API under the hood.

**Fit.** Optional later if the owner must keep the Business app on the store number. Not required to run Sentinel. **Do not implement in this cycle.**

---

## Option C — QR / session automation (Baileys, WhatsApp Web, etc.)

**Architecture.** Unofficial client that logs into WhatsApp (often consumer or Business) via QR and speaks the WhatsApp Web protocol.

**Operational requirements.** Persistent session store, QR in an operator UI, reconnect loops, multi-device pairing. This repo has **none** of that by design.

**Cost model.** No Meta per-message invoice. The real cost is **account loss**.

**Reliability.** Session drops, QR expiry, device conflict, protocol breakage when WhatsApp updates.

**Session dependency.** Total. The “session” **is** the transport.

**Account risk.** High. This is **not** an official API. Bans, challenges, and sudden disconnects are widely reported. **Do not describe this as safe, undetectable, ban-proof, or official.** Those claims would be false.

**Policy / ToS.** Conflicts with WhatsApp’s terms on unofficial/automated use of WhatsApp Web. Not authorized here.

**Delivery behavior.** Unofficial receipts. Cannot be mapped honestly onto this repo’s QUEUED/SUBMITTED/UNKNOWN model without inventing proof.

**24h window / templates / official menus.** Not the Cloud API contract. Interactive buttons/lists/templates as Meta documents them are **not** this path.

**Day-10.** Would not inherit Cloud API window/template rules; would inherit ban risk on a timed outbound. Worse.

**Typing / read.** Whatever the unofficial protocol exposes — unsupported, unstable, and out of scope.

**Failure recovery.** QR regen / reconnect loops are exactly the class of behavior previous cycles forbade.

**What would change in Sentinel.** New adapter, new session store, new boot/revive, likely a second send path — a redesign this milestone forbids.

**Fit.** **Rejected for implementation until an owner formally accepts ToS and account-loss risk and authorizes a new cycle.** This record is not that authorization.

---

## Comparison (short)

| | A Cloud API | B Coexistence | C QR/session |
|---|---|---|---|
| Official? | Yes | Yes (official coexistence) | No |
| Already in this repo? | Yes (DEMO; LIVE unproven) | No | **NOT IMPLEMENTED** |
| Session/QR? | No | Phone app heartbeat | QR + session store |
| 24h / templates | Yes | API side yes; app side separate | Unofficial |
| Day-10 fit | Matches current follow-up window logic | Same API + app desync risk | Poor / high ban risk |
| CAP-008 / P2 / outbox | Current design | Extra echo/ownership rules | Would break one-send-path |
| ToS / ban | Official quality risk | Official + ops complexity | ToS + ban risk |
| Recommendation | **Stay** | Optional later, not now | **Do not implement** |

---

## Recommendation (with confidence)

**Stay on Option A (Meta Cloud API)** as the only Sentinel transport.

- **Confidence HIGH** that QR/session must not be implemented without a later explicit authorization. Evidence: no official API, ToS conflict, account risk, and this repo’s one-send-path + no-QR constraints.
- **Confidence HIGH** that the current code is already a Cloud API adapter (DEMO). Evidence: `whatsapp.js`, `isLive()`, package.json.
- **Confidence MEDIUM** on coexistence details (companion-device unlink, 13-day app open, echo events) — sourced from Meta + partner docs; pin them against the live Meta page before any coexistence onboarding.
- **UNKNOWN:** live delivery on a real Khanewal WABA (B-2); exact PK per-message rates after 1 Oct 2026; whether the store’s existing number is coexistence-eligible.

**Decision this cycle:** no transport change. No QR/session code. No coexistence webhook work.

---

## Binding statements

1. **CURRENT TRANSPORT = Meta Cloud API**
2. **QR / SESSION = NOT IMPLEMENTED**
3. No QR/session adapter will be written until this decision is formally superseded by an authorized cycle.
4. This file is documentation. It is not a runtime module and is not imported by `src/`.
