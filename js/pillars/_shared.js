// Helpers shared by the pillar modules (pure). Written by the shell lane; any lane may use them.
import { addDays, lastWeeks, dowIndex, daysBetween } from '../dates.js';

/** Ring sublabel exactly per SPEC §2: `of ${goal} ${goal===1 ? one : many}`. */
export function sublabel(meta, goal) {
  return `of ${goal} ${goal === 1 ? meta.unit.one : meta.unit.many}`;
}

/** Base Summary with the ring math filled in. */
export function baseSummary(meta, id, value, goal) {
  return {
    pillar: id, ringValue: value, ringGoal: goal, over: Math.max(0, value - goal),
    label: meta.label, sublabel: sublabel(meta, goal), note: null, href: meta.href, empty: null, freshness: null,
  };
}

/** boolean[7] for ctx.weekStart's week from a list of ymd dates. */
export function marksFromDates(dates, weekStart) {
  const out = [false, false, false, false, false, false, false];
  const end = addDays(weekStart, 6);
  for (const d of dates) if (d >= weekStart && d <= end) out[dowIndex(d)] = true;
  return out;
}

export function countInWeek(dates, ws) {
  const end = addDays(ws, 6);
  let n = 0;
  for (const d of dates) if (d >= ws && d <= end) n++;
  return n;
}

/** { [weekStart]: count } for the last n weeks ending at ctx.weekStart (every week present). */
export function weeklyHistory(dates, today, n = 26) {
  const out = {};
  for (const ws of lastWeeks(today, n)) out[ws] = countInWeek(dates, ws);
  return out;
}

export function daysAgo(date, today) {
  return date ? daysBetween(date, today) : null;
}

/** Weeks in a row (ending this week if it qualifies, else last week) where count ≥ min. */
export function weekRun(dates, ctx, min = 1) {
  let ws = countInWeek(dates, ctx.weekStart) >= min ? ctx.weekStart : ctx.prevWeekStart;
  let n = 0;
  while (countInWeek(dates, ws) >= min && n < 520) { n++; ws = addDays(ws, -7); }
  return n;
}
