# STATE — truthful snapshot (2026-09-12, post V1-6 Rapid Feature Integration)

- **HEAD:** working tree on top of `0f887ec` (typing-presence records). V1-5.1 remains **FROZEN**. This cycle added product features on top of that safety gate; it did not reopen firewall/kill/outbox/FSM/floors.
- **Suite:** `npm test` sequential per-file runner. **VERIFIED 2026-09-12:** 19 files, **292/292 pass × 2 consecutive clean processes** (was 241/241; +51 V1-6 focused tests: qualify 15, profile 9, compare 7, ops 5, b2 6, crm 9). Owner-file sha256 unchanged (`products.json` `2f10d77e…`, `negotiation-rules.json` `c4414e14…`, `sales-skills.json` `18841306…`). Do not cite this number after the next code change without re-running.
- **Live server:** DEMO unless Cloud API tokens are set. Real WhatsApp is **IMPLEMENTED BUT UNPROVEN**. B-2 remains **OPEN**. `b2Preflight()` and `B2_LIVE_SMOKE_CHECKLIST.md` are operator prep, not live evidence.
- **Kill switch / firewall / CAP-008 / outbox / numberFirewall:** unchanged architecture. Kill still dominates autonomous execution. Human takeover still suppresses AI. P2 and outbox.enqueue still do not inspect amounts. Staff `confirm-paid` is **not** an outbound send. LLM/router/qualification/profile/compare/care/ops **cannot** call `confirmPaidSale`.
- **Negotiation:** Reno 16 floor **Rs. 186,800 RESOLVED**. Reno 16F **UNRESOLVED** (do not guess; compare path states that explicitly and does not leak 186800 onto 16F). Engine owns numbers on its path. LLM replies are untrusted until DEBT-07 number firewall allows them.
- **V1-6 product layer (DEMO/PILOT):**
  - Deterministic lead qualification (`stateData.qualification`) — evidence stages, not message-count. `human_owned` is a flag, not a stage.
  - Bounded CRM profile (`stateData.profile`) — CUSTOMER_STATED facts only. Budget is untrusted and is **not** an allow-listed price.
  - Catalog compare + recommend — catalog/`priceCardLine` only. Recommend trigger is explicit (`recommend` / `suggest` / `konsa … phone`); a bare “mera budget …” stays on the LLM/memory path.
  - Setup-help copy (not a scheduled chase). Paid-customer issue copy + existing CAP-008 escalate. No extra Day-0/3 scheduler.
  - Staff CRM brief on the existing inbox (stage, score, objections, next action, paid/follow-up). Owner ops snapshot + B-2 preflight page (OWNER, auth). Incomplete KPIs render **UNKNOWN/PARTIAL**, never a fake 0.
- **Transport (D-010):** **CURRENT TRANSPORT = Meta Cloud API. QR / SESSION = NOT IMPLEMENTED.** No adapter was written this cycle. `src/` contains none of the banned client tokens.
- **Do-not-touch without authorization:** CAP-008/055/P2 foundations, CAP-007 marketing, floors, QR/session transport, SQLite, STT/vision, payments, PTA/warranty APIs.
- **Open debts (still):** DEBT-09 governor unwired, DEBT-17/18/19/20, **B-2 live Meta**, B-7 Reno 16F floor, remaining cross-SKU collisions, no POS, confirm-paid still needs an existing CAP-008 conversation row.
- **Production status:** DEMO/PILOT. Safer for a **small staffed sample in DEMO**. Nothing here is `VERIFIED_PRODUCTION`.
