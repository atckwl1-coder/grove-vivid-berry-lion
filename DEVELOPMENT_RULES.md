# SENTINEL DEVELOPMENT MANAGEMENT RULES

Permanent development-management contract for all future Sentinel work.

This document does not change application behavior. It governs how work is
authorized, executed, recorded, and frozen. After completing an authorized
task: **STOP**. Do not automatically choose the next feature.

---

## 1. MAIN BRANCH

- `main` represents the latest approved stable Sentinel state.
- Never experiment directly on `main`.
- Never rewrite `main` history.
- Never use blind `--force`.
- Ref updates that replace remote history require explicit human authorization
  and `--force-with-lease` only (never casual `--force`).

---

## 2. FROZEN BASELINE

The current permanent baseline is:

| Field | Value |
|---|---|
| Tag | `sentinel-v1.6-pilot-freeze` |
| Commit | `f92a3f8d6838384f5ab6feb67598c35d8075a8a1` |
| Branch at freeze | `main` |
| GitHub backup | `https://github.com/atckwl1-coder/grove-vivid-berry-lion` |

This tag must remain recoverable. Do not delete it casually.

It is a **historical** V1-6 pilot freeze, not automatically current `main`. Approved product commits may land on `main` after this SHA. Current HEAD and suite: `STATE.md`.

---

## 3. FEATURE BRANCHES

Every future feature starts from current approved `main`.

Examples:

- `feature/v1-7-...`
- `feature/customer-care-...`
- `fix/...`
- `audit/...`

Do not land experimental work on `main` first and branch later.

---

## 4. EXPLICIT SCOPE ONLY

An agent may implement **only** the explicitly authorized task.

Discovered improvements outside scope:

- **DO NOT IMPLEMENT.**
- Record them as `CANDIDATE` / `DEBT` only.

Silent scope expansion is a contract violation.

---

## 5. NO AUTONOMOUS MILESTONES

Agents must never invent, launch, or continue another milestone without
explicit authorization.

Forbidden without authorization:

- “next sprint”
- “rapid feature integration”
- inventing V1-x+1 after completing V1-x
- continuing into B-2, QR, payments, or any other adjacent workstream

---

## 6. REQUIRED DEVELOPMENT LOOP

For every authorized feature:

`INSPECT → PLAN → IMPLEMENT → TEST → VERIFY → REPORT → COMMIT`

- Inspect the actual repository; do not rely only on prior reports.
- Plan against the authorized scope only.
- Implement only that scope.
- Test with the existing suite; add tests for the authorized change.
- Verify honestly (see §15).
- Report what was implemented, what was not, and what remains unproven.
- Commit after approval of the work, not before.

No silent scope expansion at any step.

---

## 7. SAFETY FREEZE

The following require **explicit authorization** before modification:

- owner floors
- `numberFirewall`
- Action Firewall
- Kill Switch
- CAP-008 FSM
- outbox
- idempotency
- paid-sale authority
- owner source-of-truth
- transport architecture

If a requested feature needs one of these files and authorization is absent,
return `BLOCKED_BY_SHARED_CONTRACT`. Do not “just this once” patch them.

---

## 8. TRANSPORT

Current transport: **Meta Cloud API**.

NOT IMPLEMENTED:

- QR
- Baileys
- WhatsApp Web session clients

No alternate transport may be introduced without explicit authorization.
Preflight/checklists are operator prep, not live evidence.

---

## 9. TESTING

- Do not weaken or delete existing tests to make a feature pass.
- A test failure must be reported honestly.
- Do not cite a previous pass count after a code change without re-running.
- Isolation fixtures (`CATALOG_FILE`, `NEGOTIATION_RULES_FILE`,
  `SALES_SKILLS_FILE`, `CATALOG_NOW_MS`) must not mutate owner JSON.

---

## 10. GIT HISTORY

- Every approved milestone receives an honest commit.
- Do not fabricate historical commits.
- Do not rewrite already-published freeze history.
- After an approved milestone is frozen, create an annotated tag.

---

## 11. RELEASE / FREEZE

Recommended annotated-tag format:

- `sentinel-vX.Y-pilot`
- `sentinel-vX.Y-stable`

Example of the current freeze: `sentinel-v1.6-pilot-freeze`.

---

## 12. SECRETS

Never commit:

- `.env`
- credentials
- tokens
- sessions
- runtime data
- customer PII
- local databases

`.env.example` (template only) may remain tracked.

---

## 13. RUNTIME DATA

`data/` remains ignored unless a specific artifact is explicitly approved as
sanitized fixture data.

Do not treat live `data/` contents as source of truth for git.

---

## 14. DOCUMENTATION

Every completed milestone must update only the documentation necessary to
describe the **actual** repository state.

Never claim without evidence:

- `LIVE`
- `DELIVERED`
- `VERIFIED_PRODUCTION`
- or similar production-status language

Operator prep, DEMO/PILOT, and preflight are not live proof.

---

## 15. TRUTH LABELS

Use only:

| Label | Meaning |
|---|---|
| `VERIFIED` | Evidence exists in this repository for the claim. |
| `IMPLEMENTED BUT UNPROVEN` | Code exists; live/production proof does not. |
| `UNKNOWN` | Insufficient evidence; do not invent a number. |
| `UNAVAILABLE` | Source missing; do not substitute a fake zero. |
| `BLOCKED` | Cannot proceed without an explicit decision or dependency. |
| `MOCK` | Demo/fixture behavior; not real delivery. |

Incomplete KPIs render `UNKNOWN` / `PARTIAL`, never a fake `0`.

---

## 16. ROLLBACK

The latest release tag must always remain recoverable.

Never delete release tags casually.

Current recoverable freeze: `sentinel-v1.6-pilot-freeze` →
`f92a3f8d6838384f5ab6feb67598c35d8075a8a1`.

---

## 17. HUMAN DECISIONS

Owner/business decisions must remain human decisions.

Agents may identify decisions but may not invent them.

Examples that remain human:

- Reno 16F floor
- price/floor changes
- live B-2 authorization
- alternate transport
- marketing enablement
- paid-sale policy changes

---

## 18. FINAL STOP CONDITION

After completing the authorized task:

**STOP.**

Do not automatically choose the next feature.
Do not create another implementation prompt.
Do not launch another milestone.

---

## OPERATOR NOTE

This file is the contract. Product code, safety architecture, floors, and
transport are unchanged by its addition.
