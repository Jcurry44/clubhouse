// Golf (#/golf) — SPEC §7.7, the golf.html mock is the visual contract.
// Handicap hero (estimate + 30-day delta + area chart) → scoring trend (last 10 18s, 5-round average, tap-linked
// both ways with the rounds list) → where the strokes go (fairways, greens, putts, penalties: last 5 vs prior 5)
// → recent rounds → by course → Coach (golf rules, uncapped) → Open the ledger.
// Everything reads Fairway Ledger's own storage (the vendored app, same scope); nothing here writes to it.
import * as store from '../store.js';
import * as golf from '../pillars/golf.js';
import { h, icon, mount as fill, fmt } from '../dom.js';
import { makeCtx, addDays, monD, MONTHS, parseYmd } from '../dates.js';
import { coachSection, teachCard, dateBlock, dow, openApp, settle } from './_pillar-ui.js';

export const title = 'Golf';
const LEDGER = golf.LEDGER_HREF;
const TARGETS = { fir: 50, gir: 35, putts: 32, penalties: 1.0 };

/* ------------------------------------------------------------------ pieces */

function header(f) {
  return h('header.rise',
    h('div.subtop',
      h('a.back', { href: '#/' }, icon('chevl'), 'Home'),
      h('a.action', { href: LEDGER }, icon('plus'), 'Log round'),
    ),
    h('h1.title', icon('golf'), 'Golf'),
    h('div.eyebrow', { style: 'margin-top:6px' },
      f.available && f.rounds.length ? `${f.seasonYear} season · ${f.seasonRounds.length} ${f.seasonRounds.length === 1 ? 'round' : 'rounds'} · Fairway Ledger` : 'Fairway Ledger'),
  );
}

function hcpChart(trend) {
  if (trend.length < 2) return null;
  const W = 390, H = 92;
  const vals = trend.map((t) => t.index);
  const min = Math.min(...vals) - 0.4, max = Math.max(...vals) + 0.4;
  const pts = vals.map((v, i) => [Number(((i / (vals.length - 1)) * W).toFixed(1)), Number((10 + (1 - (v - min) / (max - min || 1)) * (H - 22)).toFixed(1))]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const m0 = MONTHS[parseYmd(trend[0].date).getMonth()], m1 = MONTHS[parseYmd(trend[trend.length - 1].date).getMonth()];
  return h('div.chart', { role: 'img', 'aria-label': `Handicap estimate over your last ${trend.length} rounds: ${fmt.one(vals[0])} to ${fmt.one(vals[vals.length - 1])}` },
    h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
      h('polygon', { points: `${line} ${W},${H} 0,${H}`, fill: 'url(#hcpFill)' }),
      h('polyline', { points: line, fill: 'none', stroke: '#d4ff3f', 'stroke-width': '2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }),
    ),
    h('span.ax.l', m0), m1 !== m0 ? h('span.ax.r', m1) : null,
  );
}

function hero(f, ctx) {
  const hc = f.handicap;
  const d = hc && f.handicap30 != null ? Math.round((hc.index - f.handicap30) * 10) / 10 : null;
  const since = addDays(ctx.today, -30);
  let delta;
  if (!hc) delta = h('div.d', h('span', 'Needs 3 rated rounds'), h('span', 'for a WHS-style estimate'));
  else if (d == null) delta = h('div.d', h('span', `Best ${hc.used} of ${hc.eligible} rated rounds`), h('span', 'our estimate, not official'));
  else if (Math.abs(d) < 0.1) delta = h('div.d', h('span.delta.flat', icon('check'), 'Steady'), h('span', `since ${monD(since)} (${fmt.one(f.handicap30)})`));
  else delta = h('div.d', h('span', { class: `delta${d > 0 ? ' warm' : ''}` }, icon(d < 0 ? 'down' : 'up'), fmt.one(Math.abs(d))), h('span', `since ${monD(since)} (${fmt.one(f.handicap30)})`));
  return h('section.card.hcp.rise', { 'aria-label': 'Handicap index' },
    h('div.lbl', 'Handicap index'),
    h('div.big',
      h('div.n', hc ? h('span.count', { dataset: { to: String(hc.index), dec: '1', from: '0' } }, '0.0') : '—'),
      delta,
    ),
    f.seasonLow ? h('div.best', h('div.k', 'Season low'), h('div.v', String(f.seasonLow.score), ' ', h('small', golf.sn(f.seasonLow.short)))) : null,
    hcpChart(f.hcpTrend || []),
  );
}

function trendCard(f, state) {
  const all = f.eighteen;
  const shown = all.slice(-10);
  const offset = all.length - shown.length;
  const W = 358, H = 170, padT = 18, padB = 22, gut = 24;
  const scores = shown.map((r) => r.gross);
  let lo = Math.floor((Math.min(...scores) - 3) / 2) * 2, hi = Math.ceil((Math.max(...scores) + 2) / 2) * 2;
  if (hi - lo < 8) hi = lo + 8;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const n = shown.length, slot = (W - gut) / n, bw = Math.min(22, slot * 0.62);
  const grid = [lo + (hi - lo) * 0.17, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.83].map((v) => Math.round(v));
  const avg5 = shown.map((_, i) => {
    const k = offset + i;
    if (k < 4) return null;
    return all.slice(k - 4, k + 1).reduce((s, r) => s + r.gross, 0) / 5;
  });
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Your last ${n} 18-hole scores: ${scores.join(', ')}` });
  for (const g of grid) svg.append(h('line.grid', { x1: gut, x2: W, y1: y(g).toFixed(1), y2: y(g).toFixed(1) }), h('text.gl', { x: 0, y: (y(g) + 3.5).toFixed(1) }, String(g)));
  let lastMonth = -1;
  shown.forEach((r, i) => {
    const x = gut + slot * i + slot / 2 - bw / 2, top = y(r.gross);
    const d = parseYmd(r.date);
    // the month is named only where it changes ("Jul 17 · 24 · 31 · Aug 7"), so ten labels never collide
    const label = d.getMonth() !== lastMonth ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : String(d.getDate());
    lastMonth = d.getMonth();
    svg.append(
      h('rect.bar', { dataset: { rid: r.id }, x: x.toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: (H - padB - top).toFixed(1), rx: 4 }),
      h('text.xl', { x: (x + bw / 2).toFixed(1), y: H - 6 }, label),
    );
  });
  const ap = avg5.map((v, i) => (v == null ? null : `${(gut + slot * i + slot / 2).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  if (ap.length >= 2) svg.append(h('polyline.avg', { points: ap.join(' ') }));
  shown.forEach((r, i) => svg.append(h('text.vl', { dataset: { rid: r.id }, x: (gut + slot * i + slot / 2).toFixed(1), y: (y(r.gross) - 6).toFixed(1) }, String(r.gross))));
  shown.forEach((r, i) => svg.append(h('rect.hit', { dataset: { rid: r.id }, x: (gut + slot * i).toFixed(1), y: 0, width: slot.toFixed(1), height: H })));

  const sc = f.scoring;
  const head = sc && Math.abs(sc.delta) >= 0.1
    ? h('h3', 'Scoring average ', h('strong', `${sc.delta > 0 ? 'down' : 'up'} ${fmt.one(Math.abs(sc.delta))}`), ` over your last ${sc.n}.`)
    : sc ? h('h3', `Scoring average steady at ${fmt.one(sc.last5Avg)}.`) : h('h3', `Your last ${n} 18-hole ${n === 1 ? 'round' : 'rounds'}.`);
  const tip = h('div.tip', { 'aria-live': 'polite' });
  svg.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-rid]') : null;
    if (t) state.select(t.dataset.rid);
  });
  return { el: h('section.card.trend.rise',
    h('div.h', head),
    h('div.legend', h('span', h('i.bar'), 'Score'), ap.length >= 2 ? h('span', h('i.avg'), '5-round average') : null, h('span', 'Tap a bar to see the round')),
    h('div.chart', svg),
    tip,
  ), svg, tip };
}

function statCard({ k, glyph, v, unit, w, t, good, cmp, cmpTone, cmpIcon, label }) {
  return h('div.card.stat-card', { role: 'group', 'aria-label': label },
    h('div.k', icon(glyph), k),
    h('div.v', v, unit ? h('small', unit) : null),
    h('div', { class: `meter${good ? ' good' : ''}`, dataset: { w: `${Math.round(w)}%` }, 'aria-hidden': 'true' }, h('span.tgt', { style: `--t:${Math.round(t)}%` })),
    h('div', { class: `cmp${cmpTone ? ` ${cmpTone}` : ''}` }, cmpIcon ? icon(cmpIcon) : null, cmp),
  );
}
const clamp = (v) => Math.max(0, Math.min(100, v));

function strokes(f) {
  const cards = [];
  const pctCard = (key, k, glyph, m, target) => {
    if (!m) return;
    const d = m.prior5Pct != null ? m.last5Pct - m.prior5Pct : null;
    cards.push(statCard({
      k, glyph, v: String(m.last5Pct), unit: '%', w: m.last5Pct, t: target, good: m.last5Pct >= target, label: `${k} ${m.last5Pct}%`,
      cmp: d == null ? `goal ${target}%` : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} ${Math.abs(d) === 1 ? 'pt' : 'pts'} · goal ${target}%`,
      cmpTone: d > 0 ? 'good' : '', cmpIcon: d > 0 ? 'up' : d < 0 ? 'down' : null,
    }));
  };
  pctCard('fir', 'Fairways', 'flag', f.fir, TARGETS.fir);
  pctCard('gir', 'Greens', 'target', f.gir, TARGETS.gir);
  if (f.putts) {
    const p = f.putts, d = p.prior5 != null ? Math.round((p.last5 - p.prior5) * 10) / 10 : null;
    const scale = (v) => clamp(((42 - v) / 16) * 100); // 42 → 0 %, 26 → 100 %: past the tick = better than goal
    cards.push(statCard({
      k: 'Putts / rd', glyph: 'putt', v: fmt.one(p.last5), w: scale(p.last5), t: scale(TARGETS.putts), good: p.last5 <= TARGETS.putts, label: `Putts per round ${fmt.one(p.last5)}`,
      cmp: d == null ? `goal ${TARGETS.putts}` : `${fmt.signed1(d)} · goal ${TARGETS.putts}`,
      cmpTone: d != null && d < 0 ? 'good' : '', cmpIcon: d == null || d === 0 ? null : d < 0 ? 'down' : 'up',
    }));
  }
  if (f.penalties) {
    const p = f.penalties, d = p.prior5 != null ? Math.round((p.last5 - p.prior5) * 10) / 10 : null;
    const scale = (v) => clamp(((3 - v) / 3) * 100); // 3 a round → 0 %, clean → 100 %
    const worse = d != null && d > 0 && p.last5 > TARGETS.penalties;
    cards.push(statCard({
      k: 'Penalties / rd', glyph: 'warn', v: fmt.one(p.last5), w: scale(p.last5), t: scale(TARGETS.penalties), good: p.last5 <= TARGETS.penalties, label: `Penalties per round ${fmt.one(p.last5)}`,
      cmp: d == null ? `goal ${fmt.one(TARGETS.penalties)}` : worse ? `${fmt.signed1(d)} · the one to fix` : `${fmt.signed1(d)} · goal ${fmt.one(TARGETS.penalties)}`,
      cmpTone: worse ? 'warn' : d != null && d < 0 ? 'good' : '', cmpIcon: d == null || d === 0 ? null : d < 0 ? 'down' : 'up',
    }));
  }
  if (!cards.length) return [];
  const n = f.putts ? f.putts.n : 5;
  return [
    h('div.section-h.rise', h('h2', 'Where the strokes go'), h('span.meta', f.fir && f.fir.prior5Pct != null ? 'Last 5 vs prior 5' : `Last ${n}`)),
    h('section.stats4.rise', cards),
  ];
}

function toParText(v) {
  if (v == null) return '';
  return v > 0 ? `+${v}` : v < 0 ? fmt.signedInt(v) : 'E';
}

function roundRow(r, f) {
  const low = f.seasonLow && f.seasonLow.id === r.id;
  const bits = [dow(r.date)];
  if (r.holes === 9) bits.push('9 holes');
  bits.push(`par ${r.par}`);
  if (r.differential != null) bits.push(`diff ${fmt.one(r.differential)}`);
  if (r.entryMode === 'speed') bits.push('score only');
  return h('button', { type: 'button', class: 'r', dataset: { rid: r.id }, 'aria-label': `${r.short}, ${monD(r.date)}, ${r.gross ?? 'incomplete'}${low ? ', season low' : ''}` },
    dateBlock(r.date),
    h('div', { style: 'min-width:0' }, h('div.course', r.short), h('div.meta', bits.join(' · '))),
    h('div.score', h('b', r.gross != null ? String(r.gross) : '—'), h('span', { class: low ? 'best' : null }, low ? 'season low' : r.gross != null ? toParText(r.toPar) : 'in progress')),
  );
}

function byCourse(f) {
  const list = f.byCourse.filter((c) => c.rounds > 0).slice(0, 8);
  if (!list.length) return [];
  const best = list.find((c) => c.avg != null);
  return [
    h('div.section-h.rise', h('h2', 'By course'), h('span.meta', 'Avg score · rounds')),
    h('section.card.courses.rise', list.map((c) => {
      const isBest = best && c === best && list.filter((x) => x.avg != null).length > 1;
      const w = c.avg == null || !best ? 12 : Math.max(12, 100 - (c.avg - best.avg) * 11);
      return h('div', { class: `c${isBest ? ' best' : ''}` },
        h('div.n', c.name, h('span', `${c.rounds} ${c.rounds === 1 ? 'rd' : 'rds'}${c.eighteen < c.rounds ? ` · ${c.rounds - c.eighteen} × 9` : ''}${isBest ? ' · best' : ''}`)),
        h('div.v', c.avg != null ? fmt.one(c.avg) : '—'),
        h('div.bar', { style: `--w:${Math.round(w)}%` }),
      );
    })),
  ];
}

function emptyScreen(f, goals, ctx) {
  const F = { facts: { golf: f }, goals, ctx };
  return [
    header(f),
    teachCard({
      glyph: 'golf',
      title: 'No rounds yet',
      body: 'Your rounds live in Fairway Ledger — scored hole by hole, with its own backups. Bring them over once and every round counts here and on Home.',
      steps: [
        { b: 'Export from Fairway Ledger', small: 'In the ledger you use today: Data ▾ → Export. It saves fairway-ledger-(date).json to Files.' },
        { b: 'Import it here', small: 'Open the ledger below → Data ▾ → Import and pick that file. It snapshots first, so nothing is lost.' },
      ],
      primary: { label: 'Open the ledger', href: LEDGER },
      secondary: { label: 'Import here', href: '#/backup', note: 'Picked the file in Backups instead? Clubhouse recognises a Fairway Ledger backup and hands it to the ledger’s own Import.' },
    }),
    coachSection(golf.insights(F).filter((i) => i.id !== 'G0'), 'golf'),
  ];
}

/* ------------------------------------------------------------------ screen */


export async function mount(el) {
  let alive = true;
  const state = { sel: null, all: false, select: () => {} };

  const draw = async (live) => {
    const ctx = makeCtx(new Date());
    const [goals, f] = await Promise.all([store.goals(), golf.facts(ctx)]);
    if (!alive) return;
    if (!f.available || !f.rounds.length) {
      el.classList.toggle('no-rise', Boolean(live));
      fill(el, ...emptyScreen(f, goals, ctx).flat());
      return;
    }
    const byId = new Map(f.rounds.map((r) => [r.id, r]));
    if (!state.sel || !byId.has(state.sel)) state.sel = f.eighteen.length ? f.eighteen[f.eighteen.length - 1].id : f.rounds[f.rounds.length - 1].id;
    const trend = f.eighteen.length ? trendCard(f, state) : null;
    const listRounds = f.rounds.slice().reverse();
    const shownRounds = state.all ? listRounds : listRounds.slice(0, 10);
    const list = h('section.card.rounds.rise', { id: 'golf-rounds' }, shownRounds.map((r) => roundRow(r, f)));
    list.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target.closest('.r[data-rid]') : null;
      if (t) state.select(t.dataset.rid);
    });
    state.select = (rid) => {
      const r = byId.get(rid);
      if (!r) return;
      state.sel = rid;
      if (trend) {
        trend.svg.querySelectorAll('.bar, .vl').forEach((x) => x.classList.toggle('sel', x.dataset.rid === rid));
        trend.tip.replaceChildren(
          h('span', h('b', `${dow(r.date)} ${monD(r.date)}`), ` · ${r.short} · par ${r.par}${r.holes === 9 ? ' · 9 holes' : ''}`),
          h('span.sc', r.gross != null ? String(r.gross) : '—'),
        );
      }
      list.querySelectorAll('.r').forEach((x) => { const on = x.dataset.rid === rid; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    };
    const F = { facts: { golf: f }, goals, ctx };
    const unbacked = f.unbackedRounds;
    el.classList.toggle('no-rise', Boolean(live));
    fill(el,
      header(f),
      hero(f, ctx),
      trend ? trend.el : null,
      ...strokes(f),
      h('div.section-h.rise', h('h2', 'Recent rounds'),
        listRounds.length > 10 ? h('button.meta', { type: 'button', 'aria-expanded': state.all ? 'true' : 'false', onclick: () => { state.all = !state.all; draw(true); } }, state.all ? 'Fewer' : `All ${listRounds.length}`, icon('chev')) : h('span.meta', `${listRounds.length} in the ledger`)),
      list,
      ...byCourse(f),
      ...coachSection(golf.insights(F), 'golf'),
      openApp({ href: LEDGER, label: 'Open the ledger', sub: unbacked > 0 ? `Fairway Ledger · ${unbacked} ${unbacked === 1 ? 'round' : 'rounds'} not backed up` : 'Fairway Ledger · scoring, stats, backups', warn: unbacked >= 3 }),
    );
    state.select(state.sel);
    if (live) settle(el);
  };

  await draw(false);
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(() => { if (alive) draw(true).catch((err) => console.warn('golf redraw failed', err)); }, 60); };
  const onStore = (e) => { if (e && e.detail && e.detail.store === 'settings') refresh(); };
  window.addEventListener('clubhouse:refresh', refresh);
  store.events.addEventListener('change', onStore);
  return () => {
    alive = false;
    clearTimeout(t);
    window.removeEventListener('clubhouse:refresh', refresh);
    store.events.removeEventListener('change', onStore);
  };
}
