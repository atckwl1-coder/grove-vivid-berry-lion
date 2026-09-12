# BLOCKERS — open hard gates (each entry states the exact unblock)

| # | Blocker | Blocks | Since | Exact unblock criteria |
|---|---|---|---|---|
| B-1 | **External audit infrastructure absent**: `.claude/ai-bridge/AUDIT_PROTOCOL.md` + a fresh-context auditor dispatch mechanism do not exist in this workspace (proven 2026-09-08, see GPT_AUDIT.md §A) | Audit-gate acceptance for EVERY shipped capability (CAP-001/011, 2A.1, CAP-008, CAP-055, P2). Implementations still pass their own suites; the external-review gate stays open | 2026-09-08 | Place the real protocol + dispatch mechanism in the workspace; dispatch ONE fresh-context read-mostly auditor per capability; verify its diff; append findings to GPT_AUDIT.md |
| B-2 | Real WhatsApp pilot (Phase 5) **BLOCKED / NOT RUN** — no WABA token, `PHONE_NUMBER_ID`, `META_APP_SECRET`, or authorized test handset in this environment. Preflight/checklist are not live evidence. | Any `VERIFIED_PRODUCTION` status; any claim of customer `DELIVERED` | always | Real Meta creds + authorized handset/WABA + recorded B-2 checklist. Provider accept = `SUBMITTED`/`SENT` only. |
| B-3 | DEBT-17 audit rotation/segmentation | long-run audit durability | 2026-09-07 | Rotate + segment headers + verifier tool |
| B-4 | DEBT-18 customers-DB sensitive-zone controls | PII posture hardening | 2026-09-07 | Access controls + retention on message store |
| B-5 | DEBT-19 Secure-cookie + login rate-limit | any internet exposure of inbox | 2026-09-08 | TLS + Secure flag + throttling before public deploy |
| B-6 | DEBT-20 scheduler owner-brief misclass (AI vs SYSTEM_ALERT) | classification purity (no behavior delta today) | 2026-09-08 | reclassify when operate-layer work is authorized |
| B-7 | **Owner has not resolved the exact Reno 16F negotiation floor** (supplied range 139,000–142,000; engine is forbidden from guessing) | Autonomous concession on `reno16f` only — the engine sells it at the 150,000 verified price with an honest staff path until resolved | 2026-09-10 | owner sets `products.reno16f.floor` to an exact number + `floor_status: "RESOLVED"` in `src/data/negotiation-rules.json` (owner edit; the bot/learning cannot write this file) |

**CAP-006 reservations: OFF. CAP-007 marketing: OFF.** (fast-track law until their gates exist)
