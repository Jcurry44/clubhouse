// Home lane — coach.js (collection, §6.2 selection, novelty, system rules X1–X3, streak chips), recap.js (§6.6),
// pillars/home.js (greeting, week strip, day items, first-run setup card) and the vendored-app deep-link helper.
// Real pillar facts come from the same fixtures the pillar suites use (Mon Sep 28 2026).
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as coach from '../js/coach.js';
import * as recap from '../js/recap.js';
import * as home from '../js/pillars/home.js';
import * as golf from '../js/pillars/golf.js';
import * as bourbon from '../js/pillars/bourbon.js';
import * as sports from '../js/pillars/sports.js';
import * as train from '../js/pillars/train.js';
import { analyze, emptyFacts } from '../js/train/model.js';
import { parseFormExport } from '../js/train/form-import.js';
import { makeCtx, addDays } from '../js/dates.js';
import { libs, readFixtures } from './helpers/golf-bourbon.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const read = (...p) => JSON.parse(readFileSync(join(APP, ...p), 'utf8'));
const FEED = read('tests', 'fixtures', 'sports.sample.json');
const CATALOG = read('data', 'form-catalog.json');
const FORM = read('tests', 'fixtures', 'form-v2.sample.json');
const GOALS = { golf: 2, train: 5, bourbon: 3, sports: 3 };
const BY_ID = { golf, train, bourbon, sports };
const ctx = makeCtx(new Date(2026, 8, 28, 18, 0)); // Monday Sep 28 2026, 6 pm (local)
const clone = (x) => JSON.parse(JSON.stringify(x));

function fullFacts(c = ctx) {
  const { fl, bp } = readFixtures();
  const parsed = parseFormExport(clone(FORM), { catalog: CATALOG, now: c.now });
  assert.equal(parsed.ok, true);
  return {
    golf: golf.computeFacts(fl, { lastExportAt: '2026-09-13T20:05:00.000Z', lastExportRoundCount: 20 }, c, libs),
    train: analyze(parsed.dataset, c, GOALS.train),
    bourbon: bourbon.computeFacts(bp.state, bp.clubhousePours, c, { nameOf: (id) => bourbon.humanize(id), metaOf: () => null }),
    sports: sports.buildFacts({ feed: clone(FEED), ctx: c }),
  };
}
function emptyAll(c = ctx) {
  return { golf: golf.zero(), train: emptyFacts(5), bourbon: bourbon.zero(), sports: sports.buildFacts({ feed: null, ctx: c }) };
}
const ins = (id, pillar, priority, extra = {}) => ({ id, pillar, priority, tone: 'neutral', kicker: `${pillar} · x`, headline: `${id} says <strong>${priority}</strong>`, sub: '', viz: null, href: '#/', actions: null, ...extra });

/** Synthetic pillars for recap maths: facts[id].weeks = { weekStart: count }. */
const fakePillars = Object.fromEntries(['golf', 'train', 'bourbon', 'sports'].map((id) => [id, { weekCount: (f, ws) => (f.weeks && f.weeks[ws]) || 0 }]));

export const tests = {
  /* ---------------------------------------------------------------- coach: collection + selection */
  'coach.collect: real facts → insights from every pillar, each citing numbers and linking somewhere'() {
    const F = { facts: fullFacts(), goals: GOALS, ctx, nudge: null };
    const all = coach.collect(F);
    const pillars = new Set(all.map((i) => i.pillar));
    for (const p of ['golf', 'train', 'bourbon', 'sports']) assert.ok(pillars.has(p), `no ${p} insight`);
    for (const i of all) {
      assert.ok(i.id && i.kicker && i.headline, `incomplete ${i.id}`);
      assert.ok(i.href || (i.actions && i.actions.length), `${i.id} goes nowhere`);
      assert.ok(Number.isFinite(i.priority));
    }
    // Train insights carry the export date
    for (const i of all.filter((x) => x.pillar === 'train')) assert.match(i.sub, /as of [A-Z][a-z]{2} \d+/, i.id);
  },

  'coach.select (Home): ≤ 4 cards, ≤ 2 per pillar, screen-only rules dropped, deterministic'() {
    const F = { facts: fullFacts(), goals: GOALS, ctx, nudge: null };
    const a = coach.select(coach.collect(F), { today: ctx.today, seen: {} });
    const b = coach.select(coach.collect(F), { today: ctx.today, seen: {} });
    assert.ok(a.length <= 4 && a.length >= 3);
    assert.deepEqual(a.map((i) => i.id), b.map((i) => i.id));
    const per = {};
    for (const i of a) { per[i.pillar] = (per[i.pillar] || 0) + 1; assert.ok(!i.screenOnly, `${i.id} is screen-only`); }
    for (const n of Object.values(per)) assert.ok(n <= 2);
    assert.ok(!a.some((i) => i.id === 'S1' || i.id === 'S5'));
  },

  'coach.select: X1 always first when due; system rules do not use a pillar slot'() {
    const list = [ins('G1', 'golf', 80), ins('G2', 'golf', 85), ins('G3', 'golf', 70), ins('T2', 'train', 90), ins('X1', 'system', 10), ins('X3', 'system', 50)];
    const out = coach.select(list, { limit: 4 });
    assert.equal(out[0].id, 'X1');
    assert.equal(out.length, 4);
    assert.ok(out.filter((i) => i.pillar === 'golf').length <= 2);
  },

  'coach.select: a second card from one pillar pays the balance penalty (mock: golf, train, bourbon)'() {
    const list = [ins('G2', 'golf', 85), ins('G1', 'golf', 80), ins('T1a', 'train', 75), ins('B1', 'bourbon', 60), ins('S4', 'sports', 45)];
    const out = coach.select(list, { limit: 4 });
    assert.deepEqual(out.map((i) => i.id), ['G2', 'T1a', 'G1', 'B1']); // G1 80−15 = 65 still beats B1 60
    const out2 = coach.select([ins('G2', 'golf', 85), ins('G1', 'golf', 70), ins('T1a', 'train', 75), ins('B1', 'bourbon', 60), ins('S4', 'sports', 45)], { limit: 3 });
    assert.deepEqual(out2.map((i) => i.id), ['G2', 'T1a', 'B1']); // G1 70−15 = 55 < B1 60
  },

  'coach.select: one card per family — G1 (scoring) and G3 (handicap) never stack on Home'() {
    const out = coach.select([ins('G1', 'golf', 80, { family: 'golf-trend' }), ins('G3', 'golf', 70, { family: 'golf-trend' }), ins('G5', 'golf', 50), ins('T1a', 'train', 60)], { limit: 4 });
    assert.deepEqual(out.map((i) => i.id), ['G1', 'T1a', 'G5']);
  },
  'coach.select: hidden ids (folded into the setup card) and screenOnly never reach Home'() {
    const out = coach.select([ins('G0', 'golf', 100), ins('S1', 'sports', 70, { screenOnly: true }), ins('S4', 'sports', 45)], { hidden: ['G0'] });
    assert.deepEqual(out.map((i) => i.id), ['S4']);
  },

  'novelty: unseen +6, 1–2 days 0, 3–6 days −10, ≥ 7 days −20; evergreen and action cards untouched'() {
    const i = ins('G1', 'golf', 80);
    const sig = coach.signature(i);
    assert.equal(sig, 'G1|G1 says 80');
    assert.equal(coach.novelty(i, {}, ctx.today).bonus, 6);
    assert.equal(coach.novelty(i, { [sig]: addDays(ctx.today, -1) }, ctx.today).bonus, 0);
    assert.equal(coach.novelty(i, { [sig]: addDays(ctx.today, -4) }, ctx.today).bonus, -10);
    assert.equal(coach.novelty(i, { [sig]: addDays(ctx.today, -9) }, ctx.today).bonus, -20);
    assert.equal(coach.novelty(ins('X1', 'system', 95), {}, ctx.today).bonus, 0);
    assert.equal(coach.novelty(ins('G0', 'golf', 100), { 'G0|G0 says 100': '2026-01-01' }, ctx.today).bonus, 0);
    assert.equal(coach.novelty(ins('S2', 'sports', 65, { actions: [{ label: 'Watched it' }] }), {}, ctx.today).bonus, 0);
  },

  'novelty: "New" tag only once Coach has history from before today; a stale card drops below a fresh one'() {
    const a = ins('G1', 'golf', 80), b = ins('B2', 'bourbon', 72);
    assert.equal(coach.novelty(a, {}, ctx.today).fresh, false);
    const seen = { [coach.signature(a)]: addDays(ctx.today, -8) };
    assert.equal(coach.novelty(b, seen, ctx.today).fresh, true);
    const out = coach.select([a, b], { seen, today: ctx.today, limit: 2 });
    assert.deepEqual(out.map((i) => i.id), ['B2', 'G1']); // 72+6 = 78 > 80−20 = 60
    assert.equal(out[0].fresh, true);
  },

  'coach.remember: stamps new signatures, keeps first-seen dates, prunes > 45 days'() {
    const a = ins('G1', 'golf', 80), b = ins('T2', 'train', 90);
    const seen = { [coach.signature(a)]: addDays(ctx.today, -3), 'OLD|x': addDays(ctx.today, -60) };
    const { map, changed } = coach.remember(seen, [a, b], ctx.today);
    assert.equal(changed, true);
    assert.equal(map[coach.signature(a)], addDays(ctx.today, -3));
    assert.equal(map[coach.signature(b)], ctx.today);
    assert.equal(map['OLD|x'], undefined);
    assert.equal(coach.remember(map, [a, b], ctx.today).changed, false);
  },

  'X1 backup nudge: exact wording for never / age / volume, with Back up now + Later'() {
    const rule = coach.systemRules[0];
    const never = rule({ nudge: { due: true, reason: 'age', days: null, newRecords: 5 } });
    assert.equal(never.kicker, 'Backup · Never');
    assert.equal(never.headline, 'Back up Clubhouse — <span class="warn">no backup yet</span>.');
    const age = rule({ nudge: { due: true, reason: 'age', days: 9, newRecords: 0 } });
    assert.equal(age.headline, 'Back up Clubhouse — <span class="warn">9 days</span> since the last one.');
    const vol = rule({ nudge: { due: true, reason: 'volume', days: 2, newRecords: 4 } });
    assert.equal(vol.kicker, 'Backup · 4 new');
    assert.equal(vol.headline, '<span class="warn">4 new records</span> since your last backup.');
    assert.deepEqual(vol.actions.map((a) => a.run), ['backup.export', 'backup.snooze']);
    assert.equal(rule({ nudge: { due: false } }), null);
  },

  'X2 recap card: fires only when due, cites the recap line, taps to the recap'() {
    const rule = coach.systemRules[1];
    assert.equal(rule({ recap: { due: false } }), null);
    const x = rule({ recap: { due: true, weekNo: 39, headline: 'Solid week.', line: 'Five workouts and two rounds.' } });
    assert.equal(x.kicker, 'Recap · Week 39');
    assert.equal(x.headline, 'Solid week.');
    assert.equal(x.sub, 'Five workouts and two rounds.');
    assert.equal(x.tap, 'recap');
  },

  'X3 full house: three pillars yesterday → "a round, a workout and a pour"; two → silent'() {
    const rule = coach.systemRules[2];
    const x = rule({ yesterday: { pillars: ['bourbon', 'golf', 'train'] } });
    assert.equal(x.headline, '<strong>3 pillars</strong> in one day: a round, a workout and a pour.');
    assert.equal(x.kicker, 'Yesterday · Full house');
    assert.equal(rule({ yesterday: { pillars: ['golf', 'train'] } }), null);
  },

  'streak chips: SPEC order, singular/plural, hidden at 0; the header pill skips the Bills chip'() {
    const F = { facts: { train: { streakWeeks: 6 }, golf: { roundWeeks: 1 }, sports: { billsWatchedStreak: 3 }, bourbon: { pourWeeks: 0 } } };
    const chips = coach.streaks(F);
    assert.deepEqual(chips.map((c) => c.id), ['train', 'golf', 'sports']);
    assert.equal(chips[0].label, 'wks at training goal');
    assert.equal(chips[1].label, 'wk with a round');
    assert.equal(chips[2].label, 'Bills games watched');
    assert.equal(chips[2].tone, 'warm');
    assert.equal(coach.headlineStreak(chips).id, 'train');
    assert.equal(coach.headlineStreak(coach.streaks({ facts: { sports: { billsWatchedStreak: 4 } } })), null);
    assert.equal(coach.headlineStreak(coach.streaks({ facts: { golf: { roundWeeks: 12 } } })).id, 'golf');
  },

  /* ---------------------------------------------------------------- recap (§6.6) */
  'recap week: Sunday from 5 pm recaps the week ending; otherwise last week'() {
    const sun4 = makeCtx(new Date(2026, 9, 4, 16, 59)), sun5 = makeCtx(new Date(2026, 9, 4, 17, 0)), mon = makeCtx(new Date(2026, 9, 5, 9, 0));
    assert.equal(recap.recapWeek(sun4), '2026-09-21');
    assert.equal(recap.recapWeek(sun5), '2026-09-28');
    assert.equal(recap.recapWeek(mon), '2026-09-28');
    assert.equal(recap.rangeText('2026-09-21'), 'Sep 21 – 27');
    assert.equal(recap.rangeText('2026-08-31'), 'Aug 31 – Sep 6');
  },

  'recap line: numbers spelled out, serial comma, season low named (the mock sentence)'() {
    const ws = ctx.prevWeekStart; // Sep 21
    const facts = {
      golf: { weeks: { [ws]: 2 }, seasonLow: { score: 83, short: 'Deerwood North', courseName: 'Deerwood North', date: addDays(ws, 6) } },
      train: { weeks: { [ws]: 5 }, available: true, asOfDate: ctx.today },
      bourbon: { weeks: { [ws]: 2 }, tastings: [{ date: addDays(ws, 2), note: 'cherry' }, { date: addDays(ws, 3), note: '' }] },
      sports: { weeks: { [ws]: 3 } },
    };
    const r = recap.build({ facts, goals: GOALS, ctx }, fakePillars);
    assert.equal(r.line, 'Five workouts, two rounds, and the Deerwood North 83.');
    assert.equal(r.label, 'Last week');
    assert.equal(r.range, 'Sep 21 – 27');
    const st = Object.fromEntries(r.stats.map((s) => [s.id, s]));
    assert.equal(st.golf.cmp.text, '+2 rd');
    assert.equal(st.golf.cmp.good, true);
    assert.equal(st.bourbon.cmp.text, '1 note');
    assert.equal(st.train.w, '100%');
    assert.equal(st.bourbon.g, null);
    assert.equal(st.sports.cmp.text, 'no finals yet'); // fake pillar has no weekResults
    assert.equal(recap.joinLine(['a', 'b']), 'a and b');
    assert.equal(recap.spell(9), 'nine');
    assert.equal(recap.spell(10), '10');
  },

  'recap headline: tiers by weekly score; "best since {month}" needs history and a week worth it'() {
    const ws = ctx.prevWeekStart;
    const weeks = (n, lastWeek) => {
      const w = {};
      for (let i = 1; i <= 26; i++) w[addDays(ws, -7 * i)] = n;
      w[ws] = lastWeek;
      return w;
    };
    const F = (g, t) => ({ facts: { golf: { weeks: g }, train: { weeks: t, available: true, asOfDate: ctx.today }, bourbon: {}, sports: {} }, goals: GOALS, ctx });
    // 26 weeks of 1 round + 2 workouts, then 2 rounds + 5 workouts: best in the whole window
    const best = recap.build(F(weeks(1, 2), weeks(2, 5)), fakePillars);
    assert.equal(best.headline, 'Your best week since the spring.');
    assert.equal(best.best, true);
    // same, but a week in June (≥ 5 back) was as good → "since June"
    const g = weeks(1, 2), t = weeks(2, 5);
    const june = addDays(ws, -7 * 13); // Jun 22
    g[june] = 2; t[june] = 5;
    assert.equal(recap.build(F(g, t), fakePillars).headline, 'Your best week since June.');
    // a recent equal week (< 5 back) → just the tier
    const g2 = weeks(1, 2), t2 = weeks(2, 5);
    g2[addDays(ws, -14)] = 2; t2[addDays(ws, -14)] = 5;
    assert.equal(recap.build(F(g2, t2), fakePillars).headline, 'Solid week.');
    // no history → tiers only
    assert.equal(recap.build(F({ [ws]: 2 }, { [ws]: 5 }), fakePillars).headline, 'Solid week.');
    assert.equal(recap.build(F({ [ws]: 1 }, {}), fakePillars).headline, 'Quiet week.');
    assert.equal(recap.build(F({ [ws]: 2 }, { [ws]: 3 }), fakePillars).headline, 'Light week.');
  },

  'recap Train cell: an export from before the week ended says "as of", not a fake delta'() {
    const ws = ctx.prevWeekStart;
    const facts = { golf: {}, train: { weeks: { [ws]: 2 }, available: true, asOfDate: addDays(ws, 3) }, bourbon: {}, sports: {} };
    const r = recap.build({ facts, goals: GOALS, ctx }, fakePillars);
    const t = r.stats.find((s) => s.id === 'train');
    assert.equal(t.cmp.text, 'as of Sep 24');
    assert.equal(t.cmp.icon, 'clock');
    const none = recap.build({ facts: { golf: {}, train: { available: false }, bourbon: {}, sports: {} }, goals: GOALS, ctx }, fakePillars);
    assert.equal(none.stats.find((s) => s.id === 'train').cmp.text, 'no Form');
  },

  'recap with real facts: Games cell reads W · L from the watched finals; hasHistory false on an empty install'() {
    const f = fullFacts();
    const r = recap.build({ facts: f, goals: GOALS, ctx }, BY_ID);
    assert.equal(r.stats.length, 4);
    assert.ok(r.stats.every((s) => /^\d+%$/.test(s.w)));
    assert.equal(recap.hasHistory(emptyAll(), BY_ID, recap.recapWeek(ctx)), false);
    assert.equal(recap.hasHistory(f, BY_ID, recap.recapWeek(ctx)), true);
    // a watched Bills final in the recap week → "1 W · 0 L"
    const final = f.sports.games.find((g) => g.status === 'final' && g.result && g.date >= ctx.prevWeekStart && g.date < ctx.weekStart);
    if (final) {
      const s2 = sports.buildFacts({ feed: clone(FEED), ctx, rows: [{ gameId: final.id, date: final.date, team: final.team, watchedAt: 'x', where: '', note: '' }] });
      const r2 = recap.build({ facts: { ...f, sports: s2 }, goals: GOALS, ctx }, BY_ID);
      assert.equal(r2.stats.find((s) => s.id === 'sports').cmp.text, final.result === 'W' ? '1 W · 0 L' : '0 W · 1 L');
    }
  },

  /* ---------------------------------------------------------------- Home view-model pieces */
  'greeting: One more / Goal week / On pace / Fresh start / Let’s go (empty rings ignored)'() {
    const r = (v, g, empty = false) => ({ ringValue: v, ringGoal: g, empty: empty ? {} : null });
    const eve = makeCtx(new Date(2026, 9, 1, 19)), mon = makeCtx(new Date(2026, 8, 28, 9));
    assert.deepEqual(home.greet(eve, [r(1, 2), r(4, 5), r(0, 3), r(0, 3)]), { hello: 'Evening, Joe.', tail: 'One more.' });
    assert.equal(home.greet(eve, [r(2, 2), r(5, 5), r(3, 3), r(3, 3)]).tail, 'Goal week.');
    assert.equal(home.greet(eve, [r(2, 2), r(0, 5), r(0, 3), r(0, 3)]).tail, 'On pace.');
    assert.equal(home.greet(eve, [r(0, 2), r(0, 5), r(0, 3), r(0, 3)]).tail, 'Fresh start.');
    assert.equal(home.greet(mon, [r(0, 2), r(0, 5), r(0, 3), r(0, 3)], 'Jo').hello, 'Morning, Jo.');
    assert.equal(home.greet(mon, [r(0, 2), r(0, 5), r(0, 3), r(0, 3)]).tail, 'Let’s go.');
    assert.equal(home.greet(eve, [r(0, 2, true), r(0, 5, true), r(0, 3, true), r(0, 3)]).tail, 'Fresh start.'); // an empty ring never says "One more"
    assert.equal(home.greet(eve, [r(1, 2, true), r(0, 5), r(0, 3), r(0, 3)]).tail, 'Let’s go.');
  },

  'week strip: Monday-start, today and future flags, merged marks, day items from every pillar'() {
    const f = fullFacts();
    const marks = [golf, train, bourbon, sports].map((p) => p.dayMarks(f[p.id], ctx));
    const week = home.mergeDayMarks(marks, ctx);
    assert.deepEqual(week.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    assert.equal(week[0].date, '2026-09-28');
    assert.equal(week[0].today, true);
    assert.ok(week.slice(1).every((d) => d.future));
    const items = home.dayItems(f, ctx);
    assert.equal(items.length, 7);
    for (let i = 0; i < 7; i++) assert.equal(week[i].hit, items[i].length > 0, `day ${i}: marks and items disagree`);
    for (const it of items.flat()) assert.ok(it.text && it.href && it.glyph);
  },

  'activeYesterday: Monday looks back into last week (Sunday)'() {
    const f = { golf: { rounds: [{ date: '2026-09-27' }] }, train: { sessions: [{ date: '2026-09-27' }] }, bourbon: { tastings: [{ date: '2026-09-26' }] }, sports: { watched: { g1: { date: '2026-09-27' } } } };
    assert.deepEqual(home.activeYesterday(f, ctx), { date: '2026-09-27', pillars: ['golf', 'train', 'sports'] });
  },

  'first run: four steps, first open, empty-state Coach cards folded in, deep links point at the exact import flows'() {
    const s = home.onboarding(emptyAll(), {}, GOALS);
    assert.equal(s.show, true);
    assert.equal(s.done, 0);
    assert.equal(s.total, 4);
    assert.equal(s.open, 'golf');
    assert.deepEqual(s.steps.map((x) => x.title), ['Import golf from Fairway Ledger', 'Import bourbon from Barrel Proof', 'Import workouts from Form', 'Set your weekly goals']);
    assert.deepEqual(s.hides.sort(), ['B0', 'G0', 'T0']);
    assert.equal(s.steps[0].actions[0].href, './apps/fairway-ledger/index.html#clubhouse-import');
    assert.equal(s.steps[1].actions[0].href, './apps/barrel-proof/index.html#clubhouse-import');
    assert.equal(s.steps[2].actions[0].kind, 'form');
    assert.equal(s.steps[2].actions[1].href, 'https://form.jjcurry027.workers.dev/');
    assert.equal(s.steps[3].sub, 'Golf 2 · Train 5 · Bourbon 3 · Sports 3 a week');
    assert.ok(s.steps[2].how.some((x) => /You → Settings → Backup/.test(x)));
    assert.equal(s.steps[1].actions[0].snapshot, false);
  },

  'first run: done states from the facts; goals done by keeping or changing; hidden when all done or dismissed'() {
    const f = fullFacts();
    const s = home.onboarding(f, {}, GOALS);
    assert.deepEqual(s.steps.map((x) => x.done), [true, true, true, false]);
    assert.equal(s.open, 'goals');
    assert.deepEqual(s.hides, []);
    assert.match(s.steps[0].sub, /^\d+ rounds in the ledger$/);
    assert.match(s.steps[2].sub, /sessions · as of [A-Z][a-z]{2} \d+$/);
    assert.equal(s.steps[1].actions[0].snapshot, true); // restoring over a cabinet snapshots first
    assert.equal(home.onboarding(f, { 'onboarding.goals': '2026-09-28T20:00:00Z' }, GOALS).show, false);
    assert.equal(home.onboarding(f, { 'goal.golf': 3 }, GOALS).show, false);
    assert.equal(home.onboarding(emptyAll(), { 'onboarding.dismissed': true }, GOALS).show, false);
    assert.deepEqual(home.onboarding(emptyAll(), { 'onboarding.dismissed': true }, GOALS).hides, []);
  },

  'X2 gate: Sunday ≥ 5 pm and Monday, once per recap week'() {
    const vm = { weekStart: '2026-09-21' };
    assert.equal(home.recapDue(ctx, vm, null), true); // Monday
    assert.equal(home.recapDue(ctx, vm, '2026-09-21'), false);
    assert.equal(home.recapDue(makeCtx(new Date(2026, 8, 29, 9)), vm, null), false); // Tuesday
    assert.equal(home.recapDue(makeCtx(new Date(2026, 9, 4, 18)), { weekStart: '2026-09-28' }, '2026-09-21'), true);
    assert.equal(home.recapDue(ctx, null, null), false);
  },

  /* ---------------------------------------------------------------- the vendored apps' #clubhouse-import helper */
  'deep-link helper: both vendored apps load it, the service worker precaches it, it never imports anything'() {
    const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
    for (const app of ['fairway-ledger', 'barrel-proof']) {
      const js = join(APP, 'apps', app, 'clubhouse-bridge.js');
      assert.ok(existsSync(js), `${app} helper missing`);
      const full = readFileSync(js, 'utf8');
      // repair 2026-09-28: Barrel Proof's bridge also carries the snapshot guard (below its marker); the deep-link
      // helper itself still never touches storage or files
      const mark = full.indexOf('/* CLUBHOUSE (repair 2026-09-28): automatic Clubhouse snapshot');
      const src = mark >= 0 ? full.slice(0, mark) : full;
      const guard = mark >= 0 ? full.slice(mark) : '';
      assert.match(src, /#clubhouse-import/);
      assert.doesNotMatch(src, /localStorage|indexedDB|\.files\b|FileReader/);
      if (app === 'barrel-proof') {
        assert.match(guard, /\[data-action="import"\], \[data-action="reset"\]/, 'Barrel Proof Restore + Reset are guarded');
        assert.match(guard, /localStorage\.getItem\(KEY\)/, 'the cabinet is captured before Barrel Proof acts');
        assert.match(guard, /b\.snapshot\(LABEL\[action\], \{ lsBefore: lsBefore \}\)/);
        assert.doesNotMatch(guard, /setItem|removeItem|\.clear\(|indexedDB|\.files\b|FileReader/, 'the guard only reads the cabinet; writes go through backup.snapshot');
      } else {
        assert.equal(guard, '', 'the ledger snapshots itself; no guard there');
      }
      assert.match(readFileSync(join(APP, 'apps', app, 'index.html'), 'utf8'), /<script src="\.\/clubhouse-bridge\.js" defer><\/script>/);
      assert.ok(sw.includes(`'./apps/${app}/clubhouse-bridge.js'`), `${app} helper not precached`);
    }
  },
};
