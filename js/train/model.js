// Train — pure maths over the normalized Form dataset (see form-import.js). No DOM, no storage.
// e1RM (Epley), PRs, movers, week counts, streaks, volume, active minutes, balance → TrainFacts.
//
// "Never fabricate": an e1RM exists only for a logged, loaded set (weight > 0, 1 ≤ reps ≤ 12) on a movement that
// carries a load (dumbbell, barbell, machine, cable, kettlebell — not bodyweight holds, bands or assisted machines).
// A first-ever appearance of a lift is never called a PR: a PR is a strict improvement over an earlier logged best.

import { addDays, daysBetween, lastWeeks, mondayOf, monD, dowIndex } from '../dates.js';

export const MAX_E1RM_REPS = 12;
export const STALE_DAYS = 3;
export const MOVER_WINDOW_DAYS = 42;
export const MOVER_RECENT_DAYS = 60;
export const GROUPS = ['legs', 'pull', 'push'];

/** 'Barbell hip thrust' → 'Hip thrust' (first `n` words after the implement) — for tight slots like a ring note. */
export function shortLift(name, n = 2) {
  const words = String(name || '').replace(/^(barbell|dumbbell|kettlebell|cable|machine|smith machine|band|bodyweight)\s+/i, '').split(/\s+/).filter(Boolean);
  const out = words.slice(0, n).join(' ');
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

/** Epley, rounded to 1 lb; null unless weight > 0 and 1 ≤ reps ≤ 12. e1rm(315,3)=347 · e1rm(315,1)=315. */
export function e1rm(weight, reps) {
  const w = Number(weight), r = Number(reps);
  if (!(w > 0) || !Number.isFinite(r) || r < 1 || r > MAX_E1RM_REPS) return null;
  return Math.round(r === 1 ? w : w * (1 + r / 30));
}

/** e1RM of one normalized set (needs the parser's `lift` flag — an unmarked set is never estimated). */
export function setE1rm(s) {
  return s && s.lift === true ? e1rm(s.weight, s.reps) : null;
}

/** Σ weight × reps over loaded sets. */
export function sessionVolume(session) {
  let v = 0;
  for (const s of session.sets || []) if (s.lift === true && s.weight > 0 && s.reps > 0) v += s.weight * s.reps;
  return Math.round(v);
}

/** { weekStart: sessions } */
export function weekCounts(sessions) {
  const out = {};
  for (const s of sessions) {
    const ws = mondayOf(s.date);
    out[ws] = (out[ws] || 0) + 1;
  }
  return out;
}

/**
 * Consecutive weeks at goal. The anchor week is in progress, so it never breaks a streak:
 * start at the anchor if it already qualifies, else at the week before.
 */
export function streakWeeks(counts, goal, anchorWs) {
  let ws = (counts[anchorWs] || 0) >= goal ? anchorWs : addDays(anchorWs, -7);
  let n = 0;
  while ((counts[ws] || 0) >= goal && n < 520) { n++; ws = addDays(ws, -7); }
  return n;
}

/** Monday of the first week in a streak of length n that ends per streakWeeks(). */
export function streakStart(counts, goal, anchorWs, n) {
  if (!n) return null;
  const first = (counts[anchorWs] || 0) >= goal ? anchorWs : addDays(anchorWs, -7);
  return addDays(first, -7 * (n - 1));
}

/* ------------------------------------------------------------------ exercises: history, PRs, movers */

/**
 * Map exerciseId → { id, name, sessions:[{ date, sessionId, title, sets, best, volume }] } in date order.
 * best = the set with the highest e1RM that session (ties → heavier), or null when nothing there is estimable.
 */
export function exerciseHistory(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const byEx = new Map();
    for (const set of s.sets || []) {
      if (!byEx.has(set.exerciseId)) byEx.set(set.exerciseId, { name: set.exercise, sets: [] });
      byEx.get(set.exerciseId).sets.push(set);
    }
    for (const [id, e] of byEx) {
      let best = null;
      let volume = 0;
      for (const set of e.sets) {
        const est = setE1rm(set);
        if (est != null && (!best || est > best.e1rm || (est === best.e1rm && set.weight > best.weight))) best = { e1rm: est, weight: set.weight, reps: set.reps };
        if (set.lift === true && set.weight > 0 && set.reps > 0) volume += set.weight * set.reps;
      }
      if (!map.has(id)) map.set(id, { id, name: e.name, sessions: [] });
      const h = map.get(id);
      h.name = e.name;
      h.sessions.push({ date: s.date, sessionId: s.id, title: s.title, sets: e.sets, best, volume: Math.round(volume) });
    }
  }
  return map;
}

/**
 * Every PR, newest first: a session whose best e1RM strictly beats the running best of that lift's earlier sessions.
 * → [{ exerciseId, name, date, sessionId, e1rm, weight, reps, previous:{ e1rm, date, weight, reps } }]
 */
export function findPRs(hist) {
  const out = [];
  for (const h of hist.values()) {
    let run = null;
    for (const s of h.sessions) {
      if (!s.best) continue;
      if (run && s.best.e1rm > run.e1rm) {
        out.push({ exerciseId: h.id, name: h.name, date: s.date, sessionId: s.sessionId, e1rm: s.best.e1rm, weight: s.best.weight, reps: s.best.reps, previous: { ...run } });
      }
      if (!run || s.best.e1rm > run.e1rm) run = { e1rm: s.best.e1rm, date: s.date, weight: s.best.weight, reps: s.best.reps };
    }
  }
  return out.sort((a, b) => (a.date === b.date ? (a.e1rm < b.e1rm ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/**
 * e1RM movers: each lift's latest estimable session vs the earliest estimable session within 6 weeks before it.
 * Needs two sessions in that window and a latest session within 60 days of today. Biggest swings first.
 * → [{ exerciseId, name, e1rm, weight, reps, date, from:{ e1rm, date }, delta, isPR }]
 */
export function findMovers(hist, prs, today, limit = 6) {
  const prKey = new Set(prs.map((p) => `${p.exerciseId}|${p.sessionId}`));
  const out = [];
  for (const h of hist.values()) {
    const est = h.sessions.filter((s) => s.best);
    if (est.length < 2) continue;
    const last = est[est.length - 1];
    if (daysBetween(last.date, today) > MOVER_RECENT_DAYS) continue;
    const base = est.slice(0, -1).find((s) => daysBetween(s.date, last.date) <= MOVER_WINDOW_DAYS);
    if (!base) continue;
    out.push({
      exerciseId: h.id, name: h.name, e1rm: last.best.e1rm, weight: last.best.weight, reps: last.best.reps, date: last.date,
      from: { e1rm: base.best.e1rm, date: base.date }, delta: last.best.e1rm - base.best.e1rm, isPR: prKey.has(`${h.id}|${last.sessionId}`),
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.date < b.date ? 1 : -1)).slice(0, limit);
}

/* ------------------------------------------------------------------ the facts */

const sumRange = (map, from, to) => {
  let n = 0;
  for (const [d, v] of Object.entries(map || {})) if (d >= from && d <= to) n += v;
  return n;
};

/** Zero-shaped facts (SPEC §2: facts never throw). */
export function emptyFacts(goal = 5, error = null) {
  const f = {
    available: false, source: null, asOf: null, asOfDate: null, staleDays: 0, stale: false, member: '',
    goal, totalWorkouts: 0, sessions: [], weekWorkouts: [], prevWeekWorkouts: [], weekCount: 0, prevWeekCount: 0,
    byDay: [false, false, false, false, false, false, false], last: null, daysSinceLast: null,
    streakWeeks: 0, streakSince: null, atRisk: false, remaining: goal,
    prsThisWeek: [], prs30: [], prsAll: [], movers: [], exercises: {},
    groupSets14: { legs: 0, pull: 0, push: 0, core: 0 }, sessions14: 0, nextFocus: null,
    volumeThisWeek: 0, volumePrev4Avg: 0, volumePrevWeeks: 0,
    activeMinThisWeek: 0, activeMinPrevWeek: 0, sessionMinThisWeek: 0, activitiesThisWeek: [], cardioTarget: null,
    mobilityThisWeek: 0, weekCounts: {}, weeklyHistory: {},
  };
  if (error) f.error = String(error);
  return f;
}

/**
 * dataset + ctx (dates.makeCtx) + goal → TrainFacts (SPEC §4.5 adapted to Form-backed data).
 * `asOfDate` is the export's day: everything is "as of" it, and streaks are anchored there when the export is older
 * than the current week (so a missed re-export never reads as a broken streak).
 */
export function analyze(dataset, ctx, goal = 5) {
  if (!dataset || !Array.isArray(dataset.sessions)) return emptyFacts(goal);
  const sessions = dataset.sessions;
  const today = ctx.today;
  const asOfDate = dataset.asOfDate || today;
  const staleDays = Math.max(0, daysBetween(asOfDate, today));
  const counts = weekCounts(sessions);
  const wsNow = ctx.weekStart;
  const weekEnd = addDays(wsNow, 6);
  const prevWs = ctx.prevWeekStart;
  const weekWorkouts = sessions.filter((s) => s.date >= wsNow && s.date <= weekEnd);
  const prevWeekWorkouts = sessions.filter((s) => s.date >= prevWs && s.date < wsNow);
  const weekCount = weekWorkouts.length;

  const byDay = [false, false, false, false, false, false, false];
  for (const s of weekWorkouts) byDay[dowIndex(s.date)] = true;

  const anchor = mondayOf(asOfDate) < wsNow ? mondayOf(asOfDate) : wsNow;
  const streak = streakWeeks(counts, goal, anchor);
  const remaining = Math.max(0, goal - weekCount);

  const lastS = sessions.length ? sessions[sessions.length - 1] : null;
  const hist = exerciseHistory(sessions);
  const prsAll = findPRs(hist);
  const from30 = addDays(today, -29);
  const exercises = {};
  for (const h of hist.values()) exercises[h.id] = h.name;

  // last 14 days (incl. today): where the working sets went
  const from14 = addDays(today, -13);
  const groupSets14 = { legs: 0, pull: 0, push: 0, core: 0 };
  let sessions14 = 0;
  for (const s of sessions) {
    if (s.date < from14 || s.date > today) continue;
    sessions14++;
    for (const g of Object.keys(groupSets14)) groupSets14[g] += (s.groups && s.groups[g]) || 0;
  }
  const anyGroup = GROUPS.some((g) => groupSets14[g] > 0);
  let nextFocus = null;
  if (anyGroup) {
    const order = ['legs', 'pull', 'push']; // tie order per SPEC §4.5
    nextFocus = order.slice().sort((a, b) => groupSets14[a] - groupSets14[b] || order.indexOf(a) - order.indexOf(b))[0];
  }

  // volume: this week vs the average of the 4 prior weeks that had any lifting (≥ 2 of them, else no comparison)
  const vol = (ws) => sessions.filter((s) => s.date >= ws && s.date <= addDays(ws, 6)).reduce((a, s) => a + sessionVolume(s), 0);
  const volumeThisWeek = vol(wsNow);
  const prev4 = [1, 2, 3, 4].map((k) => vol(addDays(wsNow, -7 * k))).filter((v) => v > 0);
  const volumePrev4Avg = prev4.length >= 2 ? Math.round(prev4.reduce((a, b) => a + b, 0) / prev4.length) : 0;

  // active minutes: measured sessions + logged activities + cardio (dataset.activeMinutesByDay)
  const amap = dataset.activeMinutesByDay || {};
  const activeMinThisWeek = sumRange(amap, wsNow, weekEnd);
  const activeMinPrevWeek = sumRange(amap, prevWs, addDays(wsNow, -1));
  const sessionMinThisWeek = weekWorkouts.reduce((a, s) => a + (s.durationMin || 0), 0);
  const byName = new Map();
  for (const a of dataset.activityLog || []) {
    if (a.date < wsNow || a.date > weekEnd) continue;
    byName.set(a.name, (byName.get(a.name) || 0) + a.minutes);
  }
  const activitiesThisWeek = [...byName].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes);

  const mobDays = new Set(Object.keys(dataset.mobilityByDay || {}).filter((d) => d >= wsNow && d <= weekEnd));
  for (const s of weekWorkouts) if (s.kind === 'mobility') mobDays.add(s.date);

  const weeklyHistory = {};
  for (const ws of lastWeeks(today, 26)) weeklyHistory[ws] = counts[ws] || 0;

  const last = lastS ? { id: lastS.id, date: lastS.date, kind: lastS.kind, title: lastS.title, focus: lastS.focus, minutes: lastS.durationMin, exerciseCount: lastS.exercises, setCount: lastS.setCount, daysAgo: daysBetween(lastS.date, today) } : null;

  return {
    available: true,
    source: dataset.source || 'form-v2',
    asOf: dataset.asOf || null,
    asOfDate,
    staleDays,
    stale: staleDays >= STALE_DAYS,
    member: (dataset.member && dataset.member.name) || '',
    goal,
    totalWorkouts: sessions.length,
    sessions,
    weekWorkouts, prevWeekWorkouts, weekCount, prevWeekCount: prevWeekWorkouts.length,
    byDay,
    last,
    daysSinceLast: last ? last.daysAgo : null,
    streakWeeks: streak,
    streakSince: streakStart(counts, goal, anchor, streak),
    atRisk: anchor === wsNow && weekCount < goal && streak >= 2,
    remaining,
    prsThisWeek: prsAll.filter((p) => p.date >= wsNow && p.date <= weekEnd),
    prs30: prsAll.filter((p) => p.date >= from30 && p.date <= today),
    prsAll,
    movers: findMovers(hist, prsAll, today),
    exercises,
    groupSets14, sessions14, nextFocus,
    volumeThisWeek, volumePrev4Avg, volumePrevWeeks: prev4.length,
    activeMinThisWeek, activeMinPrevWeek, sessionMinThisWeek, activitiesThisWeek,
    cardioTarget: (dataset.profile && dataset.profile.cardioTarget) || null,
    mobilityThisWeek: mobDays.size,
    weekCounts: counts,
    weeklyHistory,
  };
}

/** 'as of Sep 27' */
export function asOfText(f) {
  return f && f.asOfDate ? `as of ${monD(f.asOfDate)}` : '';
}

/** '1 day ago' / 'today' — how old the export is. */
export function ageText(f) {
  if (!f || !f.asOfDate) return '';
  const n = f.staleDays;
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
}
