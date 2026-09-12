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
- Not QR/session WhatsApp (not implemented; D-010 recommends staying on Meta Cloud API)

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

- Reno 16 autonomous floor = **Rs. 186,800** exactly
- Reno 16F floor = **UNRESOLVED** (do not guess)
- Kill switch and Action Firewall architecture stay
- CAP-008 human fallback stays
- Marketing = OFF
- No anti-ban / detection-bypass behavior

## Status

See `STATE.md`, `PROGRESS.md`, and `HANDOFF.md`. Current `main` is `6b507e9` (332/332 DEMO). V1-6 plus post-freeze staff product (confirm-paid without conversation, lead queue, staff-recorded stated sale, unpaid uniqueness) sit on the frozen V1-5.1 safety gate. Historical tag `sentinel-v1.6-pilot-freeze` is **not** current HEAD. This is **not** a live Meta smoke test and **not** a QR transport. Catalog prices are **STALE** until the owner re-verifies. D-010 (`D010_TRANSPORT_PREFLIGHT.md`) is a decision record; `B2_LIVE_SMOKE_CHECKLIST.md` is operator prep. **B-2 is BLOCKED / NOT RUN.** Nothing is `VERIFIED_PRODUCTION`. `SENT`/`SUBMITTED` ≠ `DELIVERED`.
