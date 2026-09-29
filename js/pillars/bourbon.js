// Bourbon pillar — SPEC §2.3 BourbonFacts, §2 module API, §3.3 nameOf, §6.3 bourbon rules (B0–B6).
// Sources: Barrel Proof's own localStorage key `barrel-proof-state-v1` (the vendored app runs inside the Clubhouse
// scope) ∪ Clubhouse quick pours (IDB `pours`). Read-only toward Barrel Proof: nothing here writes its key.
import * as store from '../store.js';
import { readBarrelProof } from '../ls.js';
import { addDays, daysBetween, dayWord, ymd } from '../dates.js';
import { baseSummary, marksFromDates, countInWeek, weeklyHistory, daysAgo, weekRun } from './_shared.js';
import { esc, fmt } from '../dom.js';

export const id = 'bourbon';
export const meta = {
  label: 'Bourbon', glyph: 'bourbon', unit: { one: 'pour noted', many: 'pours noted' }, verb: 'noted',
  goalKey: 'goal.bourbon', defaultGoal: 3, goalMin: 1, goalMax: 14, href: '#/bourbon',
};
export const BP_HREF = './apps/barrel-proof/index.html';

/* ------------------------------------------------------------------ bottle names (§3.3) */

const names = new Map(); // bottleId → display name
const bottleMeta = new Map(); // bottleId → { aliases[], price, hype }
const idAliases = new Map(); // retired id → surviving id (catalog rebuilds)

/** weller-special-reserve → Weller Special Reserve (drops a trailing numeric id token ≥ 3 digits). */
export function humanize(bottleId) {
  const parts = String(bottleId || '').split('-').filter(Boolean);
  if (parts.length > 1 && /^\d{3,}$/.test(parts[parts.length - 1])) parts.pop();
  return parts.map((p) => (/^\d+$/.test(p) ? p : p[0].toUpperCase() + p.slice(1))).join(' ') || 'Unknown bottle';
}

/** Test / fallback hook: register names directly. */
export function registerBottles(list = []) {
  for (const b of list) {
    if (!b || !b.id || !b.name) continue;
    if (!names.has(b.id)) names.set(b.id, String(b.name));
    if (!bottleMeta.has(b.id)) bottleMeta.set(b.id, { aliases: Array.isArray(b.aliases) ? b.aliases : [], price: Number(b.fairPrice ?? b.msrp ?? b.shelfAverage) || null, hype: Number(b.hypeIndex) || null });
  }
}

export function nameOf(bottleId) {
  if (!bottleId) return 'Unknown bottle';
  let key = bottleId;
  for (let hop = 0; hop < 5 && !names.has(key) && idAliases.has(key); hop++) key = idAliases.get(key);
  return names.get(key) || humanize(bottleId);
}
const metaOf = (bottleId) => bottleMeta.get(bottleId) || bottleMeta.get(idAliases.get(bottleId)) || null;

const APP_URL = (p) => new URL(`../../apps/barrel-proof/${p}`, import.meta.url).href;
let seedsPromise = null;
let indexPromise = null;
let lateRefresh = false;

function loadSeeds() {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (globalThis.BarrelData && Array.isArray(globalThis.BarrelData.bottles)) { registerBottles(globalThis.BarrelData.bottles); return Promise.resolve(true); }
  if (!seedsPromise) {
    seedsPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = APP_URL('src/data/bottles.js');
      s.onload = () => { registerBottles(globalThis.BarrelData?.bottles || []); resolve(true); };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return seedsPromise;
}

/** The 7 MB catalog index (precached by the service worker) — fetched once per session, only when needed. */
function loadIndex() {
  if (typeof fetch === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (!indexPromise) {
    indexPromise = fetch(APP_URL('src/data/imported-catalog-index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return false;
        registerBottles(j.bottles || []);
        for (const [from, to] of Object.entries(j.bottleAliases || {})) idAliases.set(from, to);
        return true;
      })
      .catch(() => false);
  }
  return indexPromise;
}

/** Resolve display names for these ids: seeds first, the catalog index only if something is still unknown. */
export async function resolveNames(ids, { wait = 2500 } = {}) {
  await loadSeeds();
  const unknown = [...new Set(ids.filter(Boolean))].filter((x) => nameOf(x) === humanize(x));
  if (!unknown.length) return;
  const idx = loadIndex();
  const timer = new Promise((r) => setTimeout(() => r('late'), wait));
  const res = await Promise.race([idx, timer]);
  if (res === 'late' && !lateRefresh && typeof window !== 'undefined') {
    lateRefresh = true; // names arrive after the first paint: redraw once with real names
    idx.then((ok) => { if (ok) window.dispatchEvent(new Event('clubhouse:refresh')); });
  }
}

let nightPromise = null;
function loadNight() {
  if (globalThis.BarrelNight) return Promise.resolve(true);
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (!nightPromise) {
    nightPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = APP_URL('src/logic/night.js');
      s.onload = () => resolve(Boolean(globalThis.BarrelNight));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return nightPromise;
}

/* ------------------------------------------------------------------ Barrel Proof's own rules, mirrored */

/** BarrelRatings.isBlindTasting: the explicit flag wins; older tastings say "Blind" in the context. */
export function isBlind(t) {
  if (t && typeof t.blind === 'boolean') return t.blind;
  return /blind/i.test(String((t && t.context) || ''));
}
const normGuess = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** BarrelRatings.isGuessCorrect (generous: "eagle rare" nails "Eagle Rare 10 Year") — so Clubhouse agrees with Barrel Proof. */
export function guessCorrect(guess, name, aliases = []) {
  const g = normGuess(guess);
  if (!g || g.length < 3) return false;
  return [name, ...aliases].map(normGuess).filter(Boolean).some((n) => n.includes(g) || g.includes(n));
}

/* ------------------------------------------------------------------ facts */

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const scoreOf = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export const sn = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
/**
 * Home ring-tile note variants, longest first, for dom.fitText(): the tile is one line, so the number must never be the
 * part the ellipsis eats. Two words → the first word when it is distinctive (≥ 5 letters: "Weller", not "Old") →
 * number first, where only the name can be cut ("Waiting 40d · Old Forester").
 */
export function noteFit(name, make, numFirst) {
  const two = sn(name);
  const one = two.split(' ')[0] || '';
  const out = [make(two)];
  if (one !== two && one.replace(/[^A-Za-z]/g, '').length >= 5) out.push(make(one));
  out.push(numFirst(two));
  return out;
}

export function zero(extra = {}) {
  return {
    available: false, source: null, openBottles: [], openCount: 0, cabinetCount: 0, wishlistCount: 0, finishedCount: 0,
    finished: [], tastings: [], weekTastings: [], prevWeekTastings: [], monthTastings: [], bestThisMonth: null, lastTasting: null,
    waitingLongest: null, rebuyPending: 0, blind90: null, recentFlight: null, poursCount: 0, weeklyHistory: {}, pourWeeks: 0,
    byDay: [false, false, false, false, false, false, false], ...extra,
  };
}

/**
 * Pure: Barrel Proof state (or null) + Clubhouse pours + ctx → BourbonFacts.
 * opts.nameOf / opts.metaOf let tests inject a catalog; the browser uses the shared resolver above.
 */
export function computeFacts(st, pours, ctx, opts = {}) {
  const nm = opts.nameOf || nameOf;
  const md = opts.metaOf || metaOf;
  const bpTastings = st && Array.isArray(st.tastings) ? st.tastings.filter((t) => t && /^\d{4}-\d{2}-\d{2}/.test(String(t.date || ''))) : [];
  const quick = (pours || []).filter((p) => p && /^\d{4}-\d{2}-\d{2}/.test(String(p.date || '')));
  const tastings = [
    ...bpTastings.map((t) => ({ id: String(t.id || ''), bottleId: t.bottleId || null, name: nm(t.bottleId), date: t.date.slice(0, 10), at: '', score: scoreOf(t.score), blind: isBlind(t), guess: t.guess || '', context: t.context || '', source: 'barrel-proof', note: t.note || '' })),
    ...quick.map((p) => ({ id: String(p.id), bottleId: p.bottleId || null, name: p.bottleName || nm(p.bottleId), date: p.date, at: p.at || '', score: scoreOf(p.score), blind: false, guess: '', context: 'Clubhouse quick pour', source: 'clubhouse', note: p.note || '' })),
  ].sort((a, b) => (a.date === b.date ? (a.at || a.id).localeCompare(b.at || b.id) : a.date < b.date ? -1 : 1));

  const statuses = st && st.statuses && typeof st.statuses === 'object' ? st.statuses : {};
  const collection = st && st.collection && typeof st.collection === 'object' ? st.collection : {};
  const killLog = st && Array.isArray(st.killLog) ? st.killLog.filter((k) => k && k.bottleId) : [];
  const lastBy = {};
  for (const t of tastings) if (t.bottleId && (!lastBy[t.bottleId] || t.date > lastBy[t.bottleId])) lastBy[t.bottleId] = t.date;
  const killBy = {};
  for (const k of killLog) if (!killBy[k.bottleId] || String(k.date) > killBy[k.bottleId]) killBy[k.bottleId] = String(k.date || '');
  const count = (b) => Number(collection[b] && collection[b].count) || 0;

  const openBottles = Object.keys(statuses)
    .filter((b) => statuses[b] === 'owned' && count(b) > 0 && !(killBy[b] && lastBy[b] && killBy[b] >= lastBy[b]))
    .map((b) => ({ bottleId: b, name: nm(b), count: count(b), lastTasted: lastBy[b] || null, daysWaiting: lastBy[b] ? daysAgo(lastBy[b], ctx.today) : null }))
    .sort((a, b) => (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1) || a.name.localeCompare(b.name));

  const finishedIds = new Set([...Object.keys(statuses).filter((b) => statuses[b] === 'finished'), ...killLog.map((k) => k.bottleId)]);
  const finished = [...finishedIds].map((b) => {
    const k = killLog.filter((x) => x.bottleId === b).sort((x, y) => String(y.date).localeCompare(String(x.date)))[0] || null;
    const ts = tastings.filter((t) => t.bottleId === b && t.score != null);
    return { bottleId: b, name: nm(b), date: k ? String(k.date).slice(0, 10) : null, rebuy: k ? (k.rebuy === true ? 'yes' : k.rebuy === false ? 'no' : 'pending') : 'pending', pours: tastings.filter((t) => t.bottleId === b).length, avg: ts.length ? round1(ts.reduce((s, t) => s + t.score, 0) / ts.length) : null, stillOwned: statuses[b] === 'owned' && count(b) > 0 };
  }).filter((f) => !f.stillOwned).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const weekEnd = addDays(ctx.weekStart, 6);
  const month = ctx.today.slice(0, 7);
  const monthTastings = tastings.filter((t) => t.date.slice(0, 7) === month);
  let bestThisMonth = null;
  for (const t of monthTastings) if (t.score != null && (!bestThisMonth || t.score >= bestThisMonth.score)) bestThisMonth = { name: t.name, bottleId: t.bottleId, score: t.score, date: t.date, source: t.source };
  const last = tastings.length ? tastings[tastings.length - 1] : null;
  const waiting = openBottles.filter((b) => b.daysWaiting != null).sort((a, b) => b.daysWaiting - a.daysWaiting)[0] || null;

  const since90 = addDays(ctx.today, -90);
  const blind = tastings.filter((t) => t.source === 'barrel-proof' && t.blind && t.date >= since90);
  const guessed = blind.filter((t) => t.guess && guessCorrect(t.guess, t.name, (md(t.bottleId) || {}).aliases || [])).length;
  const blind90 = blind.length >= 3 ? { n: blind.length, guessed, pct: Math.round((guessed / blind.length) * 100) } : null;

  let recentFlight = null;
  const flights = st && Array.isArray(st.flights) ? st.flights : [];
  const fl = flights.find((f) => f && f.savedAt) || null;
  if (fl) {
    const saved = new Date(fl.savedAt);
    const date = Number.isNaN(saved.getTime()) ? String(fl.savedAt).slice(0, 10) : ymd(saved);
    if (daysBetween(date, ctx.today) <= 7 && daysBetween(date, ctx.today) >= 0) {
      const rows = (fl.pours || []).map((p) => {
        const sc = Object.values(((fl.scores || {})[p.glass]) || {}).map(Number).filter(Number.isFinite);
        return { glass: p.glass, bottleId: p.bottleId, name: p.bottleName || nm(p.bottleId), avg: sc.length ? sc.reduce((s, x) => s + x, 0) / sc.length : null };
      }).filter((r) => r.avg != null).sort((a, b) => b.avg - a.avg);
      if (rows.length) {
        let headline = null;
        const night = opts.night || globalThis.BarrelNight;
        if (night && typeof night.flightResults === 'function') {
          try {
            const res = night.flightResults(fl, (bid) => { const m = md(bid); return m ? { refPrice: m.price, hype: m.hype } : {}; });
            if (res && res.headline && !/took the flight\.$/.test(res.headline) && !/stood alone\.$/.test(res.headline)) headline = res.headline;
          } catch { headline = null; }
        }
        recentFlight = { savedAt: fl.savedAt, date, winnerName: rows[0].name, avg: round1(rows[0].avg), glasses: (fl.pours || []).length, tasters: (fl.tasters || []).length, headline };
      }
    }
  }

  const dates = tastings.map((t) => t.date);
  return zero({
    available: Boolean(st), source: st ? 'barrel-proof-state-v1' : null,
    openBottles, openCount: openBottles.length,
    cabinetCount: Object.keys(statuses).filter((b) => statuses[b] === 'owned').reduce((s, b) => s + count(b), 0),
    wishlistCount: Object.values(statuses).filter((s) => s === 'wishlist').length,
    finishedCount: finished.length, finished,
    tastings,
    weekTastings: tastings.filter((t) => t.date >= ctx.weekStart && t.date <= weekEnd),
    prevWeekTastings: tastings.filter((t) => t.date >= ctx.prevWeekStart && t.date < ctx.weekStart),
    monthTastings, bestThisMonth,
    lastTasting: last ? { name: last.name, bottleId: last.bottleId, score: last.score, date: last.date, source: last.source, daysAgo: daysAgo(last.date, ctx.today) } : null,
    waitingLongest: waiting ? { bottleId: waiting.bottleId, name: waiting.name, days: waiting.daysWaiting } : null,
    rebuyPending: killLog.filter((k) => k.rebuy === null || k.rebuy === undefined).length,
    blind90, recentFlight,
    poursCount: quick.length,
    weeklyHistory: weeklyHistory(dates, ctx.today),
    pourWeeks: weekRun(dates, ctx, 1),
    byDay: marksFromDates(dates, ctx.weekStart),
  });
}

/** §2 facts(ctx). Never throws. */
export async function facts(ctx) {
  let pours = [];
  try { pours = await store.getAll('pours'); } catch { pours = []; }
  try {
    const r = readBarrelProof();
    const st = r.ok ? r.state : null;
    if (st) {
      const ids = [...Object.keys(st.statuses || {}), ...(st.tastings || []).map((t) => t && t.bottleId), ...(st.killLog || []).map((k) => k && k.bottleId), ...pours.map((p) => p.bottleId)];
      await resolveNames(ids);
      if (Array.isArray(st.flights) && st.flights.some((f) => f && f.savedAt && Date.now() - new Date(f.savedAt) < 8 * 864e5)) await loadNight();
    }
    return computeFacts(st, pours, ctx);
  } catch (err) {
    return zero({ error: String(err), poursCount: pours.length, weeklyHistory: weeklyHistory([], ctx.today) });
  }
}

/* ------------------------------------------------------------------ §2 API */

export const EMPTY = {
  title: 'Cabinet’s empty',
  body: 'Open Barrel Proof and import your last backup. Pours and tastings show up here.',
  cta: { label: 'Open Barrel Proof', href: BP_HREF },
};

export function summary(f, goal) {
  const s = baseSummary(meta, id, (f.weekTastings || []).length, goal);
  if (!f.available && !(f.tastings || []).length) { s.empty = EMPTY; return s; }
  if (f.waitingLongest && f.waitingLongest.days >= 30) {
    const d = f.waitingLongest.days;
    s.note = { text: `${sn(f.waitingLongest.name)} waiting ${d}d`, tone: 'warm', icon: 'clock', fit: noteFit(f.waitingLongest.name, (n) => `${n} waiting ${d}d`, (n) => `Waiting ${d}d · ${n}`) };
  } else if (f.bestThisMonth) {
    const sc = fmt.one(f.bestThisMonth.score);
    s.note = { text: `Best: ${sn(f.bestThisMonth.name)} ${sc}`, tone: 'good', fit: noteFit(f.bestThisMonth.name, (n) => `Best: ${n} ${sc}`, (n) => `Best ${sc} · ${n}`) };
  }
  else s.note = { text: `${f.openCount || 0} open`, tone: 'neutral' };
  return s;
}

export function dayMarks(f, ctx) {
  return marksFromDates((f.tastings || []).map((t) => t.date), ctx.weekStart);
}

export function weekCount(f, weekStart) {
  return countInWeek((f.tastings || []).map((t) => t.date), weekStart);
}

export const quickLog = {
  kinds: [
    { k: 'pour', label: 'Pour', glyph: 'bourbon', mode: 'form', sub: (f) => (f && f.openCount ? `${f.openCount} open` : 'Quick note') },
  ],
};

/* ------------------------------------------------------------------ Coach rules (SPEC §6.3, bourbon) */

const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
/** B1 bottle glyph level: longer wait = lower shown level (a proxy, SPEC §6.3). */
export const levelOf = (days) => Math.max(15, 100 - Math.min(85, days ?? 0));

export const rules = [
  (F) => {
    const b = F.facts.bourbon || {};
    if (b.available) return null;
    return { id: 'B0', pillar: 'bourbon', priority: 100, tone: 'neutral', kicker: 'Bourbon · Empty', headline: 'The cabinet’s empty here.', sub: 'Open Barrel Proof → Import your backup. Pours count on Home.', viz: null, href: BP_HREF, actions: null };
  },
  (F) => {
    const b = F.facts.bourbon || {};
    const w = b.waitingLongest;
    if (!b.available || !w || w.days < 30) return null;
    const recent = (b.tastings || []).slice(-2).reverse().map((t) => `${sn(t.name)} poured ${dayWord(t.date, F.ctx, { short: true })}`);
    const shown = (b.openBottles || []).slice(0, 3);
    return {
      id: 'B1', pillar: 'bourbon', priority: 60, tone: 'warm', kicker: `Bourbon · ${b.openCount} open`,
      headline: `The <span class="warn">${esc(w.name)}</span> has been waiting ${w.days} days.`,
      sub: [...recent, `${b.cabinetCount} in the cabinet`].join(' · '),
      viz: { type: 'bottles', levels: shown.map((o) => ({ pct: levelOf(o.daysWaiting), wait: o.bottleId === w.bottleId })) },
      href: '#/bourbon', actions: null,
    };
  },
  (F) => {
    const b = F.facts.bourbon || {};
    const best = b.bestThisMonth;
    if (!best || best.score < 8.5) return null;
    return {
      id: 'B2', pillar: 'bourbon', priority: 55, tone: 'good', kicker: 'Bourbon · Best this month',
      headline: `Best pour this month: <strong>${esc(best.name)}, ${fmt.one(best.score)}</strong>.`,
      sub: `${dayWord(best.date, F.ctx)} · ${(b.weekTastings || []).length} ${plural((b.weekTastings || []).length, 'pour')} this week`,
      viz: { type: 'delta', value: fmt.one(best.score), icon: 'bolt', tone: 'good' }, href: '#/bourbon', actions: null,
    };
  },
  (F) => {
    const b = F.facts.bourbon || {};
    if (!b.available || !(b.rebuyPending >= 1)) return null;
    const n = b.rebuyPending;
    return {
      id: 'B3', pillar: 'bourbon', priority: 45, tone: 'neutral', kicker: 'Bourbon · Rebuy',
      headline: `<strong>${n} finished ${plural(n, 'bottle')}</strong> waiting on a rebuy call.`,
      sub: 'Barrel Proof → Rebuy board', viz: null, href: BP_HREF, actions: null,
    };
  },
  (F) => {
    const b = F.facts.bourbon || {};
    const bl = b.blind90;
    if (!bl || bl.n < 3) return null;
    return {
      id: 'B4', pillar: 'bourbon', priority: 40, tone: bl.pct >= 50 ? 'good' : 'neutral', kicker: 'Bourbon · Blind',
      headline: `Blind tasting: <strong>${bl.guessed} of ${bl.n}</strong> called right in 90 days.`,
      sub: `${bl.pct}% · Barrel Proof Tasting Night`,
      viz: { type: 'delta', value: `${bl.pct}%`, icon: bl.pct >= 50 ? 'check' : null, tone: bl.pct >= 50 ? 'good' : '' }, href: '#/bourbon', actions: null,
    };
  },
  (F) => {
    const b = F.facts.bourbon || {};
    if (!b.available && !(b.tastings || []).length) return null;
    const goal = F.goals.bourbon, n = (b.weekTastings || []).length;
    const lt = b.lastTasting;
    const sub = `${b.openCount || 0} open${lt ? ` · last: ${sn(lt.name)}${lt.score != null ? ` ${fmt.one(lt.score)}` : ''}` : ''}`;
    const viz = { type: 'dots7', on: b.byDay || [], todayIndex: F.ctx.dayIndex };
    if (goal - n === 1) return { id: 'B5', pillar: 'bourbon', priority: 50, tone: 'neutral', kicker: `Bourbon · ${n} of ${goal}`, headline: 'One more pour noted <strong>hits your goal</strong>.', sub, viz, href: '#log:pour', actions: null };
    if (n >= goal) return { id: 'B5', pillar: 'bourbon', priority: 50, tone: 'good', kicker: `Bourbon · ${n} of ${goal}`, headline: `Bourbon goal <strong>hit</strong> — ${n} noted this week.`, sub, viz, href: '#/bourbon', actions: null };
    return null;
  },
  (F) => {
    const b = F.facts.bourbon || {};
    const fl = b.recentFlight;
    if (!fl) return null;
    return {
      id: 'B6', pillar: 'bourbon', priority: 50, tone: 'good', kicker: 'Bourbon · Tasting Night',
      headline: `Tasting Night ${esc(dayWord(fl.date, F.ctx))}: <strong>${esc(fl.winnerName)}</strong> took the flight.`,
      sub: `avg ${fmt.one(fl.avg)} · ${fl.glasses} glasses${fl.headline ? ` · ${fl.headline}` : ''}`,
      viz: null, href: BP_HREF, actions: null,
    };
  },
];

/** Every bourbon insight that fires, highest priority first (the Bourbon screen shows them uncapped). */
export function insights(F) {
  const out = [];
  for (const r of rules) { try { const i = r(F); if (i) out.push(i); } catch (err) { console.warn('bourbon rule failed', err); } }
  return out.sort((a, b) => b.priority - a.priority);
}
