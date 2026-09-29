#!/usr/bin/env node
// Regenerates the SHELL precache list in sw.js from the files on disk, and syncs js/version.js
// with sw.js's CACHE_VERSION. Explicit list at runtime (no globbing in the worker) — SPEC §1.5.
//
//   node scripts/precache.mjs          rewrite sw.js + js/version.js
//   node scripts/precache.mjs --check  exit 1 if either is stale or a VENDORED path is missing
//
// Shell = ./, index.html, manifest.webmanifest, css/*, js/** (.js), fonts/*, icons/*, data/*.json.
// The vendored apps' lists live in sw.js's VENDORED block (Lane B) and are only verified here.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

function walk(dir, filter) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(abs, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(relative(ROOT, p), filter));
    else if (filter(name)) out.push(relative(ROOT, p).split(sep).join('/'));
  }
  return out;
}

const shell = [
  './',
  './index.html',
  './manifest.webmanifest',
  ...walk('css', (n) => n.endsWith('.css')),
  ...walk('js', (n) => n.endsWith('.js')),
  ...walk('fonts', (n) => /\.(woff2?|ttf)$/.test(n)),
  ...walk('icons', (n) => /\.(png|svg|ico)$/.test(n)),
  ...walk('data', (n) => n.endsWith('.json')),
].map((p) => (p.startsWith('./') ? p : `./${p}`));

const swPath = join(ROOT, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const m = /const CACHE_VERSION = '([^']+)';/.exec(sw);
if (!m) { console.error('CACHE_VERSION not found in sw.js'); process.exit(1); }
const version = m[1];

const begin = sw.indexOf('// PRECACHE:BEGIN');
const end = sw.indexOf('// PRECACHE:END');
if (begin < 0 || end < 0) { console.error('PRECACHE markers not found in sw.js'); process.exit(1); }
const headerEnd = sw.indexOf('\n', begin) + 1;
const block = `const SHELL = [\n${shell.map((p) => `  '${p}',`).join('\n')}\n];\n`;
const nextSw = sw.slice(0, headerEnd) + block + sw.slice(end);

const versionPath = join(ROOT, 'js', 'version.js');
const nextVersion = `// Generated from sw.js by \`node scripts/precache.mjs\` — keep in sync; do not edit by hand.\nexport const CACHE_VERSION = '${version}';\n`;
const curVersion = existsSync(versionPath) ? readFileSync(versionPath, 'utf8') : '';

// verify VENDORED entries exist
const vb = sw.indexOf('// VENDORED:BEGIN'), ve = sw.indexOf('// VENDORED:END');
const vendoredSrc = vb >= 0 && ve > vb ? sw.slice(vb, ve) : '';
const vendored = [...vendoredSrc.matchAll(/'(\.\/apps\/[^']+)'/g)].map((x) => x[1]);
const missing = vendored.filter((p) => !existsSync(join(ROOT, p.replace(/^\.\//, '').replace(/\?.*$/, ''))));

if (CHECK) {
  const problems = [];
  if (nextSw !== sw) problems.push('sw.js SHELL list is stale');
  if (nextVersion !== curVersion) problems.push('js/version.js does not match sw.js CACHE_VERSION');
  if (missing.length) problems.push(`VENDORED paths missing on disk: ${missing.join(', ')}`);
  if (problems.length) { console.error(`precache check FAILED:\n- ${problems.join('\n- ')}`); process.exit(1); }
  console.log(`precache check ok · ${version} · ${shell.length} shell + ${vendored.length} vendored`);
  process.exit(0);
}

if (nextSw !== sw) writeFileSync(swPath, nextSw);
if (nextVersion !== curVersion) writeFileSync(versionPath, nextVersion);
console.log(`precache · ${version} · ${shell.length} shell files${vendored.length ? ` + ${vendored.length} vendored` : ''}${missing.length ? ` · WARNING missing: ${missing.join(', ')}` : ''}`);
