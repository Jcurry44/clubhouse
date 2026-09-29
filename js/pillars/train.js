// Train pillar — a read-only window onto Form (DECISIONS 2026-09-28). Implements the SPEC §2 module API over the
// Form export the person imported: workouts this week vs goal, week streak, last session, PRs and e1RM movers,
// active minutes. Nothing here logs a workout; logging lives in Form ("Log in Form" hand-off in the LOG sheet).
//
// Facts are computed by js/train/model.js from the normalized dataset (js/train/form-import.js) that
// js/train/source.js loads — swap the source and this file does not change.
import * as store from '../store.js';
import * as dates from '../dates.js';
import { baseSummary } from './_shared.js';
import { activeSource } from '../train/source.js';
import { analyze, emptyFacts, shortLift, STALE_DAYS } from '../train/model.js';
import { FORM_URL } from '../train/form-import.js';

export const id = 'train';
export const meta = {
  label: 'Train', glyph: 'train', unit: { one: 'workout', many: 'workouts' }, verb: 'trained',
  goalKey: 'goal.train', defaultGoal: 5, goalMin: 1, goalMax: 14, href: '#/train',
};
export { FORM_URL };

export async function facts(ctx) {
  let goal = meta.defaultGoal;
  try {
    goal = (await store.goals()).train;
    const { dataset } = await activeSource().load();
    return analyze(dataset, ctx, goal);
  } catch (err) {
    return emptyFacts(goal, err);
  }
}

export function summary(f, goal, ctx) {
  const value = f.weekCount || 0;
  const s = baseSummary(meta, id, value, goal);
  if (f.available) s.freshness = { asOf: f.asOf, stale: Boolean(f.stale) };
  if (!f.available) {
    s.empty = { title: 'Import from Form', body: 'Form is where you train. Bring in its export and this ring fills itself.', cta: { label: 'Import from Form', href: '#/train' } };
    return s;
  }
  if (!f.totalWorkouts) {
    s.empty = { title: 'No finished sessions yet', body: 'Finish a workout in Form, export again, and it shows up here.', cta: { label: 'Open Form', href: FORM_URL } };
    return s;
  }
  const remaining = Math.max(0, goal - value);
  const daysLeft = ctx ? ctx.daysLeft : 0;
  const pr = (f.prsThisWeek || [])[0];
  if (f.stale) {
    // an old export cannot honestly say how this week is going — say so, before anything else
    s.note = { text: `Export ${f.staleDays}d old`, tone: 'warm', icon: 'clock' };
  } else if (pr) {
    s.note = { text: `PR: ${shortLift(pr.name)} ${pr.e1rm}`, tone: 'good', icon: 'bolt' };
  } else if (remaining === 1) s.note = { text: 'One more hits it', tone: 'neutral' };
  else if (remaining === 0) s.note = value > goal ? { text: `+${value - goal} over`, tone: 'good', icon: 'check' } : { text: 'Goal hit', tone: 'good', icon: 'check' };
  else s.note = { text: `${remaining} to go · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`, tone: 'neutral' };
  return s;
}

/** boolean[7] — days of ctx.weekStart's week with a Form session. */
export function dayMarks(f, ctx) {
  if (!f.sessions) return [false, false, false, false, false, false, false];
  const out = [false, false, false, false, false, false, false];
  const end = dates.addDays(ctx.weekStart, 6);
  for (const s of f.sessions) if (s.date >= ctx.weekStart && s.date <= end) out[dates.dowIndex(s.date)] = true;
  return out;
}

export function weekCount(f, weekStart) {
  const wc = f.weekCounts || {};
  return wc[weekStart] || 0;
}

/**
 * Quick-log contribution (§7.6): workouts are logged in Form, so the LOG sheet offers one hand-off.
 * (`#log:mob` / `#log:run` / `#log:lift` all land here — sheet.js aliases them.)
 */
export const quickLog = {
  kinds: [
    {
      k: 'lift', label: 'Workout', glyph: 'train', mode: 'link', href: FORM_URL, external: true, cta: 'Log in Form', ctaGlyph: 'train',
      sub: (f) => (f && f.available && f.asOfDate ? `In Form · as of ${dates.monD(f.asOfDate)}` : 'In Form'),
      explain: (f, h) => [
        'Lifts, mobility and activities are logged in ', h('b', 'Form'), '. Open it, do the work, then import its export here — your ring, streak and PRs update from the file.',
      ],
    },
  ],
};

export { STALE_DAYS };
