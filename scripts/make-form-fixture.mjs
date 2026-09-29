#!/usr/bin/env node
// Synthetic Form export ("form-v2") for tests and browser checks — NEVER anyone's real data.
// Shape follows Form's ExportPayload (Form Training/v2/src/shared/api.ts): sessions with entries/sets, daily
// records with activities/cardio/guided mobility, a program, a profile. Real Form exercise ids (from
// data/form-catalog.json) so names, modes and groups resolve. Includes the awkward rows a real export has:
// warm-up sets, a bodyweight lift, an assisted machine, a timed hold, a unilateral row, an unfinished session, a
// Finish-screen cooldown child, a duplicate id and a row with a bad date.
//
//   node scripts/make-form-fixture.mjs [--today YYYY-MM-DD] [--out file.json] [--member "Name"]
//
// The plan is nine weeks back plus the current week up to `today`: 3,4,5,5,2 (a trip),4,5,5,5 sessions, then this
// week's sessions on Mon…today. Bench and squat climb (so PRs exist, the newest inside the last week), overhead
// press slides back (a mover that is down), golf and walks and a cardio block fill the activity log.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const dow = (s) => (parse(s).getDay() + 6) % 7;
const monday = (s) => addDays(s, -dow(s));

const PROGRAM = {
  id: 'prog-test-1', memberId: 'mem-test-0001', name: 'Push Pull Legs', kind: 'generated', active: true, version: 3,
  createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-07-01T12:00:00.000Z',
  spec: { split: 'ppl-ul', weekdays: [0, 1, 3, 4, 5], locations: ['gym'], days: [{ weekday: 0, label: 'Push', defaultLocation: 'gym', slots: [] }, { weekday: 1, label: 'Pull', defaultLocation: 'gym', slots: [] }, { weekday: 3, label: 'Legs', defaultLocation: 'gym', slots: [] }], targetRir: { 1: 3, 2: 2, 3: 2 }, easyRir: 4, exclusions: [], mobility: { routineId: 'full', rounds: 1, weekdays: [] }, changes: [] },
};

const set = (weight, reps, extra = {}) => ({ weight, reps, rightReps: null, rir: 2, ...extra });
const entry = (exerciseId, sets) => ({ exerciseId, sets, notes: '', discomfort: false });
const warm = (w) => set(w, 10, { warmup: true, rir: null });

/** weeks[i] = the count of sessions in week i (0 = oldest) */
const WEEKS = [3, 4, 5, 5, 2, 4, 5, 5, 5];
const SLOT_DOWS = { 2: [1, 4], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 3, 4, 5] };
const KIND_BY_DOW = { 0: 'push', 1: 'pull', 2: 'pull', 3: 'legs', 4: 'full', 5: 'mobility' };

export function makeFormExport({ today = '2026-09-27', member = 'Test Lifter' } = {}) {
  const wsNow = monday(today);
  const sessions = [];
  const days = [];
  let n = 0;
  const bench = [135, 135, 140, 140, 135, 140, 145, 150, 155, 160]; // the last value is this week's
  const squat = [165, 165, 175, 175, 165, 175, 185, 185, 195, 195];
  const ohp = [85, 90, 95, 95, 85, 90, 90, 85, 85, 80]; // slides back
  const dl = [205, 215, 225, 225, 205, 225, 235, 245, 245, 255];

  const build = (date, kind, wi) => {
    n++;
    const started = `${date}T17:00:00.000Z`;
    const mins = kind === 'mobility' ? 20 + (n % 8) : 40 + ((n * 7) % 25);
    const finished = new Date(Date.parse(started) + mins * 60000).toISOString();
    const base = { id: `ses-${date}-${kind}`, date, day: -1, phase: 1, entries: [], notes: '', recovery: 'good', version: 1, createdAt: started, status: 'done', startedAt: started, finishedAt: finished, location: 'gym', programId: PROGRAM.id };
    if (kind === 'push') {
      return { ...base, day: 0, entries: [
        entry('bar-bench', [warm(95), set(bench[wi], 5), set(bench[wi], 5), set(bench[wi], 5, { rir: 1 })]),
        entry('bar-overhead-press', [set(ohp[wi], 6), set(ohp[wi], 6), set(ohp[wi], 5)]),
        entry('db-seated-lateral-raise', [set(20, 12), set(20, 12), set(20, 10)]),
        entry('cable-triceps-pushdown', [set(50, 12), set(50, 12), set(55, 10)]),
        entry('pushup', [set(null, 15), set(null, 12)]),
      ] };
    }
    if (kind === 'pull') {
      return { ...base, day: 1, entries: [
        entry('bar-bent-over-row', [warm(75), set(115 + wi * 2.5, 8), set(115 + wi * 2.5, 8), set(115 + wi * 2.5, 7)]),
        entry('cable-lat-pulldown-wide', [set(110, 10), set(115, 9), set(115, 8)]),
        entry('row', [{ weight: 50, reps: 10, rightReps: 9, rir: 2 }, { weight: 50, reps: 10, rightReps: 10, rir: 2 }]),
        entry('bar-curl', [set(60, 10), set(60, 9)]),
        entry('machine-assisted-pullup', [set(60, 8), set(55, 8)]),
      ] };
    }
    if (kind === 'legs') {
      return { ...base, day: 2, entries: [
        entry('bar-squat', [warm(95), set(squat[wi], 5), set(squat[wi], 5), set(squat[wi], 5)]),
        entry('bar-deadlift', [set(dl[wi], 3), set(dl[wi], 3)]),
        entry('leg-press', [set(270, 12), set(290, 10), set(290, 10)]),
        entry('db-romanian-deadlift', [set(60, 10), set(60, 10)]),
        entry('plank', [set(null, 45), set(null, 40)]),
      ] };
    }
    if (kind === 'full') {
      return { ...base, entries: [
        entry('goblet', [set(45, 10), set(50, 10), set(50, 9)]),
        entry('db-bench', [set(55, 10), set(55, 9)]),
        entry('cable-seated-row', [set(100, 12), set(100, 11)]),
        entry('bar-hip-thrust', [set(185 + wi * 5, 10), set(185 + wi * 5, 10)]),
      ], workout: { id: 'wk-full-a', name: 'Full body A', tagline: 'Whole body, two hours of sleep', focus: ['full-body'], goals: [], level: 'intermediate', minutes: 45, intensity: 'moderate', format: 'straight', equipment: [], locations: ['gym'], blocks: [] }, source: { kind: 'curated', refId: 'wk-full-a' } };
    }
    // a guided mobility flow: blocks, no set rows
    return { ...base, entries: [], workout: { id: 'wk-golf-flow', name: 'Golf mobility flow', tagline: 'Hips and thoracic spine', focus: ['mobility'], goals: [], level: 'beginner', minutes: 20, intensity: 'easy', format: 'flow', equipment: [], locations: ['home'], blocks: [] }, blocks: [{ blockId: 'b1', kind: 'flow', durationSec: 1200, roundsCompleted: 1, extraReps: null, items: [], rpe: null, notes: '' }], source: { kind: 'curated', refId: 'wk-golf-flow' } };
  };

  const addDay = (date, extra) => {
    const existing = days.find((d) => d.date === date);
    if (existing) { Object.assign(existing, extra); return; }
    days.push({ id: `day-${date}`, date, recovery: '', sleepHours: 7.5, mobilityMinutes: null, mobilityNotes: '', foodNotes: '', proteinGrams: null, notes: '', version: 1, ...extra });
  };

  for (let i = 0; i < 9; i++) {
    const ws = addDays(wsNow, -7 * (9 - i));
    const count = WEEKS[i];
    for (const d of SLOT_DOWS[count]) {
      const date = addDays(ws, d);
      if (date > today) continue;
      sessions.push(build(date, KIND_BY_DOW[d], i));
    }
    // weekend golf, a brisk walk midweek, a bit of cardio, guided mobility on some Sundays
    if (i % 2 === 1) addDay(addDays(ws, 5), { activities: [{ id: `act-${ws}-g`, activityId: 'golf', variantId: 'walking-carrying', presetId: '18-walking', minutes: 240, at: `${addDays(ws, 5)}T18:00:00.000Z` }] });
    addDay(addDays(ws, 2), { activities: [{ id: `act-${ws}-w`, activityId: 'brisk-walk', variantId: 'brisk', minutes: 30, at: `${addDays(ws, 2)}T23:00:00.000Z` }] });
    if (i % 3 === 0) addDay(addDays(ws, 6), { cardio: [{ minutes: 25, kind: 'steady' }] });
    if (i % 2 === 0) addDay(addDays(ws, 6), { guidedMobility: [{ id: `gm-${ws}`, routineId: 'full', date: addDays(ws, 6), rounds: 1, results: [{ moveId: 'hip-flexor', side: 'both', round: 1, seconds: 60, practicedSeconds: 600, completed: true, skipped: false }], feeling: 'comfortable', notes: '' }] });
  }
  // this week: Mon.. today, first N slots of a five-day week
  const thisWeekDows = SLOT_DOWS[5].filter((d) => addDays(wsNow, d) <= today);
  for (const d of thisWeekDows) sessions.push(build(addDays(wsNow, d), KIND_BY_DOW[d], 9));
  if (dow(today) >= 2) addDay(addDays(wsNow, 2), { activities: [{ id: 'act-now-w', activityId: 'brisk-walk', variantId: 'brisk', minutes: 45, at: `${addDays(wsNow, 2)}T23:00:00.000Z` }] });
  if (dow(today) >= 5) addDay(addDays(wsNow, 5), { activities: [{ id: 'act-now-g', activityId: 'golf', variantId: 'riding-cart', presetId: '18-riding', minutes: 210, at: `${addDays(wsNow, 5)}T18:00:00.000Z` }] });

  // the awkward rows
  const anyDone = sessions[sessions.length - 1];
  sessions.push({ ...anyDone, id: 'ses-unfinished', date: today, status: 'active', finishedAt: undefined });
  sessions.push({ ...anyDone, id: 'ses-cooldown', date: anyDone.date, source: { kind: 'quick', parentSessionId: anyDone.id }, entries: [] });
  sessions.push({ ...sessions[0] }); // duplicate id
  sessions.push({ ...sessions[1], id: 'ses-bad-date', date: 'not-a-date' });

  return {
    format: 'form-v2',
    exportedAt: `${today}T15:30:00.000Z`,
    member: { id: 'mem-test-0001', email: null, displayName: member, householdId: 'hh-test-1' },
    profile: { age: 40, bodyweight: 190, sex: 'male', phase: 1, nextDay: 0, notes: '', version: 2, cardioTarget: 150, stepsTarget: 8000 },
    program: PROGRAM,
    sessions,
    days,
    reviews: [],
    follows: [],
    customWorkouts: [],
    healthSamples: [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const today = arg('today', ymd(new Date()));
  const out = arg('out', null);
  const json = JSON.stringify(makeFormExport({ today, member: arg('member', 'Test Lifter') }), null, 2);
  if (out) { writeFileSync(out, json); console.log(`wrote ${out} · today=${today}`); } else process.stdout.write(json);
}
