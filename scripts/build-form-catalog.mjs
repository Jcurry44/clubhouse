#!/usr/bin/env node
// Builds data/form-catalog.json — a compact id → name lookup copied (read-only) from Form's exercise and
// activity catalogs, so a Form export (which carries exercise ids, not names) can be shown in words.
//
//   node scripts/build-form-catalog.mjs [path/to/Form Training/v2]
//
// Nothing in Form is edited; this only READS src/catalog/exercises/*.ts and src/catalog/activities.ts.
// Output shape (arrays keep it small):
//   exercises: { id: [name, short, mode, group, flags] }   mode = Form LoadMode, group = push|pull|legs|core|other,
//                                                           flags = string of: u (unilateral) · a (assisted)
//   activities: { id: name }
// The committed data/form-catalog.json is the source of truth at runtime; re-run this when Form adds exercises.
// Unknown ids in an export fall back to a humanized id (Trap Bar Deadlift), so a stale catalog never breaks an import.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DEFAULT_FORM = resolve(ROOT, '..', '..', 'Form Training', 'v2');
const FORM = resolve(process.argv[2] || DEFAULT_FORM);

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR + NL).join(NL); // Form's exercise files are CRLF

const GROUP = {
  legs: ['knee-dominant', 'hip-dominant', 'unilateral', 'hamstring', 'calf', 'hip-thrust', 'abduction', 'adduction', 'knee-extension', 'plyo-lower'],
  push: ['h-push', 'v-push', 'second-push', 'triceps', 'chest-fly', 'lateral', 'plyo-upper'],
  pull: ['h-pull', 'v-pull', 'rear-delt', 'biceps', 'shrug', 'grip'],
  core: ['core', 'anti-extension', 'anti-rotation', 'rotation', 'lateral-core', 'core-flexion'],
};
const groupOf = (pattern) => Object.entries(GROUP).find(([, list]) => list.includes(pattern))?.[0] || 'other';

/** Split a catalog file into its top-level `  {` … `  },` object literals. */
function chunks(src) {
  const out = [];
  const parts = src.split(`${NL}  {${NL}`);
  for (const part of parts.slice(1)) {
    const end = part.indexOf(`${NL}  },`);
    out.push(end < 0 ? part : part.slice(0, end));
  }
  return out;
}

const field = (chunk, key) => {
  const m = new RegExp(`${NL}    ${key}: "([^"]*)"`).exec(`${NL}${chunk}`);
  return m ? m[1] : null;
};

function exercises() {
  const out = {};
  for (const f of ['lower', 'upper', 'core']) {
    const p = join(FORM, 'src', 'catalog', 'exercises', `${f}.ts`);
    if (!existsSync(p)) throw new Error(`missing ${p}`);
    for (const c of chunks(read(p))) {
      const id = field(c, 'id');
      const name = field(c, 'name');
      if (!id || !name) continue;
      const short = field(c, 'short') || name;
      const mode = field(c, 'mode') || 'db';
      const pattern = field(c, 'pattern') || '';
      let flags = '';
      if ((NL + c).includes(`${NL}    unilateral: true`)) flags += 'u';
      if ((NL + c).includes(`${NL}    assisted: true`) || /assist/i.test(id)) flags += 'a';
      out[id] = [name, short, mode, groupOf(pattern), flags];
    }
  }
  return out;
}

function activities() {
  const src = read(join(FORM, 'src', 'catalog', 'activities.ts'));
  const out = {};
  const re = new RegExp(`${NL}    id: "([^"]+)",${NL}    name: "([^"]+)",${NL}    icon:`, 'g');
  for (const m of src.matchAll(re)) out[m[1]] = m[2];
  return out;
}

const ex = exercises();
const act = activities();
const doc = {
  v: 1,
  note: 'Copied read-only from Form (src/catalog). Regenerate with scripts/build-form-catalog.mjs.',
  exercises: ex,
  activities: act,
};
writeFileSync(join(ROOT, 'data', 'form-catalog.json'), `${JSON.stringify(doc)}${NL}`);
console.log(`form-catalog.json · ${Object.keys(ex).length} exercises · ${Object.keys(act).length} activities`);
