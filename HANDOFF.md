# HANDOFF — if another operator picks this up

1. Read in order: `README.md` (orient) → `FEASIBILITY_AUDIT.md` (strategy truth) → `CAPABILITY_REGISTRY.yml` (capability states + change_log) → `VERIFICATION_LOG.md` (every VR) → `GPT_AUDIT.md` (audit ledger + infrastructure absence proof) → `BLOCKERS.md` (open gates).
2. Never claim beyond evidence; B-1 (external audit gate) is OPEN for everything shipped.
3. Run: `npm install && npm test` (node_modules is NOT durable across sandbox turns — reinstall each session).
4. Live drill: `source scripts/drill-env.sh && npm start`, then scripts under `scripts/*drill*` (they sign webhooks correctly with awk `$2` — hard-won lesson).
5. Write access discipline: `.gitignore` keeps `data/` out of git by design (sessions/PII/kill state).
6. Next likely cycle (needs explicit authorization): P3 authoritative data layer (VERIFIED/STALE evidence feeding the firewall's EVIDENCE stage).
