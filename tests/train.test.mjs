// Train lane: the Form export parser, e1RM / PR / streak / volume maths, the insight rules, the pillar summary
// and — against a small in-memory IndexedDB — the full backup round trip of the imported dataset.
// Fixture: tests/fixtures/form-v2.sample.json (synthetic, made by scripts/make-form-fixture.mjs --today 2026-09-27).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, installLocalStorage } from './helpers/fake-idb.mjs';
import * as store from '../js/store.js';
import * as backup from '../js/backup.js';
import * as data from '../js/train/data.js';
import { parseFormExport, detectForm, humanize, EMPTY_CATALOG } from '../js/train/form-import.js';
import * as model from '../js/train/model.js';
import { insights } from '../js/train/insights.js';
import * as train from '../js/pillars/train.js';
import { fileSource, liveSource, activeSource } from '../js/train/source.js';
import { makeCtx, addDays } from '../js/dates.js';

install();
installLocalStorage();

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, '..', 'data', 'form-catalog.json'), 'utf8'));
const fixture = () => JSON.parse(readFileSync(join(here, 'fixtures', 'form-v2.sample.json'), 'utf8'));
const NOW = new Date(2026, 8, 27, 20, 0, 0); // Sun Sep 27 2026, local
const ctxAt = (y, m, d, h = 12) => makeCtx(new Date(y, m, d, h, 0, 0));
const parsed = () => { const r = parseFormExport(fixture(), { catalog, now: NOW, fileName: 'form-test-2026-09-27.json' }); assert.equal(r.ok, true); return r; };

/** Tiny dataset builder for the maths: sessions of loaded sets. */
function ds(sessions, extra = {}) {
  return {
    v: 1, source: 'form-v2', asOf: '2026-09-27T15:30:00.000Z', asOfDate: '2026-09-27', member: { id: 'm', name: 'T' }, profile: {},
    activeMinutesByDay: {}, activityLog: [], mobilityByDay: {},
    sessions: sessions.map((s, i) => ({ id: `s${i}`, at: `${s.date}T10:00:00Z`, title: s.title || 'Push', focus: '', kind: 'strength', durationMin: 45, exercises: 1, setCount: (s.sets || []).length, volume: 0, groups: s.groups || { push: 0, pull: 0, legs: 0, core: 0 }, sets: [], ...s })),
    ...extra,
  };
}
const lift = (exerciseId, weight, reps, name = exerciseId) => ({ exercise: name, exerciseId, weight, reps, lift: true });

export const tests = {
  /* ------------------------------------------------------------ e1RM */
  'e1rm: Epley, rounded to a pound, only for loaded sets of 1-12 reps'() {
    assert.equal(model.e1rm(315, 3), 347);
    assert.equal(model.e1rm(315, 1), 315);
    assert.equal(model.e1rm(225, 5), 263);
    assert.equal(model.e1rm(100, 12), 140);
    assert.equal(model.e1rm(100, 13), null); // over 12 reps: never estimated
    assert.equal(model.e1rm(0, 5), null); // no load
    assert.equal(model.e1rm(null, 5), null);
    assert.equal(model.e1rm(100, 0), null);
    assert.equal(model.e1rm(52.5, 8), 67);
  },
  'setE1rm: an unmarked set (not a loaded movement) is never estimated'() {
    assert.equal(model.setE1rm({ weight: 200, reps: 5, lift: true }), 233);
    assert.equal(model.setE1rm({ weight: 200, reps: 5, lift: false }), null);
    assert.equal(model.setE1rm({ weight: 200, reps: 5 }), null);
  },

  /* ------------------------------------------------------------ parser */
  'parser: the fixture becomes a compact dataset with the counts Form would give'() {
    const { dataset, skipped } = parsed();
    assert.equal(dataset.source, 'form-v2');
    assert.equal(dataset.counts.sessions, 43);
    assert.deepEqual(skipped, { sessions: 2, days: 0 }); // the duplicate id + the bad date; the unfinished + cooldown rows are not "skipped", they simply do not count
    assert.equal(dataset.sessions.length, 43);
    assert.equal(dataset.asOfDate, '2026-09-27');
    assert.equal(dataset.fileName, 'form-test-2026-09-27.json');
    assert.deepEqual(dataset.member, { id: 'mem-test-0001', name: 'Test Lifter' });
    assert.deepEqual(dataset.profile, { cardioTarget: 150, stepsTarget: 8000 });
    assert.ok(!('email' in dataset.member));
    // ascending by date
    for (let i = 1; i < dataset.sessions.length; i++) assert.ok(dataset.sessions[i - 1].date <= dataset.sessions[i].date);
  },
  'parser: unfinished sessions and Finish-screen cooldowns count nowhere (Form session-count rule)'() {
    const { dataset } = parsed();
    assert.ok(!dataset.sessions.some((s) => s.id === 'ses-unfinished' || s.id === 'ses-cooldown'));
    const f = fixture();
    const before = f.sessions.filter((s) => s.status !== 'active' && !(s.source && s.source.parentSessionId)).length;
    assert.ok(before >= 43);
  },
  'parser: warm-ups dropped, unilateral takes the lower side, names come from the catalog'() {
    const { dataset } = parsed();
    const push = dataset.sessions.find((s) => s.date === '2026-09-21' && s.title === 'Push');
    const bench = push.sets.filter((x) => x.exerciseId === 'bar-bench');
    assert.equal(bench.length, 3); // 4 logged, 1 was a warm-up
    assert.ok(bench.every((x) => x.exercise === 'Barbell bench press' && x.lift === true && x.weight === 160));
    const pull = dataset.sessions.find((s) => s.date === '2026-09-22');
    const row = pull.sets.filter((x) => x.exerciseId === 'row');
    assert.deepEqual(row.map((x) => x.reps), [9, 10]); // 10L/9R -> 9 ; 10L/10R -> 10
    assert.equal(row[0].exercise, 'One-arm DB row');
  },
  'parser: bodyweight, timed, assisted and unknown movements are never marked liftable'() {
    const { dataset } = parsed();
    const all = dataset.sessions.flatMap((s) => s.sets);
    const pushup = all.find((x) => x.exerciseId === 'pushup');
    assert.equal(pushup.weight, null);
    assert.equal(pushup.lift, false);
    assert.ok(all.filter((x) => x.exerciseId === 'plank').every((x) => x.lift === false));
    assert.ok(all.filter((x) => x.exerciseId === 'machine-assisted-pullup').every((x) => x.lift === false)); // assistance is not load
    const r = parseFormExport({ format: 'form-v2', exportedAt: '2026-09-27T15:00:00Z', sessions: [{ id: 'a', date: '2026-09-27', status: 'done', entries: [{ exerciseId: 'brand-new-thing', sets: [{ weight: 50, reps: 8 }] }, { exerciseId: 'farmer-carry-thing', sets: [{ weight: 50, reps: 40 }] }] }] }, { catalog: EMPTY_CATALOG });
    const sets = r.dataset.sessions[0].sets;
    assert.equal(sets[0].exercise, 'Brand New Thing'); // humanized fallback
    assert.equal(sets[0].lift, true);
    assert.equal(sets[1].lift, false); // looks like a carry
  },
  'parser: titles come from the workout snapshot, then the program day, then the sets; kinds are classified'() {
    const { dataset } = parsed();
    const byDate = (d) => dataset.sessions.filter((s) => s.date === d);
    assert.equal(byDate('2026-09-21')[0].title, 'Push');
    assert.equal(byDate('2026-09-24')[0].title, 'Legs'); // program day 2 label
    assert.equal(byDate('2026-09-25')[0].title, 'Full body A'); // workout snapshot name
    const flow = byDate('2026-09-26')[0];
    assert.equal(flow.title, 'Golf mobility flow');
    assert.equal(flow.kind, 'mobility');
    assert.equal(flow.setCount, 0);
    assert.equal(byDate('2026-09-21')[0].kind, 'strength');
    assert.equal(byDate('2026-09-21')[0].focus, 'push');
  },
  'parser: minutes are measured, never estimated; active minutes add activities and cardio'() {
    const { dataset } = parsed();
    const s = dataset.sessions.find((x) => x.date === '2026-09-21');
    assert.ok(s.durationMin >= 40 && s.durationMin <= 65);
    const noTimes = parseFormExport({ format: 'form-v2', exportedAt: '2026-09-27T15:00:00Z', sessions: [{ id: 'z', date: '2026-09-26', status: 'done', entries: [] }] }, { catalog });
    assert.equal(noTimes.dataset.sessions[0].durationMin, null);
    assert.deepEqual(noTimes.dataset.activeMinutesByDay, {});
    // golf 210 min on Sat Sep 26 (riding) — that day also has the mobility session
    const sat = dataset.activeMinutesByDay['2026-09-26'];
    const flowMin = dataset.sessions.find((x) => x.date === '2026-09-26').durationMin;
    assert.equal(sat, 210 + flowMin);
    const golf = dataset.activityLog.find((a) => a.date === '2026-09-26');
    assert.deepEqual([golf.id, golf.name, golf.minutes], ['golf', 'Golf', 210]);
    assert.ok(dataset.activityLog.some((a) => a.id === 'cardio' && a.name === 'Cardio' && a.minutes === 25));
    assert.equal(dataset.mobilityByDay['2026-09-20'], 10); // 600 practiced seconds of guided mobility
  },
  'parser: tolerates missing fields, and rows it cannot use are counted, not invented'() {
    const min = parseFormExport({ format: 'form-v2', sessions: [] }, { catalog, now: NOW });
    assert.equal(min.ok, true);
    assert.equal(min.dataset.sessions.length, 0);
    assert.ok(min.dataset.asOf); // no exportedAt -> falls back
    const sparse = parseFormExport({ format: 'form-v2', exportedAt: '2026-09-27T15:00:00Z', member: {}, sessions: [{ date: '2026-09-27' }, { id: 'x', date: 'nope' }, null, { id: 'y', date: '2026-09-20', entries: [{ exerciseId: 'goblet' }, { sets: [{ reps: 5 }] }, { exerciseId: 'goblet', sets: [null, { reps: 8, weight: 45 }, { reps: null, weight: 45 }] }] }], days: [{ date: 'bad' }, { date: '2026-09-27', activities: [{ activityId: 'golf', minutes: -5 }, { activityId: 'golf', minutes: 'x' }, {}] }] }, { catalog });
    assert.equal(sparse.ok, true);
    assert.equal(sparse.dataset.sessions.length, 2); // the id-less one is kept (id synthesized), the bad-date one and null are dropped
    assert.equal(sparse.skipped.sessions, 2);
    assert.equal(sparse.skipped.days, 1);
    const y = sparse.dataset.sessions.find((s) => s.id === 'y');
    assert.equal(y.setCount, 1); // only { reps 8, weight 45 } is a logged set
    assert.deepEqual(sparse.dataset.activityLog, []);
  },
  'parser: rejects anything that is not a form-v2 export, with a friendly message'() {
    const bad = (obj, reason) => { const r = detectForm(obj); assert.equal(r.ok, false); assert.equal(r.reason, reason); assert.ok(r.message.length > 20); return r.message; };
    bad(null, 'not-object');
    bad([1, 2], 'not-object');
    bad('hello', 'not-object');
    assert.match(bad({ app: 'clubhouse', format: 1, idb: {} }, 'clubhouse'), /Clubhouse backup/);
    assert.match(bad({ courses: [], rounds: [] }, 'other-app'), /Fairway Ledger/);
    assert.match(bad({ app: 'barrel-proof', state: {} }, 'other-app'), /Barrel Proof/);
    assert.match(bad({ format: 'form-v3', sessions: [] }, 'newer'), /form-v3/);
    assert.match(bad({ format: 'something', sessions: [] }, 'not-form'), /Backup/);
    assert.match(bad({ format: 'form-v2' }, 'not-form'), /no sessions/);
    assert.equal(parseFormExport({ format: 'nope' }).ok, false);
    assert.equal(detectForm({ format: 'form-v2', sessions: [] }).ok, true);
  },
  'shortLift: the implement word goes, the number survives a tight slot'() {
    assert.equal(model.shortLift('Barbell hip thrust'), 'Hip thrust');
    assert.equal(model.shortLift('Barbell bench press'), 'Bench press');
    assert.equal(model.shortLift('Barbell bent-over row'), 'Bent-over row');
    assert.equal(model.shortLift('Dumbbell Romanian deadlift', 3), 'Romanian deadlift');
    assert.equal(model.shortLift('Goblet squat'), 'Goblet squat');
    assert.equal(model.shortLift(''), '');
  },
  'humanize: kebab ids read as words'() {
    assert.equal(humanize('bar-bench'), 'Bar Bench');
    assert.equal(humanize('goblet'), 'Goblet');
    assert.equal(humanize(''), 'Exercise');
    assert.equal(humanize('a__b'), 'A B');
  },

  /* ------------------------------------------------------------ PR maths */
  'PRs: strict improvement over an earlier logged best; the first appearance and a tie are not PRs'() {
    const d = ds([
      { date: '2026-09-01', sets: [lift('bench', 100, 5)] }, // first ever: not a PR
      { date: '2026-09-08', sets: [lift('bench', 100, 5)] }, // tie: not a PR
      { date: '2026-09-15', sets: [lift('bench', 105, 5)] }, // PR
      { date: '2026-09-22', sets: [lift('bench', 100, 5)] }, // lower: not a PR
    ]);
    const prs = model.findPRs(model.exerciseHistory(d.sessions));
    assert.equal(prs.length, 1);
    assert.deepEqual([prs[0].date, prs[0].weight, prs[0].reps, prs[0].e1rm, prs[0].previous.e1rm], ['2026-09-15', 105, 5, 123, 117]);
  },
  'PRs: sets over 12 reps, unloaded and unmarked sets never create an e1RM or a PR'() {
    const d = ds([
      { date: '2026-09-01', sets: [lift('curl', 30, 10)] },
      { date: '2026-09-08', sets: [lift('curl', 60, 13)] }, // 13 reps: not estimable
      { date: '2026-09-15', sets: [{ exercise: 'Pushup', exerciseId: 'pu', weight: null, reps: 30, lift: false }] },
      { date: '2026-09-22', sets: [{ exercise: 'Odd', exerciseId: 'odd', weight: 500, reps: 5 }] }, // no lift flag
    ]);
    const hist = model.exerciseHistory(d.sessions);
    assert.equal(model.findPRs(hist).length, 0);
    assert.equal(hist.get('curl').sessions[1].best, null);
    assert.equal(hist.get('pu').sessions[0].best, null);
    assert.equal(hist.get('odd').sessions[0].best, null);
  },
  'PRs: the best set of a session is the highest e1RM (ties -> the heavier set)'() {
    const d = ds([{ date: '2026-09-01', sets: [lift('sq', 200, 5), lift('sq', 225, 3), lift('sq', 180, 8)] }]);
    const best = model.exerciseHistory(d.sessions).get('sq').sessions[0].best;
    assert.deepEqual(best, { e1rm: 248, weight: 225, reps: 3 }); // 225x3 = 247.5 -> 248 beats 200x5 = 233
  },
  'movers: latest vs the earliest session in the six weeks before it; down moves are kept; stale lifts drop out'() {
    const d = ds([
      { date: '2026-08-10', sets: [lift('a', 100, 5), lift('b', 100, 5), lift('old', 100, 5)] },
      { date: '2026-09-07', sets: [lift('a', 110, 5), lift('b', 100, 5)] },
      { date: '2026-09-21', sets: [lift('a', 115, 5), lift('b', 90, 5)] },
      { date: '2026-05-01', sets: [lift('old', 100, 5)] },
      { date: '2026-05-08', sets: [lift('old', 120, 5)] },
    ]);
    const hist = model.exerciseHistory(d.sessions);
    const prs = model.findPRs(hist);
    const movers = model.findMovers(hist, prs, '2026-09-27');
    const a = movers.find((m) => m.exerciseId === 'a');
    assert.equal(a.from.date, '2026-08-10'); // 42 days before Sep 21 is Aug 10 (inclusive)
    assert.equal(a.delta, 134 - 117);
    assert.equal(a.isPR, true);
    const b = movers.find((m) => m.exerciseId === 'b');
    assert.equal(b.delta < 0, true);
    assert.equal(b.isPR, false);
    assert.ok(!movers.some((m) => m.exerciseId === 'old')); // last done in May: outside the 60-day recency window
  },

  /* ------------------------------------------------------------ streaks and weeks */
  'streak: the week in progress never breaks a streak; a qualifying anchor week extends it'() {
    const counts = { '2026-08-31': 5, '2026-09-07': 5, '2026-09-14': 5 };
    assert.equal(model.streakWeeks(counts, 5, '2026-09-21'), 3); // Sep 21 has 0 so far: streak = the three before
    assert.equal(model.streakWeeks({ ...counts, '2026-09-21': 5 }, 5, '2026-09-21'), 4); // this week already at goal
    assert.equal(model.streakWeeks({ ...counts, '2026-09-21': 4 }, 5, '2026-09-21'), 3);
    assert.equal(model.streakWeeks({ '2026-09-07': 5, '2026-09-14': 4 }, 5, '2026-09-21'), 0); // last week missed
    assert.equal(model.streakWeeks({}, 5, '2026-09-21'), 0);
    assert.equal(model.streakStart(counts, 5, '2026-09-21', 3), '2026-08-31');
    assert.equal(model.streakStart(counts, 5, '2026-09-21', 0), null);
  },
  'analyze: the fixture as of its export day'() {
    const f = model.analyze(parsed().dataset, makeCtx(NOW), 5);
    assert.equal(f.available, true);
    assert.equal(f.totalWorkouts, 43);
    assert.equal(f.weekCount, 5);
    assert.equal(f.prevWeekCount, 5);
    assert.equal(f.remaining, 0);
    assert.equal(f.streakWeeks, 4);
    assert.equal(f.streakSince, '2026-08-31');
    assert.equal(f.atRisk, false);
    assert.deepEqual(f.byDay, [true, true, false, true, true, true, false]);
    assert.equal(f.stale, false);
    assert.equal(f.staleDays, 0);
    assert.equal(f.last.title, 'Golf mobility flow');
    assert.equal(f.last.daysAgo, 1);
    assert.ok(f.prsThisWeek.length >= 3);
    assert.ok(f.prsThisWeek.some((p) => p.exerciseId === 'bar-bench' && p.weight === 160));
    assert.ok(f.movers.some((m) => m.exerciseId === 'bar-overhead-press' && m.delta < 0)); // the slide back is shown, not hidden
    assert.ok(f.volumeThisWeek > 30000);
    assert.ok(f.volumePrev4Avg > 30000);
    assert.equal(f.activeMinThisWeek > f.activeMinPrevWeek, true);
    assert.deepEqual(f.activitiesThisWeek.map((a) => a.name), ['Golf', 'Brisk walk']);
    assert.equal(f.mobilityThisWeek, 1); // the Sat flow session
    assert.equal(Object.keys(f.weeklyHistory).length, 26);
    assert.equal(f.weeklyHistory['2026-09-21'], 5);
    assert.equal(f.cardioTarget, 150);
    assert.equal(f.nextFocus, 'pull'); // 30 legs / 28 pull / 32 push sets in 14 days -> least is pull
  },
  'analyze: an old export is stale, and its streak is anchored to the export week (a missed re-export is not a broken streak)'() {
    const ctx = ctxAt(2026, 9, 2); // Fri Oct 2 - export is from Sun Sep 27
    const f = model.analyze(parsed().dataset, ctx, 5);
    assert.equal(f.staleDays, 5);
    assert.equal(f.stale, true);
    assert.equal(f.weekCount, 0); // nothing in the export for the week of Sep 28
    assert.equal(f.streakWeeks, 4); // anchored at Sep 21
    assert.equal(f.atRisk, false); // unknown, not "at risk"
    assert.equal(model.asOfText(f), 'as of Sep 27');
    assert.equal(model.ageText(f), '5 days ago');
  },
  'analyze: nothing imported -> zero-shaped facts, never a throw'() {
    const f = model.analyze(null, makeCtx(NOW), 5);
    assert.equal(f.available, false);
    assert.equal(f.totalWorkouts, 0);
    assert.equal(f.remaining, 5);
    assert.equal(model.analyze({ sessions: 'nope' }, makeCtx(NOW), 5).available, false);
    assert.equal(model.emptyFacts(3, new Error('boom')).error, 'Error: boom');
  },
  'analyze: volume compares with the average of prior lifting weeks (needs two), and week counts add up'() {
    const s = (date, w) => ({ date, sets: [lift('bench', w, 10)] });
    const d = ds([s('2026-09-21', 100), s('2026-09-14', 100), s('2026-09-07', 80), s('2026-09-28', 100)]);
    const f = model.analyze({ ...d, asOfDate: '2026-09-29' }, ctxAt(2026, 8, 29), 5);
    assert.equal(f.volumeThisWeek, 1000);
    assert.equal(f.volumePrev4Avg, Math.round((1000 + 1000 + 800) / 3));
    assert.equal(f.volumePrevWeeks, 3);
    const one = model.analyze({ ...ds([s('2026-09-21', 100), s('2026-09-28', 100)]), asOfDate: '2026-09-29' }, ctxAt(2026, 8, 29), 5);
    assert.equal(one.volumePrev4Avg, 0); // only one prior lifting week: no comparison
  },

  /* ------------------------------------------------------------ insights */
  'insights: goal hit + streak + a PR, each citing its numbers and the export date'() {
    const ctx = makeCtx(NOW);
    const t = model.analyze(parsed().dataset, ctx, 5);
    const list = insights({ facts: { train: t }, goals: { train: 5 }, ctx });
    const ids = list.map((i) => i.id);
    assert.ok(ids.includes('T2') && ids.includes('T4'));
    assert.ok(!ids.includes('T1b')); // T4 replaces it
    assert.ok(!ids.includes('T10') && !ids.includes('T0'));
    const t4 = list.find((i) => i.id === 'T4');
    assert.equal(t4.headline, '<strong>4 weeks straight</strong> at your goal.');
    assert.equal(t4.sub, '5 a week since Aug 31 · as of Sep 27');
    assert.equal(t4.kicker, 'Train · 4 weeks');
    assert.equal(t4.viz.type, 'dots7');
    const t2 = list.find((i) => i.id === 'T2');
    assert.match(t2.headline, /^New PR: <strong>Barbell [a-z -]+ \d+ × \d+<\/strong>\.$/i);
    assert.match(t2.sub, /^e1RM \d+ lb · previous \d+ on [A-Z][a-z]{2} \d+ · as of Sep 27$/);
    assert.equal(t2.viz.icon, 'up');
    for (const i of list) { assert.equal(i.pillar, 'train'); assert.ok(/as of Sep 27/.test(i.sub), `${i.id} cites the date`); }
    for (let k = 1; k < list.length; k++) assert.ok(list[k - 1].priority >= list[k].priority);
  },
  'insights: one more hits the goal (T1a), and the sessions are named with weekdays'() {
    const ctx = ctxAt(2026, 8, 30); // Wed Sep 30
    const base = parsed().dataset;
    const cut = { ...base, asOf: '2026-09-30T15:00:00.000Z', asOfDate: '2026-09-30', sessions: base.sessions.filter((s) => s.date <= '2026-09-24' && s.date >= '2026-09-21').concat([]) };
    // week of Sep 28 has nothing; pretend this week (Sep 28) has 4 sessions by shifting the last four sessions by 7 days
    const shifted = cut.sessions.map((s) => ({ ...s, date: addDays(s.date, 7), id: `${s.id}-n` }));
    const t = model.analyze({ ...base, asOf: '2026-09-30T15:00:00.000Z', asOfDate: '2026-09-30', sessions: [...base.sessions, ...shifted] }, ctx, 5);
    assert.equal(t.weekCount, 3);
    const two = insights({ facts: { train: t }, goals: { train: 5 }, ctx }).find((i) => i.id === 'T1c');
    assert.equal(two.headline, '3 of 5 — <strong>2 more</strong> with 4 days left.');
    assert.equal(two.sub, 'Push Mon · Pull Tue · Legs Thu · as of Sep 30');
    const one = insights({ facts: { train: { ...t, weekCount: 4, remaining: 1 } }, goals: { train: 5 }, ctx }).find((i) => i.id === 'T1a');
    assert.equal(one.headline, '4 workouts this week — <strong>one more hits your goal</strong>.');
    assert.equal(one.kicker, 'Train · 4 of 5');
  },
  'insights: an old export raises T10 and stays quiet about this week, the gap and the streak'() {
    const ctx = ctxAt(2026, 9, 3); // Sat Oct 3
    const t = model.analyze(parsed().dataset, ctx, 5);
    const list = insights({ facts: { train: t }, goals: { train: 5 }, ctx });
    const ids = list.map((i) => i.id);
    assert.ok(ids.includes('T10'));
    assert.deepEqual(ids.filter((x) => ['T1a', 'T1b', 'T1c', 'T3', 'T4', 'T5', 'T8', 'T9'].includes(x)), []);
    const t10 = list.find((i) => i.id === 'T10');
    assert.equal(t10.tone, 'warm');
    assert.equal(t10.headline, 'Your Form export is <span class="warn">6 days old</span>.');
    assert.match(t10.sub, /^as of Sep 27 · /);
  },
  'insights: nothing imported (T0), an empty export (T00), a long gap (T5), no legs (T6), golf without mobility (T8)'() {
    const ctx = makeCtx(NOW);
    const none = insights({ facts: { train: model.analyze(null, ctx, 5) }, goals: { train: 5 }, ctx });
    assert.deepEqual(none.map((i) => i.id), ['T0']);
    assert.match(none[0].headline, /Import your export/);
    const empty = insights({ facts: { train: model.analyze(ds([]), ctx, 5) }, goals: { train: 5 }, ctx });
    assert.deepEqual(empty.map((i) => i.id), ['T00']);

    const g = (sets) => ({ push: sets.push || 0, pull: sets.pull || 0, legs: sets.legs || 0, core: 0 });
    const c2 = ctxAt(2026, 8, 30); // Wed Sep 30 (dayIndex 2)
    const d = ds([
      { date: '2026-09-18', groups: g({ push: 9, pull: 3 }), sets: [lift('bench', 100, 5)] },
      { date: '2026-09-22', groups: g({ push: 5, pull: 5 }), sets: [lift('bench', 100, 5)] },
      { date: '2026-09-24', groups: g({ push: 4, pull: 4 }), sets: [lift('bench', 100, 5)] },
    ], { asOf: '2026-09-30T15:00:00.000Z', asOfDate: '2026-09-30' });
    const t = model.analyze(d, c2, 5);
    const list = insights({ facts: { train: t, golf: { weekRounds: [{}] } }, goals: { train: 5 }, ctx: c2 });
    const byId = Object.fromEntries(list.map((i) => [i.id, i]));
    assert.equal(byId.T5.headline, '<span class="warn">6 days</span> since your last workout. Mobility counts.'); // Sep 24 -> Sep 30
    assert.equal(byId.T6.headline, '3 sessions, <span class="warn">zero leg work</span> in two weeks.');
    assert.equal(byId.T6.sub, '30 push and pull sets · 0 for legs · as of Sep 30');
    assert.equal(byId.T8.headline, 'A round this week and <strong>no mobility yet</strong>.');
    assert.equal(byId.T8.href, '#log:mob');
  },
  'insights: a streak that cannot be saved is T3, wording per the SPEC'() {
    const ctx = ctxAt(2026, 9, 3); // Sat Oct 3: dayIndex 5, daysLeft 1
    const mk = (date) => ({ date, sets: [lift('bench', 100, 5)] });
    const sessions = [
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29',
    ].map(mk);
    const t = model.analyze(ds(sessions, { asOf: '2026-10-03T15:00:00.000Z', asOfDate: '2026-10-03' }), ctx, 5);
    assert.equal(t.streakWeeks, 3);
    assert.equal(t.atRisk, true);
    const t3 = insights({ facts: { train: t }, goals: { train: 5 }, ctx }).find((i) => i.id === 'T3');
    assert.equal(t3.headline, 'Your <span class="warn">3-week streak</span> needs 3 more by Sunday.');
    assert.equal(t3.sub, '2 of 5 so far · 1 day left · as of Oct 3');
    assert.equal(t3.tone, 'warm');
  },

  /* ------------------------------------------------------------ pillar */
  'pillar summary: empty until imported, then the ring; PR, stale and goal notes in precedence order'() {
    const ctx = makeCtx(NOW);
    const none = train.summary(model.analyze(null, ctx, 5), 5, ctx);
    assert.equal(none.empty.title, 'Import from Form');
    assert.equal(none.empty.cta.href, '#/train');
    assert.equal(none.ringValue, 0);
    assert.equal(none.sublabel, 'of 5 workouts');
    assert.equal(none.freshness, null);

    const t = model.analyze(parsed().dataset, ctx, 5);
    const s = train.summary(t, 5, ctx);
    assert.equal(s.ringValue, 5);
    assert.equal(s.over, 0);
    assert.equal(s.empty, null);
    assert.deepEqual(s.freshness, { asOf: t.asOf, stale: false });
    assert.equal(s.note.icon, 'bolt'); // a PR this week wins
    assert.match(s.note.text, /^PR: [A-Z][\w-]+( [\w-]+)? \d+$/); // 'PR: Hip thrust 307' — the implement word is dropped so the number survives the ring's 22 characters
    assert.ok(s.note.text.length <= 22);

    const noPR = { ...t, prsThisWeek: [] };
    assert.deepEqual(train.summary(noPR, 5, ctx).note, { text: 'Goal hit', tone: 'good', icon: 'check' });
    assert.deepEqual(train.summary({ ...noPR, weekCount: 7 }, 5, ctx).note, { text: '+2 over', tone: 'good', icon: 'check' });
    assert.deepEqual(train.summary({ ...noPR, weekCount: 4 }, 5, ctx).note, { text: 'One more hits it', tone: 'neutral' });
    const c3 = ctxAt(2026, 8, 29); // Tue: 5 days left
    assert.deepEqual(train.summary({ ...noPR, weekCount: 1 }, 5, c3).note, { text: '4 to go · 5 days', tone: 'neutral' });
    const stale = train.summary({ ...t, stale: true, staleDays: 4 }, 5, ctx);
    assert.deepEqual(stale.note, { text: 'Export 4d old', tone: 'warm', icon: 'clock' }); // honesty beats a PR
    assert.equal(stale.freshness.stale, true);
    const zero = train.summary({ ...t, totalWorkouts: 0, weekCount: 0 }, 5, ctx);
    assert.equal(zero.empty.title, 'No finished sessions yet');
  },
  'pillar: dayMarks, weekCount and the LOG-sheet hand-off'() {
    const ctx = makeCtx(NOW);
    const t = model.analyze(parsed().dataset, ctx, 5);
    assert.deepEqual(train.dayMarks(t, ctx), [true, true, false, true, true, true, false]);
    assert.equal(train.weekCount(t, '2026-09-14'), 5);
    assert.equal(train.weekCount(t, '2026-06-01'), 0);
    assert.deepEqual(train.dayMarks({}, ctx), [false, false, false, false, false, false, false]);
    const kinds = train.quickLog.kinds;
    assert.equal(kinds.length, 1);
    assert.equal(kinds[0].k, 'lift');
    assert.equal(kinds[0].mode, 'link');
    assert.equal(kinds[0].href, 'https://form.jjcurry027.workers.dev/');
    assert.equal(kinds[0].cta, 'Log in Form');
    assert.equal(kinds[0].sub(t), 'In Form · as of Sep 27');
    assert.equal(kinds[0].sub(null), 'In Form');
    assert.equal(train.meta.defaultGoal, 5);
  },
  'source: fileSource reads the stored dataset; the live source is disabled with an honest note'() {
    assert.equal(activeSource(), fileSource);
    assert.equal(fileSource.enabled, true);
    assert.equal(liveSource.enabled, false);
    assert.match(liveSource.note, /Later/);
    return liveSource.load().then(() => assert.fail('live must not load'), (e) => assert.equal(e.code, 'not-available'));
  },

  /* ------------------------------------------------------------ storage + backup round trip */
  async 'backup: the Train dataset is in every export and restores byte-for-byte (export -> wipe -> restore -> undo)'() {
    await store.open();
    for (const s of ['trainForm', 'workouts', 'settings', 'snapshots']) await store.clear(s);
    const original = parsed().dataset;
    await data.saveDataset(original);
    await store.put('workouts', { id: 'wk-legacy', date: '2026-09-01' });
    assert.deepEqual(await data.loadDataset(), original);
    assert.equal((await data.loadMeta()).sessions, 43);

    const payload = await backup.buildPayload(new Date('2026-09-28T16:00:00Z'));
    assert.deepEqual(Object.keys(payload.idb), store.DATA_STORES);
    assert.ok(Object.keys(payload.idb).includes('trainForm'));
    assert.equal(payload.idb.trainForm.length, 1);
    assert.equal(payload.idb.trainForm[0].key, 'dataset');
    assert.equal(payload.counts.trainSessions, 43);
    assert.equal(payload.counts.workouts, 44); // 1 legacy row + 43 Form sessions: "workouts" everywhere
    assert.equal(backup.trainSessions(payload.idb.trainForm), 43);

    const file = JSON.parse(JSON.stringify(payload)); // through a real file
    assert.equal(backup.validate(file), null);
    assert.equal(backup.detect(file), 'clubhouse');
    assert.equal(backup.fileCounts(file).workouts, 44);
    assert.equal(backup.fileCounts(file).trainForm, undefined);
    assert.equal(backup.previewRows({ workouts: 0 }, backup.fileCounts(file))[0].file, 44);

    // wipe, then the everyday path: restore the file (snapshot first)
    await store.replaceAll('trainForm', []);
    assert.equal(await data.loadDataset(), null);
    assert.equal((await backup.nowCounts()).workouts, 1);
    const res = await backup.restore(file, 'before-import');
    assert.deepEqual(await data.loadDataset(), original);
    assert.equal((await backup.nowCounts()).workouts, 44);
    const snaps = await backup.listSnapshots();
    assert.equal(snaps[0].label, 'before-import');
    assert.equal(snaps[0].counts.trainSessions, 0); // the snapshot holds what was there BEFORE the restore
    assert.equal(snaps[0].id, res.snap.id);

    // Undo = restore that snapshot (itself snapshotted first) -> the wiped state comes back
    await backup.restoreSnapshot(res.snap.id, 'before-undo');
    assert.equal(await data.loadDataset(), null);
    assert.equal((await backup.listSnapshots())[0].label, 'before-undo');
    // ...and the undo's own snapshot brings the dataset back again
    await backup.restoreSnapshot((await backup.listSnapshots())[0].id, 'before-redo');
    assert.deepEqual(await data.loadDataset(), original);
  },
  async 'backup: a Clubhouse file from before Train (no trainForm) leaves the imported dataset alone; malformed Form data is refused'() {
    await store.open();
    await data.saveDataset(parsed().dataset);
    const payload = JSON.parse(JSON.stringify(await backup.buildPayload(new Date('2026-09-28T16:00:00Z'))));
    delete payload.idb.trainForm;
    assert.equal(backup.validate(payload), null);
    assert.equal(backup.fileCounts(payload).workouts, 1);
    await backup.restore(payload, 'before-import');
    assert.equal((await data.loadDataset()).sessions.length, 43);

    const bad = JSON.parse(JSON.stringify(await backup.buildPayload(new Date('2026-09-28T16:00:00Z'))));
    bad.idb.trainForm[0].sessions = 'nope';
    assert.match(backup.validate(bad), /Form data is malformed/);
    bad.idb.trainForm = [{ sessions: [] }]; // a row without its key
    assert.match(backup.validate(bad), /without key/);
    const before = await data.loadDataset();
    await assert.rejects(() => backup.restore(bad, 'before-import'), (e) => e.code === 'invalid');
    assert.deepEqual(await data.loadDataset(), before); // refused: nothing changed
  },
  async 'backup: the nudge counts Form sessions the same way in facts and in the export, so a fresh backup is not immediately "due"'() {
    const t = model.analyze(parsed().dataset, makeCtx(NOW), 5);
    const payload = await backup.buildPayload(new Date('2026-09-28T16:00:00Z'));
    const now = new Date('2026-09-28T17:00:00Z');
    const settings = { lastExportAt: '2026-09-28T16:00:00.000Z', lastExportCounts: { workouts: payload.counts.workouts - 1, rounds: 0, tastings: 0, pours: 0, watched: 0 } }; // -1: the legacy row from the previous test
    const n = backup.needsNudge({ train: { totalWorkouts: t.totalWorkouts } }, settings, now);
    assert.equal(n.newRecords, 0);
    assert.equal(n.due, false);
  },
  async 'store: trainForm is a real object store (schema v2) and clear() empties only it'() {
    assert.equal(store.DB_VERSION, 2);
    assert.equal(store.SCHEMA.trainForm.keyPath, 'key');
    assert.ok(store.STORE_NAMES.includes('trainForm'));
    assert.ok(store.DATA_STORES.includes('trainForm'));
    await store.open();
    await data.saveDataset(parsed().dataset);
    await store.put('pours', { id: 'pour-x', date: '2026-09-01' });
    await store.clear('trainForm');
    assert.equal(await store.count('trainForm'), 0);
    assert.equal(await store.count('pours') >= 1, true);
    await store.del('pours', 'pour-x');
  },
};
