#!/bin/bash
# PROJECT SENTINEL — Phase 2A adversarial demonstration script (exact)
# Usage: server must be running on :3000 with META_APP_SECRET=demo-adversarial-secret
set -e
BODY='{"entry":[{"changes":[{"value":{"contacts":[{"profile":{"name":"Ahmed"}}],"messages":[{"from":"923001234567","id":"wamid.evidence-001","type":"text","text":{"body":"menu"}}]}}]}]}'
GOOD_SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac 'demo-adversarial-secret' | awk '{print $2}')"

echo "=== ATTACK 1: FORGED SIGNATURE ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -H "x-hub-signature-256: sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" -d "$BODY"
echo "=== LEGIT EVENT (valid signature) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -H "x-hub-signature-256: $GOOD_SIG" -d "$BODY"
sleep 1
echo "=== ATTACK 2: REPLAY (identical event, valid signature) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -H "x-hub-signature-256: $GOOD_SIG" -d "$BODY"
sleep 1
echo "=== AUDIT TRAIL DUMP + CHAIN CHECK ==="
node -e "
const lines = require('fs').readFileSync('data/audit.jsonl','utf8').trim().split('\n').map(JSON.parse);
for (const e of lines) console.log(e.ts, e.type, JSON.stringify(e.payload).slice(0,90), '| prev:', e.prev.slice(0,12));
console.log('CHAIN:', lines.every((e,i)=> i===0 ? e.prev==='GENESIS' : e.prev===lines[i-1].hash) ? 'INTACT' : 'BROKEN');
"
