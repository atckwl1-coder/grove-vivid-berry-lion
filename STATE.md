# STATE — truthful snapshot (2026-09-09, post V1-0 truth cut)

- **HEAD:** `36ca9df` (merge of `feature/v1-truth-cut` / `b9e6eb6`) — V1-0 truth cut cycle
- **Suite:** `npm test` → deterministic sequential per-file runner (`scripts/run-tests.mjs`); **78/78** (6 files: cap008 19, cap055 14, p2firewall 16, phase2a 10, remediation 8, v1truth 11); 5 clean runs this cycle (3 pre-merge + 2 post-merge)
- **Live server (DEMO):** webhook verified-signed; inbox `/inbox`; kill banner; drill creds in `scripts/drill-env.sh` (demo only)
- **Kill switch:** state file `data/killswitch.json`; currently ACTIVE (drills end resumed); AUTOMATION only demo provider
- **Capabilities:** CAP-001/011 PILOT · CAP-008 PILOT · CAP-055 PILOT · P2-firewall PILOT (+audit-gate BLOCKED for all — B-1 open) · **CAP-006 NOT_PROVEN (phantom UX removed in V1-0; capability absent; honest deferral proven)**
- **Customer-facing truth status (V1-0):** zero phantom reservation/booking/token/slot claims in executable code (static scan + tests/v1truth 11/11). Residual known non-reservation artifacts (recorded, need own authorization): location "demo link" disclosure string; menu_repair row → AI-generic (no handler).
- **Repo note:** `src/data/products.json` now tracked (was accidentally git-ignored by unanchored `data/`; fresh clones previously could not boot). Runtime `./data` still ignored.
- **Do-not-touch without authorization:** CAP-008/055/P2 foundations, CAP-007 marketing, CAP-009, pricing, real WhatsApp, V1-1..V1-5 (each needs its own mandate)
- **Danger surface (sensitive zone):** `data/` (customer DB + messages + sessions + killswitch); redacted zone = logs/audit/demo
- **Ops note:** git identity does NOT persist across sandbox turns (repo-local config wiped) — before committing: `git config user.name/user.email` from `git log -1 --format='%an %ae'` (last identity: `sentinel-eng <sentinel@local>`).
