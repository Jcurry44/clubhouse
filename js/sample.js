// Sample data for Golf + Bourbon — a DEVELOPER aid (Settings → Developer → Load sample data). Never automatic.
//
// Safety rules (Joe fears losing rounds):
// - It only ever fills an EMPTY Fairway Ledger / Barrel Proof. If either already holds real data, that half is skipped.
// - A full snapshot is taken (awaited) before anything is written or removed — undo lives in Backups.
// - Every sample row is marked (round ids `round-sample-*` + `sampleSource`, tastings `taste-sample-*`, killLog
//   `sample:true`, flight `flight-sample-*`, quick pours `pour-sample-*`) so "Remove sample data" takes out only
//   sample rows; anything Joe added on top stays.
// Pure builders (buildGolfSample / buildBourbonSample) take `today` so tests and fixtures are deterministic.
import * as store from './store.js';
import { readRaw, writeRaw, removeRaw } from './ls.js';
import { addDays, parseYmd, ymd, monD } from './dates.js';

export const MARKER = 'dev.sample';
const FL_KEY = 'fairwayLedger.v1';
const FL_META = 'fairwayLedger.backupMeta.v1';
const BP_KEY = 'barrel-proof-state-v1';

/* ------------------------------------------------------------------ PRNG */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ golf */

const DW = { buck: 'Buck', doe: 'Doe', fawn: 'Fawn' };

/**
 * Round specs, oldest first: [daysAgo, courseId, gross, putts, penalties, fairwaysHit, tag, note].
 * The last ten 18s are shaped to tell a story the Coach can read: scoring 87.6 → 85.4 (down 2.2),
 * putts 33.4 → 32.2, penalties 0.8 → 1.4 (Driver), fairways 43% → 50%, and an 83 at Deerwood yesterday.
 */
export const GOLF_SPECS = [
  [150, 'arrowhead-white', 93, 35, 2, 5, 'casual', 'First round of the year. Rust everywhere.'],
  [143, 'deerwood-buck-doe-white', 91, 34, 1, 6, 'league', ''],
  [136, 'glen-oak-white', 92, 35, 2, 5, 'casual', ''],
  [129, 'deerwood-fawn-white', 45, 17, 1, 3, 'practice', 'Evening nine.'],
  [122, 'diamond-hawk-green', 94, 35, 2, 4, 'casual', 'Wind all day.'],
  [115, 'deerwood-doe-fawn-white', 90, 34, 1, 5, 'league', ''],
  [108, 'harvest-hill-silver', 89, 34, 1, 6, 'casual', ''],
  [101, 'hickory-stick-white', 92, 35, 2, 5, 'tournament', 'Member-guest, day one.'],
  [94, 'deerwood-buck-doe-white', 89, 34, 1, 6, 'league', ''],
  [87, 'arrowhead-white', 90, 34, 1, 5, 'casual', ''],
  [80, 'deerwood-buck-white', 44, 17, 0, 3, 'practice', 'Nine before dinner.'],
  [73, 'glen-oak-white', 88, 34, 1, 6, 'casual', ''],
  [66, 'diamond-hawk-green', 90, 33, 1, 5, 'casual', ''],
  [59, 'deerwood-doe-fawn-white', 87, 34, 0, 6, 'league', ''],
  [52, 'harvest-hill-silver', 86, 33, 1, 6, 'casual', 'Irons finally showed up.'],
  [45, 'deerwood-buck-doe-white', 87, 33, 1, 7, 'league', ''],
  [38, 'hickory-stick-white', 86, 32, 1, 7, 'casual', ''],
  [31, 'deerwood-fawn-buck-white', 85, 33, 2, 7, 'league', 'Two OB with the driver on Fawn.'],
  [24, 'arrowhead-white', 87, 32, 1, 6, 'casual', ''],
  [17, 'deerwood-doe-white', 42, 16, 0, 4, 'practice', ''],
  [10, 'diamond-hawk-green', 86, 32, 2, 8, 'casual', ''],
  [1, 'deerwood-buck-doe-white', 83, 32, 1, 7, 'league', 'Season low. Putter was hot on Doe.'],
  [0, 'deerwood-fawn-white', 42, 16, 0, 4, 'practice', 'Monday nine.'],
];

function courseHoles(courseId, catalog) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  if (byId.has(courseId)) {
    const c = byId.get(courseId);
    const nine = /^deerwood-(buck|doe|fawn)-/.exec(courseId);
    return { tee: c.tee, holes: (c.holes || []).map((x) => ({ ...x, label: nine ? `${DW[nine[1]]} ${x.number}` : (x.label || String(x.number)) })) };
  }
  const m = /^deerwood-(buck|doe|fawn)-(buck|doe|fawn)-(\w+)$/.exec(courseId);
  if (!m) throw new Error(`sample: unknown course ${courseId}`);
  const front = byId.get(`deerwood-${m[1]}-${m[3]}`), back = byId.get(`deerwood-${m[2]}-${m[3]}`);
  let n = 1;
  const holes = [[m[1], front], [m[2], back]].flatMap(([nine, c]) => (c.holes || []).map((x) => ({ ...x, number: n++, label: `${DW[nine]} ${x.number}` })));
  return { tee: front.tee, holes };
}

function ironFor(yards) {
  return yards < 140 ? '9i' : yards < 155 ? '8i' : yards < 170 ? '7i' : yards < 185 ? '6i' : '5i';
}

/** One round's holes, hitting the spec's gross / putts / penalties / fairways exactly. */
function buildHoles(base, spec, rnd, GolfMath) {
  const [, , gross, puttsTarget, pens, firHit] = spec;
  const holes = base.map((x) => ({ ...x }));
  const par = holes.reduce((s, x) => s + x.par, 0);
  const score = holes.map((x) => x.par);
  const diff = holes.map((x, i) => (Number(x.hcp) || i + 1) + rnd() * 6); // lower = harder
  const order = holes.map((_, i) => i).sort((a, b) => diff[a] - diff[b]);
  let extra = gross - par;
  if (extra >= 6 && extra <= 14 && rnd() < 0.7) { // one birdie on an easy par 4/5, paid back elsewhere
    const easy = order.slice().reverse().find((i) => holes[i].par >= 4);
    score[easy] -= 1; extra += 1;
  }
  for (let pass = 0; extra > 0 && pass < 4; pass++) {
    for (const i of order) {
      if (extra <= 0) break;
      if (rnd() < (pass === 0 ? 0.25 : 0.4)) continue; // some holes stay pars; doubles land on the hard ones
      if (score[i] - holes[i].par >= 3) continue;
      score[i] += 1; extra -= 1;
    }
  }
  for (let i = 0; extra > 0; i = (i + 1) % holes.length) { score[order[i]] += 1; extra -= 1; }
  // putts: 1 on birdies, 2 elsewhere, then one-putts / three-putts to hit the target
  const putts = score.map((s, i) => (s < holes[i].par ? 1 : 2));
  let delta = puttsTarget - putts.reduce((s, x) => s + x, 0);
  // one-putts go to bogeys first (a chip-and-putt save keeps the green-in-regulation pars intact);
  // three-putts go to bogeys first too (on in regulation, then three putts — the classic way a GIR becomes a 5)
  const idx = holes.map((_, i) => i).sort(() => rnd() - 0.5);
  const over = (i) => score[i] - holes[i].par;
  const byOverDesc = idx.slice().sort((a, b) => over(b) - over(a));
  for (const i of byOverDesc) { if (delta >= 0) break; if (putts[i] === 2 && over(i) >= 0 && (over(i) >= 1 || rnd() < 0.4)) { putts[i] = 1; delta += 1; } }
  for (const i of idx) { if (delta >= 0) break; if (putts[i] === 2 && over(i) >= 0) { putts[i] = 1; delta += 1; } }
  for (const i of idx) { if (delta <= 0) break; if (putts[i] === 2 && over(i) === 1) { putts[i] = 3; delta -= 1; } }
  for (const i of idx) { if (delta <= 0) break; if (putts[i] === 2 && score[i] - 3 >= 1) { putts[i] = 3; delta -= 1; } }
  // fairways: the best-scoring par 4/5s were the ones in the short grass
  const fw = holes.map((_, i) => i).filter((i) => holes[i].par >= 4).sort((a, b) => (score[a] - holes[a].par) - (score[b] - holes[b].par) || rnd() - 0.5);
  const fairway = holes.map((x) => (x.par === 3 ? 'na' : ''));
  fw.forEach((i, k) => { fairway[i] = k < firHit ? 'hit' : (k % 3 === 0 ? 'left' : 'right'); });
  // penalties: on the worst missed fairways, mostly the driver
  const penHoles = fw.filter((i) => fairway[i] !== 'hit').sort((a, b) => (score[b] - holes[b].par) - (score[a] - holes[a].par)).slice(0, pens);
  return holes.map((x, i) => {
    const pen = penHoles.includes(i);
    const club = x.par === 3 ? ironFor(x.yards || 160) : (x.yards && x.yards < 330 && rnd() < 0.5 ? '3W' : 'Driver');
    const penClub = pen ? (rnd() < 0.8 ? 'Driver' : '3W') : '';
    return {
      number: x.number, label: x.label || String(x.number), par: x.par, yards: x.yards || 0, hcp: x.hcp ?? null,
      score: score[i], putts: putts[i], fairway: pen ? 'right' : fairway[i],
      gir: GolfMath ? GolfMath.derivedGir(score[i], putts[i], x.par) : score[i] - putts[i] <= x.par - 2,
      penalties: pen ? 1 : 0, penaltyClub: penClub, penaltyClubs: pen ? [penClub] : [],
      fringePutts: 0, firstPuttDistance: putts[i] === 1 ? 3 + Math.floor(rnd() * 8) : 12 + Math.floor(rnd() * 30), bunker: '',
      note: pen ? 'Tee shot right, re-teed' : '', teeClub: club, clubsHit: x.par === 3 ? [club, 'Putter'] : [club, ironFor(120 + Math.floor(rnd() * 70)), 'Putter'],
    };
  });
}

/**
 * Fairway Ledger state for `today` (YYYY-MM-DD). catalog = window.__golfCourseCatalog (the ledger's own
 * data/courses.js). libs = { GolfShapes, GolfMath } (vendored). Returns { state, backupMeta }.
 */
export function buildGolfSample(today, catalog, libs = {}) {
  const GS = libs.GolfShapes, GM = libs.GolfMath;
  const rounds = GOLF_SPECS.map((spec, k) => {
    const [ago, courseId, , , , , tag, note] = spec;
    const { tee, holes } = courseHoles(courseId, catalog);
    const rnd = mulberry32(1009 + k * 7919);
    const round = {
      id: `round-sample-${String(k + 1).padStart(2, '0')}`, date: addDays(today, -ago), courseId, tee: tee || 'White',
      wind: ['5', '10', '15', '10', 'calm'][k % 5], note, tag, entryMode: 'detailed',
      holes: buildHoles(holes, spec, rnd, GM), sampleSource: 'clubhouse',
    };
    return GS ? GS.makeRound(round) : round;
  });
  const state = {
    courses: JSON.parse(JSON.stringify(catalog)),
    rounds,
    profile: { bag: ['Driver', '3W', '5H', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'Putter'] },
  };
  const exported = parseYmd(addDays(today, -15));
  exported.setHours(20, 5, 0, 0);
  // the last backup predates the last three rounds, so the ledger's own "unbacked" count reads 3
  const backupMeta = { lastExportAt: exported.toISOString(), lastExportRoundCount: rounds.length - 3 };
  return { state, backupMeta };
}

/* ------------------------------------------------------------------ bourbon */

export const BOURBON_OWNED = { 'eagle-rare-10': 2, 'four-roses-single-barrel': 1, 'old-forester-1920': 1, 'russells-reserve-10': 1, 'woodford-double-oaked': 1, 'weller-antique-107': 1, 'rare-breed': 1 };
const TASTINGS = [
  // [bottleId, daysAgo, score, context, tags, note]
  ['eagle-rare-10', 0, 8.6, 'Neat pour', ['cherry', 'oak'], 'Monday reset.'],
  ['four-roses-single-barrel', 6, 9.0, 'Neat pour', ['cherry', 'spice'], 'Big finish. Buy another.'],
  ['old-forester-1920', 12, 8.2, 'Neat pour', ['chocolate'], ''],
  ['eagle-rare-10', 16, 8.4, 'Neat pour', [], ''],
  ['stagg', 18, 9.3, 'Neat pour', ['dark fruit', 'leather'], 'Last pour of the bottle.'],
  ['russells-reserve-10', 20, 8.1, 'Neat pour', ['vanilla'], ''],
  ['rare-breed', 23, 8.1, 'Neat pour', ['spice'], ''],
  ['woodford-double-oaked', 27, 7.9, 'Big cube', ['caramel'], 'Dessert bourbon.'],
  ['stagg', 30, 9.1, 'Neat pour', [], ''],
  ['four-roses-single-barrel', 33, 8.8, 'Neat pour', [], ''],
  ['weller-antique-107', 40, 8.7, 'Neat pour', ['wheat', 'honey'], 'Saving the rest for a good day.'],
  ['eagle-rare-10', 44, 8.3, 'Neat pour', [], ''],
  ['old-forester-1920', 47, 8.0, 'Neat pour', [], ''],
  ['stagg', 52, 9.4, 'Neat pour', [], 'Birthday pour.'],
  ['elijah-craig-barrel-proof', 55, 8.8, 'Neat pour', ['toffee'], ''],
  ['russells-reserve-10', 58, 8.3, 'Neat pour', [], ''],
  ['woodford-double-oaked', 64, 7.6, 'Old fashioned', [], ''],
  ['eagle-rare-10', 71, 8.5, 'Neat pour', [], ''],
  ['elijah-craig-barrel-proof', 78, 8.6, 'Neat pour', [], ''],
  ['four-roses-single-barrel', 88, 8.7, 'Neat pour', [], ''],
  ['weller-antique-107', 95, 8.9, 'Neat pour', [], 'Opened it.'],
];
const FLIGHT = { ago: 4, pours: [['A', 'four-roses-single-barrel', 'Four Roses Single Barrel'], ['B', 'old-forester-1920', 'Old Forester 1920'], ['C', 'russells-reserve-10', "Russell's Reserve 10 Year"]],
  scores: { A: { Joe: 9.1, Mike: 8.8, Dan: 9.0 }, B: { Joe: 8.3, Mike: 8.6, Dan: 8.2 }, C: { Joe: 8.6, Mike: 8.4, Dan: 8.7 } },
  guesses: { A: 'Four Roses', B: 'Eagle Rare', C: "Russell's" } };

const at = (day, h, m) => { const d = parseYmd(day); d.setHours(h, m, 0, 0); return d.toISOString(); };

/** Barrel Proof state (schema 12, every field Barrel Proof's own initialState has) + Clubhouse quick pours. */
export function buildBourbonSample(today) {
  const d = (n) => addDays(today, -n);
  const tastings = TASTINGS.map(([bottleId, ago, score, context, tags, note], k) => ({
    id: `taste-sample-${String(k + 1).padStart(2, '0')}`, bottleId, date: d(ago), score, context, blind: false, tags, note,
  }));
  for (const [glass, bottleId] of FLIGHT.pours) {
    tastings.push({ id: `taste-sample-night-${glass}`, bottleId, date: d(FLIGHT.ago), score: FLIGHT.scores[glass].Joe, context: 'Blind — Tasting Night', blind: true, tags: [], note: `Glass ${glass}, scored blind`, guess: FLIGHT.guesses[glass] });
  }
  tastings.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // Barrel Proof keeps newest first
  const statuses = {};
  const collection = {};
  for (const [id, count] of Object.entries(BOURBON_OWNED)) { statuses[id] = 'owned'; collection[id] = { count, batches: [], note: '' }; }
  statuses.stagg = 'finished';
  statuses['elijah-craig-barrel-proof'] = 'finished';
  statuses['michters-us1-bourbon'] = 'wishlist';
  const state = {
    schemaVersion: 12, activeBottleId: 'eagle-rare-10', storePrice: 0,
    statuses, tastings, huntLog: [], matchups: [], collection, prices: {}, club: { friends: [] },
    activeFlight: null,
    flights: [{
      id: 'flight-sample-1', createdAt: at(d(FLIGHT.ago), 20, 10), savedAt: at(d(FLIGHT.ago), 21, 40), status: 'revealed',
      pours: FLIGHT.pours.map(([glass, bottleId, bottleName]) => ({ glass, bottleId, bottleName })),
      tasters: ['Joe', 'Mike', 'Dan'], scores: FLIGHT.scores, guesses: FLIGHT.guesses,
    }],
    barcodeLinks: {},
    killLog: [
      { bottleId: 'elijah-craig-barrel-proof', date: d(50), rebuy: true, sample: true },
      { bottleId: 'stagg', date: d(15), rebuy: null, sample: true },
    ],
    identityLinks: {}, clubProfiles: { joe: { name: 'Joe', role: 'This device' } }, activeTastingGame: null, tastingGames: [],
    clubhouseSample: { v: 1, bottles: Object.keys(statuses) },
  };
  const pours = [
    { id: 'pour-sample-1', date: today, at: at(today, 19, 30), bottleId: 'rare-breed', bottleName: 'Wild Turkey Rare Breed', score: 8.0, note: 'After nine at Deerwood.', source: 'clubhouse' },
    { id: 'pour-sample-2', date: d(9), at: at(d(9), 18, 15), bottleId: null, bottleName: 'Buffalo Trace', score: 7.5, note: 'Clubhouse bar.', source: 'clubhouse' },
  ];
  return { state, pours };
}

/* ------------------------------------------------------------------ browser: status / load / remove */

const parse = (raw) => { try { return raw == null ? null : JSON.parse(raw); } catch { return undefined; } };
const isSampleRound = (r) => r && (r.sampleSource === 'clubhouse' || /^round-sample-/.test(String(r.id || '')));
const isSampleTasting = (t) => t && /^taste-sample-/.test(String(t.id || ''));

let catalogPromise = null;
function loadCourseCatalog() {
  if (Array.isArray(globalThis.__golfCourseCatalog)) return Promise.resolve(globalThis.__golfCourseCatalog);
  if (!catalogPromise) {
    catalogPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // the exact URL the service worker precaches, so this works offline too
      s.src = new URL('../apps/fairway-ledger/data/courses.js?v=2026-07-29b', import.meta.url).href;
      s.onload = () => (Array.isArray(globalThis.__golfCourseCatalog) ? resolve(globalThis.__golfCourseCatalog) : reject(new Error('course catalog missing')));
      s.onerror = () => { catalogPromise = null; reject(new Error('course catalog failed to load')); };
      document.head.appendChild(s);
    });
  }
  return catalogPromise;
}

/** What is on this phone right now, and what "Load sample data" would do. */
export async function status() {
  const fl = parse(readRaw(FL_KEY));
  const bp = parse(readRaw(BP_KEY));
  const marker = await store.setting(MARKER, null);
  const pours = await store.getAll('pours').catch(() => []);
  const flRounds = fl && Array.isArray(fl.rounds) ? fl.rounds : [];
  const bpTastings = bp && Array.isArray(bp.tastings) ? bp.tastings : [];
  const bpOwned = bp && bp.statuses ? Object.values(bp.statuses).filter((s) => s === 'owned').length : 0;
  return {
    marker,
    loaded: Boolean(marker),
    golf: { rounds: flRounds.length, sample: flRounds.filter(isSampleRound).length, empty: fl !== undefined && flRounds.length === 0 },
    bourbon: { tastings: bpTastings.length, sample: bpTastings.filter(isSampleTasting).length, empty: bp !== undefined && bpTastings.length === 0 && bpOwned === 0 && !(bp && (bp.killLog || []).length) },
    pours: { sample: pours.filter((p) => /^pour-sample-/.test(p.id)).length },
  };
}

/**
 * Seed the empty halves. Caller has already confirmed with Joe. Snapshot first (awaited); throws {code:'snapshot'}
 * if that fails and nothing is written. Returns { golf: n rounds | 0, bourbon: n tastings | 0, skipped: [] }.
 */
export async function load(snapshot) {
  const st = await status();
  const out = { golf: 0, bourbon: 0, pours: 0, skipped: [] };
  if (!st.golf.empty) out.skipped.push('golf');
  if (!st.bourbon.empty) out.skipped.push('bourbon');
  if (!st.golf.empty && !st.bourbon.empty) return out;
  try { await snapshot('before-sample'); } catch (err) { const e = new Error('snapshot failed'); e.code = 'snapshot'; e.cause = err; throw e; }
  const today = ymd(new Date());
  const marker = { at: new Date().toISOString(), golfCreated: false, metaCreated: false, bourbonCreated: false };
  if (st.golf.empty) {
    const [catalog] = await Promise.all([loadCourseCatalog(), import('./pillars/golf.js').then((g) => g.ensureLibs())]);
    const { state, backupMeta } = buildGolfSample(today, catalog, { GolfShapes: globalThis.GolfShapes, GolfMath: globalThis.GolfMath });
    const existing = parse(readRaw(FL_KEY));
    marker.golfCreated = !existing;
    // an opened-but-empty ledger keeps its own courses / profile / map notes; only rounds are added
    const next = existing && typeof existing === 'object' ? { ...existing, courses: Array.isArray(existing.courses) && existing.courses.length ? existing.courses : state.courses, rounds: state.rounds } : state;
    writeRaw(FL_KEY, JSON.stringify(next));
    if (readRaw(FL_META) == null) { writeRaw(FL_META, JSON.stringify(backupMeta)); marker.metaCreated = true; }
    out.golf = state.rounds.length;
  }
  if (st.bourbon.empty) {
    const { state, pours } = buildBourbonSample(today);
    const existing = parse(readRaw(BP_KEY));
    marker.bourbonCreated = !existing;
    const next = existing && typeof existing === 'object' ? { ...existing, ...state, clubProfiles: existing.clubProfiles || state.clubProfiles } : state;
    writeRaw(BP_KEY, JSON.stringify(next));
    await store.putMany('pours', pours);
    out.bourbon = state.tastings.length;
    out.pours = pours.length;
  }
  await store.setSetting(MARKER, marker);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('clubhouse:refresh'));
  return out;
}

/**
 * Take out only the sample rows. Snapshot first (awaited). If an app's key was created by the sample and nothing
 * of Joe's is left in it, the key is removed entirely (the app goes back to its own first-run state).
 */
export async function remove(snapshot) {
  const marker = (await store.setting(MARKER, null)) || {};
  try { await snapshot('before-sample-removal'); } catch (err) { const e = new Error('snapshot failed'); e.code = 'snapshot'; e.cause = err; throw e; }
  const out = { rounds: 0, tastings: 0, pours: 0, kept: { rounds: 0, tastings: 0 } };
  const fl = parse(readRaw(FL_KEY));
  if (fl && Array.isArray(fl.rounds)) {
    const keep = fl.rounds.filter((r) => !isSampleRound(r));
    out.rounds = fl.rounds.length - keep.length;
    out.kept.rounds = keep.length;
    if (out.rounds) {
      if (marker.golfCreated && !keep.length) {
        removeRaw(FL_KEY);
        if (marker.metaCreated) removeRaw(FL_META);
      } else {
        writeRaw(FL_KEY, JSON.stringify({ ...fl, rounds: keep }));
      }
    }
  }
  const bp = parse(readRaw(BP_KEY));
  if (bp && typeof bp === 'object') {
    const tastings = (bp.tastings || []).filter((t) => !isSampleTasting(t));
    out.tastings = (bp.tastings || []).length - tastings.length;
    out.kept.tastings = tastings.length;
    const killLog = (bp.killLog || []).filter((k) => !(k && k.sample === true));
    const flights = (bp.flights || []).filter((f) => !/^flight-sample-/.test(String(f && f.id)));
    const mine = new Set((bp.clubhouseSample && bp.clubhouseSample.bottles) || []);
    const statuses = { ...(bp.statuses || {}) };
    const collection = { ...(bp.collection || {}) };
    // a sample bottle Joe has since logged himself stays; untouched sample bottles go
    const used = new Set(tastings.map((t) => t.bottleId));
    for (const id of mine) if (!used.has(id)) { delete statuses[id]; delete collection[id]; }
    const nothingLeft = !tastings.length && !killLog.length && !flights.length && !Object.keys(statuses).length && !Object.keys(collection).length;
    if (out.tastings || bp.clubhouseSample) {
      if (marker.bourbonCreated && nothingLeft) removeRaw(BP_KEY);
      else {
        const next = { ...bp, tastings, killLog, flights, statuses, collection };
        delete next.clubhouseSample;
        writeRaw(BP_KEY, JSON.stringify(next));
      }
    }
  }
  const pours = (await store.getAll('pours').catch(() => [])).filter((p) => /^pour-sample-/.test(p.id));
  for (const p of pours) await store.del('pours', p.id);
  out.pours = pours.length;
  await store.setSetting(MARKER, null);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('clubhouse:refresh'));
  return out;
}

/* ------------------------------------------------------------------ Settings row (Settings → Developer) */

/**
 * The clearly-labelled dev toggle. `ui` = { h, icon, toast, confirm, snapshot } from the Settings screen;
 * `onChange` redraws Settings. Returns a `.card.list` section.
 */
export async function settingsRow({ h, icon, toast, confirm, snapshot, onChange }) {
  const st = await status();
  const on = st.loaded || st.golf.sample > 0 || st.bourbon.sample > 0;
  const small = on
    ? `On${st.marker && st.marker.at ? ` since ${monD(ymd(new Date(st.marker.at)))}` : ''} · ${st.golf.sample} sample rounds · ${st.bourbon.sample} tastings · ${st.pours.sample} quick pours. Tap to remove only the sample rows.`
    : 'Fills an empty Fairway Ledger and Barrel Proof with realistic rounds, bottles and pours so every screen has something to show. Never automatic; real data is never touched.';
  const busy = (el, v) => el.classList.toggle('busy', v);
  const run = async (e) => {
    const btn = e.currentTarget;
    if (on) {
      const ok = await confirm({
        title: 'Remove sample data?',
        sub: `${st.golf.sample} sample rounds, ${st.bourbon.sample} sample tastings and ${st.pours.sample} quick pours go. Anything you logged yourself stays.`,
        verb: 'Remove sample data', glyph: 'trash',
      });
      if (!ok) return;
      busy(btn, true);
      try {
        const r = await remove(snapshot);
        toast(`Sample data removed · ${r.rounds} rounds · ${r.tastings} tastings`, { icon: 'check' });
      } catch (err) {
        console.warn(err);
        toast(err.code === 'snapshot' ? 'Couldn’t snapshot — nothing changed.' : 'Couldn’t remove the sample. Your snapshot is in Backups.', { tone: 'warm' });
      }
      busy(btn, false);
      onChange && onChange();
      return;
    }
    if (!st.golf.empty && !st.bourbon.empty) {
      toast('Golf and Bourbon already hold real data — sample data only fills empty apps.', { tone: 'warm', icon: 'shield' });
      return;
    }
    const halves = [st.golf.empty ? 'Golf' : null, st.bourbon.empty ? 'Bourbon' : null].filter(Boolean).join(' and ');
    const ok = await confirm({
      title: 'Load sample data?',
      sub: `Fills ${halves} with 23 rounds, 10 bottles, a Tasting Night and 2 quick pours dated around today. ${!st.golf.empty ? 'Golf already has your rounds, so it is skipped. ' : ''}${!st.bourbon.empty ? 'Bourbon already has your data, so it is skipped. ' : ''}Remove it here anytime.`,
      verb: 'Load sample data', tone: 'volt', glyph: 'bolt',
    });
    if (!ok) return;
    busy(btn, true);
    try {
      const r = await load(snapshot);
      toast(`Sample data loaded · ${r.golf} rounds · ${r.bourbon} tastings`, { icon: 'bolt' });
    } catch (err) {
      console.warn(err);
      toast(err.code === 'snapshot' ? 'Couldn’t snapshot — nothing changed.' : 'Sample data didn’t load. Your snapshot is in Backups.', { tone: 'warm' });
    }
    busy(btn, false);
    onChange && onChange();
  };
  return h('section.card.list.rise', { 'aria-label': 'Developer tools' },
    h('button', { type: 'button', class: `li dev-sample${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', onclick: run },
      h('div', { class: `lg${on ? ' good' : ''}` }, icon('bolt')),
      h('div.t', 'Load sample data', h('small', small)),
      h('div.end', h('span.dev-tag', 'Dev'), h('span', { class: `check${on ? ' on' : ''}` }, icon('check'))),
    ),
  );
}
