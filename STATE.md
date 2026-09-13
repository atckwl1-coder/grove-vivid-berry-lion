# STATE — truthful snapshot (2026-09-14, M2 freeze)

- **HEAD:** `feature/m2-live-blocker-fix` at `399afde` (`fix: enforce single active pairing socket`). **M2 COMPLETE/FROZEN.** **V1-5.1 COMPLETE/FROZEN.** Overall = **DEMO/PILOT**. Not merged to `main` (`main` = `64fd32a` at freeze). Continuation: `SENTINEL_CONTINUATION_STATE.md` + `docs/evidence/M2_FREEZE.md`.
- **Historical freeze:** tag `sentinel-v1.6-pilot-freeze` → `f92a3f8d…` is a historical V1-6 pin only. Do not treat it as current HEAD.
- **Suite:** sequential `npm test`. **VERIFIED 2026-09-13/14 on `399afde`:** **432/432 ×2**. Do not cite 432/432 after the next code change without re-running.
- **Live server:** DEMO unless Cloud API tokens are set **or** `SENTINEL_TRANSPORT=session` is explicit. Real WhatsApp live operation is **NOT PROVEN** by the M2 suite. B-2 remains **BLOCKED / NOT RUN**. Provider `SENT`/`SUBMITTED` ≠ customer `DELIVERED`.
- **Catalog:** shipped `products.json` `observed_at` is 2026-09-05 / 2026-09-10. Versus wall clock **STALE** until the owner re-runs `node scripts/verify-catalog.mjs --verify`.
- **Kill switch / firewall / CAP-008 FSM / outbox / numberFirewall / session inbound:** architecture frozen. M2 is not permission to bypass them. Kill still dominates autonomous execution. Human takeover still suppresses AI.
- **Negotiation (owner files, verified hashes in M2_FREEZE.md):** Reno 16 invoice **Rs. 199,999**; floor **Rs. 186,800 RESOLVED**. Reno 16F invoice **Rs. 149,999**; floor **Rs. 138,600 RESOLVED** in the **current** owner file (V1-5.1 freeze had 16F UNRESOLVED; do not revert without new owner instruction). Floors are last-resort.
- **Transport:** M2 adapter **IMPLEMENTED / TESTED**. DEMO default. Cloud still works. Session requires explicit selection. **Not** production-ready. **Not** live-delivery proof.
- **V1-5.1:** COMPLETE/FROZEN (staff Mark as PAID, paid ≠ customer_statement, Day-10 paid-only, monetary normalize, Unicode reject, 16/16F cross-SKU, D-010 record, 241/241 ×2 at that milestone).
- **Do-not-touch without authorization:** CAP-008/055/P2, outbox, idempotency, session inbound, CAP-007 marketing, floors, QR redesign, M2 architecture, SQLite, STT/vision, payments.
- **Open debts (still):** DEBT-09 governor unwired, DEBT-17/18/19/20, **B-2 live Meta (BLOCKED)**, remaining cross-SKU collisions, no POS, catalog owner re-verify, inbox must not be internet-exposed until DEBT-19.
- **Production status:** DEMO/PILOT. Nothing here is `VERIFIED_PRODUCTION`.
