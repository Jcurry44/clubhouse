// Coach — the deterministic insight engine (SPEC §6), Home lane.
// Every pillar owns its own rules (pillars/golf.js G0–G9, train/insights.js T0–T10, pillars/bourbon.js B0–B6,
// pillars/sports.js S0–S5); this module adds the cross-pillar rules (X1 backup nudge, X2 weekly recap, X3 full house),
// ranks everything by priority + novelty, and applies the Home selection (§6.2). Pure: no storage, no DOM.
//
//   collect(F)          → every insight that fires (pillar + system), unsorted
//   select(list, opts)  → the Home feed: ranked, capped (≤ 4, ≤ 2 per pillar, ≤ 1 per family, X1 always), screen-only rules dropped
//   run(F, opts)        → select(collect(F), opts)
//   forPillar(F, id)    → one pillar's insights, uncapped (pillar screens)
//   streaks(F)          → ≤ 4 streak chips (§6.4)
//   remember(seen, list, today) → the updated novelty map (Home persists it as settings 'coach.seen')
//
// F = { facts:{golf,train,bourbon,sports}, goals, ctx, nudge?, recap?, yesterday? }.
import * as golf from './pillars/golf.js';
import * as bourbon from './pillars/bourbon.js';
import * as sports from './pillars/sports.js';
import { insights as trainInsights } from './train/insights.js';
import { esc } from './dom.js';
import { daysBetween, addDays } from './dates.js';

export const PILLAR_ORDER = ['golf', 'train', 'bourbon', 'sports', 'system'];

/* ------------------------------------------------------------------ system rules (SPEC §6.3 "System / cross-pillar") */

const WORD = { golf: 'a round', train: 'a workout', bourbon: 'a pour', sports: 'a game' };

/** 'a, b and c' */
export function listText(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const systemRules = [
  // X1 — the weekly backup nudge (backup.needsNudge → F.nudge)
  (F) => {
    const n = F.nudge;
    if (!n || !n.due) return null;
    const age = n.reason === 'age';
    const never = age && n.days == null;
    return {
      id: 'X1', pillar: 'system', priority: 95, tone: 'warm',
      kicker: never ? 'Backup · Never' : age ? `Backup · ${n.days} days` : `Backup · ${n.newRecords} new`,
      headline: never ? 'Back up Clubhouse — <span class="warn">no backup yet</span>.'
        : age ? `Back up Clubhouse — <span class="warn">${n.days} days</span> since the last one.`
          : `<span class="warn">${n.newRecords} new records</span> since your last backup.`,
      sub: 'Rounds, workouts, pours, everything · one tap, goes to Files',
      viz: null, href: '#/backup',
      actions: [{ label: 'Back up now', run: 'backup.export' }, { label: 'Later', run: 'backup.snooze' }],
    };
  },
  // X2 — the weekly recap arrived (Sunday evening / Monday), until tapped (home.lastRecapSeen)
  (F) => {
    const r = F.recap;
    if (!r || !r.due) return null;
    return {
      id: 'X2', pillar: 'system', priority: 85, tone: 'good', glyph: 'trophy',
      kicker: `Recap · Week ${r.weekNo}`,
      headline: esc(r.headline),
      sub: r.line,
      viz: null, href: '#/', tap: 'recap', actions: null,
    };
  },
  // X3 — yesterday touched three or more pillars
  (F) => {
    const y = F.yesterday;
    if (!y || !Array.isArray(y.pillars) || y.pillars.length < 3) return null;
    const list = PILLAR_ORDER.filter((p) => y.pillars.includes(p)).map((p) => WORD[p]);
    return {
      id: 'X3', pillar: 'system', priority: 50, tone: 'good', glyph: 'bolt',
      kicker: 'Yesterday · Full house',
      headline: `<strong>${y.pillars.length} pillars</strong> in one day: ${listText(list)}.`,
      sub: 'That’s the app.',
      viz: null, href: '#/', actions: null,
    };
  },
];

/* ------------------------------------------------------------------ collection */

function safe(fn, F, label) {
  try {
    const out = fn(F);
    return Array.isArray(out) ? out.filter(Boolean) : out ? [out] : [];
  } catch (err) {
    console.warn(`coach: ${label} failed`, err);
    return [];
  }
}

/** Every insight that fires, from every pillar plus the system rules. */
export function collect(F) {
  return [
    ...safe(golf.insights, F, 'golf'),
    ...safe(trainInsights, F, 'train'),
    ...safe(bourbon.insights, F, 'bourbon'),
    ...safe(sports.insights, F, 'sports'),
    ...systemRules.flatMap((r, i) => safe(r, F, `system ${i}`)),
  ];
}

/* ------------------------------------------------------------------ novelty */

/**
 * Rules whose job is to get something done (empty states, backups, a stale file, the recap): they keep their rank
 * however long they have been showing. Everything else fades when it has said the same thing for days.
 */
export const EVERGREEN = new Set(['G0', 'G9', 'T0', 'T00', 'T10', 'B0', 'S0', 'X1', 'X2']);

/** What makes an insight "the same thing": its rule and the words + numbers it says. */
export function signature(ins) {
  return `${ins.id}|${String(ins.headline || '').replace(/<[^>]*>/g, '')}`;
}

/**
 * Novelty bonus for one insight given the seen map ({ signature: first-seen 'YYYY-MM-DD' }).
 * Unseen or first seen today +6; 1–2 days 0; 3–6 days −10; a week or more −20. `fresh` (the "New" tag) only when
 * Coach has history from before today — on the very first day everything is new, so nothing is tagged.
 */
export function novelty(ins, seen, today) {
  if (!seen || !today || EVERGREEN.has(ins.id) || (ins.actions && ins.actions.length)) return { bonus: 0, fresh: false };
  const history = Object.values(seen).some((d) => typeof d === 'string' && d < today);
  const first = seen[signature(ins)];
  if (!first || first >= today) return { bonus: 6, fresh: history };
  const age = daysBetween(first, today);
  if (age <= 2) return { bonus: 0, fresh: false };
  if (age <= 6) return { bonus: -10, fresh: false };
  return { bonus: -20, fresh: false };
}

/** A second card from a pillar that already has one must beat the next pillar by this much (§6.2 balance). */
export const SAME_PILLAR_PENALTY = 15;

/**
 * §6.2 selection for Home: drop screen-only and hidden rules, score = priority + novelty, then pick greedily —
 * X1 first whenever it is due, at most `perPillar` from one pillar (system rules exempt), a second card from the same
 * pillar pays SAME_PILLAR_PENALTY, stop at `limit`. Deterministic: ties break by pillar order, then by input order.
 * Returns the picked insights (pick order = display order) with `score` and `fresh` attached.
 */
export function select(list, { limit = 4, perPillar = 2, home = true, seen = null, today = null, hidden = [] } = {}) {
  const hide = new Set(hidden);
  const pool = list
    .filter(Boolean)
    .filter((i) => !(home && i.screenOnly) && !hide.has(i.id))
    .map((i, n) => {
      const nv = novelty(i, seen, today);
      return { ...i, score: i.priority + nv.bonus, fresh: nv.fresh, _n: n };
    });
  const rank = (a, b) => b._eff - a._eff || PILLAR_ORDER.indexOf(a.pillar) - PILLAR_ORDER.indexOf(b.pillar) || a._n - b._n;
  const out = [];
  const per = {};
  const fams = new Set(); // repair: one card per `family` (G1 scoring + G3 handicap tell the same golf trend)
  const x1 = pool.find((i) => i.id === 'X1');
  if (x1) out.push(x1);
  let rest = pool.filter((i) => i !== x1);
  while (out.length < limit && rest.length) {
    for (const i of rest) i._eff = i.score - (i.pillar !== 'system' && per[i.pillar] ? SAME_PILLAR_PENALTY : 0);
    const ok = rest.filter((i) => (i.pillar === 'system' || (per[i.pillar] || 0) < perPillar) && !(i.family && fams.has(i.family))).sort(rank);
    if (!ok.length) break;
    const pick = ok[0];
    out.push(pick);
    if (pick.family) fams.add(pick.family);
    if (pick.pillar !== 'system') per[pick.pillar] = (per[pick.pillar] || 0) + 1;
    rest = rest.filter((i) => i !== pick);
  }
  return out.map(({ _n, _eff, ...i }) => i);
}

export function run(F, opts) {
  return select(collect(F), opts);
}

/** Every insight for one pillar, uncapped, priority order (pillar screens, §6.2). */
export function forPillar(F, pillar) {
  return collect(F).filter((i) => i.pillar === pillar).sort((a, b) => b.priority - a.priority);
}

/**
 * The novelty map after showing `shown` today: new signatures get today's date; entries older than 45 days are
 * dropped (and the map is capped at 80, newest kept). Returns { map, changed }.
 */
export function remember(seen, shown, today) {
  const map = {};
  const cutoff = addDays(today, -45);
  for (const [k, v] of Object.entries(seen || {})) if (typeof v === 'string' && v >= cutoff) map[k] = v;
  let changed = Object.keys(map).length !== Object.keys(seen || {}).length;
  for (const i of shown) {
    const k = signature(i);
    if (!map[k]) { map[k] = today; changed = true; }
  }
  const keys = Object.keys(map);
  if (keys.length > 80) {
    keys.sort((a, b) => (map[b] < map[a] ? -1 : map[b] > map[a] ? 1 : 0)).slice(80).forEach((k) => { delete map[k]; });
    changed = true;
  }
  return { map, changed };
}

/* ------------------------------------------------------------------ streak chips (§6.4) */

/** ≤ 4 chips in SPEC order (train, golf, sports, bourbon), hidden at 0. Each links to its pillar. */
export function streaks(F) {
  const f = F.facts || {};
  const wk = (n) => (n === 1 ? 'wk' : 'wks');
  const n = {
    train: Number(f.train?.streakWeeks) || 0,
    golf: Number(f.golf?.roundWeeks) || 0,
    sports: Number(f.sports?.billsWatchedStreak) || 0,
    bourbon: Number(f.bourbon?.pourWeeks) || 0,
  };
  return [
    { id: 'train', glyph: 'flame', n: n.train, label: `${wk(n.train)} at training goal`, tone: 'good', href: '#/train' },
    { id: 'golf', glyph: 'golf', n: n.golf, label: `${wk(n.golf)} with a round`, tone: 'good', href: '#/golf' },
    { id: 'sports', glyph: 'sports', n: n.sports, label: n.sports === 1 ? 'Bills game watched' : 'Bills games watched', tone: 'warm', href: '#/sports' },
    { id: 'bourbon', glyph: 'bourbon', n: n.bourbon, label: `${wk(n.bourbon)} with a pour noted`, tone: 'good', href: '#/bourbon' },
  ].filter((c) => c.n > 0);
}

/**
 * The header's streak pill: the first week-based streak that is running (training goal, then rounds, then pours).
 * null when none is — the pill hides (§7.10).
 */
export function headlineStreak(chips) {
  return chips.find((c) => c.id !== 'sports') || null;
}
