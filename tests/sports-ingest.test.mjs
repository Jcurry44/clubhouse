// scripts/ingest-sports.mjs against recorded upstream responses (tests/fixtures/, recorded 2026-09-28 from the
// live ESPN / NHL api-web / MLB StatsAPI endpoints and trimmed to the fields the parsers read).
// The clock is pinned to 2026-09-28 17:00Z: Bills 3-0 with the Patriots next, Sabres between preseason and the
// opener, Bisons in the off-season.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ing from '../scripts/ingest-sports.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, 'fixtures');
const SCRIPT = join(here, '..', 'scripts', 'ingest-sports.mjs');
const NOW = new Date('2026-09-28T17:00:00Z');
const quiet = () => {};
const fromFixtures = () => ing.fixtureGetJson(FX);
const run = (extra = {}) => ing.collect({ now: NOW, getJson: fromFixtures(), log: quiet, ...extra });

/** A getJson that throws for fixture names matching `re`, otherwise reads the fixtures. */
const failing = (re) => async (req) => {
  if (re.test(req.fx)) throw new Error('HTTP 503');
  return fromFixtures()(req);
};

export const tests = {
  async 'a fixture run validates against the SPEC 5.1 schema'() {
    const feed = await run();
    assert.deepEqual(ing.validateFeed(feed), []);
    assert.equal(feed.schemaVersion, 1);
    assert.equal(feed.generatedAt, '2026-09-28T17:00:00Z');
    assert.deepEqual(feed.window, { from: '2026-07-30', to: '2026-10-28' });
    assert.deepEqual(feed.sources.map((s) => s.id), ['espn-nfl', 'nhl-web', 'mlb-stats']);
    assert.ok(feed.sources.every((s) => s.ok && s.error === null && s.itemCount > 0));
  },

  async 'bills: record, standing, streak, next game with the line'() {
    const { teams, games } = await run();
    const t = teams.bills;
    assert.equal(t.record, '3-0');
    assert.deepEqual(t.recordDetail, { w: 3, l: 0, t: 0, otl: null });
    assert.equal(t.standing, '1st in AFC East');
    assert.equal(t.streak, 'W3');
    assert.equal(t.phase, 'regular');
    assert.equal(t.stale, false);
    assert.equal(t.nextGameId, 'nfl-401872971');
    assert.equal(t.lastGameId, 'nfl-401872953');
    const next = games.find((g) => g.id === 'nfl-401872971');
    assert.equal(next.home, true);
    assert.equal(next.opponent.short, 'Patriots');
    assert.equal(next.opponent.record, '1-2');
    assert.equal(next.line, 'BUF -7');
    assert.equal(next.overUnder, 48.5);
    assert.equal(next.tv, 'CBS');
    assert.equal(next.week, 4);
    assert.equal(next.date, '2026-10-04');
    assert.equal(next.status, 'scheduled');
    assert.equal(next.score, null);
    assert.equal(next.result, null);
  },

  async 'bills: yesterday is a final with a W and the score'() {
    const { games } = await run();
    const g = games.find((x) => x.id === 'nfl-401872953');
    assert.equal(g.status, 'final');
    assert.equal(g.result, 'W');
    assert.deepEqual(g.score, { us: 24, them: 16 });
    assert.equal(g.opponent.abbr, 'LAC');
    assert.equal(g.line, null);
  },

  async 'sabres: preseason shows its own record, no standing before game one'() {
    const { teams, games } = await run();
    const t = teams.sabres;
    assert.equal(t.phase, 'preseason');
    assert.equal(t.record, '0-0-0');
    assert.equal(t.recordPre, '1-2-1');
    assert.equal(t.standing, null);
    assert.equal(t.streak, null);
    assert.equal(t.nextGameId, 'nhl-2026020011');
    const pre = games.filter((g) => g.team === 'sabres' && g.seasonType === 'preseason');
    assert.equal(pre.length, 4);
    assert.ok(pre.every((g) => g.note === 'preseason' && g.status === 'final'));
    // the OT loss at Detroit is OTL, not L
    assert.deepEqual(pre.map((g) => g.result), ['L', 'W', 'OTL', 'L']);
    const opener = games.find((g) => g.id === 'nhl-2026020011');
    assert.equal(opener.home, false);
    assert.equal(opener.opponent.short, 'Blue Jackets');
    assert.equal(opener.opponent.name, 'Columbus Blue Jackets');
    assert.equal(opener.tv, 'MSG-B');
    assert.equal(opener.note, null);
  },

  async 'bisons: off-season keeps the final table, no next game, cancelled game dropped'() {
    const { teams, games } = await run();
    const t = teams.bisons;
    assert.equal(t.phase, 'offseason');
    assert.equal(t.record, '68-79');
    assert.equal(t.standing, '7th in IL East');
    assert.equal(t.streak, 'L2');
    assert.equal(t.nextGameId, null);
    assert.equal(t.lastGameId, 'milb-816903');
    assert.ok(!games.some((g) => g.id === 'milb-816824'), 'the Sep 12 cancelled nightcap must not appear');
    const last = games.find((g) => g.id === 'milb-816903');
    assert.equal(last.result, 'L');
    assert.deepEqual(last.score, { us: 8, them: 15 });
    assert.equal(last.home, true);
    assert.equal(last.venue, 'Sahlen Field');
  },

  async 'games: sorted by start, ids unique and prefixed, dates are New York dates, inside the window'() {
    const { games, window } = await run();
    for (let i = 1; i < games.length; i++) assert.ok(games[i - 1].startUTC <= games[i].startUTC);
    assert.equal(new Set(games.map((g) => g.id)).size, games.length);
    assert.ok(games.every((g) => /^(nfl|nhl|milb)-/.test(g.id)));
    assert.ok(games.every((g) => g.date === ing.nyDate(g.startUTC)));
    assert.ok(games.every((g) => g.date >= window.from && g.date <= window.to));
  },

  'nyDate: a 7:30 pm ET start is still that evening, a 00:15Z kickoff is the previous NY day'() {
    assert.equal(ing.nyDate('2026-10-13T00:15:00Z'), '2026-10-12');
    assert.equal(ing.nyDate('2026-10-03T23:00:00Z'), '2026-10-03');
    assert.equal(ing.nyDate('2026-01-01T04:59:00Z'), '2025-12-31');
    assert.equal(ing.nyDate('not a date'), null);
  },

  async 'a dead source carries its previous data forward stale, keeps asOf, and the run still validates'() {
    const first = await run();
    const later = new Date('2026-09-29T01:00:00Z');
    const second = await ing.collect({ now: later, getJson: failing(/^nhl-|^espn-nhl-/), prev: first, log: quiet });
    assert.deepEqual(ing.validateFeed(second), []);
    const s = second.teams.sabres;
    assert.equal(s.stale, true);
    assert.equal(s.asOf, first.teams.sabres.asOf, 'asOf must stay the last GOOD fetch');
    assert.equal(s.record, first.teams.sabres.record);
    assert.equal(second.games.filter((g) => g.team === 'sabres').length, first.games.filter((g) => g.team === 'sabres').length);
    const src = second.sources.find((x) => x.id === 'nhl-web');
    assert.equal(src.ok, false);
    assert.match(src.error, /503|fixture missing/);
    // the healthy teams are untouched and fresh
    assert.equal(second.teams.bills.stale, false);
    assert.equal(second.teams.bills.asOf, '2026-09-29T01:00:00Z');
    assert.equal(second.teams.bisons.stale, false);
  },

  async 'a dead source with no previous file yields an empty stale block, never a crash'() {
    const feed = await ing.collect({ now: NOW, getJson: failing(/^espn-nfl-/), prev: null, log: quiet });
    assert.deepEqual(ing.validateFeed(feed), []);
    assert.equal(feed.teams.bills.stale, true);
    assert.equal(feed.teams.bills.asOf, null);
    assert.equal(feed.teams.bills.record, null);
    assert.equal(feed.games.filter((g) => g.team === 'bills').length, 0);
    assert.equal(feed.sources.find((x) => x.id === 'espn-nfl').ok, false);
  },

  async 'every source down at once still produces a valid file'() {
    const first = await run();
    const feed = await ing.collect({ now: new Date('2026-09-29T09:00:00Z'), getJson: async () => { throw new Error('network down'); }, prev: first, log: quiet });
    assert.deepEqual(ing.validateFeed(feed), []);
    assert.ok(Object.values(feed.teams).every((t) => t.stale === true));
    assert.equal(feed.games.length, first.games.length);
  },

  async 'NHL falls back to ESPN and keeps the game ids the watched rows are keyed on'() {
    const first = await run();
    const feed = await ing.collect({ now: NOW, getJson: failing(/^nhl-schedule|^nhl-standings/), prev: first, log: quiet });
    assert.deepEqual(ing.validateFeed(feed), []);
    const src = feed.sources.find((x) => x.id === 'nhl-web');
    assert.equal(src.ok, true);
    assert.equal(src.via, 'espn-nhl');
    assert.match(src.warnings[0], /used ESPN NHL/);
    assert.equal(feed.teams.sabres.stale, false);
    const opener = feed.games.find((g) => g.team === 'sabres' && g.date === '2026-10-01');
    assert.equal(opener.id, 'nhl-2026020011', 'ESPN\'s own id must not replace the NHL id already in the previous file');
    assert.equal(opener.opponent.abbr, 'CBJ');
  },

  async 'odds are best-effort: no scoreboard fixture leaves the line empty and the source ok'() {
    const feed = await ing.collect({ now: NOW, getJson: failing(/^espn-nfl-scoreboard/), prev: null, log: quiet });
    const bills = feed.sources.find((x) => x.id === 'espn-nfl');
    assert.equal(bills.ok, true);
    assert.match(bills.warnings.join(' '), /odds/);
    assert.equal(feed.games.find((g) => g.id === 'nfl-401872971').line, null);
  },

  async 'the postseason schedule is optional too'() {
    const feed = await ing.collect({ now: NOW, getJson: failing(/^espn-nfl-schedule-(pre|post)/), prev: null, log: quiet });
    assert.equal(feed.sources.find((x) => x.id === 'espn-nfl').ok, true);
    assert.equal(feed.teams.bills.record, '3-0');
    assert.ok(!feed.games.some((g) => g.team === 'bills' && g.seasonType === 'preseason'));
  },

  async '--only re-runs one source and leaves the others exactly as they were'() {
    const first = await run();
    const later = new Date('2026-09-28T23:00:00Z');
    const feed = await ing.collect({ now: later, getJson: fromFixtures(), prev: first, log: quiet, only: ['bills'] });
    assert.equal(feed.teams.bills.asOf, '2026-09-28T23:00:00Z');
    assert.equal(feed.teams.sabres.asOf, first.teams.sabres.asOf);
    assert.equal(feed.games.filter((g) => g.team === 'sabres').length, first.games.filter((g) => g.team === 'sabres').length);
    assert.equal(feed.sources.length, 3);
  },

  async 'games outside today -60 / +30 days are dropped'() {
    const mk = (id, date) => ({ id: `nfl-${id}`, team: 'bills', league: 'NFL', seasonType: 'regular', week: 1, date, startUTC: `${date}T17:00:00Z`, tbd: false, home: true, opponent: { name: 'X', short: 'X', abbr: 'X', record: null }, venue: null, tv: null, line: null, overUnder: null, status: 'scheduled', score: null, result: null, note: null });
    const src = { id: 'espn-nfl', label: 'x', team: 'bills', async run(ctx) {
      const games = [mk('a', '2026-07-29'), mk('b', '2026-07-30'), mk('c', '2026-10-28'), mk('d', '2026-10-29')];
      return { team: ing.finalizeTeam(ing.TEAMS.bills, { season: 2026, games, now: ctx.now }), games };
    } };
    const feed = await ing.collect({ sources: [src], now: NOW, getJson: fromFixtures(), log: quiet });
    assert.deepEqual(feed.games.map((g) => g.id), ['nfl-b', 'nfl-c']);
  },

  'parseEspnEvents: TBD kickoff, playoff note, postponed, live, tie'() {
    const ev = (id, over = {}) => ({
      id, date: '2026-12-06T18:00Z', week: { number: 13 }, seasonType: { type: 2 },
      competitions: [{
        date: '2026-12-06T18:00Z', timeValid: true, venue: { fullName: 'Highmark Stadium' }, broadcasts: [{ media: { shortName: 'CBS' } }],
        status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
        competitors: [
          { homeAway: 'home', team: { abbreviation: 'BUF', displayName: 'Buffalo Bills' } },
          { homeAway: 'away', team: { abbreviation: 'NYJ', displayName: 'New York Jets', shortDisplayName: 'Jets' } },
        ],
        ...over,
      }],
    });
    const opts = { teamKey: 'bills', league: 'NFL', idPrefix: 'nfl' };
    const tbd = ing.parseEspnEvents([ev('1', { timeValid: false })], opts)[0];
    assert.equal(tbd.tbd, true);
    const post = ing.parseEspnEvents([{ ...ev('2'), seasonType: { type: 3 } }], opts)[0];
    assert.equal(post.seasonType, 'post');
    assert.equal(post.note, 'playoff');
    const ppd = ing.parseEspnEvents([ev('3', { status: { type: { name: 'STATUS_POSTPONED', state: 'pre' } } })], opts)[0];
    assert.equal(ppd.status, 'postponed');
    assert.equal(ppd.note, 'postponed');
    const live = ing.parseEspnEvents([ev('4', {
      status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
      competitors: [
        { homeAway: 'home', score: { value: 10 }, team: { abbreviation: 'BUF' } },
        { homeAway: 'away', score: { value: 7 }, team: { abbreviation: 'NYJ', displayName: 'New York Jets', shortDisplayName: 'Jets' } },
      ],
    })], opts)[0];
    assert.equal(live.status, 'live');
    assert.deepEqual(live.score, { us: 10, them: 7 });
    assert.equal(live.result, null);
    const tie = ing.parseEspnEvents([ev('5', {
      status: { type: { name: 'STATUS_FINAL', state: 'post', detail: 'Final/OT' } },
      competitors: [
        { homeAway: 'home', score: { value: 20 }, team: { abbreviation: 'BUF' } },
        { homeAway: 'away', score: { value: 20 }, team: { abbreviation: 'NYJ', displayName: 'New York Jets', shortDisplayName: 'Jets' } },
      ],
    })], opts)[0];
    assert.equal(tie.result, 'T');
  },

  'parseEspnEvents: a hockey shootout loss is SOL, an overtime loss OTL (from the detail text)'() {
    const ev = (detail) => ({
      id: detail, date: '2026-11-02T00:00Z', seasonType: { type: 2 },
      competitions: [{
        date: '2026-11-02T00:00Z', timeValid: true,
        status: { type: { name: 'STATUS_FINAL', state: 'post', detail } },
        competitors: [
          { homeAway: 'home', winner: false, score: '2', team: { abbreviation: 'BUF' } },
          { homeAway: 'away', winner: true, score: '3', team: { abbreviation: 'MTL', displayName: 'Montreal Canadiens', shortDisplayName: 'Canadiens' } },
        ],
      }],
    });
    const opts = { teamKey: 'sabres', league: 'NHL', idPrefix: 'nhl' };
    assert.equal(ing.parseEspnEvents([ev('Final/SO')], opts)[0].result, 'SOL');
    assert.equal(ing.parseEspnEvents([ev('Final/OT')], opts)[0].result, 'OTL');
    assert.equal(ing.parseEspnEvents([ev('Final')], opts)[0].result, 'L');
  },

  'parseMlb: postponed stays, cancelled is dropped, a live game carries a score with no result'() {
    const side = (id, score, extra = {}) => ({ team: { id, name: `Team ${id}`, teamName: `T${id}`, abbreviation: `T${id}` }, score, leagueRecord: { wins: 10, losses: 9 }, ...extra });
    const game = (pk, detailed, abs, extra = {}) => ({ gamePk: pk, gameType: 'R', gameDate: '2026-05-01T23:05:00Z', status: { detailedState: detailed, abstractGameState: abs }, teams: { away: side(422, 3), home: side(500, 4) }, venue: { name: 'Park' }, ...extra });
    const json = { dates: [{ games: [game(1, 'Postponed', 'Final'), game(2, 'Cancelled', 'Final'), game(3, 'In Progress', 'Live'), game(4, 'Scheduled', 'Preview', { status: { detailedState: 'Scheduled', abstractGameState: 'Preview', startTimeTBD: true } })] }] };
    const out = ing.parseMlb(json);
    assert.deepEqual(out.map((g) => g.id), ['milb-1', 'milb-3', 'milb-4']);
    assert.equal(out[0].status, 'postponed');
    assert.equal(out[1].status, 'live');
    assert.deepEqual(out[1].score, { us: 3, them: 4 });
    assert.equal(out[1].result, null);
    assert.equal(out[2].tbd, true);
    assert.equal(out[2].home, false);
  },

  'mlbStandingsGiven: falls through to the league that actually holds the Bisons'() {
    const other = { records: [{ division: { name: 'Pacific Coast League West' }, teamRecords: [{ team: { id: 1 }, wins: 1, losses: 1 }] }] };
    assert.equal(ing.mlbStandingsGiven(other), null);
    const mine = { records: [{ division: { name: 'International League East' }, teamRecords: [{ team: { id: 422 }, wins: 80, losses: 70, divisionRank: '2', streak: { streakCode: 'W4' } }] }] };
    assert.deepEqual(ing.mlbStandingsGiven(mine), { recordDetail: { w: 80, l: 70, t: null, otl: null }, record: '80-70', standing: '2nd in IL East', streak: 'W4' });
  },

  'nhlStandingsGiven: standing and streak only once a game has been played'() {
    const row = (gp) => ({ standings: [{ teamAbbrev: { default: 'BUF' }, gamesPlayed: gp, wins: 3, losses: 1, otLosses: 2, divisionSequence: 3, divisionName: 'Atlantic', streakCode: 'W', streakCount: 2 }] });
    const zero = ing.nhlStandingsGiven(row(0));
    assert.equal(zero.standing, null);
    assert.equal(zero.streak, null);
    const six = ing.nhlStandingsGiven(row(6));
    assert.equal(six.record, '3-1-2');
    assert.equal(six.standing, '3rd in Atlantic');
    assert.equal(six.streak, 'W2');
  },

  'tally, streakOf, recordString, ordinal'() {
    const fin = (r) => ({ result: r });
    const list = [fin('L'), fin('W'), fin('W'), fin('OTL'), fin('W'), fin('W'), fin('W')];
    assert.deepEqual(ing.tally(list), { w: 5, l: 1, t: 0, otl: 1 });
    assert.equal(ing.streakOf(list), 'W3');
    assert.equal(ing.streakOf([fin('W'), fin('OTL'), fin('SOL')]), 'OT2');
    assert.equal(ing.streakOf([]), null);
    assert.equal(ing.recordString('plain', { w: 3, l: 0, t: 0 }), '3-0');
    assert.equal(ing.recordString('plain', { w: 8, l: 8, t: 1 }), '8-8-1');
    assert.equal(ing.recordString('hockey', { w: 1, l: 1, otl: 1 }), '1-1-1');
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ing.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  },

  async 'finalizeTeam never turns a date window into a season record (MLB)'() {
    const games = [{ id: 'milb-1', team: 'bisons', seasonType: 'regular', status: 'final', result: 'W', startUTC: '2026-09-01T20:00:00Z' }];
    const t = ing.finalizeTeam(ing.TEAMS.bisons, { season: 2026, games, now: NOW, windowed: true });
    assert.equal(t.record, null);
    const t2 = ing.finalizeTeam(ing.TEAMS.bisons, { season: 2026, games, now: NOW });
    assert.equal(t2.record, '1-0');
  },

  async 'validateFeed catches the mistakes that would break the client'() {
    const ok = await run();
    assert.deepEqual(ing.validateFeed(ok), []);
    const clone = () => JSON.parse(JSON.stringify(ok));
    const has = (feed, re) => ing.validateFeed(feed).some((p) => re.test(p));

    let f = clone(); f.games.reverse();
    assert.ok(has(f, /sorted by startUTC/));
    f = clone(); f.games[3].date = '2026-01-01';
    assert.ok(has(f, /New_York date|outside the window/));
    f = clone(); f.games.find((g) => g.status === 'final').score = null;
    assert.ok(has(f, /needs a score/));
    f = clone(); f.games[0].team = 'jets';
    assert.ok(has(f, /bad team/));
    f = clone(); f.games[1].id = f.games[0].id;
    assert.ok(has(f, /duplicate id/));
    f = clone(); f.teams.bills.phase = 'summer';
    assert.ok(has(f, /bad phase/));
    f = clone(); f.sources[0].ok = false; f.sources[0].error = null;
    assert.ok(has(f, /error must be null when ok/));
    f = clone(); f.schemaVersion = 2;
    assert.ok(has(f, /schemaVersion/));
    f = clone(); f.games.find((g) => g.status === 'scheduled').result = 'W';
    assert.ok(has(f, /carry no score/));
  },

  async 'formatFeed is valid JSON that round-trips exactly, one game per line'() {
    const feed = await run();
    const text = ing.formatFeed(feed);
    assert.deepEqual(JSON.parse(text), feed);
    assert.ok(text.endsWith('}\n'));
    assert.ok(!text.includes('\r'));
    const gameLines = text.split('\n').filter((l) => /^ {4}\{"id":"(nfl|nhl|milb)-[0-9]/.test(l));
    assert.equal(gameLines.length, feed.games.length);
  },

  async 'shouldWrite: identical content is left alone, changes and the 20 h heartbeat are written'() {
    const prev = await run();
    const same = await ing.collect({ now: new Date('2026-09-28T21:00:00Z'), getJson: fromFixtures(), prev, log: quiet });
    assert.equal(ing.shouldWrite(same, prev, Date.parse('2026-09-28T21:00:00Z')).write, false);
    assert.equal(ing.shouldWrite(same, null).write, true);
    // 21 hours later with the same content → heartbeat keeps generatedAt honest
    const hb = ing.shouldWrite(same, prev, Date.parse('2026-09-29T14:00:01Z'));
    assert.equal(hb.write, true);
    assert.match(hb.why, /heartbeat/);
    // a real change
    const changed = JSON.parse(JSON.stringify(same));
    changed.teams.bills.record = '4-0';
    const c = ing.shouldWrite(changed, prev, Date.parse('2026-09-28T21:00:00Z'));
    assert.equal(c.write, true);
    assert.equal(c.why, 'content changed');
    // a stale flag flip counts as a change; a fresh asOf on a healthy team does not
    const stale = JSON.parse(JSON.stringify(same));
    stale.teams.sabres.stale = true;
    assert.equal(ing.shouldWrite(stale, prev, Date.parse('2026-09-28T21:00:00Z')).write, true);
  },

  'CLI: fixture run writes a valid file, a second identical run leaves it untouched, --dry writes nothing, exit code 0 even with every source down'() {
    const dir = mkdtempSync(join(tmpdir(), 'clubhouse-ingest-'));
    const out = join(dir, 'sports.json');
    const files = [out];
    try {
      const args = ['--fixture', FX, '--out', out, '--now', '2026-09-28T17:00:00Z', '--quiet'];
      let r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(out));
      const first = readFileSync(out, 'utf8');
      assert.deepEqual(ing.validateFeed(JSON.parse(first)), []);
      const m1 = statSync(out).mtimeMs;

      r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(out, 'utf8'), first);
      assert.equal(statSync(out).mtimeMs, m1, 'unchanged content must not rewrite the file');

      const dry = join(dir, 'dry.json');
      files.push(dry);
      r = spawnSync(process.execPath, [SCRIPT, '--fixture', FX, '--out', dry, '--dry', '--quiet'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(existsSync(dry), false);

      // every source down (empty fixture dir) with the good file as the previous one → exit 0, stale flags set
      const empty = mkdtempSync(join(tmpdir(), 'clubhouse-empty-'));
      try {
        r = spawnSync(process.execPath, [SCRIPT, '--fixture', empty, '--out', out, '--now', '2026-09-28T23:00:00Z', '--quiet'], { encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        const after = JSON.parse(readFileSync(out, 'utf8'));
        assert.ok(Object.values(after.teams).every((t) => t.stale));
        assert.equal(after.teams.bills.record, '3-0', 'the last good record survives a total outage');
        assert.deepEqual(ing.validateFeed(after), []);
      } finally { rmdirSync(empty); }
    } finally {
      for (const f of files) if (existsSync(f)) unlinkSync(f);
      rmdirSync(dir);
    }
  },
};
