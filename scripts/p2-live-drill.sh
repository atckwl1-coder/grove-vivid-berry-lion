#!/bin/bash
# P2 ACTION FIREWALL — live drill on running server (DEMO transport)
set -u
P=923005558888; B=/tmp/p2-body.json
sign(){ openssl dgst -sha256 -hmac 'demo-adversarial-secret' | awk '{print $2}'; }
ev(){ printf '{"entry":[{"changes":[{"value":{"contacts":[{"profile":{"name":"FW Drill"}}],"messages":[{"from":"%s","id":"wamid.fw-%s","type":"text","text":{"body":"%s"}}]}}]}]}' "$P" "$1" "$2" > $B; }
fire(){ curl -s -o /dev/null -w "    webhook %{http_code}\n" -X POST localhost:3000/webhook -H "Content-Type: application/json" -H "x-hub-signature-256: sha256=$(cat $B | sign)" --data-binary @$B; sleep 2; }
echo "════ P2 FIREWALL LIVE DRILL $(date -Iseconds) ════"
echo "── 1. baseline autonomous AI reply (firewall should ALLOW) ──"
ev 1 "emi reno13"; fire
echo "    FIREWALL_DECISION rows: $(grep -c FIREWALL_DECISION data/audit.jsonl || true)"
grep FIREWALL_DECISION data/audit.jsonl | tail -2 | python3 -c "import json,sys; [print('   ', json.dumps(e['payload'])) for e in (json.loads(l) for l in sys.stdin)]"
echo "── 2. OWNER STOP → autonomous must DENY at the firewall wall ──"
L=$(curl -s -X POST "localhost:3000/inbox/login?json=1" -H "Content-Type: application/json" -d '{"id":"boss","password":"drill-boss-pw-2026"}')
TOK=$(echo "$L"|python3 -c 'import json,sys;print(json.load(sys.stdin)["sessionToken"])'); CSRF=$(echo "$L"|python3 -c 'import json,sys;print(json.load(sys.stdin)["csrf"])')
curl -s -X POST "localhost:3000/inbox/kill/stop?json=1" -H "Cookie: noor_session=$TOK" -H "x-csrf: $CSRF" -H "Content-Type: application/json" -d '{"actionId":"act-p2drill-stop-1","reason":"firewall composition drill"}' | python3 -m json.tool | sed 's/^/    /'
ev 2 "mi band kab aayega?"; fire
echo "    DENY rows with reason KILL_SWITCH_ACTIVE:"
grep FIREWALL_DECISION data/audit.jsonl | grep KILL_SWITCH_ACTIVE | tail -1 | python3 -c "import json,sys; e=json.loads(sys.stdin.read()); print('   ', json.dumps(e['payload']))"
echo "    (server log above may ALSO show EVENT_FAILED — send refused at enqueue)"
echo "── 3. RESUME (typed confirm) → autonomy returns ──"
curl -s -X POST "localhost:3000/inbox/kill/resume?json=1" -H "Cookie: noor_session=$TOK" -H "x-csrf: $CSRF" -H "Content-Type: application/json" -d '{"actionId":"act-p2drill-resume-1","confirm":"RESUME","reason":"drill done"}' | python3 -m json.tool | sed 's/^/    /'
ev 3 "emi reno13"; fire
echo "    tail audit (last 4 decision-relevant rows):"
grep -E "FIREWALL_DECISION|KILL_" data/audit.jsonl | tail -6 | python3 -c "
import json,sys
for l in sys.stdin:
    e=json.loads(l)
    print('   ',e['ts'][11:19],e['type'].ljust(20),json.dumps(e['payload'])[:110])
"
echo "════ DRILL COMPLETE ════"
