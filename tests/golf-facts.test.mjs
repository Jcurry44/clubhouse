// GolfFacts (SPEC §2.1 / §8.B.4), summary, and the golf Coach rules (§6.3) on the Fairway Ledger fixture.
import assert from 'node:assert/strict';
import * as golf from '../js/pillars/golf.js';
import { makeCtx, addDays } from '../js/dates.js';
import { GolfMath, GolfShapes, libs, readFixtures, courseCatalog, TODAY } from './helpers/golf-bourbon.mjs';
import { buildGolfSample } from '../js/sample.js';

const ctx = makeCtx(new Date(2026, 8, 28, 18, 0)); // Monday Sep 28 2026, 6 pm
const { fl } = readFixtures();
const clone = (x) => JSON.parse(JSON.stringify(x));
const meta = { lastExportAt: '2026-09-13T20:05:00.000Z', lastExportRoundCount: 20 };
const facts = (state = fl, m = meta, c = ctx) => golf.computeFacts(state, m, c, libs);
const F = (f, goal = 2, c = ctx) => ({ facts: { golf: f }, goals: { golf: goal, train: 5, bourbon: 3, sports: 3 }, ctx: c });

export const tests = {
  'fixture matches the sample builder for its day (regenerate with node tests/helpers/golf-bourbon.mjs --write)'() {
    const { state } = buildGolfSample(TODAY, courseCatalog(), libs);
    assert.deepEqual(fl.rounds, JSON.parse(JSON.stringify(state.rounds)));
  },
  'rounds sorted by date then id, whatever the input order'() {
    const s = clone(fl);
    s.rounds.reverse();
    const f = facts(s);
    for (let i = 1; i < f.rounds.length; i++) {
      const a = f.rounds[i - 1], b = f.rounds[i];
      assert.ok(a.date < b.date || (a.date === b.date && a.id < b.id), `${a.date} ${a.id} before ${b.date} ${b.id}`);
    }
    assert.equal(f.rounds.length, 23);
  },
  'eighteen = complete 18-hole rounds only; nine = complete 9s; an unfinished round is in rounds but not averages'() {
    const s = clone(fl);
    const open = clone(s.rounds[s.rounds.length - 2]);
    open.id = 'round-open'; open.date = addDays(TODAY, -3); open.holes[17].score = null;
    s.rounds.push(open);
    const f = facts(s);
    assert.equal(f.eighteen.length, 19);
    assert.equal(f.nine.length, 4);
    assert.ok(f.rounds.some((r) => r.id === 'round-open' && r.gross === null && !r.complete));
    assert.ok(!f.eighteen.some((r) => r.id === 'round-open'));
  },
  'scoring: last 5 vs prior 5, exact to 0.1, delta from the rounded averages'() {
    const f = facts();
    assert.deepEqual(f.scoring, { last5Avg: 85.4, prior5Avg: 87.6, delta: 2.2, n: 5 });
    assert.deepEqual(f.last10Scores, [88, 90, 87, 86, 87, 86, 85, 87, 86, 83]);
    assert.deepEqual(f.last5.map((r) => r.gross), [83, 86, 87, 85, 86]); // most recent first
  },
  'scoring falls back to 3 vs 3 at 6–9 rounds and is null under 6'() {
    const eighteens = fl.rounds.filter((r) => r.holes.length === 18);
    const s7 = { ...clone(fl), rounds: clone(eighteens.slice(-7)) };
    const f7 = facts(s7);
    assert.equal(f7.scoring.n, 3);
    assert.equal(f7.scoring.last5Avg, 85.3); // 83, 86, 87
    assert.equal(f7.scoring.prior5Avg, 86.0); // 85, 86, 87
    const s5 = { ...clone(fl), rounds: clone(eighteens.slice(-5)) };
    assert.equal(facts(s5).scoring, null);
  },
  'seasonLow: lowest 18-hole gross this season, tie → latest'() {
    const s = clone(fl);
    const twin = clone(s.rounds.find((r) => r.id === 'round-sample-22'));
    twin.id = 'round-earlier-83'; twin.date = addDays(TODAY, -40);
    s.rounds.push(twin);
    const f = facts(s);
    assert.equal(f.seasonLow.score, 83);
    assert.equal(f.seasonLow.id, 'round-sample-22');
    assert.equal(f.seasonLow.short, 'Deerwood');
  },
  'handicap equals GolfMath.calculateHandicapEstimate on the same rounds with the ledger’s course lookup'() {
    const f = facts();
    const lookup = golf.makeCourseLookup(fl.courses);
    const rated = (id) => { const c = lookup(id); return c && c.rating && c.slope ? { rating: c.rating, slope: c.slope } : null; };
    const raw = fl.rounds.map((r) => GolfShapes.normalizeRound(r)).sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
    assert.equal(f.handicap.index, GolfMath.calculateHandicapEstimate(raw, rated).index);
    assert.ok(f.handicap30 > f.handicap.index, 'the sample improves over 30 days');
    assert.equal(f.hcpTrend.length, 10);
    assert.equal(f.hcpTrend[f.hcpTrend.length - 1].index, f.handicap.index);
  },
  'Deerwood 18s are synthesized from their nines (rating = sum, slope = mean) like the ledger does'() {
    const lookup = golf.makeCourseLookup(fl.courses);
    const c = lookup('deerwood-buck-doe-white');
    const buck = fl.courses.find((x) => x.id === 'deerwood-buck-white'), doe = fl.courses.find((x) => x.id === 'deerwood-doe-white');
    assert.equal(c.rating, Number((buck.rating + doe.rating).toFixed(1)));
    assert.equal(c.slope, Math.round((buck.slope + doe.slope) / 2));
    assert.equal(golf.shortCourse(c.name), 'Deerwood');
    assert.equal(golf.shortCourse('Seneca Hickory Stick Golf Course'), 'Seneca Hickory Stick');
  },
  'putts / penalties (topClub) / FIR / GIR: last 5 vs prior 5'() {
    const f = facts();
    assert.deepEqual(f.putts, { last5: 32.2, prior5: 33.4, n: 5 });
    assert.equal(f.penalties.last5, 1.4);
    assert.equal(f.penalties.prior5, 0.8);
    assert.equal(f.penalties.topClub, 'Driver');
    assert.ok(f.fir.last5Pct - f.fir.prior5Pct >= 5);
    assert.ok(f.gir.last5Pct >= 0 && f.gir.last5Pct <= 100);
  },
  'byCourse collapses every Deerwood routing and nine into one row, sorted by average'() {
    const f = facts();
    const dw = f.byCourse.filter((c) => c.name === 'Deerwood');
    assert.equal(dw.length, 1);
    assert.equal(dw[0].rounds, 11);
    assert.equal(dw[0].eighteen, 7);
    const avgs = f.byCourse.filter((c) => c.avg != null).map((c) => c.avg);
    assert.deepEqual(avgs, avgs.slice().sort((a, b) => a - b));
  },
  'weeklyHistory has 26 weeks; weekRounds / dayMarks / weekCount agree'() {
    const f = facts();
    assert.equal(Object.keys(f.weeklyHistory).length, 26);
    assert.equal(f.weekRounds.length, 1);
    assert.deepEqual(golf.dayMarks(f, ctx), [true, false, false, false, false, false, false]);
    assert.equal(golf.weekCount(f, ctx.weekStart), 1);
    assert.equal(golf.weekCount(f, ctx.prevWeekStart), 1);
    assert.equal(f.unbackedRounds, 3);
    assert.equal(f.daysSinceLastRound, 0);
  },
  'summary: ring = rounds this week; note precedence scoring delta → season low → last round; empty state'() {
    const f = facts();
    const s = golf.summary(f, 2, ctx);
    assert.equal(s.ringValue, 1);
    assert.equal(s.sublabel, 'of 2 rounds');
    assert.deepEqual(s.note, { text: 'Avg down 2.2', tone: 'good', icon: 'down' });
    const flat = { ...f, scoring: { ...f.scoring, delta: 0.2 } };
    assert.deepEqual(golf.summary(flat, 2, ctx).note, { text: 'Season low 83', tone: 'good', icon: 'bolt' });
    const old = { ...flat, seasonLow: { ...f.seasonLow, daysAgo: 30 } };
    assert.equal(golf.summary(old, 2, ctx).note.text, '42 at Deerwood');
    const empty = golf.summary(golf.computeFacts(null, null, ctx, libs), 2, ctx);
    assert.equal(empty.empty.cta.href, './apps/fairway-ledger/index.html');
    assert.equal(golf.summary(facts(), 1, ctx).over, 0);
  },
  'rules: G0 on an empty ledger, wording exact'() {
    const list = golf.insights(F(golf.computeFacts(null, null, ctx, libs)));
    assert.deepEqual(list.map((i) => i.id), ['G0']);
    assert.equal(list[0].sub, 'Open Fairway Ledger → Data → Import your last backup.');
  },
  'rules: the sample fires G1 G3 G9 G4 G6 G7 G8 (G2 folded into G1), exact copy'() {
    const list = golf.insights(F(facts()));
    assert.deepEqual(list.map((i) => i.id), ['G1', 'G3', 'G9', 'G4', 'G6', 'G7', 'G8']);
    const by = Object.fromEntries(list.map((i) => [i.id, i]));
    assert.equal(by.G1.headline, 'Scoring average <strong>down 2.2</strong> over your last 5 rounds.');
    assert.equal(by.G1.sub, '85.4 vs 87.6 · Deerwood 83 yesterday was a season best');
    assert.equal(by.G1.kicker, `Golf · Handicap ${facts().handicap.index.toFixed(1)}`);
    assert.equal(by.G4.headline, 'One more round <strong>hits your goal</strong> this week.');
    assert.equal(by.G4.sub, '6 days left · Sat and Sun open');
    assert.equal(by.G7.headline, 'Penalties crept up to <span class="warn">1.4</span> a round.');
    assert.equal(by.G7.sub, '0.8 before · Driver is the club');
    assert.equal(by.G9.headline, '<span class="warn">3 rounds</span> aren\'t in a Fairway Ledger backup yet.');
    assert.deepEqual(by.G9.actions, [{ label: 'Back up now', run: 'backup.export' }]);
    assert.match(by.G3.headline, /^Handicap <strong>down \d+\.\d<\/strong> in 30 days\.$/);
  },
  'rules: G2 fires when the season low is fresh but scoring is flat; G5 after 14 idle days in season'() {
    const f = facts();
    const flat = { ...f, scoring: { ...f.scoring, delta: 0.1 } };
    const g2 = golf.insights(F(flat)).find((i) => i.id === 'G2');
    assert.equal(g2.headline, '<strong>83</strong> at Deerwood yesterday — your best of 2026.');
    const later = makeCtx(new Date(2026, 9, 20, 12, 0)); // Oct 20: 22 days after the last round
    const g5 = golf.insights(F(facts(fl, meta, later), 2, later)).find((i) => i.id === 'G5');
    assert.equal(g5.headline, 'It\'s been <span class="warn">22 days</span> since your last round.');
    const winter = makeCtx(new Date(2026, 11, 20, 12, 0));
    assert.ok(!golf.insights(F(facts(fl, meta, winter), 2, winter)).some((i) => i.id === 'G5'), 'no nagging in December');
  },
  'rules: G4 goal-hit wording when the week reaches the goal'() {
    const g4 = golf.insights(F(facts(), 1)).find((i) => i.id === 'G4');
    assert.equal(g4.headline, 'Golf goal <strong>hit</strong> — 1 round this week.');
    assert.equal(g4.tone, 'good');
  },
};
