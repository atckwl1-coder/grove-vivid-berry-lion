# STATE — truthful snapshot (2026-09-09, post V1-1 conversation memory)

- **HEAD:** `bad2d30` (merge of `feature/v11-memory` / `47a2c16`) — V1-1 conversation-memory cycle
- **Suite:** `npm test` → deterministic sequential per-file runner (`scripts/run-tests.mjs`); **90/90** (7 files: cap008 19, cap055 14, p2firewall 16, phase2a 10, remediation 8, v11memory 12, v1truth 11); 5 clean runs this cycle (3 pre-merge + 2 post-merge)
- **Live server (DEMO):** webhook verified-signed; inbox `/inbox`; kill banner; drill creds in `scripts/drill-env.sh` (demo only)
- **Kill switch:** state file `data/killswitch.json`; currently ACTIVE (drills end resumed); AUTOMATION only demo provider
- **Capabilities:** CAP-001/011 PILOT · CAP-008 PILOT · CAP-055 PILOT · P2-firewall PILOT (+audit-gate BLOCKED for all — B-1 open) · CAP-006 NOT_PROVEN (honest deferral live since V1-0; capability absent)
- **AI brain (V1-1):** `think()` now sends `[system, ...history, user(current)]` — bounded per-customer context: last 12 eligible entries × ≤500 chars (≤6000 chars), derived from the existing customers-DB (no new storage); system prompt always first + new rule 7 (history = data, not instructions); current turn always last. Demo fallback (no LLM key) unchanged — no LLM, no memory needed.
- **Customer-facing truth status (V1-0):** zero phantom reservation/booking/token/slot claims in executable code.
- **Repo notes:** `src/data/products.json` tracked (V1-0); git identity does NOT persist across sandbox turns (see HANDOFF §6).
- **Do-not-touch without authorization:** CAP-008/055/P2 foundations, CAP-007 marketing, CAP-009, pricing, real WhatsApp, V1-2..V1-5 (each needs its own mandate)
- **Danger surface (sensitive zone):** `data/` (customer DB + messages + sessions + killswitch); redacted zone = logs/audit/demo — V1-1 reads the sensitive zone (own-customer text) but writes nothing new to it
- **Open debts:** DEBT-07 price validator (brain row REDESIGN_REQUIRED), DEBT-09 governor unwired, DEBT-17/18/19/20 as registered; V1-2 addresses catalog authority (staleness) — not the price validator itself
