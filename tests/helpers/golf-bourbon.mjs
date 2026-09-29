// Shared setup for golf-facts / bourbon-facts tests: the vendored UMD libs, the ledger's course catalog, and the
// deterministic sample builders. `node tests/helpers/golf-bourbon.mjs --write` regenerates the two fixtures.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGolfSample, buildBourbonSample } from '../../js/sample.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..');
const require = createRequire(join(APP, 'package.json'));

export const GolfMath = require(join(APP, 'js', 'vendor', 'golf-math.js'));
export const GolfShapes = require(join(APP, 'js', 'vendor', 'shapes.js'));
export const libs = { GolfMath, GolfShapes };

/** The ledger's own data/courses.js (sets window.__golfCourseCatalog) evaluated in a sandbox object. */
export function courseCatalog() {
  const src = readFileSync(join(APP, 'apps', 'fairway-ledger', 'data', 'courses.js'), 'utf8');
  const window = {};
  new Function('window', src)(window); // eslint-disable-line no-new-func
  return window.__golfCourseCatalog;
}

export const TODAY = '2026-09-28'; // a Monday — the fixtures are built for this day
export const FIXTURE_FL = join(APP, 'tests', 'fixtures', 'fairwayLedger.sample.json');
export const FIXTURE_BP = join(APP, 'tests', 'fixtures', 'barrel-proof.sample.json');

export function readFixtures() {
  return {
    fl: JSON.parse(readFileSync(FIXTURE_FL, 'utf8')), // the ledger's Export format: the bare state object
    bp: JSON.parse(readFileSync(FIXTURE_BP, 'utf8')), // Barrel Proof's Export format: { app, exportedAt, state } (+ Clubhouse quick pours for the union test)
  };
}

if (process.argv.includes('--write')) {
  const { state } = buildGolfSample(TODAY, courseCatalog(), libs);
  // keep the fixture lean: only the courses the rounds use (+ every Deerwood nine, which the 18s are built from)
  const used = new Set(state.rounds.map((r) => r.courseId));
  state.courses = state.courses.filter((c) => used.has(c.id) || /^deerwood-(buck|doe|fawn)-/.test(c.id));
  writeFileSync(FIXTURE_FL, `${JSON.stringify(state)}\n`);
  const b = buildBourbonSample(TODAY);
  writeFileSync(FIXTURE_BP, `${JSON.stringify({ app: 'barrel-proof', exportedAt: '2026-09-28T23:10:00.000Z', state: b.state, clubhousePours: b.pours }, null, 2)}\n`);
  console.log('wrote', FIXTURE_FL, FIXTURE_BP);
}
