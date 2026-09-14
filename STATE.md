# STATE — truthful snapshot (2026-09-14, LIVE CORE CHECKPOINT)

- **HEAD intent:** live-tested code `8e7cb2be5e73c67e11c53776d89a24c04430914b` on `feature/m2-live-blocker-fix`, then this preservation commit merged to `main`. **M2 COMPLETE.** **V1-5.1 COMPLETE/FROZEN.** Overall = **DEMO/PILOT**. Dedicated TEST-number live 1:1 is **LIVE-PROVEN**. Not `VERIFIED_PRODUCTION`. Not store-number pilot. Continuation: `SENTINEL_CONTINUATION_STATE.md`, `docs/evidence/LIVE_CORE_BASELINE.md`, `docs/evidence/M2_FREEZE.md`.
- **Historical freeze:** tag `sentinel-v1.6-pilot-freeze` → `f92a3f8d…` is a historical V1-6 pin only. Do not treat it as current HEAD.
- **Suite:** sequential `npm test`. **VERIFIED 2026-09-14:** **435/435 ×2**. Do not cite that count after the next code change without re-running.
- **Live (dedicated TEST number only):** session restore CONNECTED, restart restore, one real 1:1 inbound (customer PN), durable `sess:` claim, existing brain, firewall ALLOW, outbox queue, session send **accepted** (job SENT). **SENT/SUBMITTED ≠ DELIVERED.** **CONNECTED ≠ CAUGHT_UP.** Store/customer-facing number **not used**.
- **Not proven live:** outage catch-up / RPN / CAUGHT_UP, CAP-008 human fallback, kill ON/OFF around a real turn, duplicate live replay.
- **Catalog:** shipped `products.json` `observed_at` is 2026-09-05 / 2026-09-10. Versus wall clock **STALE** until the owner re-runs `node scripts/verify-catalog.mjs --verify`.
- **Kill switch / firewall / CAP-008 FSM / outbox / numberFirewall / session inbound:** architecture frozen. Session live 1:1 is not permission to bypass them. Kill still dominates autonomous execution. Human takeover still suppresses AI.
- **Negotiation (owner files, hashes in LIVE_CORE_BASELINE.md):** Reno 16 invoice **Rs. 199,999**; floor **Rs. 186,800 RESOLVED**. Reno 16F invoice **Rs. 149,999**; floor **Rs. 138,600 RESOLVED**. Floors are last-resort.
- **Transport:** M2 adapter **IMPLEMENTED / TESTED**. DEMO remains default. Cloud still works. Session requires explicit selection. Live 1:1 on the **TEST** number is proven; this is **not** production-ready and **not** a delivery proof.
- **V1-5.1:** COMPLETE/FROZEN (staff Mark as PAID, paid ≠ customer_statement, Day-10 paid-only, monetary normalize, Unicode reject, 16/16F cross-SKU, D-010 record).
- **Do-not-touch without authorization:** CAP-008/055/P2, outbox, idempotency, session inbound, CAP-007 marketing, floors, QR redesign, M2 architecture, SQLite, STT/vision, payments.
- **Open debts (still):** DEBT-09 governor unwired, DEBT-17/18/19/20, **B-2 live Meta (BLOCKED)**, remaining cross-SKU collisions, no POS, catalog owner re-verify, inbox must not be internet-exposed until DEBT-19, live catch-up.
- **Production status:** DEMO/PILOT. Nothing here is `VERIFIED_PRODUCTION`.
