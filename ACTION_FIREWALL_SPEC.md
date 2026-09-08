# P2 — CENTRAL ACTION FIREWALL · AUTHORITATIVE SPECIFICATION
**Cycle scope (frozen):** ONLY the central firewall boundary. No CAP-009, no CAP-008/055 re-work (composed, not modified), no marketing/reservation/payment/pricing activation, no new transports.

## 0 · PROVENANCE — where every rule comes from (contract discipline)
| Source artifact | What it contributes (verbatim authority) |
|---|---|
| User authorization prompt (2026-09-08, this cycle) | objective; precedence law; decision semantics list; security non-authorities; outbox/audit/failure/race/idempotency rules; verification/DONE-WHEN demands; status ceiling |
| User roadmap directive (fast-track plan) | stage order `IDENTITY→AUTHZ→EVIDENCE→POLICY→RISK→IDEMPOTENCY→EXECUTION→RESULT→AUDIT`; decisions `ALLOW/DENY/ESCALATE/UNKNOWN`; "LLM never calls sensitive side effects directly" |
| CAP055_SPEC.md | mandatory upstream global gate; fail-closed; held/held-release semantics; audit event law |
| CAP008_SPEC.md | owner/staff identity via scrypt sessions; tenant scoping; human-ownership suppression; actor-tagged sends |
| PHASE2A_SPEC.md + 2A.1 amendment | idempotency (single delivery per accepted event; at-least-once at provider); outbox states incl. UNKNOWN; tamper-EVIDENT audit; "no second transport" |
| SECURITY_THREAT_MODEL.md / FEASIBILITY_AUDIT.md | LLM/customer input = untrusted; CAP-006/007 OFF; AI never approves discounts/refunds/policy |

**Absent & declared (not fabricated):** CLAUDE.md, SPEC.md, BUILD_PLAN.md, docs/*, .claude/ai-bridge/*, GPT_AUDIT F1–F35, PROGRESS/STATE/HANDOFF/BLOCKERS.md, standalone P2 task card. This spec is therefore derived from the sources above only; anything they don't support ⇒ NOT PROVEN / excluded.

## 1 · AUTHORITY PRECEDENCE (hard law)
`SYSTEM POLICY (CAP-055, boot gates) > TENANT POLICY (kill/tenant scoping, window rules) > BUSINESS RULES (feature-off flags, catalog-bound) > AUTHORIZED STAFF (CAP-008 sessions) > CUSTOMER CONTENT (input only) > MODEL OUTPUT (untrusted hint only)`.
The firewall receives model/customer material strictly as **untrusted fields** — they can REQUEST, never AUTHORIZE.

## 2 · ACTION CLASSES (closed set — derived strictly from existing code paths; anything else = UNKNOWN class ⇒ DENY)
| Class | Source in code | Default rule |
|---|---|---|
| `MSG.AI_TEXT` | brain/flows replies (`meta.source='AI'`) | pass all stages |
| `MSG.ESCALATION_ACK` | `AI_SYSTEM_ACK` transient ack (CAP-008 §5) | allowed only in ESCALATION_PENDING window |
| `MSG.CONSENT_ACK` | opt-in/out acks (legal duty) | passes even when kill-stopped (CAP-055 list) |
| `MSG.HUMAN_TEXT` | staff reply (`HUMAN` + claimant identity, CAP-008) | requires authenticated actor==claimedBy |
| `MSG.SYSTEM_ALERT` | owner alerts (`SYSTEM`) | autonomous ⇒ holds under kill stop |
| `MARKETING.SEND` | scheduler/campaign paths (CAP-007) | **DENY — feature OFF** until Governor gate exists |
| `COMMERCE.RESERVE` | `reserve` flow (CAP-006) | **DENY — feature OFF** (transactional store not proven) |
| `COMMERCE.ADMIN_ACTION` | any discount/refund/price/permission mutation | **DENY — no such authority subsystem; LLM can never be its source** (registry law) |
| unknown / missing class | — | **DENY `UNKNOWN_ACTION_CLASS` (fail-closed)** |

## 3 · PIPELINE STAGES (user-roadmap order) & decisions
```
REQUEST → 0 KILL (CAP-055, upstream, mandatory) → 1 IDENTITY (actor/class/source sanity)
        → 2 AUTHZ (actor↔tenant↔conversation ownership; CAP-008 rules)
        → 3 EVIDENCE (if action carries evidence{status}: only VERIFIED passes; STALE/CONFLICTED/UNKNOWN → DENY·EVIDENCE_NOT_VERIFIED; absent ⇒ class rules govern)
        → 4 POLICY (stage rules per class from §2 — e.g., LIVE window note is enforced at outbox windowGuard; marketing/reserve OFF)
        → 5 RISK (fail-closed plumbing: malformed fields, missing recipient, bad tenant ⇒ DENY; no scoring invented)
        → 6 IDEMPOTENCY (actionId → fs-claim via existing idem primitive, prefix `fw-`; duplicate ⇒ DENY·REPLAYED)
        → 7 EXECUTION (hand to outbox.enqueue ONLY on ALLOW; decision stored in job.meta.firewall{decision,reason,traceId,ts})
        → 8 RESULT (outbox SENT/RETRY/DLQ/UNKNOWN semantics unchanged — firewall never fabricates SUCCESS/FAILURE from UNKNOWN)
        → 9 AUDIT (FIREWALL_DECISION per evaluation: {decision, reason, class, layer, traceId, actor?, tenant, actionId} — no bodies, no secrets)
```
**Decisions:** `ALLOW` · `DENY` (terminal for this evaluation) · `ESCALATE` (exists: means "hand to CAP-008 escalation pipeline" — returned for classes demanding approval; current classes none require it, so ESCALATE is wired-but-unused unless a class opts in — documented, not invented) · `UNKNOWN` is NOT an authorization decision here; it lives where the existing contract puts it — at the provider/outbox execution boundary (SENT_WITH_AUDIT_GAP/UNKNOWN_REQUEUED). Explicitly recorded to satisfy the mandated semantics without inventing states.

**Decision point (exact):** evaluated at ENQUEUE (inside `wa.send()`, before queue write) and stored on the job; **kill-switch is additionally re-checked at execution** (existing outbox autonomyGuard). No other race guarantee is claimed.

## 4 · NON-AUTHORITIES (each gets an adversarial test)
LLM output · customer messages · browser/UI state · hidden fields · prompt instructions · model confidence · natural-language "admin" claims · OWNER_PHONE · caller-supplied metadata claiming authority.
Rule: fields `meta.claimsRole / claimsAuthority / assertedByModel` are **ignored for authorization** — no test may be able to flip a DENY by declaring itself owner.

## 5 · COMPOSITION (no replacement, no duplication)
- CAP-055: consulted first (stage 0); its hold/release/audit semantics untouched.
- CAP-008: `conversations.authorizeOutbound` becomes the firewall's AUTHZ stage (single audit source preserved — event names unchanged).
- gates.js `messagingWindowGuard`: remains the LIVE 24h policy at outbox (documented; firewall doesn't duplicate window logic).
- Idempotency: existing `claimOnce` file-marker primitive under `fw-` prefix for actionIds.
- Outbox: the ONLY execution transport (firewall never sends; it decides).

## 6 · FAIL-CLOSED INVENTORY (all tested)
unreadable kill state (inherited) · malformed request (no class/to) · missing actor on HUMAN class · invalid tenant · evidence explicitly stale/conflicted · replayed actionId · unknown class · unknown source · firewall internal exception ⇒ **DENY + `FIREWALL_ERROR_FAILCLOSED` audit** (never silent ALLOW).

## 7 · AUDIT CONTRACT
`FIREWALL_DECISION` on every evaluate: {traceId, decision, reason, class, stage, actor.staffId?, tenant, actionId?} + existing stage events (`KILL_SEND_BLOCKED`, `AI_SEND_BLOCKED_HUMAN_ACTIVE`, …) unchanged. PII: phones masked by audit.redact; message bodies NEVER logged by the firewall. Tamper-evident chain semantics unchanged (append-only JSONL, hash-chained).

## 8 · BYPASS PROPERTY (architectural requirement)
Every send flows through `wa.send()` — the single chokepoint. Proof instrument: static scan in tests asserts (a) no other module calls `outbox.enqueue`/`deliverToMeta` directly except `whatsapp.js`, (b) `whatsapp.send` calls `firewall.evaluate` before enqueue (code-grep + runtime DENY test), (c) inbox reply path passes through the same evaluate (HUMAN class). Known bypass surface honestly declared: in-process code could import outbox factory and build a rogue instance — blocked by *code ownership*, noted as NOT PROVEN against hostile code changes (that's what repo review + tests are for).

## 9 · DONE-WHEN (P2, verbatim-mapped)
1. Every autonomous state-changing send evaluated pre-outbox ✔ test: allow/deny live
2. Decisions deterministic w/ reasons (table in test output)
3. All §2 deny classes deny; allow path delivers exactly 1 job
4. Malformed / missing-authority / invalid-actor / invalid-tenant denied
5. Customer+LLM injection attempts cannot flip decisions
6. Replay of actionId denied; concurrent twins → exactly one ALLOW
7. Kill-switch STOPPED ⇒ autonomous DENY + HELD at execution (composed, existing events intact)
8. Outbox integration: ALLOW→enqueue; DENY→no enqueue; UNKNOWN preserved at provider boundary
9. Restart: idem markers persist → replay still denied after reboot
10. Audit: every decision reconstructible from FIREWALL_DECISION + chain intact (hash chain check)
11. Privacy: no message bodies / no secrets / masked phones in firewall audits
12. Prior suites stay green (51/51 baseline)
13. All adversarial items print EXPECTED/ACTUAL/PROVES/DOES-NOT-PROVE
14. Status ceiling PILOT; no VERIFIED_PRODUCTION claim; real-pilot untouched

## 10 · SUBSTITUTIONS FOR ABSENT MANDATED INFRA (honest labels)
- AI audit checkpoint: `.claude/ai-bridge` absent ⇒ I perform a **same-session independent inspection pass** over the full P2 diff (findings AF-1..n classified ACCEPTED/FIXED/REJECTED/DEFERRED), labeled *self-audit — NOT a fresh-context external auditor* (limitation).
- Commit/merge: repo wasn't git-initialized ⇒ I initialize git: baseline commit (pre-P2 state), `feature/p2-firewall` branch, merge commit to `main`, both hashes reported. This mirrors the workflow faithfully in-sandbox.
- PROGRESS/STATE/HANDOFF/BLOCKERS/check-deps: absent governance files; per the user's standing "no document explosion" rule, project state lives in `VERIFICATION_LOG.md` + `CAPABILITY_REGISTRY.yml` (existing governance) — noted for the record.
