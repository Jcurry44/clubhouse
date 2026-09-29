// Train — Coach insights over Form-backed data (SPEC §6.3 Train rules T0–T9, adapted; wording follows the SPEC
// where the data allows it). Pure: (F) → Insight[] with F = { facts, goals, ctx } and facts.train from
// pillars/train.js. Every insight cites its numbers and ends its receipts with "as of <export date>" so a stale
// export never reads as live truth. Rules never touch storage or the DOM.
//
// Wiring (Coach lane): `import { insights as trainInsights } from './train/insights.js'` and add
// `...trainInsights(F)` to coach.run()'s rule output; the Train screen already renders it uncapped.
import { DOW, dowIndex, monD, addDays } from '../dates.js';
import { esc } from '../dom.js';
import { asOfText, shortLift } from './model.js';

const FORM = 'https://form.jjcurry027.workers.dev/';
const plural = (n, one, many) => (n === 1 ? one : many || `${one}s`);
const fmtLb = (n) => Math.round(n).toLocaleString('en-US');

function sessionsSummary(list) {
  return list.slice(0, 4).map((w) => `${w.title} ${DOW[dowIndex(w.date)]}`).join(' · ');
}

/** The insights, most important first. */
export function insights(F) {
  const t = F.facts && F.facts.train;
  const goal = (F.goals && F.goals.train) || 5;
  const ctx = F.ctx;
  if (!t) return [];
  const out = [];
  const push = (i) => { if (i) out.push({ pillar: 'train', actions: null, viz: null, ...i }); };

  // ---- nothing imported yet
  if (!t.available) {
    push({
      id: 'T0', priority: 100, tone: 'neutral', kicker: 'Train · Form',
      headline: 'Nothing from Form yet. <strong>Import your export</strong> and this lights up.',
      sub: 'Form → You → Settings → Backup → Prepare export. Clubhouse only reads the file.',
      href: '#/train',
    });
    return out;
  }
  if (!t.totalWorkouts) {
    push({
      id: 'T00', priority: 100, tone: 'neutral', kicker: 'Train · Form',
      headline: 'Your Form export has <strong>no finished sessions</strong> yet.',
      sub: `Finish a workout in Form and export again · ${asOfText(t)}`,
      href: FORM,
    });
    return out;
  }

  const asOf = asOfText(t);
  const receipts = (s) => (s ? `${s} · ${asOf}` : asOf);
  const beforeWeek = Boolean(t.asOfDate && ctx && t.asOfDate < ctx.weekStart); // export predates this week: this-week numbers are unknown
  const remaining = Math.max(0, goal - t.weekCount);
  const over = Math.max(0, t.weekCount - goal);
  const viz = { type: 'dots7', on: t.byDay, todayIndex: ctx.dayIndex };
  const week = sessionsSummary(t.weekWorkouts);
  const recentPR = (t.prs30 || []).find((p) => p.date >= addDays(ctx.today, -6));

  // ---- T10 · the export is old
  if (t.stale) {
    push({
      id: 'T10', priority: 92, tone: 'warm', kicker: `Train · ${t.staleDays} days`,
      headline: `Your Form export is <span class="warn">${t.staleDays} days old</span>.`,
      sub: `${asOf} · In Form: You → Settings → Backup, then import the new file here.`,
      href: '#/train',
    });
  }

  // ---- T2 · a new PR in the last seven days (strict improvement over an earlier logged best)
  if (recentPR) {
    const p = recentPR;
    push({
      id: 'T2', priority: 90, tone: 'good', kicker: 'Train · PR',
      headline: `New PR: <strong>${esc(p.name)} ${fmtLb(p.weight)} × ${p.reps}</strong>.`,
      sub: receipts(`e1RM ${p.e1rm} lb · previous ${p.previous.e1rm} on ${monD(p.previous.date)}`),
      viz: { type: 'delta', value: `+${p.e1rm - p.previous.e1rm}`, icon: 'up', tone: 'good' },
      href: `#/train/exercise/${encodeURIComponent(p.exerciseId)}`,
    });
  }

  if (!beforeWeek) {
    // ---- T4 · streak held (replaces T1b when it applies), T1a/b/c goal progress
    if (remaining === 0 && t.streakWeeks >= 2) {
      push({
        id: 'T4', priority: 65, tone: 'good', kicker: `Train · ${t.streakWeeks} weeks`,
        headline: `<strong>${t.streakWeeks} weeks straight</strong> at your goal.`,
        sub: receipts(`${goal} a week since ${monD(t.streakSince)}`), viz, href: '#/train',
      });
    } else if (remaining === 0 && over === 0) {
      push({
        id: 'T1b', priority: 70, tone: 'good', kicker: `Train · ${goal} of ${goal}`,
        headline: `Goal <strong>hit</strong>: ${goal} of ${goal}. Anything more is gravy.`,
        sub: receipts(week), viz, href: '#/train',
      });
    } else if (remaining === 1) {
      push({
        id: 'T1a', priority: 75, tone: 'neutral', kicker: `Train · ${t.weekCount} of ${goal}`,
        headline: `${t.weekCount} ${plural(t.weekCount, 'workout')} this week — <strong>one more hits your goal</strong>.`,
        sub: receipts([week, recentPR ? `PR: ${shortLift(recentPR.name)} ${recentPR.e1rm}` : ''].filter(Boolean).join(' · ')), viz, href: '#log:lift',
      });
    } else if (remaining >= 2 && ctx.daysLeft >= remaining) {
      push({
        id: 'T1c', priority: 50, tone: 'neutral', kicker: `Train · ${t.weekCount} of ${goal}`,
        headline: `${t.weekCount} of ${goal} — <strong>${remaining} more</strong> with ${ctx.daysLeft} ${plural(ctx.daysLeft, 'day')} left.`,
        sub: receipts(week || (t.nextFocus ? `Next up: ${t.nextFocus}` : '')), viz, href: '#log:lift',
      });
    }

    // ---- T3 · a streak that needs more than the week has days
    if (t.atRisk && remaining > 0 && ctx.daysLeft < remaining) {
      push({
        id: 'T3', priority: 80, tone: 'warm', kicker: 'Train · Streak',
        headline: `Your <span class="warn">${t.streakWeeks}-week streak</span> needs ${remaining} more by Sunday.`,
        sub: receipts(`${t.weekCount} of ${goal} so far · ${ctx.daysLeft} ${plural(ctx.daysLeft, 'day')} left`), viz, href: '#log:lift',
      });
    }

    // ---- T8 · golf this week, no mobility yet (crosses pillars: reads Golf's facts when present)
    const g = F.facts.golf;
    if (g && Array.isArray(g.weekRounds) && g.weekRounds.length >= 1 && t.mobilityThisWeek === 0 && ctx.dayIndex <= 4 && !t.stale) {
      push({
        id: 'T8', priority: 42, tone: 'neutral', kicker: 'Train · Golf mobility',
        headline: 'A round this week and <strong>no mobility yet</strong>.',
        sub: receipts('A golf flow is about 20 minutes in Form'), href: '#log:mob',
      });
    }

    // ---- T9 · active minutes up on last week (measured sessions + logged activities + cardio)
    if (t.activeMinThisWeek >= 30 && t.activeMinPrevWeek > 0 && t.activeMinThisWeek - t.activeMinPrevWeek >= 15) {
      const top = t.activitiesThisWeek.slice(0, 2).map((a) => `${a.name} ${a.minutes}`).join(' · ');
      push({
        id: 'T9', priority: 35, tone: 'good', kicker: 'Train · Active',
        headline: `<strong>${t.activeMinThisWeek} min</strong> active this week, up ${t.activeMinThisWeek - t.activeMinPrevWeek}.`,
        sub: receipts(`${top ? `${top} · ` : ''}${t.activeMinPrevWeek} min last week`),
        viz: { type: 'delta', value: `+${t.activeMinThisWeek - t.activeMinPrevWeek}`, icon: 'up', tone: 'good' }, href: '#/train',
      });
    }
  }

  // ---- T5 · a gap since the last session (only when the export is current enough to know)
  if (!t.stale && t.daysSinceLast != null && t.daysSinceLast >= 4 && remaining > 0) {
    push({
      id: 'T5', priority: 60, tone: 'warm', kicker: `Train · ${t.daysSinceLast} days`,
      headline: `<span class="warn">${t.daysSinceLast} days</span> since your last workout. Mobility counts.`,
      sub: receipts(`Last: ${t.last.title} ${DOW[dowIndex(t.last.date)]}${t.last.minutes ? ` · ${t.last.minutes} min` : ''}`), href: '#log:mob',
    });
  }

  // ---- T6 · balance: upper-body work and nothing for the legs in two weeks
  const gs = t.groupSets14 || {};
  const upperSets = (gs.push || 0) + (gs.pull || 0);
  if ((gs.legs || 0) === 0 && upperSets >= 12 && t.sessions14 >= 3) {
    push({
      id: 'T6', priority: 45, tone: 'warm', kicker: 'Train · Balance',
      headline: `${t.sessions14} sessions, <span class="warn">zero leg work</span> in two weeks.`,
      sub: receipts(`${upperSets} push and pull sets · 0 for legs`), href: '#/train',
    });
  }

  // ---- T7 · lifted volume vs the 4-week average (week is done)
  if (t.volumePrev4Avg > 0 && remaining === 0 && Math.abs(t.volumeThisWeek / t.volumePrev4Avg - 1) >= 0.15 && !beforeWeek) {
    const ratio = t.volumeThisWeek / t.volumePrev4Avg - 1;
    push({
      id: 'T7', priority: 40, tone: ratio > 0 ? 'good' : 'neutral', kicker: 'Train · Volume',
      headline: `Lift volume <strong>${ratio > 0 ? 'up' : 'down'} ${Math.round(Math.abs(ratio) * 100)}%</strong> vs your ${t.volumePrevWeeks}-week average.`,
      sub: receipts(`${fmtLb(t.volumeThisWeek)} lb vs ${fmtLb(t.volumePrev4Avg)} lb`),
      viz: { type: 'delta', value: `${ratio > 0 ? '+' : '−'}${Math.round(Math.abs(ratio) * 100)}%`, icon: ratio > 0 ? 'up' : 'down', tone: ratio > 0 ? 'good' : 'warm' }, href: '#/train',
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}
