// Home composition — SPEC §2.4 / §2.5 / §7.10, Home lane.
// Composes the four pillars through the §2 API (facts / summary / dayMarks / weekCount) and the facts contract
// shapes (§2.1–§5.3); knows nothing else about them. buildHome() is the whole Home view-model; the pure pieces
// (mergeDayMarks, greet, onboarding, dayItems, activeYesterday, recapState) are exported for tests.
import * as store from '../store.js';
import * as dates from '../dates.js';
import * as backup from '../backup.js';
import * as coach from '../coach.js';
import * as recap from '../recap.js';
import { pillars, byId } from './index.js';
import { EXPORT_STEPS, FORM_URL } from '../train/form-import.js';

/** Home's "Get set up" deep links: the vendored apps open with their own Import control pointed out. */
export const LEDGER_IMPORT = './apps/fairway-ledger/index.html#clubhouse-import';
export const BP_IMPORT = './apps/barrel-proof/index.html#clubhouse-import';
export { FORM_URL };

const sn = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
const one = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : '');

/* ------------------------------------------------------------------ week strip (§6.5) */

export function mergeDayMarks(marks, ctx) {
  return dates.DOW.map((label, i) => {
    const date = dates.addDays(ctx.weekStart, i);
    return {
      label,
      date,
      dayNum: Number(date.slice(8)),
      hit: marks.some((m) => m && m[i]),
      today: i === ctx.dayIndex,
      future: i > ctx.dayIndex,
    };
  });
}

/**
 * What happened on each day of this week, for the tap-to-see line under the strip:
 * [[{ pillar, glyph, text, href }], … ×7]. Reads only the facts contract fields.
 */
export function dayItems(facts, ctx) {
  const days = Array.from({ length: 7 }, () => []);
  const at = (d) => (typeof d === 'string' && d >= ctx.weekStart && d <= ctx.weekEnd ? dates.dowIndex(d) : -1);
  const add = (d, item) => { const i = at(d); if (i >= 0) days[i].push(item); };
  const g = facts.golf || {};
  for (const r of g.weekRounds || []) {
    const where = String(r.short || r.courseName || '').split(/\s+/)[0];
    const text = r.complete !== false && r.gross ? `${r.gross} at ${where}` : `Round at ${where}`;
    add(r.date, { pillar: 'golf', glyph: 'golf', text: r.holes === 9 ? `${text} · 9` : text, href: '#/golf' });
  }
  const t = facts.train || {};
  for (const s of t.weekWorkouts || []) {
    add(s.date, { pillar: 'train', glyph: 'train', text: `${s.title || 'Workout'}${s.durationMin ? ` · ${s.durationMin} min` : ''}`, href: '#/train' });
  }
  const b = facts.bourbon || {};
  for (const x of b.weekTastings || []) {
    add(x.date, { pillar: 'bourbon', glyph: 'bourbon', text: `${sn(x.name) || 'Pour'}${Number.isFinite(x.score) ? ` ${one(x.score)}` : ''}`, href: '#/bourbon' });
  }
  const sp = facts.sports || {};
  for (const x of sp.watchedThisWeek || []) {
    const team = (sp.teams && sp.teams[x.team] && sp.teams[x.team].short) || x.team || 'Game';
    const opp = x.opponent && x.opponent.short;
    const res = x.result && x.score ? ` ${x.result} ${x.score.us}–${x.score.them}` : opp ? ` vs ${opp}` : '';
    add(x.date, { pillar: 'sports', glyph: 'sports', text: `${team}${res}`, href: '#/sports' });
  }
  return days;
}

/** Every activity date per pillar (rounds, Form sessions, tastings + quick pours, watched games). */
export function activityDates(facts) {
  return {
    golf: (facts.golf?.rounds || []).map((r) => r.date),
    train: (facts.train?.sessions || []).map((s) => s.date),
    bourbon: (facts.bourbon?.tastings || []).map((x) => x.date),
    sports: Object.values(facts.sports?.watched || {}).map((r) => r && r.date),
  };
}

/** { date, pillars:[…] } — which pillars had activity yesterday (X3). */
export function activeYesterday(facts, ctx) {
  const y = dates.addDays(ctx.today, -1);
  const a = activityDates(facts);
  return { date: y, pillars: Object.keys(a).filter((k) => a[k].includes(y)) };
}

/* ------------------------------------------------------------------ greeting (§2.5) */

export function greet(ctx, rings, name = 'Joe') {
  const hello = ctx.hour < 12 ? 'Morning' : ctx.hour < 17 ? 'Afternoon' : 'Evening';
  const live = rings.filter((r) => !r.empty);
  let tail = 'Let’s go.';
  if (live.some((r) => r.ringGoal - r.ringValue === 1)) tail = 'One more.';
  else if (live.length === rings.length && live.length && live.every((r) => r.ringValue >= r.ringGoal)) tail = 'Goal week.';
  else if (live.some((r) => r.ringValue >= r.ringGoal && r.ringValue > 0)) tail = 'On pace.';
  else if (rings.every((r) => !r.ringValue) && ctx.dayIndex >= 2) tail = 'Fresh start.';
  return { hello: `${hello}, ${name || 'Joe'}.`, tail };
}

/* ------------------------------------------------------------------ first run (§7.10, extended to four steps) */

const goalLine = (goals) => `Golf ${goals.golf} · Train ${goals.train} · Bourbon ${goals.bourbon} · Sports ${goals.sports}`;

/**
 * The "Get set up" card. Pure: facts + settings map + goals → { show, done, total, open, steps[], hides[] }.
 * Each step: { id, glyph, n, done, title, sub, how:[html], note, actions:[{ kind:'link'|'ext'|'form'|'keep', label, href?, primary? }] }.
 * `hides` = the Coach empty-state rules the card replaces while it is up (G0 / T0 / B0 — same message, one place).
 */
export function onboarding(facts, map = {}, goals = store.DEFAULT_GOALS) {
  const g = facts.golf || {}, b = facts.bourbon || {}, t = facts.train || {};
  const rounds = (g.rounds || []).length;
  const golfDone = Boolean(g.available && rounds);
  const bourbonDone = Boolean(b.available);
  const trainDone = Boolean(t.available);
  const goalsDone = Boolean(map['onboarding.goals']) || Object.keys(map).some((k) => k.startsWith('goal.'));
  const steps = [
    {
      id: 'golf', glyph: 'golf', n: 1, done: golfDone,
      title: 'Import golf from Fairway Ledger',
      sub: golfDone ? `${rounds} ${rounds === 1 ? 'round' : 'rounds'} in the ledger` : 'Old ledger: Data → Export. Then Import here.',
      how: [
        'In the Fairway Ledger you use now, tap <b>Data</b> (top right) → <b>Export</b>. It saves a <b>fairway-ledger-…json</b> file.',
        'Tap below: Clubhouse’s ledger opens with <b>Data</b> already open. Tap <b>Import</b> and choose that file.',
      ],
      note: 'The ledger checks the file itself — and asks first if it would replace rounds.',
      actions: [{ kind: 'link', label: 'Open the ledger’s Import', href: LEDGER_IMPORT, primary: true }],
    },
    {
      id: 'bourbon', glyph: 'bourbon', n: 2, done: bourbonDone,
      title: 'Import bourbon from Barrel Proof',
      sub: bourbonDone ? `${b.cabinetCount || 0} in the cabinet · ${(b.tastings || []).length} tastings` : 'Old app: Back up. Then Restore here.',
      how: [
        'In the Barrel Proof you use now, tap the <b>download arrow</b> at the top — “Back up your data to a file”.',
        'Tap below, then the highlighted <b>upload arrow</b> (“Restore”) and choose that file.',
      ],
      note: bourbonDone ? 'Restoring replaces this cabinet — Clubhouse takes a snapshot first.' : 'Pours and tastings count on Home as soon as it’s in.',
      actions: [{ kind: 'link', label: 'Open Barrel Proof’s Restore', href: BP_IMPORT, primary: true, snapshot: bourbonDone }],
    },
    {
      id: 'train', glyph: 'train', n: 3, done: trainDone,
      title: 'Import workouts from Form',
      sub: trainDone ? `${t.totalWorkouts || 0} ${t.totalWorkouts === 1 ? 'session' : 'sessions'} · as of ${dates.monD(t.asOfDate)}` : 'Form: You → Settings → Backup.',
      how: EXPORT_STEPS.map((s) => s.html),
      note: 'You’ll see a preview first. Nothing is saved until you tap Import — and a snapshot comes first.',
      actions: [{ kind: 'form', label: trainDone ? 'Choose a newer Form file' : 'Choose the Form file', primary: true }, { kind: 'ext', label: 'Open Form', href: FORM_URL }],
    },
    {
      id: 'goals', glyph: 'target', n: 4, done: goalsDone,
      title: 'Set your weekly goals',
      sub: `${goalLine(goals)} a week`,
      how: [`Your rings fill at <b>${goalLine(goals)}</b> each week.`],
      note: 'Change them any time in Settings.',
      actions: [{ kind: 'keep', label: 'Keep these', primary: true }, { kind: 'link', label: 'Change goals', href: '#/settings', mark: true }],
    },
  ];
  const done = steps.filter((s) => s.done).length;
  const show = !map['onboarding.dismissed'] && done < steps.length;
  const open = (steps.find((s) => !s.done) || {}).id || null;
  const hides = show ? [!golfDone && 'G0', !bourbonDone && 'B0', !trainDone && 'T0'].filter(Boolean) : [];
  return { show, done, total: steps.length, open, steps, hides };
}

/* ------------------------------------------------------------------ recap (§6.6) + X2 gate */

/** X2 is due Sunday ≥ 17:00 and all Monday, once per recap week, until tapped. */
export function recapDue(ctx, recapVm, lastSeen) {
  if (!recapVm) return false;
  const window = (ctx.dayIndex === 6 && ctx.hour >= 17) || ctx.dayIndex === 0;
  return window && lastSeen !== recapVm.weekStart;
}

/* ------------------------------------------------------------------ the view-model */

export async function buildHome(now = new Date()) {
  const ctx = dates.makeCtx(now);
  const [goals, map] = await Promise.all([store.goals(), store.settingsMap()]);
  const name = map['profile.name'] || 'Joe';
  const factsList = await Promise.all(pillars.map((p) => Promise.resolve().then(() => p.facts(ctx)).catch((e) => ({ available: false, error: String(e) }))));
  const facts = Object.fromEntries(pillars.map((p, i) => [p.id, factsList[i] || { available: false }]));

  const rings = pillars.map((p) => {
    try { return p.summary(facts[p.id], goals[p.id], ctx); } catch (err) {
      console.warn('summary failed', p.id, err);
      return { pillar: p.id, ringValue: 0, ringGoal: goals[p.id], over: 0, label: p.meta.label, sublabel: '', note: null, href: p.meta.href, empty: { title: 'Unavailable', body: '', cta: null } };
    }
  });
  const week = mergeDayMarks(pillars.map((p) => { try { return p.dayMarks(facts[p.id], ctx); } catch { return []; } }), ctx);
  const items = dayItems(facts, ctx);
  week.forEach((d, i) => { d.items = items[i]; });

  let nudge = null;
  try { nudge = await backup.nudgeState(facts, now); } catch { nudge = null; }

  const rWeek = recap.recapWeek(ctx);
  const lastWeek = recap.hasHistory(facts, byId, rWeek) ? recap.build({ facts, goals, ctx }, byId) : null;
  const due = recapDue(ctx, lastWeek, map['home.lastRecapSeen']);

  const setup = onboarding(facts, map, goals);
  const F = { facts, goals, ctx, nudge, recap: lastWeek ? { ...lastWeek, due } : null, yesterday: activeYesterday(facts, ctx) };
  const seen = map['coach.seen'] && typeof map['coach.seen'] === 'object' ? map['coach.seen'] : {};
  const insights = coach.select(coach.collect(F), { limit: 4, perPillar: 2, home: true, seen, today: ctx.today, hidden: setup.hides });
  const streaks = coach.streaks(F);
  const pill = coach.headlineStreak(streaks);

  let nextUp = null;
  try { nextUp = facts.sports && facts.sports.available && byId.sports.nextUpCard ? byId.sports.nextUpCard(facts.sports, ctx) : null; } catch { nextUp = null; }

  const greeting = greet(ctx, rings, name);
  return { ctx, greeting, rings, week, insights, streaks, pill, nextUp, lastWeek, setup, facts, goals, nudge, seen };
}
