// Golf pillar — SPEC §2.1 GolfFacts, §2 module API, §6.3 golf rules (G0–G9).
// Source of truth: Fairway Ledger's own localStorage key `fairwayLedger.v1` (the vendored app runs inside the
// Clubhouse scope, so rounds saved there count here the moment the ledger saves them). Read-only: nothing in
// this file ever writes to the ledger's storage.
// Math is the ledger's own: vendored lib/golf-math.js (window.GolfMath) + lib/shapes.js (window.GolfShapes).
import { readFairwayLedger } from '../ls.js';
import { addDays, daysBetween, monD, dayWord, parseYmd } from '../dates.js';
import { baseSummary, marksFromDates, countInWeek, weeklyHistory, daysAgo, weekRun } from './_shared.js';
import { esc, fmt } from '../dom.js';

export const id = 'golf';
export const meta = {
  label: 'Golf', glyph: 'golf', unit: { one: 'round', many: 'rounds' }, verb: 'played',
  goalKey: 'goal.golf', defaultGoal: 2, goalMin: 1, goalMax: 14, href: '#/golf',
};
export const LEDGER_HREF = './apps/fairway-ledger/index.html';

/* ------------------------------------------------------------------ vendored libs */

let libsPromise = null;
function loadScript(url) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
/** window.GolfMath / window.GolfShapes are normally loaded by index.html (defer); this is the safety net. */
export function ensureLibs() {
  if (globalThis.GolfMath && globalThis.GolfShapes) return Promise.resolve(true);
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (!libsPromise) {
    libsPromise = Promise.all([
      globalThis.GolfMath ? true : loadScript(new URL('../vendor/golf-math.js', import.meta.url).href),
      globalThis.GolfShapes ? true : loadScript(new URL('../vendor/shapes.js', import.meta.url).href),
    ]).then(() => Boolean(globalThis.GolfMath && globalThis.GolfShapes));
  }
  return libsPromise;
}

/* ------------------------------------------------------------------ courses */

const DW_NINES = { buck: 'Buck', doe: 'Doe', fawn: 'Fawn' };
const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * courseId → course. Deerwood 18s (`deerwood-buck-doe-white`) are synthesized from their two nines exactly the
 * way Fairway Ledger does it (rating = sum of the nines, slope = rounded mean) — they are not stored in state.
 */
export function makeCourseLookup(courses = []) {
  const byId = new Map(courses.filter((c) => c && c.id).map((c) => [c.id, c]));
  const cache = new Map();
  return (courseId) => {
    if (cache.has(courseId)) return cache.get(courseId);
    let c = byId.get(courseId) || null;
    if (!c && /^deerwood-/.test(String(courseId))) {
      const parts = String(courseId).replace('deerwood-', '').split('-');
      const tee = parts.pop();
      if (parts.length === 2 && parts.every((p) => DW_NINES[p])) {
        const nines = parts.map((p) => byId.get(`deerwood-${p}-${tee}`));
        if (nines.every(Boolean)) {
          const rated = nines.every((n) => Number(n.rating) > 0 && Number(n.slope) > 0);
          c = {
            id: courseId,
            name: `Deerwood Golf Course - ${DW_NINES[parts[0]]} / ${DW_NINES[parts[1]]}`,
            tee: nines[0].tee,
            rating: rated ? Number(nines.reduce((s, n) => s + Number(n.rating), 0).toFixed(1)) : null,
            slope: rated ? Math.round((Number(nines[0].slope) + Number(nines[1].slope)) / 2) : null,
          };
        }
      }
    }
    cache.set(courseId, c);
    return c;
  };
}

/** 'Deerwood Golf Course - Buck / Doe' → 'Deerwood'; 'Seneca Hickory Stick Golf Course' → 'Seneca Hickory Stick'. */
export function shortCourse(name) {
  const base = String(name || '').split(' - ')[0].trim();
  const s = base.replace(/\s+(golf\s+(course|club|links|resort)|country\s+club|golf|links|resort|cc|gc)$/i, '').trim();
  return s || base || 'Course';
}
/** First two words (SPEC §6.3 `sn`). */
export const sn = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
const courseKey = (courseId, name) => (/^deerwood-/.test(String(courseId)) ? 'deerwood' : shortCourse(name).toLowerCase());

/* ------------------------------------------------------------------ rounds */

function totals(round, GM) {
  if (GM && typeof GM.roundTotals === 'function') return GM.roundTotals(round);
  const holes = round.holes || [];
  const gross = holes.reduce((s, x) => s + Number(x.score || 0), 0);
  const par = holes.reduce((s, x) => s + Number(x.par || 0), 0);
  const fir = holes.filter((x) => x.par > 3 && x.fairway !== 'na');
  return { gross, par, toPar: gross - par, putts: holes.reduce((s, x) => s + Number(x.putts || 0), 0), girMade: holes.filter((x) => x.gir).length, girTotal: holes.length, firMade: fir.filter((x) => x.fairway === 'hit').length, firTotal: fir.length };
}

/** One raw ledger round → NormRound (SPEC §2.1) + `raw` (the normalized ledger round, for the handicap math). */
export function normRound(input, lookup, libs = {}) {
  const GS = libs.GolfShapes, GM = libs.GolfMath;
  const raw = GS && typeof GS.normalizeRound === 'function' ? GS.normalizeRound(input) : { ...input, holes: Array.isArray(input && input.holes) ? input.holes : [] };
  const holes = raw.holes || [];
  const complete = holes.length > 0 && holes.every((x) => Number(x.score) > 0);
  const t = totals(raw, GM);
  const course = lookup(raw.courseId);
  const courseName = course && course.name ? course.name : String(raw.courseId || 'Unknown course');
  const detailed = raw.entryMode !== 'speed' && t.putts > 0;
  const penaltyClubs = [];
  for (const x of holes) for (const c of Array.isArray(x.penaltyClubs) ? x.penaltyClubs : []) if (c) penaltyClubs.push(c);
  const gross = complete ? t.gross : null;
  const differential = complete && holes.length >= 18 && course && Number(course.rating) > 0 && Number(course.slope) > 0
    ? round1(((gross - Number(course.rating)) * 113) / Number(course.slope)) : null;
  return {
    id: String(raw.id || ''), date: String(raw.date || ''), courseId: String(raw.courseId || ''), courseName,
    short: shortCourse(courseName), key: courseKey(raw.courseId, courseName),
    tee: raw.tee || '', par: t.par, gross, toPar: complete ? t.gross - t.par : null,
    putts: detailed ? t.putts : null, holes: holes.length, complete,
    tag: raw.tag || '', entryMode: raw.entryMode || 'detailed', detailed, differential,
    penalties: holes.reduce((s, x) => s + (Number(x.penalties) || 0), 0), penaltyClubs,
    firMade: detailed ? t.firMade : 0, firTotal: detailed ? t.firTotal : 0,
    girMade: detailed ? t.girMade : 0, girTotal: detailed ? t.girTotal : 0,
    note: raw.note || '',
    raw,
  };
}

const byDateThenId = (a, b) => (a.date === b.date ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.date < b.date ? -1 : 1);

function handicapOf(rounds, lookupRated, GM) {
  if (!GM || typeof GM.calculateHandicapEstimate !== 'function' || !rounds.length) return null;
  try {
    const r = GM.calculateHandicapEstimate(rounds.map((x) => x.raw), lookupRated);
    return r && r.index != null ? { index: r.index, note: r.note || '', used: (r.used || []).length, eligible: (r.eligible || []).length } : null;
  } catch { return null; }
}

function mean1(rounds, pick) {
  const vals = rounds.map(pick).filter((v) => Number.isFinite(v));
  return vals.length ? round1(avg(vals)) : null;
}
function pct(rounds, made, total) {
  const T = rounds.reduce((s, r) => s + r[total], 0);
  return T > 0 ? Math.round((rounds.reduce((s, r) => s + r[made], 0) / T) * 100) : null;
}
function topOf(list) {
  const counts = new Map();
  for (const x of list) counts.set(x, (counts.get(x) || 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

/* ------------------------------------------------------------------ facts */

export function zero(extra = {}) {
  return {
    available: false, source: null, asOf: null, rounds: [], eighteen: [], nine: [], seasonYear: null, seasonRounds: [],
    weekRounds: [], prevWeekRounds: [], last5: [], prior5: [], scoring: null, seasonLow: null, handicap: null, handicap30: null,
    hcpTrend: [], putts: null, penalties: null, fir: null, gir: null, last10Scores: [], lastRound: null, daysSinceLastRound: null,
    byCourse: [], unbackedRounds: 0, backupMeta: null, weeklyHistory: {}, roundWeeks: 0, byDay: [false, false, false, false, false, false, false],
    ...extra,
  };
}

/**
 * Pure: ledger state + backupMeta + ctx → GolfFacts. libs = { GolfMath, GolfShapes } (the vendored UMD modules).
 * Never throws for bad rows; an unusable state returns the zero shape.
 */
export function computeFacts(state, backupMeta, ctx, libs = {}) {
  if (!state || !Array.isArray(state.rounds) || !Array.isArray(state.courses)) return zero({ weeklyHistory: weeklyHistory([], ctx.today) });
  const GM = libs.GolfMath;
  const lookup = makeCourseLookup(state.courses);
  const lookupRated = (courseId) => { const c = lookup(courseId); return c && Number(c.rating) > 0 && Number(c.slope) > 0 ? { rating: Number(c.rating), slope: Number(c.slope) } : null; };
  const rounds = state.rounds
    .filter((r) => r && typeof r === 'object' && /^\d{4}-\d{2}-\d{2}/.test(String(r.date || '')))
    .map((r) => normRound(r, lookup, libs))
    .sort(byDateThenId);
  const complete = rounds.filter((r) => r.complete);
  const eighteen = complete.filter((r) => r.holes === 18);
  const nine = complete.filter((r) => r.holes === 9);
  const dates = rounds.map((r) => r.date);
  const weekEnd = addDays(ctx.weekStart, 6);
  const yearOf = (r) => Number(r.date.slice(0, 4));
  const seasonYear = rounds.some((r) => yearOf(r) === ctx.season) ? ctx.season : rounds.length ? Math.max(...rounds.map(yearOf)) : ctx.season;
  const seasonRounds = rounds.filter((r) => yearOf(r) === seasonYear);

  const recentFirst = eighteen.slice().reverse();
  const last5 = recentFirst.slice(0, 5);
  const prior5 = recentFirst.slice(5, 10);

  // scoring: last 5 vs the 5 before (3 vs 3 at 6–9 rounds; null under 6). Delta from the rounded averages so the
  // receipts on screen always add up (85.4 vs 87.6 → 2.2).
  let scoring = null;
  if (eighteen.length >= 6) {
    const n = eighteen.length >= 10 ? 5 : 3;
    const a = round1(avg(recentFirst.slice(0, n).map((r) => r.gross)));
    const b = round1(avg(recentFirst.slice(n, 2 * n).map((r) => r.gross)));
    scoring = { last5Avg: a, prior5Avg: b, delta: round1(b - a), n };
  }

  const seasonEighteen = seasonRounds.filter((r) => r.complete && r.holes === 18);
  let seasonLow = null;
  for (const r of seasonEighteen) if (!seasonLow || r.gross <= seasonLow.score) seasonLow = { score: r.gross, toPar: r.toPar, courseName: r.courseName, short: r.short, date: r.date, id: r.id, daysAgo: daysAgo(r.date, ctx.today) };

  const handicap = handicapOf(complete, lookupRated, GM);
  const cut30 = addDays(ctx.today, -30);
  const h30 = handicapOf(complete.filter((r) => r.date <= cut30), lookupRated, GM);
  // the hero's area chart: the estimate recomputed after each of the last 10 rounds
  const hcpTrend = [];
  for (let i = Math.max(0, complete.length - 10); i < complete.length; i++) {
    const hc = handicapOf(complete.slice(0, i + 1), lookupRated, GM);
    if (hc) hcpTrend.push({ date: complete[i].date, index: hc.index });
  }

  const det = (list) => list.filter((r) => r.detailed);
  const d5 = det(recentFirst).slice(0, 5), p5 = det(recentFirst).slice(5, 10);
  const putts = d5.length ? { last5: mean1(d5, (r) => r.putts), prior5: p5.length ? mean1(p5, (r) => r.putts) : null, n: d5.length } : null;
  const penalties = d5.length ? { last5: mean1(d5, (r) => r.penalties), prior5: p5.length ? mean1(p5, (r) => r.penalties) : null, topClub: topOf(d5.flatMap((r) => r.penaltyClubs)) } : null;
  const fir = d5.length && pct(d5, 'firMade', 'firTotal') != null ? { last5Pct: pct(d5, 'firMade', 'firTotal'), prior5Pct: p5.length ? pct(p5, 'firMade', 'firTotal') : null } : null;
  const gir = d5.length && pct(d5, 'girMade', 'girTotal') != null ? { last5Pct: pct(d5, 'girMade', 'girTotal'), prior5Pct: p5.length ? pct(p5, 'girMade', 'girTotal') : null } : null;

  const last = rounds.length ? rounds[rounds.length - 1] : null;
  const groups = new Map();
  for (const r of seasonRounds) {
    const g = groups.get(r.key) || { courseId: r.courseId, name: r.short, rounds: 0, scores: [] };
    g.rounds++;
    if (r.complete && r.holes === 18) g.scores.push(r.gross);
    groups.set(r.key, g);
  }
  const byCourse = [...groups.values()]
    .map((g) => ({ courseId: g.courseId, name: g.name, rounds: g.rounds, eighteen: g.scores.length, avg: g.scores.length ? round1(avg(g.scores)) : null }))
    .sort((a, b) => (a.avg == null) - (b.avg == null) || (a.avg ?? 0) - (b.avg ?? 0) || b.rounds - a.rounds);

  const meta = backupMeta || { lastExportAt: null, lastExportRoundCount: 0 };
  return zero({
    available: true, source: 'fairwayLedger.v1', asOf: null,
    rounds, eighteen, nine, seasonYear, seasonRounds,
    weekRounds: rounds.filter((r) => r.date >= ctx.weekStart && r.date <= weekEnd),
    prevWeekRounds: rounds.filter((r) => r.date >= ctx.prevWeekStart && r.date < ctx.weekStart),
    last5, prior5, scoring, seasonLow,
    handicap, handicap30: h30 ? h30.index : null, hcpTrend,
    putts, penalties, fir, gir,
    last10Scores: eighteen.slice(-10).map((r) => r.gross),
    lastRound: last ? { id: last.id, date: last.date, gross: last.gross, toPar: last.toPar, courseName: last.courseName, short: last.short, holes: last.holes, daysAgo: daysAgo(last.date, ctx.today) } : null,
    daysSinceLastRound: last ? daysAgo(last.date, ctx.today) : null,
    byCourse,
    unbackedRounds: Math.max(0, rounds.length - (Number(meta.lastExportRoundCount) || 0)),
    backupMeta: meta,
    weeklyHistory: weeklyHistory(dates, ctx.today),
    roundWeeks: weekRun(dates, ctx, 1),
    byDay: marksFromDates(dates, ctx.weekStart),
  });
}

/** §2 facts(ctx): reads the ledger's localStorage (memoized on the raw string in ls.js). Never throws. */
export async function facts(ctx) {
  try {
    await ensureLibs();
    const r = readFairwayLedger();
    if (!r.ok) return zero({ reason: r.reason, weeklyHistory: weeklyHistory([], ctx.today) });
    return computeFacts(r.state, r.backupMeta, ctx, { GolfMath: globalThis.GolfMath, GolfShapes: globalThis.GolfShapes });
  } catch (err) {
    return zero({ error: String(err), weeklyHistory: weeklyHistory([], ctx.today) });
  }
}

/* ------------------------------------------------------------------ §2 API */

export const EMPTY = {
  title: 'No rounds yet',
  body: 'Your rounds live in Fairway Ledger. Open it and import your last backup — everything counts here.',
  cta: { label: 'Open the ledger', href: LEDGER_HREF },
};

export function summary(f, goal) {
  const s = baseSummary(meta, id, (f.weekRounds || []).length, goal);
  if (!f.available || !(f.rounds || []).length) { s.empty = EMPTY; return s; }
  const sc = f.scoring;
  if (sc && Math.abs(sc.delta) >= 0.5) {
    s.note = sc.delta > 0
      ? { text: `Avg down ${fmt.one(sc.delta)}`, tone: 'good', icon: 'down' }
      : { text: `Avg up ${fmt.one(-sc.delta)}`, tone: 'neutral', icon: 'up' };
  } else if (f.seasonLow && f.seasonLow.daysAgo != null && f.seasonLow.daysAgo <= 14) {
    s.note = { text: `Season low ${f.seasonLow.score}`, tone: 'good', icon: 'bolt' };
  } else if (f.lastRound && f.lastRound.gross != null) {
    s.note = { text: `${f.lastRound.gross} at ${String(f.lastRound.short || f.lastRound.courseName).split(/\s+/)[0]}`, tone: 'neutral' };
  }
  return s;
}

export function dayMarks(f, ctx) {
  return marksFromDates((f.rounds || []).map((x) => x.date), ctx.weekStart);
}

export function weekCount(f, weekStart) {
  return countInWeek((f.rounds || []).map((x) => x.date), weekStart);
}

export const quickLog = {
  kinds: [
    { k: 'round', label: 'Round', glyph: 'golf', mode: 'link', href: LEDGER_HREF, cta: 'Open Fairway Ledger', sub: () => 'Fairway Ledger' },
  ],
};

/* ------------------------------------------------------------------ Coach rules (SPEC §6.3, golf) */

const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
/** 'today' / 'yesterday' / 'on Sunday' / 'on Sep 7' — for mid-sentence use. */
function onDay(date, ctx) {
  const w = dayWord(date, ctx);
  return w === 'today' || w === 'yesterday' ? w : `on ${w}`;
}
const inSeason = (ctx) => { const m = parseYmd(ctx.today).getMonth(); return m >= 3 && m <= 9; };

export const rules = [
  (F) => {
    const g = F.facts.golf || {};
    if (g.available && (g.rounds || []).length) return null;
    return { id: 'G0', pillar: 'golf', priority: 100, tone: 'neutral', kicker: 'Golf · Empty', headline: 'No rounds in the ledger yet.', sub: 'Open Fairway Ledger → Data → Import your last backup.', viz: null, href: LEDGER_HREF, actions: null };
  },
  (F) => {
    const g = F.facts.golf || {};
    const sc = g.scoring;
    if (!g.available || !sc || Math.abs(sc.delta) < 0.5) return null;
    const down = sc.delta > 0;
    const low = g.seasonLow && daysBetween(g.seasonLow.date, F.ctx.today) <= 14 ? g.seasonLow : null;
    return {
      id: 'G1', pillar: 'golf', family: 'golf-trend', priority: 80, tone: down ? 'good' : 'neutral',
      kicker: g.handicap ? `Golf · Handicap ${fmt.one(g.handicap.index)}` : `Golf · ${g.eighteen.length} rounds`,
      headline: `Scoring average <strong>${down ? 'down' : 'up'} ${fmt.one(Math.abs(sc.delta))}</strong> over your last ${sc.n} rounds.`,
      sub: `${fmt.one(sc.last5Avg)} vs ${fmt.one(sc.prior5Avg)}${low ? ` · ${sn(low.short)} ${low.score} ${onDay(low.date, F.ctx)} was a season best` : ''}`,
      viz: { type: 'spark', values: g.last10Scores, invert: true }, href: '#/golf', actions: null,
    };
  },
  (F) => {
    const g = F.facts.golf || {};
    const low = g.seasonLow;
    if (!g.available || !low || daysBetween(low.date, F.ctx.today) > 14) return null;
    if (g.scoring && Math.abs(g.scoring.delta) >= 0.5) return null; // G1 already tells it
    const toPar = low.toPar > 0 ? `+${low.toPar}` : low.toPar < 0 ? fmt.signedInt(low.toPar) : 'E';
    return {
      id: 'G2', pillar: 'golf', priority: 85, tone: 'good', kicker: 'Golf · Season low',
      headline: `<strong>${low.score}</strong> at ${esc(low.short)} ${esc(dayWord(low.date, F.ctx))} — your best of ${g.seasonYear}.`,
      sub: `${toPar} · ${g.handicap ? `handicap ${fmt.one(g.handicap.index)}` : `${g.seasonRounds.filter((r) => r.holes === 18).length} rounds this year`}`,
      viz: { type: 'delta', value: String(low.score), icon: 'bolt', tone: 'good' }, href: '#/golf', actions: null,
    };
  },
  (F) => {
    const g = F.facts.golf || {};
    if (!g.available || !g.handicap || g.handicap30 == null) return null;
    const d = round1(g.handicap.index - g.handicap30);
    if (Math.abs(d) < 0.3) return null;
    const down = d < 0;
    return {
      id: 'G3', pillar: 'golf', family: 'golf-trend', priority: 70, tone: down ? 'good' : 'neutral', kicker: 'Golf · Handicap',
      headline: `Handicap <strong>${down ? 'down' : 'up'} ${fmt.one(Math.abs(d))}</strong> in 30 days.`,
      sub: `${fmt.one(g.handicap30)} → ${fmt.one(g.handicap.index)} · our estimate, not an official index`,
      viz: { type: 'delta', value: fmt.signed1(d), icon: down ? 'down' : 'up', tone: down ? 'good' : '' }, href: '#/golf', actions: null,
    };
  },
  (F) => {
    const g = F.facts.golf || {};
    if (!g.available || !(g.rounds || []).length) return null;
    const goal = F.goals.golf, n = (g.weekRounds || []).length;
    const viz = { type: 'dots7', on: g.byDay || [], todayIndex: F.ctx.dayIndex };
    if (goal - n === 1) {
      const left = F.ctx.daysLeft;
      return {
        id: 'G4', pillar: 'golf', priority: 60, tone: 'neutral', kicker: `Golf · ${n} of ${goal}`,
        headline: 'One more round <strong>hits your goal</strong> this week.',
        sub: `${left === 0 ? 'Last day of the week' : `${left} ${plural(left, 'day')} left`}${F.ctx.dayIndex <= 4 ? ' · Sat and Sun open' : ''}`,
        viz, href: '#/golf', actions: null,
      };
    }
    if (n >= goal) {
      const lr = g.lastRound;
      return {
        id: 'G4', pillar: 'golf', priority: 60, tone: 'good', kicker: `Golf · ${n} of ${goal}`,
        headline: `Golf goal <strong>hit</strong> — ${n} ${plural(n, 'round')} this week.`,
        sub: lr && lr.gross != null ? `Last round ${lr.gross} at ${sn(lr.short)}` : `${n} ${plural(n, 'round')} in the ledger this week`,
        viz, href: '#/golf', actions: null,
      };
    }
    return null;
  },
  (F) => {
    const g = F.facts.golf || {};
    if (!g.available || g.daysSinceLastRound == null || g.daysSinceLastRound < 14 || !inSeason(F.ctx)) return null;
    const lr = g.lastRound;
    return {
      id: 'G5', pillar: 'golf', priority: 50, tone: 'warm', kicker: `Golf · ${g.daysSinceLastRound} days`,
      headline: `It's been <span class="warn">${g.daysSinceLastRound} days</span> since your last round.`,
      sub: `${lr.gross != null ? lr.gross : `${lr.holes} holes`} at ${esc(lr.short)} on ${monD(lr.date)}`, viz: null, href: '#/golf', actions: null,
    };
  },
  (F) => {
    const g = F.facts.golf || {};
    const p = g.putts;
    if (!g.available || !p || p.prior5 == null || Math.abs(p.last5 - p.prior5) < 1.0) return null;
    const d = round1(p.last5 - p.prior5), down = d < 0;
    return {
      id: 'G6', pillar: 'golf', priority: 55, tone: down ? 'good' : 'neutral', kicker: 'Golf · Putting',
      headline: `Putts per round <strong>${down ? 'down' : 'up'} ${fmt.one(Math.abs(d))}</strong> over your last 5.`,
      sub: `${fmt.one(p.last5)} vs ${fmt.one(p.prior5)}`,
      viz: { type: 'delta', value: fmt.signed1(d), icon: down ? 'down' : 'up', tone: down ? 'good' : '' }, href: '#/golf', actions: null,
    };
  },
  (F) => {
    const g = F.facts.golf || {};
    const p = g.penalties;
    if (!g.available || !p || p.prior5 == null || p.last5 - p.prior5 < 0.4) return null;
    return {
      id: 'G7', pillar: 'golf', priority: 55, tone: 'warm', kicker: 'Golf · Penalties',
      headline: `Penalties crept up to <span class="warn">${fmt.one(p.last5)}</span> a round.`,
      sub: `${fmt.one(p.prior5)} before · ${p.topClub ? `${esc(p.topClub)} is the club` : 'mostly off the tee'}`,
      viz: { type: 'delta', value: fmt.signed1(p.last5 - p.prior5), icon: 'up', tone: 'warm' }, href: '#/golf', actions: null,
    };
  },
  (F) => {
    const g = F.facts.golf || {};
    if (!g.available) return null;
    const pick = g.fir && g.fir.prior5Pct != null && g.fir.last5Pct - g.fir.prior5Pct >= 5 ? ['Fairways', g.fir]
      : g.gir && g.gir.prior5Pct != null && g.gir.last5Pct - g.gir.prior5Pct >= 5 ? ['Greens', g.gir] : null;
    if (!pick) return null;
    const [label, m] = pick, d = m.last5Pct - m.prior5Pct;
    return {
      id: 'G8', pillar: 'golf', priority: 45, tone: 'good', kicker: `Golf · ${label}`,
      headline: `${label} <strong>${m.last5Pct}%</strong> over your last 5, up ${d} points.`,
      sub: `${m.prior5Pct}% before`,
      viz: { type: 'delta', value: `+${d}`, icon: 'up', tone: 'good' }, href: '#/golf', actions: null,
    };
  },
  (F) => {
    const g = F.facts.golf || {};
    if (!g.available || g.unbackedRounds < 3) return null;
    return {
      id: 'G9', pillar: 'golf', priority: 65, tone: 'warm', kicker: 'Golf · Backup',
      headline: `<span class="warn">${g.unbackedRounds} rounds</span> aren't in a Fairway Ledger backup yet.`,
      sub: 'Ledger → Data → Export, or back up all of Clubhouse below.',
      viz: null, href: '#/backup', actions: [{ label: 'Back up now', run: 'backup.export' }],
    };
  },
];

/** Every golf insight that fires, highest priority first (the Golf screen shows them uncapped). */
export function insights(F) {
  const out = [];
  for (const r of rules) { try { const i = r(F); if (i) out.push(i); } catch (err) { console.warn('golf rule failed', err); } }
  return out.sort((a, b) => b.priority - a.priority);
}

