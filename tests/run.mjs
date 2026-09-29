#!/usr/bin/env node
// node tests/run.mjs [filter] — runs every tests/*.test.mjs. Each file exports `tests`: { name: fn } (fn may be async).
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort();
let pass = 0, fail = 0;
for (const f of files) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  for (const [name, fn] of Object.entries(mod.tests || {})) {
    try {
      await fn();
      pass++;
    } catch (err) {
      fail++;
      console.log(`FAIL ${f} › ${name}\n     ${err && err.message ? err.message : err}`);
    }
  }
}
console.log(`${fail ? 'FAILED' : 'ok'} · ${pass} passed · ${fail} failed · ${files.length} files`);
process.exit(fail ? 1 : 0);
