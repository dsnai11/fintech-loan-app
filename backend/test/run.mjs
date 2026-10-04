import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Runs every suite in test/suites one after another. Needs MongoDB (TEST_MONGO_URL, default localhost).
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'suites');
const only = process.argv[2];
const suites = readdirSync(dir).filter(f => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort();

const results = [];
for (const file of suites) {
  console.log(`\n=== ${file} ===`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  results.push({ file, ok: r.status === 0, seconds: ((Date.now() - started) / 1000).toFixed(1) });
}

console.log('\n──────── Summary ────────');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}  (${r.seconds}s)`);
const bad = results.filter(r => !r.ok).length;
console.log(bad ? `\n${bad} of ${results.length} suites FAILED` : `\nAll ${results.length} suites passed`);
process.exit(bad ? 1 : 0);
