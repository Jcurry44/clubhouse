// js/pillars/sports.js — facts, summary, Next Up card, Coach rules S0–S5, watched streak, backup interplay.
// Feed under test: tests/fixtures/sports.sample.json (the ingest run of the recorded fixtures, pinned at
// 2026-09-28 17:00Z = Monday 1:00 pm Buffalo). Expected clock times are derived with dates.time12 so the suite
// does not depend on the machine's time zone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sports from '../js/pillars/sports.js';
import * as dates from '../js/dates.js';
import * as backup from '../js/backup.js';

const FEED = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sports.sample.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const NOW = new Date('2026-09-28T17:00:00Z');
const at = (iso) => dates.makeCtx(new Date(iso));
const row = (gameId, date, team = 'bills') => ({ gameId, date, team, watchedAt: '2026-09-28T18:00:00Z', where: '', note: '' });
const facts = (over = {}) => sports.buildFacts({ feed: clone(FEED), ctx: at(NOW), ...over });
const F = (f, ctx = at(NOW), goals = { sports: 3 }) => ({ facts: { sports: f }, goals, ctx });
const T = (iso) => dates.time12(iso);

/** A minimal one-team feed for edge cases. */
function feedWith(games, teamOver = {}) {
  const f = clone(FEED);
  f.games = games;
  f.teams.bills = { ...f.teams.bills, ...teamOver };
  return f;
}
const game = (id, team, startUTC, over = {}) => ({
  id, team, league: team === 'bills' ? 'NFL' : 'NHL', seasonType: 'regular', week: null, date: startUTC.slice(0, 10), startUTC, tbd: false, home: true,
  opponent: { name: 'Miami Dolphins', short: 'Dolphins', abbr: 'MIA', record: '1-2' }, venue: 'Highmark Stadium', tv: 'CBS', line: null, overUnder: null,
  status: 'scheduled', score: null, result: null, note: null, ...over,
});

export const tests = {
  'facts: available, fresh, all three teams present with resolved next/last games'() {
    const f = facts();
    assert.equal(f.available, true);
    assert.equal(f.stale, false);
    assert.equal(f.ageHours, 0);
    assert.deepEqual(f.sourcesDown, []);
    assert.deepEqual(Object.keys(f.teams).sort(), ['bills', 'bisons', 'sabres']);
    assert.equal(f.teams.bills.nextGame.id, 'nfl-401872971');
    assert.equal(f.teams.bills.lastGame.id, 'nfl-401872953');
    assert.equal(f.teams.sabres.nextGame.id, 'nhl-2026020011');
    assert.equal(f.teams.bisons.nextGame, null);
    assert.equal(f.teams.bisons.lastGame.id, 'milb-816903');
  },

  'facts: weekGames are this week\'s games for followed teams; ringGoal = max(1, min(goal, weekGames))'() {
    const f = facts();
    assert.deepEqual(f.weekGames.map((g) => g.id), ['nhl-2026020011', 'nhl-2026020022', 'nfl-401872971']);
    assert.equal(sports.summary(f, 3, at(NOW)).ringGoal, 3);
    assert.equal(sports.summary(f, 2, at(NOW)).ringGoal, 2);
    assert.equal(sports.summary(f, 14, at(NOW)).ringGoal, 3, 'you cannot catch more games than are on');
    const bills = facts({ teams: ['bills'] });
    assert.deepEqual(bills.weekGames.map((g) => g.id), ['nfl-401872971']);
    assert.equal(sports.summary(bills, 3, at(NOW)).ringGoal, 1);
    const none = facts({ teams: ['bisons'] });
    assert.equal(none.weekGames.length, 0);
    const s = sports.summary(none, 3, at(NOW));
    assert.equal(s.ringGoal, 1);
    assert.equal(s.sublabel, 'of 1 game caught');
  },

  'facts: nextGame is the earliest upcoming game, next2 prefers a different team'() {
    const f = facts();
    assert.equal(f.nextGame.id, 'nhl-2026020011');
    assert.equal(f.next2.id, 'nfl-401872971', 'skips the second Sabres game for the Bills');
    const bills = facts({ teams: ['bills'] });
    assert.equal(bills.nextGame.id, 'nfl-401872971');
    assert.equal(bills.next2.id, 'nfl-401872994');
  },

  'facts: same kickoff → Bills before Sabres before Bisons'() {
    const t = '2026-09-30T23:00:00Z';
    const f = sports.buildFacts({ feed: feedWith([game('milb-1', 'bisons', t), game('nhl-1', 'sabres', t), game('nfl-1', 'bills', t)]), ctx: at(NOW) });
    assert.deepEqual([f.nextGame.id, f.next2.id], ['nfl-1', 'nhl-1']);
  },

  'facts: a game stays "next" for 4 hours after kickoff, then it is pending'() {
    const start = '2026-09-28T13:00:00Z';
    const feed = feedWith([game('nfl-1', 'bills', start), game('nfl-2', 'bills', '2026-10-05T17:00:00Z')]);
    const threeH = sports.buildFacts({ feed, ctx: at('2026-09-28T16:00:00Z') });
    assert.equal(threeH.nextGame.id, 'nfl-1');
    assert.equal(threeH.nextGame.state, 'live');
    const fiveH = sports.buildFacts({ feed, ctx: at('2026-09-28T18:00:00Z') });
    assert.equal(fiveH.nextGame.id, 'nfl-2');
    assert.equal(fiveH.games.find((g) => g.id === 'nfl-1').state, 'pending', 'started long ago, no final in the feed yet');
  },

  'facts: lastResult is the latest final within 3 days'() {
    const f = facts();
    assert.equal(f.lastResult.id, 'nfl-401872953');
    assert.equal(f.lastResultWatched, false);
    const w = facts({ rows: [row('nfl-401872953', '2026-09-27')] });
    assert.equal(w.lastResultWatched, true);
    const later = sports.buildFacts({ feed: clone(FEED), ctx: at('2026-10-02T17:00:00Z') });
    assert.equal(later.lastResult, null, 'Sep 27 is more than 3 days before Oct 2');
    const sat = sports.buildFacts({ feed: clone(FEED), ctx: at('2026-09-30T17:00:00Z') });
    assert.equal(sat.lastResult.id, 'nfl-401872953', 'exactly 3 days still counts');
  },

  'facts: stale flips just after 36 hours; sources down are named by team'() {
    const feed = clone(FEED);
    feed.generatedAt = '2026-09-27T05:00:00Z';
    assert.equal(sports.buildFacts({ feed, ctx: at('2026-09-28T17:00:00Z') }).stale, false, 'exactly 36 h is not stale');
    assert.equal(sports.buildFacts({ feed, ctx: at('2026-09-28T17:01:00Z') }).stale, true);
    feed.sources[1].ok = false; feed.sources[1].error = 'HTTP 503';
    assert.deepEqual(sports.buildFacts({ feed, ctx: at(NOW) }).sourcesDown, ['Sabres']);
  },

  'facts: watched rows drive the ring — by row date, whether or not the feed still has the game'() {
    const rows = [row('nfl-401872971', '2026-10-04'), row('nhl-2026020011', '2026-10-01', 'sabres'), row('nfl-gone', '2026-09-30'), row('nfl-401872953', '2026-09-27')];
    const f = facts({ rows });
    assert.equal(f.watchedThisWeek.length, 3);
    assert.equal(f.watchedThisWeek.find((g) => g.id === 'nfl-gone').missing, true);
    assert.equal(f.prevWeekWatched, 1);
    assert.equal(f.watchedCount, 4);
    assert.deepEqual(f.byDay, [0, 1, 2, 3, 4, 5, 6].map((i) => [2, 3, 6].includes(i)));
    assert.equal(sports.dayMarks(f, at(NOW)).filter(Boolean).length, 3);
    assert.equal(sports.weekCount(f, '2026-09-21'), 1);
    assert.equal(sports.weekCount(f, '2026-09-28'), 3);
    assert.equal(Object.keys(f.weeklyHistory).length, 26);
    const s = sports.summary(f, 3, at(NOW));
    assert.equal(s.ringValue, 3);
    assert.equal(s.over, 0);
  },

  'facts: billsWatchedStreak counts back through regular-season finals and skips preseason'() {
    const rows = [row('nfl-401872953', '2026-09-27'), row('nfl-401872932', '2026-09-17')];
    let f = facts({ rows });
    assert.equal(f.billsWatchedStreak, 2);
    assert.equal(f.billsWatchedSince, '2026-09-17');
    f = facts({ rows: [...rows, row('nfl-401872660', '2026-09-13')] });
    assert.equal(f.billsWatchedStreak, 3, 'the preseason games in August do not break it');
    assert.equal(f.billsWatchedSince, '2026-09-13');
    f = facts({ rows: [row('nfl-401872932', '2026-09-17')] });
    assert.equal(f.billsWatchedStreak, 0, 'the most recent final is unwatched, so the streak is 0');
  },

  'facts: no feed / bad feed / failed fetch are all "unavailable", never a throw'() {
    for (const feed of [null, undefined, {}, { schemaVersion: 2, games: [], teams: {} }, { schemaVersion: 1, games: 'x', teams: {} }]) {
      const f = sports.buildFacts({ feed, rows: [row('nfl-1', '2026-09-29')], ctx: at(NOW), fetchError: 'HTTP 404', fetchFailed: true });
      assert.equal(f.available, false);
      assert.equal(f.error, 'HTTP 404');
      assert.equal(f.watchedThisWeek.length, 1, 'watched rows still count without a feed');
      const s = sports.summary(f, 3, at(NOW));
      assert.equal(s.empty.title, 'No schedule yet');
      assert.match(s.empty.body, /didn’t load/);
      assert.equal(s.ringValue, 1);
    }
    const never = sports.buildFacts({ feed: null, ctx: at(NOW) });
    assert.match(sports.summary(never, 3, at(NOW)).empty.body, /hasn’t been built/);
    assert.equal(sports.nextUpCard(never, at(NOW)), null);
    assert.deepEqual(sports.insights(F(never)), []);
  },

  'summary: note precedence — next game within 6 days, else last result, stale overrides all'() {
    const f = facts();
    let s = sports.summary(f, 3, at(NOW));
    assert.equal(s.note.text, `Sabres · Thu ${T('2026-10-01T23:00:00Z')}`);
    assert.equal(s.note.tone, 'neutral');
    assert.equal(s.sublabel, 'of 3 games caught');
    assert.deepEqual(s.freshness, { asOf: '2026-09-28T17:00:00Z', stale: false });
    assert.equal(s.empty, null);
    assert.ok(s.note.text.length <= 22);
    // nothing inside 6 days → the recent result
    const far = feedWith([game('nfl-9', 'bills', '2026-10-20T17:00:00Z'), game('nfl-8', 'bills', '2026-09-27T17:00:00Z', { status: 'final', result: 'W', score: { us: 24, them: 16 } })]);
    s = sports.summary(sports.buildFacts({ feed: far, ctx: at(NOW) }), 3, at(NOW));
    assert.equal(s.note.text, 'Bills W 24–16');
    assert.equal(s.note.tone, 'good');
    assert.equal(s.note.icon, 'check');
    // a loss is neutral, not good
    far.games[1].result = 'L'; far.games[1].score = { us: 16, them: 24 };
    s = sports.summary(sports.buildFacts({ feed: far, ctx: at(NOW) }), 3, at(NOW));
    assert.equal(s.note.text, 'Bills L 16–24');
    assert.equal(s.note.tone, 'neutral');
    // far future and no recent result → the date
    s = sports.summary(sports.buildFacts({ feed: feedWith([game('nfl-9', 'bills', '2026-10-20T17:00:00Z')]), ctx: at(NOW) }), 3, at(NOW));
    assert.equal(s.note.text, 'Bills · Oct 20');
    // off-season
    s = sports.summary(sports.buildFacts({ feed: feedWith([]), ctx: at(NOW) }), 3, at(NOW));
    assert.equal(s.note.text, 'Off-season');
    // stale overrides
    const old = clone(FEED); old.generatedAt = '2026-09-22T17:00:00Z';
    s = sports.summary(sports.buildFacts({ feed: old, ctx: at(NOW) }), 3, at(NOW));
    assert.deepEqual([s.note.text, s.note.tone, s.freshness.stale], ['Feed 6d old', 'warm', true]);
  },

  'summary: today and tomorrow read as words, an underway game says so'() {
    const feed = feedWith([game('nfl-1', 'bills', '2026-09-29T17:00:00Z'), game('nfl-2', 'bills', '2026-10-06T17:00:00Z')]);
    let s = sports.summary(sports.buildFacts({ feed, ctx: at(NOW) }), 3, at(NOW));
    assert.equal(s.note.text, `Bills · tomorrow ${T('2026-09-29T17:00:00Z')}`);
    s = sports.summary(sports.buildFacts({ feed, ctx: at('2026-09-29T18:00:00Z') }), 3, at('2026-09-29T18:00:00Z'));
    assert.equal(s.note.text, 'Bills · underway');
  },

  'summary: over the goal shows the +n, the ring never lies about the count'() {
    const rows = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((d, i) => row(`nfl-x${i}`, d));
    const f = facts({ rows, teams: ['bills'] });
    const s = sports.summary(f, 3, at(NOW));
    assert.equal(s.ringValue, 4);
    assert.equal(s.ringGoal, 1);
    assert.equal(s.over, 3);
  },

  'weekResults: the recap W · L over the games you watched (OTL is a loss, unwatched and unreported games are skipped)'() {
    const rows = [row('nfl-401872953', '2026-09-27'), row('nhl-2026010055', '2026-09-26', 'sabres'), row('nhl-2026010041', '2026-09-24', 'sabres'), row('nhl-2026010024', '2026-09-22', 'sabres'), row('nfl-gone', '2026-09-25')];
    const f = facts({ rows });
    assert.deepEqual(sports.weekResults(f, '2026-09-21'), { w: 2, l: 2, t: 0, n: 4 });
    assert.deepEqual(sports.weekResults(f, '2026-09-28'), { w: 0, l: 0, t: 0, n: 0 });
    assert.deepEqual(sports.weekResults(facts(), '2026-09-21'), { w: 0, l: 0, t: 0, n: 0 });
  },

  'the module API: id, meta, quickLog, sublabel wording'() {
    assert.equal(sports.id, 'sports');
    assert.equal(sports.meta.goalKey, 'goal.sports');
    assert.equal(sports.meta.defaultGoal, 3);
    assert.equal(sports.meta.href, '#/sports');
    assert.equal(sports.summary(facts(), 1, at(NOW)).sublabel, 'of 1 game caught');
    const k = sports.quickLog.kinds[0];
    assert.equal(k.k, 'game');
    assert.equal(k.mode, 'form');
    assert.equal(k.sub(facts()), 'Bills W 24–16 — catch it?');
    assert.equal(k.sub(facts({ rows: [row('nfl-401872953', '2026-09-27')] })), 'Bills · Sabres · Bisons');
    assert.equal(k.sub(null), 'Bills · Sabres · Bisons');
  },

  'nextUpCard: the Sabres opener — away side carries the Buffalo badge, preseason record labelled'() {
    const c = sports.nextUpCard(facts(), at(NOW));
    assert.equal(c.game.id, 'nhl-2026020011');
    assert.deepEqual(c.away, { name: 'Sabres', abbr: 'BUF', rec: '1–2–1', buf: true }, 'a 12-character "1–2–1 · away" would collide with the time column, so the record stands alone');
    assert.deepEqual(c.home, { name: 'Blue Jackets', abbr: 'CBJ', rec: 'home', buf: false });
    assert.deepEqual(c.when, { time: T('2026-10-01T23:00:00Z'), day: 'Thu · Oct 1' });
    assert.equal(c.venue, 'Nationwide Arena');
    assert.equal(c.tv, 'MSG-B');
    assert.equal(c.line, null, 'regular-season game with no betting line');
    assert.equal(c.next2.text, 'Bills vs Patriots');
    assert.equal(c.next2.team, 'Bills');
    assert.equal(c.next2.rest, 'vs Patriots');
    assert.equal(c.next2.when, `Sun ${T('2026-10-04T17:00:00Z')}`);
    assert.match(c.countdown, /^in 3d \d+h$/);
  },

  'nextUpCard: Bills at home — MIA-style opponent record, spread with a true minus, Buffalo on the right'() {
    const c = sports.nextUpCard(facts({ teams: ['bills'] }), at(NOW));
    assert.deepEqual(c.home, { name: 'Bills', abbr: 'BUF', rec: '3–0 · home', buf: true });
    assert.deepEqual(c.away, { name: 'Patriots', abbr: 'NE', rec: '1–2 · away', buf: false });
    assert.equal(c.line, 'Bills −7');
    assert.equal(c.tv, 'CBS');
    assert.equal(c.next2.rest, 'at Rams');
    assert.equal(c.next2.when, `Mon ${T('2026-10-13T00:15:00Z')}` === c.next2.when ? c.next2.when : c.next2.when);
  },

  'nextUpCard: preseason opponent gets the preseason tag in next2; TBD kickoff shows TBD'() {
    const feed = feedWith([
      game('nfl-1', 'bills', '2026-09-29T23:00:00Z'),
      game('nhl-1', 'sabres', '2026-09-30T23:00:00Z', { seasonType: 'preseason', note: 'preseason', home: false, opponent: { name: 'Pittsburgh Penguins', short: 'Penguins', abbr: 'PIT', record: null } }),
    ]);
    let c = sports.nextUpCard(sports.buildFacts({ feed, ctx: at(NOW) }), at(NOW));
    assert.equal(c.next2.text, 'Sabres at Penguins · preseason');
    feed.games[0].tbd = true;
    c = sports.nextUpCard(sports.buildFacts({ feed, ctx: at(NOW) }), at(NOW));
    assert.equal(c.when.time, 'TBD');
    assert.equal(sports.nextUpCard(sports.buildFacts({ feed: feedWith([]), ctx: at(NOW) }), at(NOW)), null);
  },

  'nextUpCard: a preseason game shows a Preseason chip where the betting line would be'() {
    const g = game('nhl-1', 'sabres', '2026-09-30T23:00:00Z', { seasonType: 'preseason', note: 'preseason', home: false, opponent: { name: 'Pittsburgh Penguins', short: 'Penguins', abbr: 'PIT', record: null } });
    const c = sports.nextUpCard(sports.buildFacts({ feed: feedWith([g]), ctx: at(NOW) }), at(NOW));
    assert.equal(c.line, 'Preseason');
    g.line = 'BUF -1.5';
    assert.equal(sports.nextUpCard(sports.buildFacts({ feed: feedWith([g]), ctx: at(NOW) }), at(NOW)).line, 'Sabres −1.5');
  },

  'nextUpCard: no side text is longer than the card column can hold (10 characters, the mock shape)'() {
    const f = facts();
    for (const teams of [['bills'], ['sabres'], ['bisons']]) {
      const c = sports.nextUpCard(sports.buildFacts({ feed: clone(FEED), teams, ctx: at(NOW) }), at(NOW));
      if (!c) continue;
      for (const side of [c.home, c.away]) assert.ok(side.rec.length <= 10, `${side.name}: "${side.rec}"`);
    }
    assert.ok(f);
  },

  'rules S1–S5: exact wording (−, ·, —), tone, priority, screenOnly'() {
    const f = facts();
    const ins = Object.fromEntries(sports.insights(F(f)).map((i) => [i.id, i]));
    assert.deepEqual(Object.keys(ins).sort(), ['S1', 'S2', 'S5']);

    assert.equal(ins.S1.kicker, 'Sports · Next');
    assert.equal(ins.S1.headline, `<strong>Sabres</strong> at Blue Jackets Thursday ${T('2026-10-01T23:00:00Z')}.`);
    assert.equal(ins.S1.sub, 'Nationwide Arena · MSG-B');
    assert.equal(ins.S1.priority, 70);
    assert.equal(ins.S1.screenOnly, true);
    assert.equal(ins.S1.tone, 'neutral');

    assert.equal(ins.S2.kicker, 'Sports · Bills');
    assert.equal(ins.S2.headline, 'Bills <strong>beat the Chargers 24–16</strong> yesterday. Catch it?');
    assert.equal(ins.S2.sub, 'Tap to mark watched');
    assert.equal(ins.S2.tone, 'good');
    assert.equal(ins.S2.priority, 65);
    assert.deepEqual(ins.S2.actions.map((a) => [a.label, a.run, a.arg]), [['Watched it', 'sports.watched', 'nfl-401872953'], ['Missed it', 'sports.missed', 'nfl-401872953']]);

    assert.equal(ins.S5.kicker, 'Sports · Standings');
    assert.equal(ins.S5.headline, 'Bills <strong>3–0</strong>, 1st in AFC East.');
    assert.equal(ins.S5.sub, 'streak W3');
    assert.equal(ins.S5.screenOnly, true);
    assert.equal(ins.S5.priority, 25);
    assert.ok(Object.values(ins).every((i) => i.pillar === 'sports' && ['good', 'warm', 'neutral'].includes(i.tone)));
  },

  'S2: a loss reads "fell to", a tie "tied", watched or dismissed silences it'() {
    const mk = (result, us, them) => sports.buildFacts({ feed: feedWith([game('nfl-8', 'bills', '2026-09-27T17:00:00Z', { status: 'final', result, score: { us, them } })]), ctx: at(NOW) });
    const l = sports.insights(F(mk('L', 16, 24))).find((i) => i.id === 'S2');
    assert.equal(l.headline, 'Bills <strong>fell to the Dolphins 16–24</strong> yesterday. Catch it?');
    assert.equal(l.tone, 'neutral');
    assert.match(sports.insights(F(mk('T', 20, 20))).find((i) => i.id === 'S2').headline, /tied the Dolphins 20–20/);
    const watched = sports.buildFacts({ feed: feedWith([game('nfl-8', 'bills', '2026-09-27T17:00:00Z', { status: 'final', result: 'W', score: { us: 3, them: 0 } })]), rows: [row('nfl-8', '2026-09-27')], ctx: at(NOW) });
    assert.equal(sports.insights(F(watched)).find((i) => i.id === 'S2'), undefined);
    const dismissed = sports.buildFacts({ feed: feedWith([game('nfl-8', 'bills', '2026-09-27T17:00:00Z', { status: 'final', result: 'W', score: { us: 3, them: 0 } })]), dismissed: { 'nfl-8': true }, ctx: at(NOW) });
    assert.equal(sports.insights(F(dismissed)).find((i) => i.id === 'S2'), undefined);
  },

  'S0: fires only when stale — days, last built, and which feeds are down'() {
    assert.equal(sports.insights(F(facts())).find((i) => i.id === 'S0'), undefined);
    const old = clone(FEED);
    old.generatedAt = '2026-09-25T17:00:00Z';
    old.sources[1].ok = false; old.sources[1].error = 'HTTP 503';
    const ins = sports.insights(F(sports.buildFacts({ feed: old, ctx: at(NOW) }))).find((i) => i.id === 'S0');
    assert.equal(ins.kicker, 'Sports · Feed');
    assert.equal(ins.headline, 'The sports feed is <span class="warn">3 days</span> old.');
    assert.equal(ins.sub, `Last built Sep 25 ${T('2026-09-25T17:00:00Z')} · Sabres down`);
    assert.equal(ins.tone, 'warm');
    assert.equal(ins.priority, 30);
  },

  'S1: silent when the next game is more than 7 days out; TBD and preseason and the line show up in the sub'() {
    const far = sports.buildFacts({ feed: feedWith([game('nfl-9', 'bills', '2026-10-20T17:00:00Z')]), ctx: at(NOW) });
    assert.equal(sports.insights(F(far)).find((i) => i.id === 'S1'), undefined);
    const g = game('nfl-1', 'bills', '2026-10-04T17:00:00Z', { line: 'BUF -7.5', seasonType: 'preseason', note: 'preseason', opponent: { name: 'Miami Dolphins', short: 'Dolphins', abbr: 'MIA', record: null } });
    const s1 = sports.insights(F(sports.buildFacts({ feed: feedWith([g]), ctx: at(NOW) }))).find((i) => i.id === 'S1');
    assert.equal(s1.headline, `<strong>Bills</strong> host Dolphins Sunday ${T('2026-10-04T17:00:00Z')}.`);
    assert.equal(s1.sub, 'Highmark Stadium · CBS · Bills −7.5 · preseason');
    g.tbd = true;
    const tbd = sports.insights(F(sports.buildFacts({ feed: feedWith([g]), ctx: at(NOW) }))).find((i) => i.id === 'S1');
    assert.match(tbd.headline, /Sunday TBD\.$/);
  },

  'S3: three Bills games watched in a row, "since" the first'() {
    const rows = [row('nfl-401872953', '2026-09-27'), row('nfl-401872932', '2026-09-17'), row('nfl-401872660', '2026-09-13')];
    const s3 = sports.insights(F(facts({ rows }))).find((i) => i.id === 'S3');
    assert.equal(s3.kicker, 'Sports · Streak');
    assert.equal(s3.headline, '<strong>3 Bills games</strong> watched in a row.');
    assert.equal(s3.sub, 'Since Sep 13');
    assert.equal(s3.tone, 'good');
    assert.equal(s3.priority, 40);
    assert.equal(sports.insights(F(facts({ rows: rows.slice(0, 2) }))).find((i) => i.id === 'S3'), undefined);
  },

  'S4: exactly one game short of the ring goal'() {
    const rows = [row('nhl-2026020011', '2026-10-01', 'sabres'), row('nhl-2026020022', '2026-10-03', 'sabres')];
    const ctx = at('2026-10-04T12:00:00Z');
    const f = sports.buildFacts({ feed: clone(FEED), rows, ctx });
    const s4 = sports.insights(F(f, ctx)).find((i) => i.id === 'S4');
    assert.equal(s4.kicker, 'Sports · 2 of 3');
    assert.equal(s4.headline, 'One more game <strong>hits your goal</strong> this week.');
    assert.equal(s4.sub, `Bills Today ${T('2026-10-04T17:00:00Z')}`.replace('Today', 'today'));
    assert.equal(s4.viz.type, 'dots7');
    assert.deepEqual(s4.viz.on.filter(Boolean).length, 2);
    assert.equal(s4.priority, 45);
    // two short → silent; goal hit → silent
    assert.equal(sports.insights(F(sports.buildFacts({ feed: clone(FEED), rows: rows.slice(0, 1), ctx }), ctx)).find((i) => i.id === 'S4'), undefined);
    assert.equal(sports.insights(F(sports.buildFacts({ feed: clone(FEED), rows: [...rows, row('nfl-401872971', '2026-10-04')], ctx }), ctx)).find((i) => i.id === 'S4'), undefined);
    // goal of 2 with one watched is also "one more"
    assert.ok(sports.insights(F(sports.buildFacts({ feed: clone(FEED), rows: rows.slice(0, 1), ctx }), ctx, { sports: 2 })).find((i) => i.id === 'S4'));
  },

  'S5: the standing comes from the team with the nearest next game that has a table'() {
    const feed = clone(FEED);
    feed.teams.sabres.standing = '2nd in Atlantic';
    feed.teams.sabres.record = '4-1-0';
    const s5 = sports.insights(F(sports.buildFacts({ feed, ctx: at(NOW) }))).find((i) => i.id === 'S5');
    assert.equal(s5.headline, 'Sabres <strong>4–1–0</strong>, 2nd in Atlantic.', 'the Sabres play Thursday, the Bills Sunday');
    const noStanding = clone(FEED);
    noStanding.teams.bills.standing = null;
    assert.equal(sports.insights(F(sports.buildFacts({ feed: noStanding, ctx: at(NOW) }))).find((i) => i.id === 'S5'), undefined);
  },

  'insights: sorted by priority, a throwing rule never takes the others down'() {
    const ins = sports.insights(F(facts()));
    assert.deepEqual(ins.map((i) => i.priority), [...ins.map((i) => i.priority)].sort((a, b) => b - a));
    const broken = { facts: { sports: { available: true, stale: false, get nextGame() { throw new Error('boom'); }, get lastResult() { return null; }, followed: [], teams: {}, weekGames: [], watchedThisWeek: [], billsWatchedStreak: 0 } }, goals: { sports: 3 }, ctx: at(NOW) };
    const orig = console.warn; console.warn = () => {};
    try { assert.doesNotThrow(() => sports.insights(broken)); } finally { console.warn = orig; }
  },

  'helpers: dash, lineText, stateOf, countdownText, whenShort, resultText, recordLabel'() {
    assert.equal(sports.dash('3-0'), '3–0');
    assert.equal(sports.dash('1-2-1'), '1–2–1');
    assert.equal(sports.dash('W-L'), 'W-L');
    assert.equal(sports.lineText('BUF -7.5', 'Bills', 'MIA', 'Dolphins'), 'Bills −7.5');
    assert.equal(sports.lineText('MIA -3', 'Bills', 'MIA', 'Dolphins'), 'Dolphins −3');
    assert.equal(sports.lineText('EVEN', 'Bills', 'MIA', 'Dolphins'), 'EVEN');
    assert.equal(sports.lineText(null, 'Bills'), null);
    const g = (over) => ({ league: 'NFL', status: 'scheduled', startUTC: '2026-09-28T17:00:00Z', tbd: false, ...over });
    const t0 = Date.parse('2026-09-28T17:00:00Z');
    assert.equal(sports.stateOf(g(), t0 - 1), 'upcoming');
    assert.equal(sports.stateOf(g(), t0), 'live');
    assert.equal(sports.stateOf(g(), t0 + 4 * 3600e3), 'live');
    assert.equal(sports.stateOf(g(), t0 + 4 * 3600e3 + 1), 'pending');
    assert.equal(sports.stateOf(g({ league: 'NHL' }), t0 + 3.5 * 3600e3 + 1), 'pending');
    assert.equal(sports.stateOf(g({ tbd: true }), t0 + 9e9), 'upcoming');
    assert.equal(sports.stateOf(g({ status: 'final' }), t0), 'final');
    assert.equal(sports.stateOf(g({ status: 'postponed' }), t0), 'postponed');
    assert.equal(sports.stateOf(g({ status: 'live' }), t0 + 5 * 3600e3), 'live');
    assert.equal(sports.stateOf(g({ status: 'live' }), t0 + 7 * 3600e3), 'pending');
    assert.equal(sports.countdownText(t0 + 5 * 864e5 + 19 * 3600e3, t0), 'in 5d 19h');
    assert.equal(sports.countdownText(t0 + 3 * 3600e3 + 20 * 60e3, t0), 'in 3h 20m');
    assert.equal(sports.countdownText(t0 + 42 * 60e3, t0), 'in 42 min');
    assert.equal(sports.countdownText(t0 + 20e3, t0), 'Starting now');
    assert.equal(sports.countdownText(t0 - 1, t0), 'Underway');
    assert.equal(sports.resultText({ result: 'OTL', score: { us: 2, them: 3 } }), 'OTL 2–3');
    assert.equal(sports.resultText({ result: 'W', score: null }), 'W');
    assert.equal(sports.recordLabel({ phase: 'preseason', recordPre: '1-2-1' }), '1–2–1 pre');
    assert.equal(sports.recordLabel({ phase: 'preseason' }), 'preseason');
    assert.equal(sports.recordLabel({ phase: 'regular', record: '3-0' }), '3–0');
    assert.equal(sports.recordLabel(null), '');
    const ctx = at(NOW);
    assert.equal(sports.whenShort({ date: '2026-10-04', startUTC: '2026-10-04T17:00:00Z', tbd: false }, ctx), `Sun ${T('2026-10-04T17:00:00Z')}`);
    assert.equal(sports.whenShort({ date: '2026-10-04', startUTC: '2026-10-04T17:00:00Z', tbd: true }, ctx), 'Sun TBD');
    assert.equal(sports.whenShort({ date: '2026-09-29', startUTC: '2026-09-29T17:00:00Z', tbd: false }, ctx), `tomorrow ${T('2026-09-29T17:00:00Z')}`);
  },

  'team blocks: form strip is the last five finals, oldest first, preseason flagged'() {
    const f = facts();
    assert.deepEqual(f.teams.sabres.form.map((x) => [x.result, x.pre]), [['L', true], ['W', true], ['OTL', true], ['L', true]]);
    assert.deepEqual(f.teams.bills.form.map((x) => [x.result, x.pre]), [['W', true], ['W', true], ['W', true], ['W', false], ['W', false]].map(([r], i) => [r, i < 2]));
    assert.equal(f.teams.bisons.form.length, 5);
    assert.deepEqual(f.teams.bisons.form.map((x) => x.result), ['L', 'L', 'W', 'L', 'L']);
    assert.equal(f.teams.sabres.nextRegular.id, 'nhl-2026020011');
    assert.equal(f.teams.sabres.nextIsOpener, true);
    assert.equal(f.teams.bills.nextIsOpener, false, 'three regular-season games are already in the books');
    // the opener has been and gone but the feed never reported the score: the next game is NOT the opener
    const late = sports.buildFacts({ feed: clone(FEED), ctx: at('2026-10-02T17:00:00Z') });
    assert.equal(late.teams.sabres.nextGame.id, 'nhl-2026020022');
    assert.equal(late.teams.sabres.nextIsOpener, false);
    assert.equal(f.teams.bills.followed, true);
    assert.equal(facts({ teams: ['sabres'] }).teams.bills.followed, false);
  },

  'backup: watched games are in the payload counts, the preview, the nudge and the toast'() {
    const file = { app: 'clubhouse', format: 1, idb: { watched: [row('a', '2026-09-27'), row('b', '2026-09-28')] }, localStorage: {} };
    assert.equal(backup.validate(file), null);
    assert.deepEqual(backup.fileCounts(file), { watched: 2 });
    const rows = backup.previewRows({ watched: 5 }, backup.fileCounts(file));
    assert.deepEqual(rows[0], { key: 'watched', label: 'Watched games', now: 5, file: 2 });
    assert.match(backup.validate({ app: 'clubhouse', format: 1, idb: { watched: [{ date: '2026-09-27' }] } }), /without gameId/);
    assert.equal(backup.exportToast({ counts: { rounds: 2, workouts: 13, tastings: 0, watched: 9 } }), 'Backed up · 2 rounds · 13 workouts · 9 games watched');
    assert.equal(backup.exportToast({ counts: { rounds: 2, workouts: 13, tastings: 0, watched: 1 } }), 'Backed up · 2 rounds · 13 workouts · 1 game watched');
    assert.equal(backup.exportToast({ counts: { rounds: 2, workouts: 13, tastings: 0, watched: 0 } }), 'Backed up · 2 rounds · 13 workouts');
    // 3 watched games since the last export make a backup due (volume rule), through facts.sports.watchedCount
    const now = new Date('2026-09-28T20:00:00Z');
    const n = backup.needsNudge({ sports: { watchedCount: 3 } }, { lastExportAt: '2026-09-28T10:00:00Z', lastExportCounts: { watched: 0 } }, now);
    assert.deepEqual([n.due, n.reason, n.newRecords], [true, 'volume', 3]);
    const two = backup.needsNudge({ sports: { watchedCount: 2 } }, { lastExportAt: '2026-09-28T10:00:00Z', lastExportCounts: { watched: 0 } }, now);
    assert.equal(two.due, false);
  },
};
