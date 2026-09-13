# M2 TRANSPORT ADAPTER — FROZEN CHECKPOINT

Status:
PASS / FROZEN

Commit:
399afde156098337b141a4015e2c6eadc0555abb

Verification:
432/432 × 2 (sequential per-file `npm test` / `node scripts/run-tests.mjs`, two consecutive processes, 2026-09-13)

Branch at freeze:
`feature/m2-live-blocker-fix` HEAD = `399afde`

Not merged to `main` at freeze time (`main` = `64fd32a`).

Scope:

- `src/sentinel/session/adapter.js`
- `tests/m2transport.test.js`

The pairing-lifecycle commit `399afde` itself touches only those two files.

Verified behaviors:

- companion handle
- generation guard
- retryPairing serializes end → start
- CONNECTED reuse
- NEEDS_QR reuse
- stale QR ignored
- stale close ignored
- stale timers ignored

M2 is COMPLETE FOR ITS DEFINED SCOPE.

M2 is NOT a claim that real WhatsApp production delivery has been proven.

## Transport boundary

M2 TRANSPORT ADAPTER: IMPLEMENTED / TESTED

REAL WHATSAPP LIVE OPERATION: NOT PROVEN BY THIS M2 TEST SUITE

Do not write production-ready. Do not write ban-proof. Do not write official WhatsApp automation. Do not imply that M2 proves real-account behavior.

DEMO remains the default selector. Cloud remains available. Session requires explicit `SENTINEL_TRANSPORT=session`. M2 does not silently replace Cloud as the default.

## Non-blocking concerns (do not fix in this freeze)

1. `resetAuth()` + `start()` does not await `lastEnd`.
   OWNER UI uses `retryPairing()`, which does.

2. CONNECTED reconnect `attach()` can replace a companion handle without calling `end()`
   on the previous handle.
   Existing report states the previous handle is already closed and generation guard
   protects against stale events.

These are NON-BLOCKING.

## Protected system contracts

M2 is not permission to bypass any of:

- P2 Action Firewall
- CAP-055 Kill Switch
- CAP-008 Human Fallback
- Outbox
- Idempotency
- Session inbound protections
- Number Firewall
- Catalog authority
- Negotiation floor controls
- Owner source-of-truth files

## Owner source-of-truth (verified 2026-09-14, files not modified)

| File | sha256 | bytes |
|---|---|---|
| `src/data/products.json` | `c575d337066076738efadec6c7ba5a6f97a864190be3b1327104d39fbe00d3d4` | 4529 |
| `src/data/negotiation-rules.json` | `406e13419bef40d801e7535ad4926e1406d64a25a7111fdec0f703ed0a25aa10` | 2049 |
| `src/data/sales-skills.json` | `bbba4caba0030e1beb84d1d95c5e847c796b6cfc512ec5a6514d8dcc2d715071` | 14931 |

From the owner files (do not rewrite):

- Reno 16 floor = **186800** (`floor_status=RESOLVED`)
- Reno 16F floor = **138600** (`floor_status=RESOLVED`) in the **current** owner files on this tree (B-7 closed in-file 2026-09-13)

V1-5.1 historical freeze recorded Reno 16F as **UNRESOLVED**. That narrative is superseded by the current owner file. Preservation records the file, not a stale story. Do not revert 16F to UNRESOLVED without a new owner instruction.

## V1-5.1 (COMPLETE / FROZEN)

Preserved, not rewritten:

- staff Mark as PAID workflow
- paid-sale confirmation
- customer_statement ≠ paid
- Day-10 requires paid verification
- monetary normalization
- Unicode monetary rejection
- Reno 16 / 16F cross-SKU protection
- D-010 transport decision record (historical: Cloud API; session was not implemented at V1-5.1)
- 241/241 ×2 V1-5.1 regression at that milestone
- DEMO/PILOT status

## Do not reopen

- M2 architecture
- pairing-socket generation guard
- QR redesign
- P2 / kill / CAP-008 / outbox architecture
- owner pricing floors
- completed V1-5.1 work
- speculative governance
