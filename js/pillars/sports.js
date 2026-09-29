// Sports pillar (SPEC §5.3): reads data/sports.json (written server-side by scripts/ingest-sports.mjs) plus the
// `watched` rows in IndexedDB. Implements the §2 pillar API and also exports what Home / the Coach / the Sports
// screen share: nextUpCard(), the S0–S5 rules (insights()), and the watched-row writers.
//
// Pure where it can be: buildFacts() takes the parsed feed + rows + ctx and touches nothing else, so it is unit-tested
// in Node (tests/sports-facts.test.mjs). Only loadFeed()/facts()/the writers touch fetch or IndexedDB.
import * as store from '../store.js';
import { addDays, dowIndex, dayWord, time12, monD, ymd, makeCtx, DOW } from '../dates.js';
import { baseSummary, marksFromDates, countInWeek, weeklyHistory } from './_shared.js';

export const id = 'sports';
export const meta = {
  label: 'Sports', glyph: 'sports', unit: { one: 'game caught', many: 'games caught' }, verb: 'watched',
  goalKey: 'goal.sports', defaultGoal: 3, goalMin: 1, goalMax: 14, href: '#/sports',
};

export const TEAM_IDS = ['bills', 'sabres', 'bisons'];
export const DEFAULT_TEAMS = TEAM_IDS;
export const FEED_URL = './data/sports.json';
export const STALE_HOURS = 36;
const GRACE_MS = 4 * 3600e3;
const HOURS = { NFL: 4, NHL: 3.5, MiLB: 3.5 };
const SOURCE_TEAM = { 'espn-nfl': 'Bills', 'nhl-web': 'Sabres', 'mlb-stats': 'Bisons' };
const OFFSEASON_BACK = { bills: 'September', sabres: 'October', bisons: 'April' };

/* ------------------------------------------------------------------ small pure helpers (also used by the screen) */

/** '3-0' → '3–0' (en dash between digits), for records and scores. */
export const dash = (s) => String(s ?? '').replace(/(\d)-(?=\d)/g, '$1–');

/** 'BUF -7.5' → 'Bills −7.5' (team name for the abbreviation, real minus sign). */
export function lineText(line, teamShort, oppAbbr, oppShort) {
  if (!line) return null;
  let s = String(line);
  s = s.replace(/^BUF\b/, teamShort || 'BUF');
  if (oppAbbr && oppShort) s = s.replace(new RegExp(`^${oppAbbr}\\b`), oppShort);
  return s.replace(/-(?=\d)/g, '−');
}

/** 'scheduled' games that should be over by now are 'pending' — the feed just hasn't reported the final yet. */
export function stateOf(g, nowMs) {
  if (g.status === 'postponed') return 'postponed';
  if (g.status === 'final') return 'final';
  const start = Date.parse(g.startUTC);
  const dur = (HOURS[g.league] || 3.5) * 3600e3;
  if (g.status === 'live') return nowMs > start + dur + 2 * 3600e3 ? 'pending' : 'live';
  if (g.tbd || nowMs < start) return 'upcoming';
  return nowMs <= start + dur ? 'live' : 'pending';
}

/** 'in 5d 19h' · 'in 3h 20m' · 'in 42 min' · 'Starting now' · 'Underway'. */
export function countdownText(startMs, nowMs) {
  const diff = startMs - nowMs;
  if (diff <= 0) return 'Underway';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Starting now';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `in ${h}h ${min % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** 'Sun 1:00' / 'Sun TBD' — weekday (or today/tomorrow) + clock, no am/pm because the day is stated (§0). */
export function whenShort(g, ctx) {
  return `${dayWord(g.date, ctx, { short: true })} ${g.tbd ? 'TBD' : time12(g.startUTC)}`;
}

/** The result chip text: 'W 24–16', 'OTL 2–3'. */
export function resultText(g) {
  if (!g.score) return g.result || '';
  return `${g.result || ''} ${g.score.us}–${g.score.them}`.trim();
}

const ord = (t) => TEAM_IDS.indexOf(t);
const byStartThenTeam = (a, b) => a.startMs - b.startMs || ord(a.team) - ord(b.team);

/** Record shown in cards: preseason teams show their preseason record, labelled. */
export function recordLabel(team) {
  if (!team) return '';
  if (team.phase === 'preseason') return team.recordPre ? `${dash(team.recordPre)} pre` : 'preseason';
  return team.record ? dash(team.record) : '';
}

/* ------------------------------------------------------------------ feed loading */

let lastGood = null;
let memo = null;

function isFeed(d) {
  return Boolean(d && d.schemaVersion === 1 && Array.isArray(d.games) && d.teams && typeof d.teams === 'object');
}

async function fetchFeed(timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(FEED_URL, { cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!isFeed(data)) throw new Error('unrecognised feed format');
    lastGood = data;
    return { data, error: null, failed: false };
  } catch (err) {
    // The service worker already falls back to its cached copy when offline; this is the belt to that braces.
    return { data: lastGood, error: String(err && err.message ? err.message : err), failed: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetches ./data/sports.json at most once a minute; a failed fetch is remembered for only 15 s (so coming back to the
 * screen retries soon, but a dead network never makes every render wait) and falls back to the last good copy in memory.
 */
export function loadFeed({ force = false, timeoutMs = 5000 } = {}) {
  if (!force && memo && Date.now() < memo.until) return memo.promise;
  const entry = { until: Date.now() + 60000, promise: null };
  entry.promise = fetchFeed(timeoutMs).then((r) => { if (r.failed) entry.until = Date.now() + 15000; return r; });
  memo = entry;
  return entry.promise;
}

/** Test hook. */
export function _resetFeedCache() { lastGood = null; memo = null; }

/* ------------------------------------------------------------------ facts */

function zeroFacts(ctx, rows = [], extra = {}) {
  const watched = Object.fromEntries(rows.map((r) => [r.gameId, r]));
  const dates = rows.map((r) => r.date);
  const weekEnd = addDays(ctx.weekStart, 6);
  return {
    available: false, error: null, fetchFailed: false, offline: false,
    generatedAt: null, ageHours: null, stale: false, sourcesDown: [], sources: [],
    followed: DEFAULT_TEAMS.slice(), teams: {}, games: [], weekGames: [],
    watched, watchedCount: rows.length,
    watchedThisWeek: rows.filter((r) => r.date >= ctx.weekStart && r.date <= weekEnd).map(rowAsGame),
    prevWeekWatched: rows.filter((r) => r.date >= ctx.prevWeekStart && r.date < ctx.weekStart).length,
    byDay: marksFromDates(dates, ctx.weekStart),
    nextGame: null, next2: null, lastResult: null, lastResultWatched: false, billsWatchedStreak: 0, billsWatchedSince: null,
    dismissed: {},
    weeklyHistory: weeklyHistory(dates, ctx.today),
    ...extra,
  };
}

/** A watched row whose game is no longer in the feed still counts; it just has less to show. */
function rowAsGame(r) {
  return { id: r.gameId, team: r.team, date: r.date, startUTC: null, status: 'final', opponent: { name: '', short: '', abbr: '', record: null }, score: null, result: null, home: false, tbd: false, seasonType: 'regular', note: null, missing: true };
}

/**
 * Pure. feed = parsed data/sports.json (or null); rows = IDB `watched`; teams = followed ids; dismissed = {gameId: true}.
 * Never throws.
 */
export function buildFacts({ feed, rows = [], teams = DEFAULT_TEAMS, dismissed = {}, ctx, fetchError = null, fetchFailed = false, offline = false }) {
  const base = zeroFacts(ctx, rows, { dismissed, offline, fetchFailed, error: fetchError });
  if (!isFeed(feed)) return base;
  try {
    const nowMs = +ctx.now;
    const followed = TEAM_IDS.filter((t) => (Array.isArray(teams) && teams.length ? teams : DEFAULT_TEAMS).includes(t));
    const watched = base.watched;
    const gen = Date.parse(feed.generatedAt);
    const ageHours = Number.isFinite(gen) ? Math.max(0, (nowMs - gen) / 3600e3) : null;
    const stale = ageHours == null || ageHours > STALE_HOURS;
    const sourcesDown = (feed.sources || []).filter((s) => !s.ok).map((s) => SOURCE_TEAM[s.id] || s.label);
    const weekEnd = addDays(ctx.weekStart, 6);

    const hydrate = (g) => {
      const startMs = Date.parse(g.startUTC);
      return { ...g, startMs, state: stateOf(g, nowMs), watchedRow: watched[g.id] || null };
    };
    const allGames = (feed.games || []).map(hydrate).sort(byStartThenTeam);
    const games = allGames.filter((g) => followed.includes(g.team));
    const gameById = Object.fromEntries(allGames.map((g) => [g.id, g]));

    // upcoming: not final, not postponed, and not more than 4 h past its start (SPEC nextGame grace)
    const upcomingOf = (list) => list.filter((g) => (g.state === 'upcoming' || g.state === 'live') && g.startMs >= nowMs - GRACE_MS);
    const finalsOf = (list) => list.filter((g) => g.state === 'final' || g.state === 'pending').sort((a, b) => a.startMs - b.startMs);

    const teamsOut = {};
    for (const tid of TEAM_IDS) {
      const block = feed.teams[tid];
      if (!block) continue;
      const mine = allGames.filter((g) => g.team === tid);
      const fin = finalsOf(mine).filter((g) => g.state === 'final');
      const form = fin.slice(-5).map((g) => ({ gameId: g.id, result: g.result, pre: g.seasonType === 'preseason', opp: g.opponent.short, score: g.score, date: g.date }));
      const up = upcomingOf(mine);
      teamsOut[tid] = {
        ...block, followed: followed.includes(tid),
        nextGame: up[0] || null, lastGame: fin[fin.length - 1] || null, form,
        nextRegular: up.find((g) => g.seasonType !== 'preseason') || null,
        // the next game is the season opener only if no regular-season game (final or pending) precedes it
        nextIsOpener: Boolean(up[0] && up[0].seasonType === 'regular' && !mine.some((x) => x.seasonType === 'regular' && x.startMs < up[0].startMs)),
        tag: block.tag || (tid === 'bills' ? 'NFL' : tid === 'sabres' ? 'NHL' : 'AAA'),
      };
    }

    const weekGames = games.filter((g) => g.date >= ctx.weekStart && g.date <= weekEnd && g.state !== 'postponed');
    const up = upcomingOf(games).sort(byStartThenTeam);
    const nextGame = up[0] || null;
    const next2 = nextGame ? (up.slice(1).find((g) => g.team !== nextGame.team) || up[1] || null) : null;

    const recent = finalsOf(games).filter((g) => g.state === 'final' && (ctx.today <= addDays(g.date, 3)));
    const lastResult = recent.length ? recent[recent.length - 1] : null;

    // Bills streak: most recent regular/post finals backwards, stopping at the first one with no watched row
    let streak = 0, since = null;
    const bills = allGames.filter((g) => g.team === 'bills' && g.state === 'final' && g.seasonType !== 'preseason').sort((a, b) => b.startMs - a.startMs);
    for (const g of bills) {
      if (!watched[g.id]) break;
      streak++; since = g.date;
    }

    const dates = rows.map((r) => r.date);
    const watchedThisWeek = rows.filter((r) => r.date >= ctx.weekStart && r.date <= weekEnd).map((r) => (gameById[r.gameId] ? { ...gameById[r.gameId] } : rowAsGame(r)));

    return {
      ...base,
      available: true, error: fetchError, fetchFailed,
      generatedAt: feed.generatedAt, ageHours, stale, sourcesDown, sources: feed.sources || [],
      followed, teams: teamsOut, games, weekGames,
      watchedThisWeek,
      nextGame, next2, lastResult, lastResultWatched: Boolean(lastResult && watched[lastResult.id]),
      billsWatchedStreak: streak, billsWatchedSince: since,
      window: feed.window || null,
    };
  } catch (err) {
    return { ...base, error: `sports feed could not be read: ${err && err.message ? err.message : err}` };
  }
}

export async function facts(ctx) {
  try {
    let rows = [];
    let map = {};
    try { rows = await store.getAll('watched'); } catch { rows = []; }
    try { map = await store.settingsMap(); } catch { map = {}; }
    const teams = Array.isArray(map['sports.teams']) && map['sports.teams'].length ? map['sports.teams'] : DEFAULT_TEAMS;
    const dismissed = {};
    for (const [k, v] of Object.entries(map)) if (k.startsWith('sports.dismissed.') && v) dismissed[k.slice('sports.dismissed.'.length)] = true;
    const r = await loadFeed();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return buildFacts({ feed: r.data, rows, teams, dismissed, ctx, fetchError: r.error, fetchFailed: r.failed, offline });
  } catch (err) {
    return { ...zeroFacts(ctx), error: String(err && err.message ? err.message : err) };
  }
}

/* ------------------------------------------------------------------ summary / dayMarks / weekCount */

const ageDays = (f) => Math.max(1, Math.round((f.ageHours || 0) / 24));

export function summary(f, goal, ctx = makeCtx(new Date())) {
  const weekN = (f.weekGames || []).length;
  const ringGoal = f.available ? Math.max(1, Math.min(goal, weekN)) : goal; // no feed: show the plain goal on the dotted ring
  const s = baseSummary(meta, id, (f.watchedThisWeek || []).length, ringGoal);
  if (!f.available) {
    s.empty = {
      title: 'No schedule yet',
      body: f.fetchFailed ? 'The schedule didn’t load. It comes back the next time you’re online — games you watch still count.' : 'The sports feed hasn’t been built. It fills in on the first Action run.',
      cta: null,
    };
    return s;
  }
  s.freshness = { asOf: f.generatedAt, stale: Boolean(f.stale) };
  const next = f.nextGame;
  const now = +ctx.now;
  if (f.stale) {
    s.note = { text: `Feed ${ageDays(f)}d old`, tone: 'warm', icon: 'warn' };
  } else if (next && next.startMs - now <= 6 * 864e5) {
    const short = f.teams[next.team]?.short || next.team;
    s.note = { text: next.state === 'live' ? `${short} · underway` : `${short} · ${whenShort(next, ctx)}`, tone: 'neutral' };
  } else if (f.lastResult) {
    const r = f.lastResult;
    const short = f.teams[r.team]?.short || r.team;
    s.note = { text: `${short} ${resultText(r)}`, tone: r.result === 'W' ? 'good' : 'neutral', icon: r.result === 'W' ? 'check' : null };
  } else if (next) {
    const short = f.teams[next.team]?.short || next.team;
    s.note = { text: `${short} · ${monD(next.date)}`, tone: 'neutral' };
  } else {
    s.note = { text: 'Off-season', tone: 'neutral' };
  }
  return s;
}

export function dayMarks(f, ctx) {
  return f.byDay && f.byDay.length === 7 ? f.byDay : marksFromDates([], ctx.weekStart);
}

export function weekCount(f, weekStart) {
  return countInWeek(Object.values(f.watched || {}).map((r) => r.date), weekStart);
}

/**
 * W-L of the games you watched in a past week (the recap's `2 W · 1 L`, SPEC §6.6): finals only, OTL/SOL count as losses,
 * ties are neither. { w, l, t, n } where n = watched games in that week whose result is in the feed.
 */
export function weekResults(f, weekStart) {
  const end = addDays(weekStart, 6);
  const byId = new Map((f.games || []).map((g) => [g.id, g]));
  const out = { w: 0, l: 0, t: 0, n: 0 };
  for (const r of Object.values(f.watched || {})) {
    if (r.date < weekStart || r.date > end) continue;
    const g = byId.get(r.gameId);
    if (!g || g.status !== 'final' || !g.result) continue;
    out.n++;
    if (g.result === 'W') out.w++;
    else if (g.result === 'T') out.t++;
    else out.l++;
  }
  return out;
}

export const quickLog = {
  kinds: [
    {
      k: 'game', label: 'Game', glyph: 'sports', mode: 'form',
      sub: (f) => {
        const r = f && f.available ? f.lastResult : null;
        if (r && !f.lastResultWatched) return `${f.teams[r.team]?.short || 'Game'} ${resultText(r)} — catch it?`;
        return 'Bills · Sabres · Bisons';
      },
    },
  ],
};

/* ------------------------------------------------------------------ Next Up card (Home) */

/** '3–0 · home' — the mock's 10-character shape. A longer string (three-part hockey record, MiLB '68–79') keeps just the
 *  record: the card's own layout already says who is home (away left, home right) and the column is ~60 px wide. */
function sideRec(record, role) {
  const r = record ? dash(record) : '';
  const full = [r, role].filter(Boolean).join(' · ');
  return full.length <= 10 ? full : (r || role);
}

function sideOf(team, g, buffalo) {
  const role = (g.home === buffalo) ? 'home' : 'away';
  if (buffalo) return { name: team.short, abbr: 'BUF', rec: sideRec(team.phase === 'preseason' ? (team.recordPre || team.record) : team.record, role), buf: true };
  const o = g.opponent;
  return { name: o.short, abbr: o.abbr, rec: sideRec(o.record, role), buf: false };
}

/**
 * The mock's `.game` card view-model (SPEC §5.3). Away side left, home side right; the Buffalo side always
 * carries the filled `.buf` badge. null when there is no upcoming game or no feed.
 */
export function nextUpCard(f, ctx) {
  if (!f || !f.available || !f.nextGame) return null;
  const g = f.nextGame;
  const team = f.teams[g.team];
  if (!team) return null;
  const buf = sideOf(team, g, true), opp = sideOf(team, g, false);
  const home = g.home ? buf : opp;
  const away = g.home ? opp : buf;
  const n2 = f.next2;
  let next2 = null;
  if (n2 && f.teams[n2.team]) {
    const t2 = f.teams[n2.team];
    const rest = `${n2.home ? 'vs' : 'at'} ${n2.opponent.short}${n2.seasonType === 'preseason' ? ' · preseason' : ''}`;
    next2 = { text: `${t2.short} ${rest}`, team: t2.short, rest, when: whenShort(n2, ctx), gameId: n2.id };
  }
  return {
    game: g, home, away,
    when: { time: g.tbd ? 'TBD' : time12(g.startUTC), day: `${DOW[dowIndex(g.date)]} · ${monD(g.date)}` },
    venue: g.venue || '', tv: g.tv || null,
    // the .tag chip: the betting line when there is one, else a plain "Preseason" so 0–0 vs 1–2–1 is never a mystery
    line: lineText(g.line, team.short, g.opponent.abbr, g.opponent.short) || (g.seasonType === 'preseason' ? 'Preseason' : null),
    countdown: countdownText(g.startMs, +ctx.now),
    next2,
  };
}

/* ------------------------------------------------------------------ Coach rules S0–S5 (SPEC §6.3) */

const PILLAR = 'sports';
const plural = (n, one, many) => (n === 1 ? one : many);

function ringGoalOf(F) {
  const f = F.facts.sports;
  return Math.max(1, Math.min(F.goals?.sports ?? meta.defaultGoal, (f.weekGames || []).length));
}

export const rules = [
  // S0 — the feed is old
  (F) => {
    const f = F.facts.sports;
    if (!f || !f.available || !f.stale) return null;
    const d = ageDays(f);
    const gen = new Date(f.generatedAt);
    const built = `${monD(ymd(gen))} ${time12(gen)}`;
    return {
      id: 'S0', pillar: PILLAR, priority: 30, tone: 'warm', kicker: 'Sports · Feed',
      headline: `The sports feed is <span class="warn">${d} ${plural(d, 'day', 'days')}</span> old.`,
      sub: `Last built ${built}${f.sourcesDown.length ? ` · ${f.sourcesDown.join(', ')} down` : ''}`,
      viz: null, href: '#/sports', actions: null,
    };
  },
  // S1 — next game inside a week (Sports screen only; Home has the Next Up card)
  (F) => {
    const f = F.facts.sports;
    const g = f && f.available ? f.nextGame : null;
    if (!g || g.startMs - +F.ctx.now > 7 * 864e5) return null;
    const team = f.teams[g.team];
    const bits = [g.venue, g.tv, lineText(g.line, team.short, g.opponent.abbr, g.opponent.short), g.note === 'preseason' ? 'preseason' : null].filter(Boolean);
    return {
      id: 'S1', pillar: PILLAR, priority: 70, tone: 'neutral', kicker: 'Sports · Next', screenOnly: true,
      headline: `<strong>${team.short}</strong> ${g.home ? 'host' : 'at'} ${g.opponent.short} ${dayWord(g.date, F.ctx)} ${g.tbd ? 'TBD' : time12(g.startUTC)}.`,
      sub: bits.join(' · '), viz: null, href: '#/sports', actions: null,
    };
  },
  // S2 — a recent final you haven't marked
  (F) => {
    const f = F.facts.sports;
    const g = f && f.available ? f.lastResult : null;
    if (!g || f.lastResultWatched || (f.dismissed && f.dismissed[g.id])) return null;
    const team = f.teams[g.team];
    const verb = g.result === 'W' ? 'beat' : g.result === 'T' ? 'tied' : 'fell to';
    return {
      id: 'S2', pillar: PILLAR, priority: 65, tone: g.result === 'W' ? 'good' : 'neutral', kicker: `Sports · ${team.short}`,
      headline: `${team.short} <strong>${verb} the ${g.opponent.short} ${g.score.us}–${g.score.them}</strong> ${dayWord(g.date, F.ctx)}. Catch it?`,
      sub: 'Tap to mark watched', viz: null, href: '#/sports', data: { gameId: g.id },
      actions: [{ label: 'Watched it', run: 'sports.watched', arg: g.id }, { label: 'Missed it', run: 'sports.missed', arg: g.id }],
    };
  },
  // S3 — Bills watched streak
  (F) => {
    const f = F.facts.sports;
    if (!f || !f.available || f.billsWatchedStreak < 3) return null;
    return {
      id: 'S3', pillar: PILLAR, priority: 40, tone: 'good', kicker: 'Sports · Streak',
      headline: `<strong>${f.billsWatchedStreak} Bills games</strong> watched in a row.`,
      sub: `Since ${monD(f.billsWatchedSince)}`, viz: null, href: '#/sports', actions: null,
    };
  },
  // S4 — one game from the weekly goal
  (F) => {
    const f = F.facts.sports;
    if (!f || !f.available || !f.weekGames.length) return null;
    const goal = ringGoalOf(F);
    const n = f.watchedThisWeek.length;
    if (goal - n !== 1) return null;
    const remaining = f.weekGames.filter((g) => !f.watched[g.id]).slice(0, 3)
      .map((g) => `${f.teams[g.team]?.short || g.team} ${whenShort(g, F.ctx)}`);
    return {
      id: 'S4', pillar: PILLAR, priority: 45, tone: 'neutral', kicker: `Sports · ${n} of ${goal}`,
      headline: 'One more game <strong>hits your goal</strong> this week.',
      sub: remaining.join(' · '),
      viz: { type: 'dots7', on: f.byDay, todayIndex: F.ctx.dayIndex }, href: '#/sports', actions: null,
    };
  },
  // S5 — standings (Sports screen only)
  (F) => {
    const f = F.facts.sports;
    if (!f || !f.available) return null;
    const cands = f.followed.map((t) => f.teams[t]).filter((t) => t && t.standing && t.record && t.phase !== 'offseason');
    if (!cands.length) return null;
    cands.sort((a, b) => (a.nextGame ? a.nextGame.startMs : Infinity) - (b.nextGame ? b.nextGame.startMs : Infinity));
    const t = cands[0];
    return {
      id: 'S5', pillar: PILLAR, priority: 25, tone: 'neutral', kicker: 'Sports · Standings', screenOnly: true,
      headline: `${t.short} <strong>${dash(t.record)}</strong>, ${t.standing}.`,
      sub: t.streak ? `streak ${t.streak}` : '', viz: null, href: '#/sports', actions: null,
    };
  },
];

/** Every sports insight that fires, highest priority first (screens show them uncapped, Home caps + drops screenOnly). */
export function insights(F) {
  return rules.map((r) => { try { return r(F); } catch (err) { console.warn('sports rule failed', err); return null; } })
    .filter(Boolean).sort((a, b) => b.priority - a.priority);
}

/* ------------------------------------------------------------------ writers (the Sports screen and Home's S2 actions share these) */

/** Writes the `watched` row for a game. Idempotent. Returns the row. */
export async function markWatched(game, { where = '', note = '' } = {}) {
  const row = { gameId: game.id, date: game.date, team: game.team, watchedAt: new Date().toISOString(), where, note };
  await store.put('watched', row);
  return row;
}

/**
 * Removes a watched row. Deleting a record is destructive (SPEC §3.7), so a `before-unwatch` snapshot is taken first —
 * unless the newest snapshot is already a `before-unwatch` from the last 10 minutes (a burst of taps would otherwise
 * push the before-import snapshot out of the rolling five). Returns the removed row so the caller can offer Undo.
 */
export async function unmarkWatched(gameId) {
  const row = await store.get('watched', gameId);
  if (!row) return null;
  const backup = await import('../backup.js');
  const snaps = await backup.listSnapshots();
  const fresh = snaps[0] && snaps[0].label === 'before-unwatch' && Date.now() - Date.parse(snaps[0].at) < 10 * 60000;
  if (!fresh) await backup.snapshot('before-unwatch'); // if this throws, nothing is deleted
  await store.del('watched', gameId);
  return row;
}

export async function restoreWatched(row) {
  await store.put('watched', row);
}

/** "Missed it" — S2 stops asking about that game. */
export async function dismissGame(gameId) {
  await store.setSetting(`sports.dismissed.${gameId}`, true);
}
