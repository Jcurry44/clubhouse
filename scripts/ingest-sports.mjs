#!/usr/bin/env node
// Clubhouse sports ingest — server-side only (Node 18+, zero dependencies). SPEC §5.2.
//
//   node scripts/ingest-sports.mjs                       live run, writes data/sports.json
//   node scripts/ingest-sports.mjs --dry                 fetch + validate, print a summary, write nothing
//   node scripts/ingest-sports.mjs --fixture <dir>       read recorded responses instead of the network
//   options: --out <file>  --prev <file>  --now <iso>  --only bills,sabres  --quiet
//
// Sources (the FanSignal pattern — a phone's browser never talks to these hosts):
//   Bills   ESPN site API (NFL team 2)              schedule x3 season types, team standing, odds for the next game
//   Sabres  NHL api-web (BUF)                       club-schedule-season + standings; ESPN NHL as the fallback
//   Bisons  MLB StatsAPI (sportId 11, team 422)     schedule + International League standings
//
// A dead source never fails the run: its previous team block + games are carried forward with
// stale:true and the old asOf. The file is rewritten only when its content changed (or as a 20 h heartbeat, so
// generatedAt stays an honest "last verified" time). Exit 0 unless the output is invalid or cannot be written.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA_VERSION = 1;
export const TEAM_ORDER = ['bills', 'sabres', 'bisons'];
export const TEAMS = {
  bills: { id: 'bills', name: 'Buffalo Bills', short: 'Bills', abbr: 'BUF', league: 'NFL', tag: 'NFL', prefix: 'nfl' },
  sabres: { id: 'sabres', name: 'Buffalo Sabres', short: 'Sabres', abbr: 'BUF', league: 'NHL', tag: 'NHL', prefix: 'nhl' },
  bisons: { id: 'bisons', name: 'Buffalo Bisons', short: 'Bisons', abbr: 'BUF', league: 'MiLB · Triple-A', tag: 'AAA', prefix: 'milb' },
};
export const WINDOW_BACK_DAYS = 60;
export const WINDOW_FWD_DAYS = 30;
const HEARTBEAT_MS = 20 * 3600e3;
const LIVE_GRACE_MS = 4 * 3600e3; // a game still counts as "next" for 4 h after its start (SPEC §5.3)
const UA_PRIMARY = 'clubhouse-ingest/1.0';
const UA_FALLBACK = 'Mozilla/5.0 (compatible; clubhouse-ingest/1.0)';

/* ------------------------------------------------------------------ small pure helpers */

const NY_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** America/New_York calendar date of an instant → 'YYYY-MM-DD' (SPEC §5.2 "Time zone"). */
export function nyDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return NY_DAY.format(d);
}

/** Any date-ish value → 'YYYY-MM-DDTHH:MM:SSZ' (no milliseconds), or null. */
export function isoZ(x) {
  const d = x instanceof Date ? x : new Date(x);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const byStart = (a, b) => (a.startUTC < b.startUTC ? -1 : a.startUTC > b.startUTC ? 1 : 0);

/** W / L / T (+ OTL / SOL for hockey) from the two scores. */
export function resultOf(us, them, { ot = false, so = false } = {}) {
  if (us == null || them == null) return null;
  if (us > them) return 'W';
  if (us === them) return 'T';
  return so ? 'SOL' : ot ? 'OTL' : 'L';
}

/** { w, l, t, otl } from a list of finals. */
export function tally(finals) {
  const out = { w: 0, l: 0, t: 0, otl: 0 };
  for (const g of finals) {
    if (g.result === 'W') out.w++;
    else if (g.result === 'L') out.l++;
    else if (g.result === 'T') out.t++;
    else if (g.result === 'OTL' || g.result === 'SOL') out.otl++;
  }
  return out;
}

/** 'W3' / 'L2' / 'OT1' — the run of equal results at the end of the (start-sorted) finals. */
export function streakOf(finals) {
  const code = (g) => (g.result === 'OTL' || g.result === 'SOL' ? 'OT' : g.result);
  const list = finals.filter((g) => g.result);
  if (!list.length) return null;
  const last = code(list[list.length - 1]);
  let n = 0;
  for (let i = list.length - 1; i >= 0 && code(list[i]) === last; i--) n++;
  return `${last}${n}`;
}

/** Bills 'W-L' / 'W-L-T'; Sabres 'W-L-OTL'; Bisons 'W-L'. */
export function recordString(kind, d) {
  if (!d) return null;
  if (kind === 'hockey') return `${d.w}-${d.l}-${d.otl || 0}`;
  return d.t ? `${d.w}-${d.l}-${d.t}` : `${d.w}-${d.l}`;
}

const nflSeasonYear = (today) => { const [y, m] = today.split('-').map(Number); return m >= 3 ? y : y - 1; };

/* ------------------------------------------------------------------ team block (shared by every source) */

/**
 * Builds the SPEC §5.1 team block from a source's FULL game list (before windowing).
 * `given` overrides what the source knows better than the game list (standings record, streak, standing text).
 * `windowed: true` = the game list is only a date window (MLB), so a tally of it must not pose as a season record.
 */
export function finalizeTeam(def, { season, games, kind = 'plain', given = {}, now, windowed = false }) {
  const nowMs = +new Date(now);
  const sorted = games.slice().sort(byStart);
  const finals = sorted.filter((g) => g.status === 'final');
  const regFinals = finals.filter((g) => g.seasonType === 'regular');
  const preFinals = finals.filter((g) => g.seasonType === 'preseason');
  const postFinals = finals.filter((g) => g.seasonType === 'post');
  const upcoming = sorted.filter((g) => (g.status === 'scheduled' || g.status === 'live') && Date.parse(g.startUTC) >= nowMs - LIVE_GRACE_MS);
  const next = upcoming[0] || null;
  const last = finals[finals.length - 1] || null;

  let phase;
  if (!next) phase = 'offseason';
  else if (next.seasonType === 'post') phase = 'post';
  else if (regFinals.length) phase = 'regular';
  else if (preFinals.length || next.seasonType === 'preseason') phase = 'preseason';
  else phase = 'regular';

  // Record: the source's own table when it has one; else the season tally — but never from a windowed game list.
  const rt = tally(regFinals);
  const detail = given.recordDetail || (windowed ? null : { w: rt.w, l: rt.l, t: kind === 'hockey' ? null : rt.t, otl: kind === 'hockey' ? rt.otl : null });
  const recordDetail = detail ? { w: detail.w, l: detail.l, t: detail.t ?? null, otl: detail.otl ?? null } : null;
  const block = {
    id: def.id, name: def.name, short: def.short, abbr: def.abbr, league: def.league, tag: def.tag,
    season: String(season || ''),
    phase,
    record: given.record ?? (recordDetail ? recordString(kind, recordDetail) : null),
    recordDetail,
    standing: given.standing ?? null,
    streak: given.streak ?? streakOf([...regFinals, ...postFinals]),
    stale: false,
    asOf: isoZ(now),
    nextGameId: next ? next.id : null,
    lastGameId: last ? last.id : null,
  };
  if (phase === 'preseason' && preFinals.length) {
    const p = tally(preFinals);
    block.recordPre = recordString(kind, kind === 'hockey' ? p : { ...p, t: p.t || 0 });
  }
  return block;
}

/* ------------------------------------------------------------------ ESPN (NFL schedule; NHL fallback) */

const ESPN_LIVE = /IN_PROGRESS|HALFTIME|END_PERIOD|FIRST_HALF|SECOND_HALF|END_OF|OVERTIME|SHOOTOUT|DELAYED|LIVE/;

function espnRecord(comp) {
  if (!comp) return null;
  if (Array.isArray(comp.record)) return (comp.record.find((r) => r.type === 'total') || comp.record[0])?.displayValue || null;
  if (Array.isArray(comp.records)) return (comp.records.find((r) => r.type === 'total' || r.name === 'overall') || comp.records[0])?.summary || null;
  return null;
}

/**
 * ESPN team-schedule events → Game[] for Buffalo. Works for NFL and NHL (same envelope).
 * Keeps every event the feed lists (no windowing here).
 */
export function parseEspnEvents(events, { teamKey, league, abbr = 'BUF', idPrefix }) {
  const out = new Map();
  for (const e of events || []) {
    const c = e?.competitions?.[0];
    if (!c || !Array.isArray(c.competitors)) continue;
    const me = c.competitors.find((x) => x.team?.abbreviation === abbr);
    const opp = c.competitors.find((x) => x !== me);
    if (!me || !opp) continue;
    const startUTC = isoZ(c.date || e.date);
    if (!startUTC) continue;
    const st = c.status?.type || e.status?.type || {};
    const name = String(st.name || '');
    let status = 'scheduled';
    if (/POSTPONED|CANCEL|SUSPENDED/.test(name)) status = 'postponed';
    else if (st.state === 'post' || /^STATUS_FINAL/.test(name)) status = 'final';
    else if (st.state === 'in' || ESPN_LIVE.test(name)) status = 'live';
    const us = status === 'scheduled' || status === 'postponed' ? null : num(me.score?.value ?? me.score?.displayValue ?? me.score);
    const them = status === 'scheduled' || status === 'postponed' ? null : num(opp.score?.value ?? opp.score?.displayValue ?? opp.score);
    const detail = `${st.detail || ''} ${st.shortDetail || ''}`;
    const so = /\bSO\b/.test(detail);
    const ot = so || /\bOT\b|overtime/i.test(detail);
    let result = null;
    if (status === 'final') {
      result = me.winner === true ? 'W' : opp.winner === true ? resultOf(0, 1, { ot, so }) : resultOf(us, them, { ot, so });
      if (result === 'W' && us != null && them != null && us <= them) result = resultOf(us, them, { ot, so });
    }
    const t = e.seasonType?.type;
    const seasonType = t === 1 ? 'preseason' : t === 3 ? 'post' : 'regular';
    const tbd = status === 'scheduled' && (c.timeValid === false || e.timeValid === false || st.isTBDFlex === true || c.status?.isTBDFlex === true);
    const tv = [...new Set((c.broadcasts || []).map((b) => b?.media?.shortName).filter(Boolean))].slice(0, 2).join('/');
    const game = {
      id: `${idPrefix}-${e.id}`, team: teamKey, league, seasonType,
      week: num(e.week?.number),
      date: nyDate(startUTC), startUTC, tbd,
      home: me.homeAway === 'home',
      opponent: {
        name: opp.team?.displayName || opp.team?.name || '', short: opp.team?.shortDisplayName || opp.team?.nickname || opp.team?.name || '',
        abbr: opp.team?.abbreviation || '', record: espnRecord(opp),
      },
      venue: c.venue?.fullName || null, tv: tv || null, line: null, overUnder: null,
      status,
      score: status === 'final' || status === 'live' ? { us, them } : null,
      result,
      note: status === 'postponed' ? 'postponed' : seasonType === 'preseason' ? 'preseason' : seasonType === 'post' ? 'playoff' : null,
    };
    out.set(game.id, game);
  }
  return [...out.values()].sort(byStart);
}

/* ------------------------------------------------------------------ NHL api-web */

const NHL_NATIONAL = new Set(['NHLN', 'ESPN', 'ESPN2', 'ESPN+', 'ABC', 'TNT', 'truTV', 'Prime Video', 'SN', 'CBC', 'TVAS', 'Hulu', 'Max']);

function nhlTv(list) {
  const us = (list || []).filter((b) => b.countryCode === 'US' && b.network).map((b) => b.network);
  const uniq = [...new Set(us)];
  const local = uniq.find((n) => n === 'MSG-B');
  const national = uniq.find((n) => NHL_NATIONAL.has(n) && n !== 'SN' && n !== 'TVAS');
  const picked = [local, national].filter(Boolean);
  if (!picked.length && uniq.length) picked.push(uniq[0]);
  return picked.join('/') || null;
}

export function parseNhlWeb(json, { abbr = 'BUF' } = {}) {
  const out = [];
  for (const g of json?.games || []) {
    if (![1, 2, 3].includes(g.gameType)) continue; // 4 = exhibitions / international events
    const away = g.awayTeam, homeT = g.homeTeam;
    if (!away || !homeT) continue;
    const home = homeT.abbrev === abbr;
    if (!home && away.abbrev !== abbr) continue;
    const me = home ? homeT : away;
    const opp = home ? away : homeT;
    const startUTC = isoZ(g.startTimeUTC);
    if (!startUTC) continue;
    let status = 'scheduled';
    const gs = String(g.gameState || '');
    const sched = String(g.gameScheduleState || 'OK');
    if (sched === 'PPD' || sched === 'SUSP' || sched === 'CNCL') status = 'postponed';
    else if (gs === 'FINAL' || gs === 'OFF') status = 'final';
    else if (gs === 'LIVE' || gs === 'CRIT') status = 'live';
    const has = status === 'final' || status === 'live';
    const us = has ? num(me.score) : null;
    const them = has ? num(opp.score) : null;
    const lpt = g.gameOutcome?.lastPeriodType || g.periodDescriptor?.periodType || 'REG';
    const seasonType = g.gameType === 1 ? 'preseason' : g.gameType === 3 ? 'post' : 'regular';
    out.push({
      id: `nhl-${g.id}`, team: 'sabres', league: 'NHL', seasonType, week: null,
      date: nyDate(startUTC), startUTC, tbd: status === 'scheduled' && sched === 'TBD',
      home,
      opponent: {
        name: [opp.placeName?.default, opp.commonName?.default].filter(Boolean).join(' '),
        short: opp.commonName?.default || opp.abbrev, abbr: opp.abbrev, record: null,
      },
      venue: g.venue?.default || null, tv: nhlTv(g.tvBroadcasts), line: null, overUnder: null,
      status,
      score: has ? { us, them } : null,
      result: status === 'final' ? resultOf(us, them, { ot: lpt === 'OT', so: lpt === 'SO' }) : null,
      note: status === 'postponed' ? 'postponed' : seasonType === 'preseason' ? 'preseason' : seasonType === 'post' ? 'playoff' : null,
    });
  }
  return out.sort(byStart);
}

export function nhlSeasonLabel(id) {
  const s = String(id || '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(6)}` : s;
}

/** Standings row → given{} for finalizeTeam (regular season only; a 0-GP preseason table has no standing). */
export function nhlStandingsGiven(json, abbr = 'BUF') {
  const row = (json?.standings || []).find((r) => r.teamAbbrev?.default === abbr);
  if (!row) return null;
  const gp = num(row.gamesPlayed) || 0;
  const recordDetail = { w: num(row.wins) || 0, l: num(row.losses) || 0, t: null, otl: num(row.otLosses) || 0 };
  return {
    recordDetail, record: recordString('hockey', recordDetail),
    standing: gp > 0 && row.divisionSequence ? `${ordinal(row.divisionSequence)} in ${row.divisionName}` : null,
    streak: gp > 0 && row.streakCode ? `${row.streakCode}${row.streakCount ?? ''}` : null,
  };
}

/** Keeps a game's id stable when a fallback source numbers the same game differently (watched rows key on it). */
export function reuseIds(games, prevGames) {
  const key = (g) => `${g.team}|${g.date}|${g.opponent?.abbr}`;
  const known = new Map((prevGames || []).map((g) => [key(g), g.id]));
  return games.map((g) => (known.has(key(g)) ? { ...g, id: known.get(key(g)) } : g));
}

/* ------------------------------------------------------------------ MLB StatsAPI */

export function parseMlb(json, { teamId = 422 } = {}) {
  const out = [];
  for (const d of json?.dates || []) {
    for (const g of d.games || []) {
      const detailed = String(g.status?.detailedState || '');
      if (/cancel/i.test(detailed)) continue; // a cancelled game never happened
      const a = g.teams?.away, h = g.teams?.home;
      if (!a || !h) continue;
      const home = h.team?.id === teamId;
      if (!home && a.team?.id !== teamId) continue;
      const me = home ? h : a;
      const opp = home ? a : h;
      const startUTC = isoZ(g.gameDate);
      if (!startUTC) continue;
      const abs = g.status?.abstractGameState;
      let status = 'scheduled';
      if (/postpone|suspend/i.test(detailed)) status = 'postponed';
      else if (abs === 'Final') status = 'final';
      else if (abs === 'Live') status = 'live';
      const has = status === 'final' || status === 'live';
      const us = has ? num(me.score) : null;
      const them = has ? num(opp.score) : null;
      const gt = String(g.gameType || 'R');
      const seasonType = gt === 'R' ? 'regular' : gt === 'S' || gt === 'E' ? 'preseason' : 'post';
      const lr = opp.leagueRecord;
      const tv = (g.broadcasts || []).find((b) => b.type === 'TV');
      out.push({
        id: `milb-${g.gamePk}`, team: 'bisons', league: 'MiLB', seasonType, week: null,
        date: nyDate(startUTC), startUTC, tbd: status === 'scheduled' && g.status?.startTimeTBD === true,
        home,
        opponent: {
          name: opp.team?.name || '', short: opp.team?.teamName || String(opp.team?.name || '').split(' ').slice(-1)[0],
          abbr: opp.team?.abbreviation || '', record: lr && lr.wins != null ? `${lr.wins}-${lr.losses}` : null,
        },
        venue: g.venue?.name || null, tv: tv ? tv.name || tv.callSign || null : null, line: null, overUnder: null,
        status,
        score: has ? { us, them } : null,
        result: status === 'final' ? (me.isWinner === true ? 'W' : opp.isWinner === true ? 'L' : resultOf(us, them)) : null,
        note: status === 'postponed' ? 'postponed' : seasonType === 'preseason' ? 'preseason' : seasonType === 'post' ? 'playoff' : null,
      });
    }
  }
  return out.sort(byStart);
}

/** Our side's W-L from the latest final regular-season game (fallback when the standings call fails). */
export function mlbLastRecord(json, teamId = 422) {
  let best = null;
  for (const d of json?.dates || []) for (const g of d.games || []) {
    if (g.gameType !== 'R' || g.status?.abstractGameState !== 'Final' || /cancel|postpone/i.test(g.status?.detailedState || '')) continue;
    const side = g.teams?.home?.team?.id === teamId ? g.teams.home : g.teams?.away?.team?.id === teamId ? g.teams.away : null;
    const lr = side?.leagueRecord;
    if (lr && lr.wins != null && (!best || g.gameDate > best.at)) best = { at: g.gameDate, w: lr.wins, l: lr.losses };
  }
  return best;
}

/** International League (117) first, then 112; returns { given, leagueId } or null when the Bisons are in neither. */
export function mlbStandingsGiven(json, teamId = 422) {
  for (const rec of json?.records || []) {
    const row = (rec.teamRecords || []).find((t) => t.team?.id === teamId);
    if (!row) continue;
    const divName = rec.division?.name || row.team?.division?.name || '';
    const short = divName.replace(/^International League/i, 'IL').replace(/^Pacific Coast League/i, 'PCL') || null;
    const rank = num(row.divisionRank);
    const recordDetail = { w: num(row.wins) || 0, l: num(row.losses) || 0, t: null, otl: null };
    return {
      recordDetail, record: recordString('plain', recordDetail),
      standing: rank && short ? `${ordinal(rank)} in ${short}` : null,
      streak: row.streak?.streakCode || null,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ sources */

const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_NHL = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';

export const espnNfl = {
  id: 'espn-nfl', label: 'ESPN NFL (Bills)', team: 'bills',
  async run(ctx) {
    const S = nflSeasonYear(ctx.today);
    const warnings = [];
    const reg = await ctx.getJson({ url: `${ESPN_NFL}/teams/2/schedule?season=${S}`, fx: 'espn-nfl-schedule.json' });
    const events = [...(reg.events || [])];
    for (const [type, fx, label] of [[1, 'espn-nfl-schedule-pre.json', 'preseason'], [3, 'espn-nfl-schedule-post.json', 'postseason']]) {
      try {
        const j = await ctx.getJson({ url: `${ESPN_NFL}/teams/2/schedule?season=${S}&seasontype=${type}`, fx });
        events.push(...(j.events || []));
      } catch (err) { warnings.push(`${label} schedule: ${err.message}`); }
    }
    const games = parseEspnEvents(events, { teamKey: 'bills', league: 'NFL', idPrefix: 'nfl' });
    let standing = null;
    try {
      const t = await ctx.getJson({ url: `${ESPN_NFL}/teams/2`, fx: 'espn-nfl-team.json' });
      standing = t.team?.standingSummary || null;
      const played = (t.team?.record?.items || []).find((r) => r.type === 'total')?.stats?.find((s) => s.name === 'gamesPlayed')?.value;
      if (played === 0) standing = null; // a 0-0 table has no meaningful rank
    } catch (err) { warnings.push(`team standing: ${err.message}`); }
    // Odds for the next game only (ESPN scoreboard, DraftKings via ESPN). Best effort.
    const nextG = games.filter((g) => g.status === 'scheduled' && Date.parse(g.startUTC) >= +ctx.now - LIVE_GRACE_MS).sort(byStart)[0];
    if (nextG) {
      try {
        const ymd = nextG.date.replace(/-/g, '');
        const sb = await ctx.getJson({ url: `${ESPN_NFL}/scoreboard?dates=${ymd}`, fx: `espn-nfl-scoreboard-${ymd}.json` });
        const ev = (sb.events || []).find((e) => `nfl-${e.id}` === nextG.id);
        const oc = ev?.competitions?.[0];
        if (oc) {
          const o = oc.odds?.[0];
          if (o?.details) nextG.line = String(o.details);
          if (num(o?.overUnder) != null) nextG.overUnder = num(o.overUnder);
          const oppC = (oc.competitors || []).find((x) => x.team?.abbreviation === nextG.opponent.abbr);
          const rec = espnRecord(oppC);
          if (rec) nextG.opponent.record = rec;
        }
      } catch (err) { warnings.push(`odds: ${err.message}`); }
    }
    const team = finalizeTeam(TEAMS.bills, { season: S, games, given: { standing }, now: ctx.now });
    return { team, games, warnings };
  },
};

async function nhlViaApiWeb(ctx) {
  const warnings = [];
  const sched = await ctx.getJson({ url: 'https://api-web.nhle.com/v1/club-schedule-season/BUF/now', fx: 'nhl-schedule.json' });
  const games = parseNhlWeb(sched);
  let given = {};
  try {
    const st = await ctx.getJson({ url: 'https://api-web.nhle.com/v1/standings/now', fx: 'nhl-standings.json' });
    given = nhlStandingsGiven(st) || {};
  } catch (err) { warnings.push(`standings: ${err.message}`); }
  const team = finalizeTeam(TEAMS.sabres, { season: nhlSeasonLabel(sched.currentSeason), games, kind: 'hockey', given, now: ctx.now });
  return { team, games, warnings };
}

async function nhlViaEspn(ctx) {
  const sched = await ctx.getJson({ url: `${ESPN_NHL}/teams/buf/schedule`, fx: 'espn-nhl-schedule.json' });
  let games = parseEspnEvents(sched.events, { teamKey: 'sabres', league: 'NHL', idPrefix: 'nhl' });
  games = reuseIds(games, ctx.prev?.games?.filter((g) => g.team === 'sabres'));
  let given = {};
  try {
    const t = await ctx.getJson({ url: `${ESPN_NHL}/teams/buf`, fx: 'espn-nhl-team.json' });
    const items = t.team?.record?.items || [];
    const total = items.find((r) => r.type === 'total');
    const gp = total?.stats?.find((s) => s.name === 'gamesPlayed')?.value;
    if (gp > 0) given = { standing: t.team?.standingSummary ? String(t.team.standingSummary).replace(/ Division$/i, '') : null };
  } catch { /* the schedule alone still makes a valid block */ }
  const team = finalizeTeam(TEAMS.sabres, { season: sched.season?.displayName || '', games, kind: 'hockey', given, now: ctx.now });
  return { team, games, warnings: [] };
}

export const nhlWeb = {
  id: 'nhl-web', label: 'NHL api-web (Sabres)', team: 'sabres',
  async run(ctx) {
    try {
      return await nhlViaApiWeb(ctx);
    } catch (primaryErr) {
      const r = await nhlViaEspn(ctx); // throws too if ESPN is also down → the runner carries the old data forward
      r.via = 'espn-nhl';
      r.warnings = [`api-web failed (${primaryErr.message}); used ESPN NHL`];
      return r;
    }
  },
};

export const mlbStats = {
  id: 'mlb-stats', label: 'MLB StatsAPI (Bisons)', team: 'bisons',
  async run(ctx) {
    const warnings = [];
    const year = Number(ctx.today.slice(0, 4));
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=11&teamId=422&season=${year}&startDate=${ctx.window.from}&endDate=${ctx.window.to}&hydrate=team,broadcasts(all)`;
    const sched = await ctx.getJson({ url, fx: 'mlb-schedule.json' });
    const games = parseMlb(sched);
    let given = {};
    let via;
    for (const league of [117, 112]) {
      try {
        const st = await ctx.getJson({
          url: `https://statsapi.mlb.com/api/v1/standings?leagueId=${league}&season=${year}&standingsTypes=regularSeason&hydrate=team,division`,
          fx: league === 117 ? 'mlb-standings.json' : 'mlb-standings-112.json',
        });
        const g = mlbStandingsGiven(st);
        if (g) { given = g; if (league !== 117) via = `standings league ${league}`; break; }
      } catch (err) { warnings.push(`standings ${league}: ${err.message}`); if (league === 117) continue; }
    }
    if (!given.record) {
      const lr = mlbLastRecord(sched);
      if (lr) given = { ...given, recordDetail: { w: lr.w, l: lr.l, t: null, otl: null }, record: `${lr.w}-${lr.l}` };
    }
    const team = finalizeTeam(TEAMS.bisons, { season: year, games, given, now: ctx.now, windowed: true });
    return { team, games, warnings, via };
  },
};

export const SOURCES = [espnNfl, nhlWeb, mlbStats];

/* ------------------------------------------------------------------ fetching */

async function fetchOnce(url, ua, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error('response was not JSON'); }
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`timeout after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Live fetch: 12 s timeout, one retry after 2 s (second try swaps user agent and, for ESPN, the host). */
export function liveGetJson({ timeoutMs = 12000, retryDelayMs = 2000 } = {}) {
  return async ({ url }) => {
    const alt = url.replace('//site.api.espn.com', '//site.web.api.espn.com');
    const tries = [[url, UA_PRIMARY], [alt, UA_FALLBACK]];
    let lastErr;
    for (let i = 0; i < tries.length; i++) {
      try { return await fetchOnce(tries[i][0], tries[i][1], timeoutMs); } catch (err) { lastErr = err; }
      if (i < tries.length - 1) await sleep(retryDelayMs);
    }
    throw lastErr;
  };
}

export function fixtureGetJson(dir) {
  return async ({ fx }) => {
    const p = join(dir, fx);
    if (!existsSync(p)) throw new Error(`fixture missing: ${fx}`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };
}

/* ------------------------------------------------------------------ the runner */

/** Previous file's team block + games for a source whose run failed. */
export function carryForward(def, prev) {
  const prevTeam = prev?.teams?.[def.team];
  const games = (prev?.games || []).filter((g) => g.team === def.team);
  if (prevTeam) return { team: { ...prevTeam, stale: true }, games };
  const t = TEAMS[def.team];
  return {
    team: {
      id: t.id, name: t.name, short: t.short, abbr: t.abbr, league: t.league, tag: t.tag, season: '', phase: 'offseason',
      record: null, recordDetail: null, standing: null, streak: null, stale: true, asOf: null, nextGameId: null, lastGameId: null,
    },
    games: [],
  };
}

/**
 * Runs every source (in parallel), each in its own try/catch. Returns the assembled feed (not yet written).
 * ctx: { now, getJson, prev, retryDelayMs?, log? }
 */
export async function collect({ sources = SOURCES, now, getJson, prev = null, log = () => {}, only = null }) {
  const nowDate = new Date(now);
  const today = nyDate(nowDate);
  const window = { from: addDaysYmd(today, -WINDOW_BACK_DAYS), to: addDaysYmd(today, WINDOW_FWD_DAYS) };
  const ctx = { now: nowDate, today, window, getJson, prev, log };
  const active = sources.filter((s) => !only || only.includes(s.team));

  const results = await Promise.all(active.map(async (src) => {
    const fetchedAt = isoZ(nowDate);
    try {
      const r = await src.run(ctx);
      const entry = { id: src.id, label: src.label, ok: true, fetchedAt, error: null, itemCount: r.games.length };
      if (r.via) entry.via = r.via;
      if (r.warnings && r.warnings.length) entry.warnings = r.warnings;
      log(`${src.label}: ${r.games.length} games${r.via ? ` (via ${r.via})` : ''}${r.warnings?.length ? ` · ${r.warnings.join('; ')}` : ''}`);
      return { src, entry, team: r.team, games: r.games };
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      const c = carryForward(src, prev);
      log(`${src.label}: FAILED (${msg}) — carrying ${c.games.length} previous games forward`);
      return { src, entry: { id: src.id, label: src.label, ok: false, fetchedAt, error: msg, itemCount: 0 }, team: c.team, games: c.games };
    }
  }));

  // Sources not run this time (--only) keep their previous data untouched.
  const teams = {};
  let games = [];
  const sourcesOut = [];
  for (const key of TEAM_ORDER) {
    const hit = results.find((r) => r.src.team === key);
    if (hit) {
      // Off-season with no fresh standings: keep the last known final table (SPEC §5.2).
      const pt = prev?.teams?.[key];
      if (hit.entry.ok && hit.team.phase === 'offseason' && hit.team.record == null && pt?.record) {
        hit.team.record = pt.record; hit.team.recordDetail = pt.recordDetail; hit.team.standing = pt.standing; hit.team.streak = pt.streak;
      }
      teams[key] = hit.team;
      games.push(...hit.games);
      sourcesOut.push(hit.entry);
    } else if (prev?.teams?.[key]) {
      teams[key] = prev.teams[key];
      games.push(...(prev.games || []).filter((g) => g.team === key));
      const ps = (prev.sources || []).find((s) => SOURCES.find((x) => x.id === s.id)?.team === key);
      if (ps) sourcesOut.push(ps);
    }
  }
  const seen = new Set();
  games = games
    .filter((g) => g.date >= window.from && g.date <= window.to)
    .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
    .sort((a, b) => byStart(a, b) || TEAM_ORDER.indexOf(a.team) - TEAM_ORDER.indexOf(b.team) || (a.id < b.id ? -1 : 1));

  return { schemaVersion: SCHEMA_VERSION, generatedAt: isoZ(nowDate), window, sources: sourcesOut, teams, games };
}

/* ------------------------------------------------------------------ validation (SPEC §5.1) */

const ENUM = {
  phase: ['preseason', 'regular', 'post', 'offseason'],
  status: ['scheduled', 'live', 'final', 'postponed'],
  result: ['W', 'L', 'T', 'OTL', 'SOL', null],
  note: [null, 'preseason', 'playoff', 'postponed'],
  seasonType: ['preseason', 'regular', 'post'],
};

/** Returns a list of problems ([] = valid). Deliberately dependency-free; also gates the write. */
export function validateFeed(feed) {
  const p = [];
  const need = (cond, msg) => { if (!cond) p.push(msg); };
  need(feed && typeof feed === 'object', 'feed is not an object');
  if (p.length) return p;
  need(feed.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`);
  need(typeof feed.generatedAt === 'string' && isoZ(feed.generatedAt), 'generatedAt must be an ISO time');
  need(feed.window && /^\d{4}-\d{2}-\d{2}$/.test(feed.window.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(feed.window.to || '') && feed.window.from <= feed.window.to, 'window {from,to} must be ordered dates');
  need(Array.isArray(feed.sources), 'sources must be a list');
  for (const s of feed.sources || []) {
    need(s && typeof s.id === 'string' && typeof s.label === 'string' && typeof s.ok === 'boolean', `source ${s?.id}: needs id, label, ok`);
    need(s.ok ? s.error === null : typeof s.error === 'string' && s.error.length > 0, `source ${s?.id}: error must be null when ok, a message when not`);
    need(Number.isInteger(s.itemCount), `source ${s?.id}: itemCount must be an integer`);
  }
  need(feed.teams && typeof feed.teams === 'object', 'teams missing');
  for (const [k, t] of Object.entries(feed.teams || {})) {
    need(TEAM_ORDER.includes(k), `unknown team ${k}`);
    for (const f of ['id', 'name', 'short', 'abbr', 'league', 'season', 'phase', 'record', 'recordDetail', 'standing', 'streak', 'stale', 'asOf', 'nextGameId', 'lastGameId']) need(f in t, `team ${k}: missing ${f}`);
    need(t.id === k, `team ${k}: id mismatch`);
    need(ENUM.phase.includes(t.phase), `team ${k}: bad phase ${t.phase}`);
    need(typeof t.stale === 'boolean', `team ${k}: stale must be boolean`);
    need(t.asOf === null || isoZ(t.asOf), `team ${k}: asOf must be null or ISO`);
  }
  need(Array.isArray(feed.games), 'games must be a list');
  const ids = new Set();
  let prevStart = '';
  for (const g of feed.games || []) {
    const at = `game ${g?.id}`;
    need(typeof g.id === 'string' && /^(nfl|nhl|milb)-.+/.test(g.id), `${at}: bad id`);
    need(!ids.has(g.id), `${at}: duplicate id`);
    ids.add(g.id);
    need(TEAM_ORDER.includes(g.team), `${at}: bad team`);
    need(feed.teams?.[g.team], `${at}: team ${g.team} has no block`);
    need(ENUM.seasonType.includes(g.seasonType), `${at}: bad seasonType`);
    need(ENUM.status.includes(g.status), `${at}: bad status ${g.status}`);
    need(ENUM.result.includes(g.result), `${at}: bad result ${g.result}`);
    need(ENUM.note.includes(g.note), `${at}: bad note ${g.note}`);
    need(typeof g.startUTC === 'string' && isoZ(g.startUTC) === g.startUTC, `${at}: startUTC must be ISO Z without ms`);
    need(g.date === nyDate(g.startUTC), `${at}: date must be the America/New_York date of startUTC`);
    need(g.date >= feed.window?.from && g.date <= feed.window?.to, `${at}: outside the window`);
    need(g.startUTC >= prevStart, `${at}: games must be sorted by startUTC`);
    prevStart = g.startUTC;
    need(typeof g.home === 'boolean' && typeof g.tbd === 'boolean', `${at}: home/tbd must be boolean`);
    need(g.opponent && typeof g.opponent.name === 'string' && typeof g.opponent.short === 'string' && typeof g.opponent.abbr === 'string', `${at}: opponent needs name, short, abbr`);
    if (g.status === 'final') need(g.score && Number.isInteger(g.score.us) && Number.isInteger(g.score.them) && g.result, `${at}: a final needs a score and a result`);
    if (g.status === 'scheduled' || g.status === 'postponed') need(g.score === null && g.result === null, `${at}: scheduled games carry no score`);
  }
  return p;
}

/* ------------------------------------------------------------------ writing */

/** Compact, diff-friendly layout: one source / team / game per line. */
export function formatFeed(f) {
  const one = (o) => JSON.stringify(o);
  const lines = ['{'];
  lines.push(`  "schemaVersion": ${f.schemaVersion},`);
  lines.push(`  "generatedAt": ${one(f.generatedAt)},`);
  lines.push(`  "window": ${one(f.window)},`);
  lines.push('  "sources": [', f.sources.map((s) => `    ${one(s)}`).join(',\n'), '  ],');
  lines.push('  "teams": {', Object.entries(f.teams).map(([k, t]) => `    ${one(k)}: ${one(t)}`).join(',\n'), '  },');
  lines.push('  "games": [', f.games.map((g) => `    ${one(g)}`).join(',\n'), '  ]');
  lines.push('}', '');
  return lines.join('\n');
}

/** The feed minus the fields that change on every run without meaning anything. */
export function normalizeForCompare(feed) {
  const c = JSON.parse(JSON.stringify(feed));
  delete c.generatedAt;
  for (const s of c.sources || []) delete s.fetchedAt;
  for (const t of Object.values(c.teams || {})) if (!t.stale) delete t.asOf;
  return JSON.stringify(c);
}

/** Should the file be rewritten? Content changed, no previous file, or the heartbeat is due. */
export function shouldWrite(next, prev, now = Date.now()) {
  if (!prev) return { write: true, why: 'no previous file' };
  if (normalizeForCompare(next) !== normalizeForCompare(prev)) return { write: true, why: 'content changed' };
  const age = now - Date.parse(prev.generatedAt || 0);
  if (!(age < HEARTBEAT_MS)) return { write: true, why: 'heartbeat (freshness stamp)' };
  return { write: false, why: 'unchanged' };
}

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

function readPrev(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
}

/* ------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const a = { fixture: null, out: join(ROOT, 'data', 'sports.json'), prev: null, now: null, dry: false, quiet: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--fixture') a.fixture = resolve(argv[++i]);
    else if (k === '--out') a.out = resolve(argv[++i]);
    else if (k === '--prev') a.prev = resolve(argv[++i]);
    else if (k === '--now') a.now = argv[++i];
    else if (k === '--only') a.only = argv[++i].split(',').map((s) => s.trim());
    else if (k === '--dry') a.dry = true;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--help' || k === '-h') { a.help = true; }
  }
  return a;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log('node scripts/ingest-sports.mjs [--dry] [--fixture dir] [--out file] [--prev file] [--now iso] [--only bills,sabres,bisons] [--quiet]'); return 0; }
  const log = args.quiet ? () => {} : (m) => console.log(`[sports] ${m}`);
  const now = args.now ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) { console.error('bad --now'); return 1; }
  const prev = readPrev(args.prev || args.out);
  const getJson = args.fixture ? fixtureGetJson(args.fixture) : liveGetJson();
  const feed = await collect({ now, getJson, prev, log, only: args.only });

  const problems = validateFeed(feed);
  if (problems.length) {
    console.error(`[sports] output failed validation — nothing written:\n  - ${problems.slice(0, 12).join('\n  - ')}`);
    return 1;
  }
  const down = feed.sources.filter((s) => !s.ok).map((s) => s.id);
  const decision = shouldWrite(feed, prev, +now);
  log(`${feed.games.length} games · window ${feed.window.from} → ${feed.window.to}${down.length ? ` · DOWN: ${down.join(', ')}` : ' · all sources ok'}`);
  for (const k of TEAM_ORDER) {
    const t = feed.teams[k];
    if (t) log(`  ${t.short}: ${t.phase} · ${t.record ?? '—'}${t.recordPre ? ` (pre ${t.recordPre})` : ''} · ${t.standing ?? 'no standing'}${t.stale ? ' · STALE' : ''}`);
  }
  if (args.dry) { log('dry run — nothing written'); return 0; }
  if (!decision.write) { log(`unchanged — file left alone (${decision.why})`); return 0; }
  try {
    atomicWrite(args.out, formatFeed(feed));
  } catch (err) {
    console.error(`[sports] could not write ${args.out}: ${err.message}`);
    return 1;
  }
  log(`wrote ${args.out} (${decision.why})`);
  return 0;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
