// Train (#/train) — Direction B, a read-only window onto Form (DECISIONS 2026-09-28).
// Ring + streak, this week's sessions, PRs and e1RM movers, sessions-per-week trend (tap-linked to the list),
// active minutes, Coach, the Form import, and a big Open Form button. Nothing here logs a workout.
import * as store from '../store.js';
import * as trainPillar from '../pillars/train.js';
import { h, icon, ring, play, fitText, fmt, rich } from '../dom.js';
import { addDays, monD, mondayOf } from '../dates.js';
import { loadView, siblingFacts, prBySession } from '../train/view.js';
import { insights } from '../train/insights.js';
import { importFromFile } from '../train/import-flow.js';
import { FORM_URL, EXPORT_STEPS, longDate } from '../train/form-import.js';
import { asOfText, shortLift } from '../train/model.js';
import { barChart } from '../train/charts.js';
import { weekStrip, sessionRow, insightCard, signed, dow } from '../train/ui.js';

export const title = 'Train';

const enc = encodeURIComponent;
const plural = (n, one, many) => (n === 1 ? one : many);
const WEEKS_SHOWN = 10;

/* ------------------------------------------------------------------ pieces */

function howTo() {
  return h('ol.tr-steps', EXPORT_STEPS.map((s) => h('li', h('span.n', String(s.n)), h('span.t', rich(s.html)))));
}

function openFormLink(cls, label = 'Open Form') {
  return h(`a.${cls}`, { href: FORM_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('share'), label);
}

/** The first-run card: a beautiful, teaching empty state. */
function onboardCard(pick) {
  return h('section.card.tr-onboard.rise', { 'aria-label': 'Bring in your Form data' },
    h('div.empty',
      h('div.glyph', icon('import')),
      h('div',
        h('h3', 'Bring in your Form data'),
        h('p', 'Form is where you train. Clubhouse turns its export file into your ring, streak and PRs — read-only, and nothing is ever sent back.'),
      ),
    ),
    howTo(),
    h('button.cta', { type: 'button', onclick: pick }, icon('import'), 'Choose the Form file'),
    openFormLink('cta.ghost', 'Open Form'),
    h('p.tr-fine', 'The file stays on this phone. Import again any time to refresh.'),
  );
}

function heroCard(vm, prev, pick) {
  const { f, goal, ctx } = vm;
  const has = f.available;
  const unknown = has && f.asOfDate < ctx.weekStart; // the export predates this week: its "0" is not a count
  const r = ring({ value: f.weekCount, goal, size: 'hero', empty: !has || unknown, from: prev != null ? prev : 0, label: unknown ? `This week unknown, export is from ${monD(f.asOfDate)}` : has ? `${f.weekCount} of ${goal} workouts this week` : 'No Form data yet' });
  if (prev != null) r.classList.add('live');
  const last = f.last;
  const facts = h('div.facts',
    h('div', h('div.k', 'Weekly goal'), h('a.v', { href: '#/settings', style: 'display:block', 'aria-label': `Weekly goal ${goal}, edit in Settings` }, String(goal), h('small', `${plural(goal, 'workout', 'workouts')} · edit`))),
    h('div', h('div.k', 'Week streak'), h('div.v', has ? String(f.streakWeeks) : '0', h('small', has ? plural(f.streakWeeks, 'week', 'weeks') : 'weeks'))),
    has
      ? h('div', h('div.k', 'Last session'), h('div.v', last ? dow(last.date) : '—', h('small', last ? last.title : 'none yet')))
      : h('div', h('div.k', 'Source'), h('div.v', 'Form', h('small', 'not imported yet'))),
  );
  const foot = has
    ? h('div', { class: `tr-fresh${f.stale ? ' stale' : ''}` },
      h('span.when', icon(f.stale ? 'warn' : 'clock'), h('b', `As of ${longDate(f.asOfDate)}`), f.stale ? ` · ${f.staleDays} days old` : f.staleDays === 1 ? ' · yesterday' : ''),
      h('button.pill.quiet', { type: 'button', onclick: pick }, icon('import'), 'Import'))
    : null;
  return h('section.card.tr-hero.rise', h('div.ring-hero', r, facts), foot);
}

function weekSection(vm, prs) {
  const { f, goal, ctx } = vm;
  const list = f.weekWorkouts.slice().reverse();
  const kids = [h('div.section-h.rise', h('h2', 'This week'), h('span.meta', f.stale && list.length === 0 ? 'Export predates it' : `${list.length} ${plural(list.length, 'session', 'sessions')}`))];
  if (list.length) {
    kids.push(h('section.card.rounds.rise', { dataset: { list: 'week' } }, list.map((s) => sessionRow({ ...s, week: ctx.weekStart }, prs.get(s.id) || [], { tag: 'button', onclick: () => selectWeek(ctx.weekStart) }))));
  } else {
    const rem = f.remaining;
    kids.push(h('section.card.tr-quiet.rise',
      h('p', f.stale
        ? `This export is from ${monD(f.asOfDate)}, so it can’t say how this week is going. Import a fresh one to see it.`
        : rem > 0
          ? `Nothing in Form yet this week — ${rem} to go with ${ctx.daysLeft} ${plural(ctx.daysLeft, 'day', 'days')} left.`
          : 'Nothing new this week.'),
      openFormLink('pill.volt', 'Open Form')));
  }
  return kids;
}

function earlierSection(vm, prs) {
  const { f, ctx } = vm;
  const weekIds = new Set(f.weekWorkouts.map((s) => s.id));
  const earlier = f.sessions.filter((s) => !weekIds.has(s.id)).slice(-5).reverse();
  if (!earlier.length) return [];
  return [
    h('div.section-h.rise', h('h2', 'Earlier'), h('a.meta.tr-all', { href: '#/train/history' }, `All ${f.totalWorkouts}`, icon('chev'))),
    h('section.card.rounds.rise', { dataset: { list: 'earlier' } }, earlier.map((s) => sessionRow({ ...s, week: mondayKey(s.date) }, prs.get(s.id) || [], { onclick: () => selectWeek(mondayKey(s.date)) }))),
  ];
}

const mondayKey = (date) => mondayOf(date);

function strengthSection(vm) {
  const { f } = vm;
  const seen = new Set();
  const chips = [];
  for (const p of f.prs30) {
    if (seen.has(p.exerciseId)) continue;
    seen.add(p.exerciseId);
    chips.push(h('a.chip', { href: `#/train/exercise/${enc(p.exerciseId)}`, 'aria-label': `PR ${p.name} ${p.weight} by ${p.reps}, ${monD(p.date)}` },
      icon('trophy'), h('b', `${fmt.group(p.weight)} × ${p.reps}`), ` ${shortLift(p.name, 3)} · ${monD(p.date)}`));
    if (chips.length === 4) break;
  }
  const movers = f.movers.slice(0, 3);
  const kids = [h('div.section-h.rise', h('h2', 'PRs'), h('span.meta', 'Last 30 days · e1RM'))];
  if (chips.length) kids.push(h('div.chips.rise', chips));
  if (movers.length) {
    kids.push(
      h('div.section-h.rise', h('h2', 'e1RM movers'), h('span.meta', 'Lately vs six weeks back')),
      h('section.card.tr-movers.rise', movers.map((m) => h('a.mv', { href: `#/train/exercise/${enc(m.exerciseId)}` },
        h('div.n', m.name, h('span', `${fmt.group(m.weight)} × ${m.reps} · ${monD(m.date)}`)),
        h('div.v', String(m.e1rm), h('small', 'lb')),
        h('div', { class: `d ${m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : ''}`.trim() },
          m.delta === 0 ? null : icon(m.delta > 0 ? 'up' : 'down'),
          m.delta === 0 ? 'same' : `${signed(m.delta)} lb`,
          h('small', ` since ${monD(m.from.date)}`))))),
    );
  }
  if (!chips.length && !movers.length) {
    kids.push(h('section.card.tr-quiet.rise', h('p', 'PRs and e1RM movers show up once a lift has two sessions to compare. Only loaded sets of 1–12 reps count — nothing is guessed.')));
  }
  return kids;
}

/* the sessions-per-week chart, tap-linked to the lists (both directions) */
let selectWeek = () => {};

function trendSection(vm, el) {
  const { f, goal, ctx } = vm;
  const weeks = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) weeks.push(addDays(ctx.weekStart, -7 * i));
  const count = (ws) => f.weekCounts[ws] || 0;
  const firstWeek = f.sessions.length ? mondayKey(f.sessions[0].date) : null;
  const done = weeks.filter((ws) => ws < ctx.weekStart && firstWeek && ws >= firstWeek);
  const hit = done.filter((ws) => count(ws) >= goal).length;
  const headline = done.length >= 3
    ? h('h3', 'Goal hit in ', h('strong', `${hit} of the last ${done.length} weeks`), '.')
    : h('h3', 'Sessions a week');
  const tip = h('div.tip', { 'aria-live': 'polite' });
  let linked = false; // the first, automatic selection only sets the tip; rows light up when the person taps
  const bars = weeks.map((ws) => ({ k: ws, x: monD(ws).replace(' ', ' '), v: count(ws), hi: count(ws) >= goal }));
  const titles = (ws) => f.sessions.filter((s) => s.date >= ws && s.date <= addDays(ws, 6)).map((s) => `${s.title} ${dow(s.date)}`);
  const chart = barChart({
    bars, goal, lo: 0, hi: Math.max(goal, ...bars.map((b) => b.v)) + 1, xEvery: 2,
    aria: `Sessions per week, last ${WEEKS_SHOWN} weeks, goal ${goal}`,
    onSelect: (ws) => {
      const c = count(ws);
      tip.replaceChildren(
        h('span', h('b', `Week of ${monD(ws)}`), c ? ` · ${titles(ws).slice(0, 4).join(' · ')}` : ' · no sessions'),
        h('span.sc', String(c)),
      );
      if (linked) el.querySelectorAll('[data-week]').forEach((r) => r.classList.toggle('sel', r.dataset.week === ws));
    },
  });
  selectWeek = (ws) => chart.select(ws);
  const sec = h('section.card.trend.rise',
    h('div.h', headline),
    h('div.legend', h('span', h('i.bar'), 'Sessions'), h('span', h('i.avg'), `Goal ${goal}`), h('span', 'Lighter bar = goal week · tap a bar')),
    h('div.chart', chart.el),
    tip,
  );
  return { sec, initial: () => { chart.select(ctx.weekStart); linked = true; } };
}

function statCards(vm) {
  const { f, ctx } = vm;
  const partial = ctx.dayIndex < 6 || f.stale; // a week in progress is never "down" against a finished one
  const dm = partial ? 0 : f.activeMinThisWeek - f.activeMinPrevWeek;
  const top = f.activitiesThisWeek.slice(0, 2).map((a) => `${a.name} ${a.minutes}`).join(' · ');
  const active = h('div.card.stat-card',
    h('div.k', icon('clock'), 'Active min'),
    h('div.v', fmt.group(f.activeMinThisWeek), h('small', ' min')),
    h('div', { class: `cmp${dm > 0 ? ' good' : ''}` }, dm === 0 ? null : icon(dm > 0 ? 'up' : 'down'), partial ? `Last week: ${f.activeMinPrevWeek} min` : f.activeMinPrevWeek || f.activeMinThisWeek ? `${dm === 0 ? 'Same as' : `${signed(dm)} vs`} last week (${f.activeMinPrevWeek})` : 'Nothing logged yet'),
    top ? h('div.cmp', top) : null);
  const vd = f.volumePrev4Avg && !partial ? Math.round((f.volumeThisWeek / f.volumePrev4Avg - 1) * 100) : null;
  const lifted = h('div.card.stat-card',
    h('div.k', icon('train'), 'Lifted'),
    h('div.v', fmt.group(f.volumeThisWeek), h('small', ' lb')),
    h('div', { class: `cmp${vd > 0 ? ' good' : ''}` }, vd == null || vd === 0 ? null : icon(vd > 0 ? 'up' : 'down'), vd == null ? (f.volumePrev4Avg ? `4-week average: ${fmt.group(f.volumePrev4Avg)} lb` : 'No 4-week average yet') : vd === 0 ? 'Same as your 4-week average' : `${signed(vd)}% vs 4-week average`),
    h('div.cmp', `Loaded sets · ${asOfText(f)}`));
  return h('div.stats4.rise', active, lifted);
}

function sourceCard(vm, pick) {
  const { f, dataset } = vm;
  const days = (dataset && dataset.counts && dataset.counts.days) || 0;
  return h('section.card.tr-source.rise',
    h('div.row',
      h('div.lg', icon('import')),
      h('div.t', 'Form export', h('small', `${f.totalWorkouts} ${plural(f.totalWorkouts, 'session', 'sessions')} · ${days} days · as of ${longDate(f.asOfDate)}${f.member ? ` · ${f.member}` : ''}`)),
    ),
    h('div.btns',
      h('button.pill.volt', { type: 'button', onclick: pick }, icon('import'), 'Import newer export'),
      h('a.pill', { href: '#/backup' }, icon('shield'), 'Backups')),
    h('details.tr-how', h('summary', 'How to export from Form', icon('chev')), howTo()),
  );
}

/* ------------------------------------------------------------------ screen */

export async function mount(el) {
  let alive = true;
  let drawing = null;
  let queued = false;
  let prevWeek = null;

  const input = h('input.file-input', { type: 'file', accept: 'application/json,.json', tabindex: '-1', 'aria-hidden': 'true' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) await importFromFile(file);
  });
  const pick = () => input.click();

  const draw = async (live) => {
    const vm = await loadView();
    if (!alive) return;
    const sib = await siblingFacts(vm.ctx);
    if (!alive) return;
    const { f, goal, ctx } = vm;
    const prs = prBySession(f);
    const ins = insights({ facts: { train: f, ...sib }, goals: { train: goal }, ctx }).filter((i) => f.available || i.id !== 'T0'); // first run: the onboarding card says it
    const trend = f.available && f.totalWorkouts ? trendSection(vm, el) : null;
    const eyebrowLong = !f.available ? 'Form · not imported yet' : f.asOfDate < ctx.weekStart ? `Export from ${monD(f.asOfDate)} · ${f.streakWeeks} wk streak` : `${f.weekCount} of ${goal} this week · ${f.streakWeeks} wk streak`;
    const kids = [
      h('header.rise',
        h('div.subtop',
          h('a.back', { href: '#/' }, icon('chevl'), 'Home'),
          openFormLink('action', 'Open Form')),
        h('h1.title', icon('train'), 'Train'),
        h('div.eyebrow.tr-eyebrow', { style: 'margin-top:6px' }, eyebrowLong),
      ),
      heroCard(vm, live ? prevWeek : null, pick),
      f.available ? weekStrip(trainPillar.dayMarks(f, ctx), ctx) : null,
    ];
    if (!f.available) {
      kids.push(onboardCard(pick));
    } else if (!f.totalWorkouts) {
      kids.push(h('section.card.tr-quiet.rise', h('p', 'Your Form export has no finished sessions yet. Finish a workout in Form, export again, and it shows up here.'), openFormLink('pill.volt', 'Open Form')));
    } else {
      kids.push(...weekSection(vm, prs), ...strengthSection(vm), ...earlierSection(vm, prs), trend.sec, statCards(vm));
    }
    if (ins.length) kids.push(h('div.section-h.rise', h('h2', 'Coach'), h('span.meta', 'Plain-English read')), ...ins.map(insightCard));
    if (f.available) kids.push(sourceCard(vm, pick));
    if (f.available) kids.push(h('div.open-app.rise', openFormLink('cta', 'Open Form'), h('div.sub', 'Log workouts and activities there — then import its export here.')));
    kids.push(input);

    el.classList.toggle('no-rise', Boolean(live));
    el.replaceChildren(...kids.filter(Boolean));
    const eb = el.querySelector('.tr-eyebrow');
    if (eb) fitText(eb, [eyebrowLong, eyebrowLong.replace('this week', 'wk').replace(' wk streak', ' streak')]);
    if (trend) trend.initial();
    prevWeek = f.weekCount;
    if (live) play(el);
  };

  const redraw = () => {
    if (!alive) return;
    if (drawing) { queued = true; return; }
    drawing = draw(true).catch((err) => console.warn('train redraw failed', err)).finally(() => {
      drawing = null;
      if (queued) { queued = false; redraw(); }
    });
  };
  let t = null;
  const onChange = (e) => {
    const s = e && e.detail && e.detail.store;
    if (s === 'snapshots') return;
    clearTimeout(t);
    t = setTimeout(redraw, 60);
  };

  await draw(false);
  store.events.addEventListener('change', onChange);
  window.addEventListener('clubhouse:refresh', onChange);
  return () => {
    alive = false;
    clearTimeout(t);
    selectWeek = () => {};
    store.events.removeEventListener('change', onChange);
    window.removeEventListener('clubhouse:refresh', onChange);
  };
}

