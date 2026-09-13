# NOOR / Sentinel — OPPO Experience Store Khanewal

Deterministic WhatsApp concierge with a safety layer (Sentinel). **DEMO/PILOT — not production-ready. Real WhatsApp delivery is unproven.**

## What it actually is

A single-process Node/Express app. Inbound Meta-shaped webhooks → deterministic flows (menu, EMI, trade-in, visit truth, negotiation engine) → optional LLM phrasing → **one send path** (P2 firewall → durable outbox → adapter).

The LLM is **not** price, policy, or security authority. DEBT-07: model-generated customer-facing text (LLM, and any future vision/multimodal copy) must pass the number firewall before send. Deterministic catalog/EMI/negotiation/follow-up copy is not this gate. P2 and the outbox do not inspect amounts.

## What it is not

- Not a live WhatsApp product (DEMO unless Cloud API tokens are set; live behavior unproven)
- Not a reservation/token system (honestly refused since V1-0)
- Not a marketing engine (governor exists but is unwired; firewall denies `MARKETING.SEND`)
- Not STT/vision (stubs; photo/voice copy is honest)
- Not a payment gateway (a customer saying “I'll take this” is stated intent; follow-up requires staff-confirmed **paid** via the CAP-008 inbox “Mark as PAID” action — not a PSP)
- Not QR/session WhatsApp as a proven live product (M2 adapter is implemented/tested; live operation is **not** proven; DEMO remains default)

## Layout

```
src/
  index.js                 boot (fail-closed on corrupt customer DB)
  flows/router.js          menu / EMI / trade-in / visit / repair / compare / care
  services/
    brain.js               LLM phrasing + DEBT-07 number firewall + labeled CRM facts
    qualification.js       deterministic lead stage/score (not message-count)
    profile.js             bounded CUSTOMER_STATED facts (budget is untrusted)
    compare.js             catalog compare + recommend (no guessed floors)
    care.js                setup-help copy (not a scheduled chase)
    ops.js                 OWNER snapshot (UNKNOWN/PARTIAL, never fake 0)
    b2preflight.js         read-only Meta-path checklist (not live evidence)
    negotiation.js         CAP-039 engine (Reno 16 floor Rs. 186,800)
    catalog.js             CAP-003 dated prices (24h TTL)
    followups.js           Day-10 care (paid sales only; honest delivery states)
    customers.js           JSON DB (atomic writes; corrupt → refuse boot)
    whatsapp.js            the ONLY send path
  inbox/                   CAP-008 UI + CRM brief + owner ops page
  sentinel/                firewall, kill switch, outbox, inbox auth, number firewall
  data/                    owner files: products.json, negotiation-rules.json
```

## Run

```
npm install
npm test          # sequential per-file suite
npm start         # DEMO on PORT (default 3000) unless Cloud API tokens are set
```

Owner catalog ritual: `node scripts/verify-catalog.mjs --verify` (24h TTL; stale prices cannot claim “aaj ki price”).

## Settled constraints

- Reno 16 autonomous floor = **Rs. 186,800** exactly (invoice **Rs. 199,999**)
- Reno 16F autonomous floor = **Rs. 138,600** exactly in the current owner file (invoice **Rs. 149,999**). V1-5.1 freeze recorded 16F UNRESOLVED; do not revert without owner instruction.
- Floors are last-resort. Do not volunteer them. Never quote below.
- Kill switch and Action Firewall architecture stay
- CAP-008 human fallback stays
- Marketing = OFF
- No anti-ban / detection-bypass behavior

## Status

See `SENTINEL_CONTINUATION_STATE.md`, `docs/evidence/M2_FREEZE.md`, `STATE.md`, `PROGRESS.md`, and `HANDOFF.md`. **M2 = COMPLETE/FROZEN** at `399afde` (432/432 ×2). **V1-5.1 = COMPLETE/FROZEN.** Overall = **DEMO/PILOT**. This is **not** a live Meta smoke test and **not** proven live session delivery. Catalog prices are **STALE** until the owner re-verifies. **B-2 is BLOCKED / NOT RUN.** Nothing is `VERIFIED_PRODUCTION`. `SENT`/`SUBMITTED` ≠ `DELIVERED`.
