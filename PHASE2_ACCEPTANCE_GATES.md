# PHASE 2 ACCEPTANCE GATES
# STATUS: DERIVED EXTRACTION — created 2026-09-07 at reviewer request.
# PROVENANCE: content assembled verbatim from the artifact(s) listed below.
# These files did NOT exist during Phase-2A verification; they are faithful
# copies from the governing artifacts, not originals. No content invented.
# SOURCES:
#   - CAPABILITY_REGISTRY.yml  (SHA256: d0a6e5f7f9bbb678c6caa6f97b5ba762183fc4d04cb6d48063a2647dcb6a629f)
---
## Release gate P0 (verbatim — CAPABILITY_REGISTRY.yml)

```yaml
release_gate_P0:
  - every_capability_in_scope_has_COMPLETE_contract
  - CAP-008_staff_inbox_live_and_drilled
  - CAP-001_idempotency_proven
  - CAP-011_outbox_proven
  - CAP-009_validator_proven_zero_price_zero_injection_breaches
  - CAP-002_consent_ledger_replayable
  - CAP-055_kill_switch_drilled
  - evidence_labels_in_every_customer_facing_output
  - CAP-006_reservation_atomicity_proven_or_feature_off
  - CAP-054_quality_monitor_wired
  - pii_redaction_in_logs
  - automated_backup_of_ledger_and_db
```

## Gate status today

| Gate | Status |
|---|---|
| CAP-001_idempotency_proven | ✅ PILOT (VR-2026-09-06-01) |
| CAP-011_outbox_proven | ✅ PILOT (VR-2026-09-06-02) |
| CAP-008_staff_inbox_live_and_drilled | ❌ BLOCKED — Phase 2B |
| CAP-009_validator_proven | ❌ not built — Phase 3 |
| all other gates | ❌ pending their phases |
