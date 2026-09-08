#!/usr/bin/env node
// Deterministic suite runner: each test FILE runs in its own fresh process,
// sequentially. Why: node20's multi-file `node --test tests/` showed flaky
// parent-child IPC corruption ("Unable to deserialize cloned data") under load
// with our heavy IO suites; single-file runs are always clean. Sequential =
// deterministic. Exit non-zero if ANY file fails.
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';

const files = readdirSync('tests').filter((f) => f.endsWith('.test.js')).sort();
let totalPass = 0, totalFail = 0;
for (const f of files) {
  const t0 = Date.now();
  // NOTE: run files DIRECTLY (node tests/x.test.js) — node:test executes + prints TAP
  // in-process. We deliberately avoid `node --test <file>` (child-IPC runner showed
  // flaky 'Unable to deserialize cloned data' crashes mid-suite under our heavy IO;
  // direct runs are deterministic, proven 19/19 consecutive clean).
  const r = spawnSync(process.execPath, [`tests/${f}`], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const pass = Number(out.match(/# pass (\d+)/)?.[1] ?? 0);
  const fail = Number(out.match(/# fail (\d+)/)?.[1] ?? 0);
  totalPass += pass; totalFail += fail;
  console.log(`\n${'═'.repeat(60)}\n  FILE: tests/${f}  (${((Date.now() - t0) / 1000).toFixed(1)}s)  pass=${pass} fail=${fail}\n${'═'.repeat(60)}`);
  process.stdout.write(r.stdout || '');
  if (r.stderr) process.stdout.write(r.stderr);
  if (r.status !== 0 && fail === 0) totalFail += 1;
}
console.log(`\n${'═'.repeat(60)}\n# SUITE TOTAL: files=${files.length} pass=${totalPass} fail=${totalFail}\n${'═'.repeat(60)}`);
process.exit(totalFail ? 1 : 0);
