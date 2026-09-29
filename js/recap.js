// Weekly recap — SPEC §6.6, Home lane. Pure: build(F, pillarsById) → the recap card view-model.
//
// Which week: from Sunday 5 pm the week that is ending ("This week", the Sunday wrap-up); otherwise the last finished
// week ("Last week"). The X2 Coach card announces it Sunday evening and Monday until tapped (home.lastRecapSeen).
//
// Per pillar: { k, v, g (Golf/Train only, per the mock), w (bar %), cmp }. cmp: Golf/Train = change vs the week before
// (`+1 rd` / `−1` / `same`); Pours = notes written; Games = W · L of the games watched (finals only).
// Headline: a "best week since {month}" claim needs real history (≥ 8 active weeks in the 26 before) and a week worth
// celebrating (score ≥ 2); otherwise Strong / Solid / Light / Quiet by the weekly score Σ min(1, v/goal).
import { addDays, monD, isoWeek, parseYmd, MONTHS_LONG, daysBetween } from './dates.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const MINUS = '−';
const PILLARS = ['golf', 'train', 'bourbon', 'sports'];

/** Numbers ≤ 9 spelled out (the recap line only). */
export const spell = (n) => (n >= 0 && n <= 9 ? WORDS[n] : String(n));
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sn = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');

/** 'a' / 'a and b' / 'a, b, and c' (the mock's serial comma). */
export function joinLine(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** The week being recapped: Sunday ≥ 17:00 → this week; else last week. */
export function recapWeek(ctx) {
  return ctx.dayIndex === 6 && ctx.hour >= 17 ? ctx.weekStart : ctx.prevWeekStart;
}

/** 'Sep 21 – 27' or 'Aug 31 – Sep 6'. */
export function rangeText(ws) {
  const we = addDays(ws, 6);
  return we.slice(5, 7) === ws.slice(5, 7) ? `${monD(ws)} – ${Number(we.slice(8))}` : `${monD(ws)} – ${monD(we)}`;
}

/** Season word for a date ('the spring', 'the summer', …). */
function seasonOf(ymd) {
  const m = parseYmd(ymd).getMonth();
  return m >= 2 && m <= 4 ? 'the spring' : m >= 5 && m <= 7 ? 'the summer' : m >= 8 && m <= 10 ? 'the fall' : 'the winter';
}

function counter(facts, pillarsById) {
  return (id, ws) => {
    const p = pillarsById && pillarsById[id];
    try { return p ? Number(p.weekCount(facts[id] || {}, ws)) || 0 : 0; } catch { return 0; }
  };
}

/** Weekly score Σ min(1, v/goal) over the four pillars (current goals). */
export function weekScore(wc, goals, ws) {
  let s = 0;
  for (const id of PILLARS) {
    const g = Number(goals[id]) || 0;
    if (g > 0) s += Math.min(1, wc(id, ws) / g);
  }
  return s;
}

/** Any activity in the 26 weeks up to and including `ws`? (Home hides the recap for a brand-new install.) */
export function hasHistory(facts, pillarsById, ws) {
  const wc = counter(facts, pillarsById);
  for (let i = 0; i < 27; i++) {
    const w = addDays(ws, -7 * i);
    if (PILLARS.some((id) => wc(id, w) > 0)) return true;
  }
  return false;
}

/**
 * The headline. Best-week claim: walk back from the week before; the first week scoring ≥ this one ends the run.
 * If that week is ≥ 5 weeks back → "since {its month}"; if none in 26 weeks → "since {season 26 weeks ago}".
 */
export function headlineFor(wc, goals, ws) {
  const score = weekScore(wc, goals, ws);
  let active = 0;
  let beatenBy = null;
  for (let i = 1; i <= 26; i++) {
    const w = addDays(ws, -7 * i);
    const s = weekScore(wc, goals, w);
    if (s > 0) active++;
    if (beatenBy == null && s >= score) beatenBy = { ws: w, back: i };
  }
  if (score >= 2 && active >= 8) {
    if (!beatenBy) return { text: `Your best week since ${seasonOf(addDays(ws, -7 * 26))}.`, score, best: true };
    if (beatenBy.back >= 5) return { text: `Your best week since ${MONTHS_LONG[parseYmd(beatenBy.ws).getMonth()]}.`, score, best: true };
  }
  const text = score >= 3 ? 'Strong week.' : score >= 2 ? 'Solid week.' : score >= 1 ? 'Light week.' : 'Quiet week.';
  return { text, score, best: false };
}

function deltaCmp(v, prev, unit) {
  const d = v - prev;
  if (d === 0) return { text: 'same', good: false, icon: null };
  return { text: `${d > 0 ? '+' : MINUS}${Math.abs(d)}${unit ? ` ${unit}` : ''}`, good: d > 0, icon: d > 0 ? 'up' : 'down' };
}

const pct = (v, g) => `${Math.round(Math.min(100, g > 0 ? (v / g) * 100 : 0))}%`;

/**
 * F = { facts, goals, ctx }; pillarsById = { golf, train, bourbon, sports } modules (weekCount, sports.weekResults).
 * Returns { weekStart, weekNo, current, label, range, headline, best, line, score, any, stats[] }.
 */
export function build(F, pillarsById) {
  const { facts, goals, ctx } = F;
  const ws = recapWeek(ctx);
  const we = addDays(ws, 6);
  const before = addDays(ws, -7);
  const wc = counter(facts, pillarsById);
  const v = Object.fromEntries(PILLARS.map((id) => [id, wc(id, ws)]));
  const head = headlineFor(wc, goals, ws);

  // the line: workouts, rounds, a season low that fell this week, pours, games — the first three that happened
  const g = facts.golf || {};
  const low = g.seasonLow && g.seasonLow.date >= ws && g.seasonLow.date <= we ? g.seasonLow : null;
  const bits = [];
  if (v.train) bits.push(`${spell(v.train)} ${v.train === 1 ? 'workout' : 'workouts'}`);
  if (v.golf) bits.push(`${spell(v.golf)} ${v.golf === 1 ? 'round' : 'rounds'}`);
  if (low) bits.push(`the ${sn(low.short || low.courseName)} ${low.score}`);
  if (v.bourbon) bits.push(`${spell(v.bourbon)} ${v.bourbon === 1 ? 'pour' : 'pours'}`);
  if (v.sports) bits.push(`${spell(v.sports)} ${v.sports === 1 ? 'game' : 'games'}`);
  const current = ws === ctx.weekStart;
  const line = bits.length ? `${cap1(joinLine(bits.slice(0, 3)))}.` : current ? 'Nothing logged yet this week.' : 'Nothing logged that week.';

  // Train honesty: an export from before the week ended can't say how that week finished
  const t = facts.train || {};
  let trainCmp;
  if (!t.available) trainCmp = { text: 'no Form', good: false, icon: null }; // fits the 56 px cell
  else if (t.asOfDate && t.asOfDate < we && !current) trainCmp = { text: `as of ${monD(t.asOfDate)}`, good: false, icon: 'clock' };
  else trainCmp = deltaCmp(v.train, wc('train', before), '');

  const b = facts.bourbon || {};
  const notes = (b.tastings || []).filter((x) => x.date >= ws && x.date <= we && String(x.note || '').trim()).length;

  let games = { text: v.sports ? 'no finals yet' : 'none', good: false, icon: null };
  const sp = pillarsById && pillarsById.sports;
  if (v.sports && sp && typeof sp.weekResults === 'function') {
    try {
      const r = sp.weekResults(facts.sports || {}, ws);
      if (r.n) games = { text: `${r.w} W · ${r.l} L${r.t ? ` · ${r.t} T` : ''}`, good: false, icon: null };
    } catch { /* keep the fallback */ }
  }

  return {
    weekStart: ws,
    weekNo: isoWeek(ws),
    current,
    label: current ? 'This week' : 'Last week',
    range: rangeText(ws),
    headline: head.text,
    best: head.best,
    line,
    score: head.score,
    any: PILLARS.some((id) => v[id] > 0),
    daysOld: daysBetween(we, ctx.today),
    stats: [
      { id: 'golf', k: 'Golf', v: v.golf, g: goals.golf, w: pct(v.golf, goals.golf), cmp: deltaCmp(v.golf, wc('golf', before), 'rd'), href: '#/golf' },
      { id: 'train', k: 'Train', v: v.train, g: goals.train, w: pct(v.train, goals.train), cmp: trainCmp, href: '#/train' },
      { id: 'bourbon', k: 'Pours', v: v.bourbon, g: null, w: pct(v.bourbon, goals.bourbon), cmp: { text: `${notes} ${notes === 1 ? 'note' : 'notes'}`, good: false, icon: null }, href: '#/bourbon' },
      { id: 'sports', k: 'Games', v: v.sports, g: null, w: pct(v.sports, goals.sports), cmp: games, href: '#/sports' },
    ],
  };
}
