# STATE — truthful snapshot (2026-09-08, post audit-integrity remediation)

- **HEAD:** see `git log -1` (cycle: P2 audit-integrity remediation; zero product-code changes this cycle)
- **Suite:** `npm test` → deterministic sequential per-file runner (`scripts/run-tests.mjs`); 67/67; five clean runs this cycle + 12/12 after AF-10 fix
- **Live server (DEMO):** webhook verified-signed; inbox `/inbox`; kill banner; drill creds in `scripts/drill-env.sh` (demo only)
- **Kill switch:** state file `data/killswitch.json`; currently ACTIVE (drills end resumed); AUTOMATION only demo provider
- **Capabilities:** CAP-001/011 PILOT · CAP-008 PILOT · CAP-055 PILOT · P2-firewall PILOT (+audit-gate BLOCKED for all)
- **Do-not-touch without authorization:** CAP-006, CAP-007, CAP-009, pricing, reservations, marketing, real WhatsApp
- **Danger surface (sensitive zone):** `data/` (customer DB + messages + sessions + killswitch); redacted zone = logs/audit/demo
