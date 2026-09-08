#!/bin/bash
# CAP-055 LIVE DRILL — owner kill switch end-to-end on a live server (DEMO transport)
# Pass $1 = phase: "pre" (stop + silence proof) or "post" (restart persistence + resume)
set -u
P=923005559999
B=/tmp/cap055-body.json
sign(){ openssl dgst -sha256 -hmac 'demo-adversarial-secret' | awk '{print $2}'; }
bevent(){ printf '{"entry":[{"changes":[{"value":{"contacts":[{"profile":{"name":"Kill Drill"}}],"messages":[{"from":"%s","id":"wamid.kill-%s","type":"text","text":{"body":"%s"}}]}}]}]}' "$P" "$1" "$2" > $B; }
fire(){ curl -s -o /dev/null -w "    webhook HTTP %{http_code}\n" -X POST localhost:3000/webhook -H "Content-Type: application/json" -H "x-hub-signature-256: sha256=$(cat $B | sign)" --data-binary @$B; sleep 2; }

LOGIN() { L=$(curl -s -X POST "localhost:3000/inbox/login?json=1" -H "Content-Type: application/json" -H 'Accept: application/json' -d "{\"id\":\"boss\",\"password\":\"drill-boss-pw-2026\"}")
  TOK=$(echo "$L" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessionToken"])')
  CSRF=$(echo "$L" | python3 -c 'import json,sys;print(json.load(sys.stdin)["csrf"])'); }

if [ "${1:-pre}" = "pre" ]; then
  echo "════ CAP-055 LIVE DRILL $(date -Iseconds) — PHASE 1 (stop + silence) ════"
  LOGIN
  echo "── 1. baseline: customer asks EMI (autonomous reply expected) ──"
  bevent pre1 "emi reno13"; fire
  echo "    audit OUTBOX_SENT count now: $(grep -c OUTBOX_SENT data/audit.jsonl)"
  echo "── 2. OWNER authenticated STOP ALL ──"
  curl -s -X POST "localhost:3000/inbox/kill/stop?json=1" -H "Cookie: noor_session=$TOK" -H "x-csrf: $CSRF" -H "Content-Type: application/json" \
    -d '{"actionId":"act-drill-stop-live-1","reason":"live drill: verify brake"}' | python3 -m json.tool | sed 's/^/    /'
  echo "── 3. kill file on disk:"; sed 's/^/    /' data/killswitch.json
  echo "── 4. customer msg AFTER stop → autonomy must be silent ──"
  bevent after1 "emi reno13 phir se batao"; fire
  echo "── 5. staff (hassan) tries STOP → expect 403 KILL_SWITCH_DENIED ──"
  HL=$(curl -s -X POST "localhost:3000/inbox/login?json=1" -H "Content-Type: application/json" -d '{"id":"hassan","password":"drill-hassan-pw-2026"}')
  HT=$(echo "$HL" | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessionToken"])'); HC=$(echo "$HL" | python3 -c 'import json,sys;print(json.load(sys.stdin)["csrf"])')
  curl -s -o /dev/null -w "    hassan STOP → HTTP %{http_code}\n" -X POST "localhost:3000/inbox/kill/stop?json=1" -H "Cookie: noor_session=$HT" -H "x-csrf: $HC" -H "Content-Type: application/json" \
    -d '{"actionId":"act-drill-stop-staff-1"}'
  echo "── 6. anonymous STATUS attempt → expect 401 ──"
  curl -s -o /dev/null -w "    anon status → HTTP %{http_code}\n" -X POST "localhost:3000/inbox/kill/status?json=1" -H "Content-Type: application/json" -d '{}'
  echo "$TOK" > /tmp/kill-tok.txt; echo "$CSRF" > /tmp/kill-csrf.txt
  echo "PHASE 1 DONE — server stays STOPPED; next: hard restart, then PHASE 2."
else
  echo "════ PHASE 2 $(date -Iseconds) — persistence after REAL process death + resume ════"
  LOGIN
  echo "── 7. state after process restart (disk truth):"; sed 's/^/    /' data/killswitch.json | head -4
  echo "── 8. customer msg after restart → STILL silent? ──"
  bevent post1 "hello koi jawab do"; fire
  echo "    KILL_SEND_BLOCKED total: $(grep -c KILL_SEND_BLOCKED data/audit.jsonl)"
  echo "── 9. OWNER RESUME with confirm phrase ──"
  curl -s -X POST "localhost:3000/inbox/kill/resume?json=1" -H "Cookie: noor_session=$TOK" -H "x-csrf: $CSRF" -H "Content-Type: application/json" \
    -d '{"actionId":"act-drill-resume-live-1","confirm":"RESUME","reason":"drill proven: silent during stop, restart-persistent"}' | python3 -m json.tool | sed 's/^/    /'
  sleep 2
  echo "── 10. blocked-while-stopped retries now drain? (OUTBOX_SENT count now: $(grep -c OUTBOX_SENT data/audit.jsonl)) ──"
  bevent post2 "emi reno13"; fire
  echo "── 11. CAP-055 audit chain ──"
  python3 -c "
import json
for l in open('data/audit.jsonl'):
    e=json.loads(l)
    if e['type'].startswith('KILL') or e['type'].startswith('OUTBOX_HELD'):
        p=e['payload']
        print(f\"  {e['ts'][11:19]} {e['type']:26s} actor={str(p.get('actor',{}).get('staffId','-')):8s} {str(p.get('prev_state'))[-20:]}→{str(p.get('new_state'))[-20:]} action={p.get('actionId','-')}\")"
fi
