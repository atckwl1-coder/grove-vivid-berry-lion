# LIVE CORE BASELINE — dedicated TEST number

Status: CHECKPOINT (not VERIFIED_PRODUCTION, not store-number pilot)

Live-tested code:
`8e7cb2be5e73c67e11c53776d89a24c04430914b`

Suite at freeze:
435/435 ×2 (`node scripts/run-tests.mjs`, two consecutive processes, 2026-09-14)

Evidence:
`evidence/m2-live-core-2026-09-14.txt`

## LIVE-PROVEN

- Session restore to CONNECTED without QR (existing creds)
- Restart restore
- Real 1:1 inbound from a second WhatsApp (notify, customer PN, not `@lid`)
- Durable session claim `sess:<provider-id>` taken once
- Existing Sentinel brain (composition + typing)
- P2 firewall ALLOW (EXECUTION / ALL_STAGES_PASS)
- Durable outbox queue (source=AI)
- Session transport adapter accepted the send (outbox job SENT)
- fromMe echo skipped (`SKIP_FROM_ME`)
- SENT / SUBMITTED / outbox SENT is **not** customer DELIVERED

## NOT-PROVEN

- `receivedPendingNotifications` / CAUGHT_UP
- Network-outage catch-up
- Multiple messages during outage
- CAP-008 live staff claim + HUMAN reply
- Kill switch ON/OFF around a live customer turn
- Duplicate live replay of the same inbound
- Phone-UI delivery / read receipts
- Store / customer-facing number

Do not invent CAUGHT_UP. Do not call SENT/SUBMITTED “DELIVERED”.

## Transport boundary (unchanged)

- DEMO remains the code default
- Cloud remains available
- Session requires explicit `SENTINEL_TRANSPORT=session`
- This checkpoint does not enable session as default
- This checkpoint does not authorize the store number

## Protected contracts (untouched this freeze)

P2 firewall, CAP-055 kill, CAP-008, outbox, idempotency, session inbound
semantics, number firewall, catalog authority, negotiation floors.

Owner files (byte-untouched this freeze):

| File | sha256 | bytes |
|---|---|---|
| `src/data/products.json` | `c575d337066076738efadec6c7ba5a6f97a864190be3b1327104d39fbe00d3d4` | 4529 |
| `src/data/negotiation-rules.json` | `406e13419bef40d801e7535ad4926e1406d64a25a7111fdec0f703ed0a25aa10` | 2049 |
| `src/data/sales-skills.json` | `bbba4caba0030e1beb84d1d95c5e847c796b6cfc512ec5a6514d8dcc2d715071` | 14931 |
