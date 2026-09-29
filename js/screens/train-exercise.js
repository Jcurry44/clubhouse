// Exercise detail (#/train/exercise/:id) — one lift across every session in the Form export: current e1RM,
// PRs, a bar + line chart (bars = the heaviest loaded set that day, dashed line = e1RM) tap-linked to the list
// (both directions, like Golf's trend). Read-only; only loaded sets of 1–12 reps are ever estimated.
import * as store from '../store.js';
import { h, icon, play } from '../dom.js';
import { monD, DOW, dowIndex } from '../dates.js';
import { loadView } from '../train/view.js';
import { exerciseHistory, asOfText } from '../train/model.js';
import { loadCatalog } from '../train/form-import.js';
import { barChart } from '../train/charts.js';
import { dateBlock, signed, dow } from '../train/ui.js';

export const title = 'Exercise';

const SHOWN = 10;

const setText = (x) => (x.weight ? `${x.weight}×${x.reps}` : String(x.reps));

export async function mount(el, params) {
  let alive = true;
  const id = params.id;
  const catalog = await loadCatalog();
  const mode = catalog.exercises[id] ? catalog.exercises[id][2] : null;

  const draw = async (live) => {
    const vm = await loadView();
    if (!alive) return;
    const { f, ctx } = vm;
    const hist = exerciseHistory(f.sessions).get(id);
    const back = h('div.subtop', h('a.back', { href: '#/train' }, icon('chevl'), 'Train'), h('span'));
    if (!hist) {
      el.classList.toggle('no-rise', Boolean(live));
      el.replaceChildren(
        h('header.rise', back, h('h1.title.tr-long', icon('train'), 'Exercise')),
        h('section.card.tr-quiet.rise', h('p', f.available ? 'That lift isn’t in your imported Form data.' : 'Import your Form export on the Train tab and every lift gets its own page.'), h('a.pill.volt', { href: '#/train' }, 'Back to Train')),
      );
      document.title = 'Clubhouse — Exercise';
      return;
    }
    document.title = `Clubhouse — ${hist.name}`;
    const prs = f.prsAll.filter((p) => p.exerciseId === id);
    const prIds = new Set(prs.map((p) => p.sessionId));
    const sessions = hist.sessions.slice(-SHOWN);
    const loaded = hist.sessions.some((s) => s.best);
    const est = hist.sessions.filter((s) => s.best);
    const latest = est.length ? est[est.length - 1] : null;
    const bestEver = est.reduce((m, s) => (!m || s.best.e1rm > m.best.e1rm ? s : m), null);
    const firstEst = est[0] || null;

    // per-session numbers for the chart and rows
    const topW = (s) => s.sets.filter((x) => x.lift === true && x.weight > 0).reduce((m, x) => Math.max(m, x.weight), 0);
    const bestReps = (s) => s.sets.reduce((m, x) => Math.max(m, x.reps), 0);
    const bars = sessions.map((s) => {
      const v = loaded ? topW(s) : bestReps(s);
      return { k: s.sessionId, x: monD(s.date).replace(' ', ' '), v, hi: prIds.has(s.sessionId) };
    });
    const line = loaded ? sessions.map((s) => (s.best ? s.best.e1rm : null)) : null;
    const values = [...bars.map((b) => b.v), ...(line || []).filter((v) => v != null)].filter((v) => v > 0);
    const lo = loaded && values.length ? Math.max(0, Math.floor((Math.min(...values) * 0.7) / 10) * 10) : 0;
    const hi = (values.length ? Math.max(...values) : 10) * 1.08;
    const tip = h('div.tip', { 'aria-live': 'polite' });
    const list = h('section.card.rounds.rise');
    const bySession = new Map(sessions.map((s) => [s.sessionId, s]));
    const sel = (sid) => {
      const s = bySession.get(sid);
      if (!s) return;
      list.querySelectorAll('.r').forEach((r) => r.classList.toggle('sel', r.dataset.id === sid));
      tip.replaceChildren(
        h('span', h('b', `${DOW[dowIndex(s.date)]} ${monD(s.date)}`), ` · ${s.best ? `${s.best.weight} × ${s.best.reps}` : s.sets.map(setText).join(' · ')}${s.best ? ` · e1RM ${s.best.e1rm}` : ''}`),
        h('span.sc', s.best ? String(s.best.e1rm) : String(bestReps(s))),
      );
    };
    const chart = barChart({
      bars, line, lo, hi, ticks: loaded ? [lo, Math.round((lo + hi) / 2 / 5) * 5].filter((t, i, a) => a.indexOf(t) === i && (t === lo ? lo > 0 : t > lo)) : [], // the baseline is labelled when it is not zero
      aria: `${hist.name}: ${loaded ? 'heaviest set and e1RM' : 'best reps'} per session, last ${bars.length}`,
      onSelect: (k) => sel(k), // bar → row + tip; a row tap calls chart.select → the same path (both directions)
    });

    for (const s of hist.sessions.slice().reverse().slice(0, SHOWN)) {
      const row = h('button.r', { type: 'button', dataset: { id: s.sessionId }, onclick: () => chart.select(s.sessionId) },
        dateBlock(s.date),
        h('div', h('div.course', s.title, prIds.has(s.sessionId) ? h('span.badge-pr', { style: 'margin-left:8px' }, icon('trophy'), 'PR') : null),
          h('div.meta', `${dow(s.date)} · ${s.sets.map(setText).join(' · ')}`)),
        h('div.score', h('b', s.best ? String(s.best.e1rm) : String(bestReps(s))), h('span', s.best ? 'e1RM' : mode === 'time' ? 'sec' : 'reps')));
      list.appendChild(row);
    }

    // hero
    const base = latest ? est.slice(0, -1).find((s) => (Date.parse(latest.date) - Date.parse(s.date)) / 864e5 <= 42) : null;
    const delta = latest && base ? latest.best.e1rm - base.best.e1rm : null;
    const big = h('span.count', { dataset: { to: String(loaded && latest ? latest.best.e1rm : Math.max(0, ...hist.sessions.map(bestReps))), dec: '0', from: '0' } }, '0');
    const hero = h('section.card.hcp.rise',
      h('div.lbl', loaded && latest ? 'Current e1RM' : mode === 'time' ? 'Longest hold' : 'Most reps'),
      h('div.big',
        h('div.n', big, loaded ? h('span.u', 'lb') : null),
        h('div.d',
          delta != null && delta !== 0 ? h('span', { class: `delta${delta < 0 ? ' warm' : ''}` }, icon(delta > 0 ? 'up' : 'down'), `${signed(delta)} lb`) : null,
          h('span', loaded && latest
            ? (base ? `since ${monD(base.date)} (${base.best.e1rm})` : 'first estimate')
            : mode === 'time' ? 'seconds, best session' : hist.sessions.some((x) => x.sets.some((y) => y.weight > 0)) ? 'assisted — no e1RM' : 'bodyweight — no e1RM'))),
      loaded && bestEver ? h('div.best', h('div.k', 'Best set'), h('div.v', `${bestEver.best.weight} × ${bestEver.best.reps}`, h('small', ` ${monD(bestEver.date)}`))) : null,
    );

    const foot = h('p.tr-fine.rise', loaded
      ? `e1RM = Epley estimate from loaded sets of 1–12 reps. ${prs.length ? `${prs.length} ${prs.length === 1 ? 'PR' : 'PRs'} in this export.` : 'No PR yet — a PR beats an earlier logged best.'} ${asOfText(f)}.`
      : `Bodyweight, timed and assisted moves aren’t given an e1RM. ${asOfText(f)}.`);

    const shortTitle = hist.name.length > 22;
    el.classList.toggle('no-rise', Boolean(live));
    el.replaceChildren(
      h('header.rise', back,
        h('h1', { class: `title${shortTitle ? ' tr-long' : ''}` }, icon('train'), hist.name),
        h('div.eyebrow', { style: 'margin-top:6px' }, `${hist.sessions.length} ${hist.sessions.length === 1 ? 'session' : 'sessions'} · ${prs.length} ${prs.length === 1 ? 'PR' : 'PRs'} · ${asOfText(f)}`)),
      hero,
      h('section.card.trend.rise',
        h('div.h', h('h3', loaded ? 'Heaviest set and ' : 'Best reps ', loaded ? h('strong', 'e1RM') : null, loaded ? ' per session.' : ' per session.')),
        h('div.legend', h('span', h('i.bar'), loaded ? 'Heaviest set (lb)' : 'Reps'), loaded ? h('span', h('i.avg'), 'e1RM') : null, h('span', 'Tap a bar')),
        h('div.chart', chart.el), tip),
      h('div.section-h.rise', h('h2', 'Sessions'), h('span.meta', `Last ${Math.min(SHOWN, hist.sessions.length)}`)),
      list,
      foot,
    );
    if (bars.length) chart.select(bars[bars.length - 1].k);
    if (live) play(el); // first draw: the router plays the entrance and the count-up
  };

  let t = null;
  const onChange = (e) => { if (e && e.detail && e.detail.store === 'snapshots') return; clearTimeout(t); t = setTimeout(() => draw(true), 60); };
  await draw(false);
  store.events.addEventListener('change', onChange);
  window.addEventListener('clubhouse:refresh', onChange);
  return () => { alive = false; clearTimeout(t); store.events.removeEventListener('change', onChange); window.removeEventListener('clubhouse:refresh', onChange); };
}

