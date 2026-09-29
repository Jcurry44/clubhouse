// Sports screen (#/sports, SPEC §5.3) — Direction B. Team cards (record, standing, next game with a live countdown,
// last result, last-5 strip), THIS WEEK / SCHEDULE / RESULTS lists with a "Watched" toggle per game (IndexedDB `watched`,
// part of every Clubhouse backup), the sports Coach cards, and an honest "as of" line when the feed is old or offline.
// Tap a last-5 square or a game row and its twin lights up (the hover-linking Joe loves, both directions).
import * as store from '../store.js';
import * as dates from '../dates.js';
import * as sports from '../pillars/sports.js';
import { h, icon, rich, ring, dots7, play, reduceMotion } from '../dom.js';
import { toast } from '../ui.js';

export const title = 'Sports';

const { dash, resultText, whenShort, countdownText, lineText } = sports;

/* ------------------------------------------------------------------ stylesheet (own file, loaded once) */

function ensureCss() {
  if (document.querySelector('link[data-sports-css]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './css/sports.css';
    link.dataset.sportsCss = '1';
    const done = () => resolve();
    link.onload = done;
    link.onerror = done; // unstyled beats blank
    document.head.appendChild(link);
    setTimeout(done, 2500);
  });
}

/* ------------------------------------------------------------------ pure view helpers */

const teamShort = (f, g) => f.teams[g.team]?.short || g.team;
const vs = (g) => `${g.home ? 'vs' : 'at'} ${g.opponent.short}`;
const canMark = (g) => g.state === 'live' || g.state === 'final' || g.state === 'pending';

export function eyebrowText(f, now = new Date()) {
  if (!f.available) return 'Bills · Sabres · Bisons · no feed yet';
  if (f.offline) return `Offline · as of ${dates.stamp(f.generatedAt)}`;
  if (f.fetchFailed) return `Couldn’t refresh · as of ${dates.stamp(f.generatedAt)}`;
  const down = f.sourcesDown.length ? `${f.sourcesDown.join(', ')} feed${f.sourcesDown.length > 1 ? 's' : ''} down` : f.stale ? 'feed is behind' : 'all feeds ok';
  return `Updated ${dates.ago(f.generatedAt, now)} · ${down}`;
}

const rangeLabel = (a, b) => (a.slice(5, 7) === b.slice(5, 7) ? `${dates.monD(a)} – ${Number(b.slice(8))}` : `${dates.monD(a)} – ${dates.monD(b)}`);

/** 'W3' → 'Won 3 in a row'. */
export function streakWords(code) {
  const m = /^(W|L|T|OT)(\d+)$/.exec(code || '');
  if (!m) return '';
  const n = Number(m[2]);
  if (m[1] === 'W') return n === 1 ? 'Won last game' : `Won ${n} in a row`;
  if (m[1] === 'L') return n === 1 ? 'Lost last game' : `Lost ${n} in a row`;
  if (m[1] === 'OT') return n === 1 ? 'OT loss last game' : `${n} OT losses in a row`;
  return '';
}

function standingLine(t, ctx) {
  if (t.phase === 'preseason') {
    const o = t.nextIsOpener ? t.nextGame : null;
    return o ? `Preseason · opener ${dates.dayWord(o.date, ctx, { short: true })}` : 'Preseason';
  }
  if (t.phase === 'offseason') return t.standing ? `Final · ${t.standing}` : 'Off-season';
  if (t.phase === 'post') return t.standing ? `Playoffs · ${t.standing}` : 'Playoffs';
  return t.standing || 'Regular season';
}

function recBlock(t) {
  if (t.phase === 'preseason') return { big: dash(t.recordPre || t.record || '–'), small: 'Preseason' };
  if (t.phase === 'offseason') return { big: dash(t.record || '–'), small: 'Final' };
  return { big: dash(t.record || '–'), small: t.streak || (t.phase === 'post' ? 'Playoffs' : '') };
}

/* ------------------------------------------------------------------ DOM builders */

function watchedPill(g, f, ctx, onToggle) {
  const on = Boolean(g.watchedRow);
  return h('button', {
    type: 'button', class: `pill wt${on ? ' sel' : ''}`, 'aria-pressed': on ? 'true' : 'false', dataset: { wt: g.id },
    'aria-label': `${teamShort(f, g)} ${vs(g)}, ${dates.dayWord(g.date, ctx, { short: true })} — ${on ? 'watched' : 'mark watched'}`,
    onclick: (e) => { e.stopPropagation(); onToggle(g); },
  }, on ? icon('check') : h('span.ring-o', { 'aria-hidden': 'true' }), 'Watched');
}

function squares(t, ui) {
  return t.form.map((x) => h('button', {
    type: 'button', class: `sq ${String(x.result || '').toLowerCase()}${x.pre ? ' pre' : ''}${ui.sel === x.gameId ? ' sel' : ''}`,
    dataset: { game: x.gameId },
    'aria-label': `${x.result} ${x.score ? `${x.score.us}–${x.score.them} ` : ''}against ${x.opp}, ${dates.monD(x.date)}${x.pre ? ', preseason' : ''}`,
    onclick: () => ui.select(x.gameId, 'sq'),
  }, x.result));
}

function nextTile(t, f, ctx) {
  const g = t.nextGame;
  if (!g) {
    const back = t.phase === 'offseason' ? `Back in ${({ bills: 'September', sabres: 'October', bisons: 'April' })[t.id] || 'the fall'}` : 'No game on the schedule yet';
    return h('div.sp-next.off', h('span.k', 'Next'), h('span.nm', 'Off-season'), h('span.nf', `· ${back}`));
  }
  const opener = t.nextIsOpener && t.phase === 'preseason';
  const label = g.state === 'live' ? 'On now' : opener ? 'Season opener' : g.seasonType === 'preseason' ? 'Next · preseason' : g.seasonType === 'post' ? 'Next · playoffs' : 'Next';
  const line = lineText(g.line, t.short, g.opponent.abbr, g.opponent.short);
  const facts = [
    `${dates.dowMonD(g.date)} · ${g.tbd ? 'TBD' : dates.time12(g.startUTC, { ampm: true })}`,
    g.venue, g.tv, line, g.overUnder != null ? `o/u ${g.overUnder}` : null,
  ].filter(Boolean);
  return h('div.sp-next',
    h('div.r1', h('span.k', label), h('span.cd', { dataset: { cd: String(g.startMs) } }, icon('clock'), g.tbd ? 'Time TBD' : countdownText(g.startMs, +ctx.now))),
    h('div.nm', vs(g), g.opponent.record ? h('small', dash(g.opponent.record)) : null),
    h('div.nf', facts.map((x, i) => [i ? ' · ' : null, h('span.nw', x)])),
  );
}

function lastLine(t, f, ctx, onToggle) {
  const g = t.lastGame;
  if (!g) return null;
  return h('div.sp-last',
    h('div.txt', h('span.k', g.seasonType === 'preseason' ? 'Last · preseason' : 'Last'),
      h('b', resultText(g)), `${vs(g)} · ${dates.dayWord(g.date, ctx, { short: true })}`),
    watchedPill(g, f, ctx, onToggle),
  );
}

function teamCard(t, f, ctx, ui, onToggle) {
  const rec = recBlock(t);
  const preNote = t.form.some((x) => x.pre);
  const sel = t.form.find((x) => x.gameId === ui.sel);
  return h('article', { class: 'card sp-team rise', dataset: { team: t.id }, 'aria-label': `${t.name}` },
    h('div.head',
      h('div.lg', { 'aria-hidden': 'true' }, t.tag),
      h('div.who', h('h3', t.short), h('div.st', standingLine(t, ctx))),
      h('div.rec', h('b', rec.big), rec.small ? h('small', rec.small) : null),
    ),
    t.stale ? h('div.sp-stale', icon('warn'), t.asOf ? `Feed down — showing data from ${dates.stamp(t.asOf)}` : 'Feed down — no data for this team yet') : null,
    t.form.length ? h('div.sp-form',
      h('span.lbl', 'Last 5'),
      h('div.sqs', { role: 'group', 'aria-label': `${t.short} last ${t.form.length} results` }, squares(t, ui)),
      h('span.note', sel ? `${dates.dowMonD(sel.date)} · ${resultText({ result: sel.result, score: sel.score })} ${sel.opp}` : (preNote ? 'includes preseason' : streakWords(t.streak))),
    ) : null,
    nextTile(t, f, ctx),
    lastLine(t, f, ctx, onToggle),
  );
}

function gameRow(g, f, ctx, ui, onToggle, { showDate = true } = {}) {
  const today = g.date === ctx.today;
  const isPre = g.seasonType === 'preseason';
  let meta;
  if (g.state === 'final') {
    meta = [h('b', { class: `res${g.result === 'W' ? ' w' : ''}` }, resultText(g)), g.tv ? `· ${g.tv}` : null];
  } else if (g.state === 'live') {
    meta = [`Underway${g.score ? ` · ${g.score.us}–${g.score.them}` : ''}`, g.tv ? ` · ${g.tv}` : ''];
  } else if (g.state === 'pending') {
    meta = ['Final score isn’t in the feed yet'];
  } else if (g.state === 'postponed') {
    meta = ['Postponed'];
  } else {
    meta = [[g.venue, g.tv, lineText(g.line, teamShort(f, g), g.opponent.abbr, g.opponent.short)].filter(Boolean).join(' · ')];
  }
  const end = canMark(g)
    ? watchedPill(g, f, ctx, onToggle)
    : g.state === 'upcoming'
      ? h('div.score', h('b', g.tbd ? 'TBD' : dates.time12(g.startUTC)), g.tbd ? h('span', ' ') : h('span', { dataset: { cd: String(g.startMs), short: '1' } }, shortCd(g.startMs, +ctx.now)))
      : h('div.score', h('span', '–'));
  return h('div', {
    class: `r${ui.sel === g.id ? ' sel' : ''}${today ? ' today' : ''}`, role: 'group', tabindex: 0, dataset: { game: g.id },
    onclick: () => ui.select(g.id, 'row'),
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) ui.select(g.id, 'row'); },
  },
  h('div.date', h('b', String(Number(g.date.slice(8)))), h('span', dates.DOW[dates.dowIndex(g.date)])),
  h('div', { style: 'min-width:0' },
    h('div.course', h('span', `${teamShort(f, g)} ${vs(g)}`)),
    h('div.meta', isPre ? h('span.pre-tag', 'pre') : null, meta)),
  end);
}

/** '5d' / '3h' / '42m' — the short form under a schedule time. */
export function shortCd(startMs, nowMs) {
  const min = Math.floor((startMs - nowMs) / 60000);
  if (min <= 0) return 'now';
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h`;
  return `in ${Math.floor(min / 1440)}d`;
}

function insightCard(ins, onAction) {
  const glyph = ins.tone === 'good' ? 'glyph good' : ins.tone === 'warm' ? 'glyph warm' : 'glyph';
  const i = ins.kicker.indexOf(' · ');
  const kicker = i < 0 ? h('div.kicker', ins.kicker) : h('div.kicker', ins.kicker.slice(0, i + 3), h('b', ins.kicker.slice(i + 3)));
  const viz = ins.viz && ins.viz.type === 'dots7' ? h('div.viz', dots7(ins.viz.on, ins.viz.todayIndex)) : null;
  const body = h('div.body', kicker, h('h3', rich(ins.headline)), ins.sub ? h('div.sub', ins.sub) : null);
  const cls = `card insight rise${viz ? '' : ' no-viz'}`;
  if (ins.actions && ins.actions.length) {
    body.appendChild(h('div.actions', ins.actions.map((a, k) => h('button', {
      type: 'button', class: k === 0 ? 'pill volt' : 'pill', onclick: () => onAction(a, ins),
    }, k === 0 ? icon('check') : null, a.label))));
    return h('div', { class: cls, dataset: { rule: ins.id } }, h('div', { class: glyph }, icon('sports')), body, viz);
  }
  return h('a', { class: `${cls} press`, href: ins.href || '#/sports', dataset: { rule: ins.id } }, h('div', { class: glyph }, icon('sports')), body, viz);
}

/* ------------------------------------------------------------------ the screen */

export async function mount(el) {
  await ensureCss();
  let alive = true;
  let drawing = null;
  let queued = false;
  let prevRing = null;
  let sig = '';
  let cdTimer = null;
  let redrawTimer = null;
  const ui = {
    sel: null, allSchedule: false, allResults: false,
    select: null,
  };

  const onToggle = async (g) => {
    const label = `${teamShort(vm.f, g)} ${vs(g)}`;
    try {
      if (g.watchedRow) {
        const row = await sports.unmarkWatched(g.id);
        if (row) toast(`Unmarked · ${label}`, { icon: 'x', action: { label: 'Undo', run: () => sports.restoreWatched(row) } });
      } else {
        await sports.markWatched(g);
        toast(`Watched · ${teamShort(vm.f, g)} ${g.state === 'final' ? resultText(g) : vs(g)}`, { action: { label: 'Undo', run: () => store.del('watched', g.id) } });
      }
    } catch (err) {
      console.warn('watched toggle failed', err);
      toast('Couldn’t save that — nothing changed.', { tone: 'warm' });
    }
  };

  const onAction = async (a, ins) => {
    try {
      if (a.run === 'sports.watched') {
        const g = vm.f.games.find((x) => x.id === a.arg);
        if (g) { await sports.markWatched(g); toast(`Watched · ${teamShort(vm.f, g)} ${resultText(g)}`, { action: { label: 'Undo', run: () => store.del('watched', g.id) } }); }
      } else if (a.run === 'sports.missed') {
        await sports.dismissGame(a.arg);
      }
    } catch (err) {
      console.warn('sports action failed', err);
      toast('Couldn’t save that — nothing changed.', { tone: 'warm' });
    }
  };

  let vm = null;
  const compute = async () => {
    const ctx = dates.makeCtx(new Date());
    const goals = await store.goals();
    const f = await sports.facts(ctx);
    const s = sports.summary(f, goals.sports, ctx);
    const F = { facts: { sports: f }, goals, ctx };
    return { ctx, f, s, ins: sports.insights(F) };
  };

  const stateSig = (f) => f.games.map((g) => g.state[0]).join('') + f.available;

  const build = (live) => {
    const { ctx, f, s, ins } = vm;
    const followed = f.followed.map((t) => f.teams[t]).filter(Boolean);
    const week = f.weekGames;
    const nextG = f.nextGame;
    const streak = f.billsWatchedStreak;

    // repair: past the 3-day "recent" window the hero still names the last final, with its day (never a bare dash);
    // no final at all → the row is dropped
    const lastAny = f.lastResult || followed.map((t) => t.lastGame).filter(Boolean).sort((a, b) => b.startMs - a.startMs)[0] || null;
    const heroFacts = h('div.facts',
      h('div', h('div.k', 'Next up'),
        h('div.v', nextG ? `${teamShort(f, nextG)} · ${whenShort(nextG, ctx)}` : (f.available ? 'Off-season' : '–'),
          nextG && !nextG.tbd ? h('small', { dataset: { cd: String(nextG.startMs), short: '1' } }, shortCd(nextG.startMs, +ctx.now)) : null)),
      streak >= 1
        ? h('div', h('div.k', 'Bills streak'), h('div.v', String(streak), h('small', `game${streak === 1 ? '' : 's'} watched in a row`)))
        : lastAny ? h('div', h('div.k', 'Last result'), h('div.v', `${teamShort(f, lastAny)} ${resultText(lastAny)}`, h('small', dates.dayWord(lastAny.date, ctx, { short: true })))) : null,
    );
    const heroRing = ring({
      value: s.ringValue, goal: s.ringGoal, size: 'hero', empty: Boolean(s.empty), from: live && prevRing != null ? prevRing : 0,
      label: `${s.ringValue} ${s.sublabel}`,
    });
    if (live && prevRing != null) heroRing.classList.add('live');
    const hero = h('section.card.rise', { 'aria-label': 'Games caught this week' }, h('div.ring-hero', heroRing, heroFacts));

    const header = h('header.rise',
      h('div.subtop',
        h('a.back', { href: '#/' }, icon('chevl'), 'Home'),
        h('a.action', { href: '#log:game' }, icon('plus'), 'Log game'),
      ),
      h('h1.title', icon('sports'), 'Sports'),
      h('div.eyebrow', { style: 'margin-top:6px', id: 'sp-eyebrow' }, eyebrowText(f, ctx.now)),
    );

    if (!f.available) {
      return [header, hero,
        h('section.card.rise', h('div.empty',
          h('div.glyph', icon('sports')),
          h('div', h('h3', s.empty.title), h('p', s.empty.body),
            f.fetchFailed ? h('div.btns', h('button.pill.sel', { type: 'button', onclick: () => refresh(true) }, icon('clock'), 'Try again')) : null))),
        insightsSection(ins),
      ];
    }

    // ---- lists
    const inWeek = week.slice().sort((a, b) => a.startMs - b.startMs);
    const later = f.games.filter((g) => g.date > ctx.weekEnd && (g.state === 'upcoming' || g.state === 'live')).sort((a, b) => a.startMs - b.startMs);
    const cutoff = dates.addDays(ctx.today, -30);
    const results = f.games.filter((g) => g.date < ctx.weekStart && g.date >= cutoff && (g.state === 'final' || g.state === 'pending')).sort((a, b) => b.startMs - a.startMs);

    const weekList = h('section.card.rounds.sp.rise', { 'aria-label': 'This week' },
      inWeek.length ? inWeek.map((g) => gameRow(g, f, ctx, ui, onToggle)) : h('div.none', 'No games this week for the teams you follow.'));

    const schedShown = ui.allSchedule ? later : later.slice(0, 6);
    const schedRows = [];
    let lastWeekStart = null;
    for (const g of schedShown) {
      const ws = dates.mondayOf(g.date);
      if (ws !== lastWeekStart) {
        lastWeekStart = ws;
        const nextWs = dates.addDays(ctx.weekStart, 7);
        schedRows.push(h('div.grp', `${ws === nextWs ? 'Next week · ' : ''}${rangeLabel(ws, dates.addDays(ws, 6))}`));
      }
      schedRows.push(gameRow(g, f, ctx, ui, onToggle));
    }
    const schedule = later.length ? [
      h('div.section-h.rise', h('h2', 'Schedule'),
        later.length > 6 ? h('button.meta', { type: 'button', 'aria-expanded': ui.allSchedule ? 'true' : 'false', onclick: () => { ui.allSchedule = !ui.allSchedule; redraw(); } }, ui.allSchedule ? 'Show less' : `All ${later.length}`) : h('span.meta', `next ${later.length}`)),
      h('section.card.rounds.sp.rise', { 'aria-label': 'Upcoming schedule' }, schedRows),
    ] : [];

    const resShown = ui.allResults ? results : results.slice(0, 5);
    const resultsSec = results.length ? [
      h('div.section-h.rise', h('h2', 'Results'),
        results.length > 5 ? h('button.meta', { type: 'button', 'aria-expanded': ui.allResults ? 'true' : 'false', onclick: () => { ui.allResults = !ui.allResults; redraw(); } }, ui.allResults ? 'Show less' : `All ${results.length}`) : h('span.meta', 'last 30 days')),
      h('section.card.rounds.sp.rise', { 'aria-label': 'Recent results' }, resShown.map((g) => gameRow(g, f, ctx, ui, onToggle))),
    ] : [];

    return [
      header, hero,
      followed.map((t) => teamCard(t, f, ctx, ui, onToggle)),
      h('div.section-h.rise', h('h2', 'This week'), h('span.meta', rangeLabel(ctx.weekStart, ctx.weekEnd))),
      weekList,
      insightsSection(ins),
      schedule,
      resultsSec,
      h('p.sp-foot.rise', 'Schedules and scores come from ESPN, the NHL and MLB, gathered a few times a day — ', h('b', 'this app never calls them from your phone'), '.'),
    ];
  };

  function insightsSection(ins) {
    if (!ins.length) return [];
    return [h('div.section-h.rise', h('h2', 'Coach'), h('span.meta', 'Plain-English read')), ins.map((i) => insightCard(i, onAction))];
  }

  ui.select = (id, from) => {
    ui.sel = ui.sel === id ? null : id;
    // both directions: light the twin in place, no redraw
    let target = null;
    for (const n of el.querySelectorAll('[data-game]')) {
      const on = ui.sel != null && n.dataset.game === ui.sel;
      n.classList.toggle('sel', on);
      if (on && n.classList.contains('r')) target = n;
    }
    // the strip's caption follows the selection
    for (const card of el.querySelectorAll('.sp-team')) {
      const t = vm.f.teams[card.dataset.team];
      const note = card.querySelector('.sp-form .note');
      const x = t && t.form.find((q) => q.gameId === ui.sel);
      if (note && t) note.textContent = x ? `${dates.dowMonD(x.date)} · ${resultText({ result: x.result, score: x.score })} ${x.opp}` : (t.form.some((q) => q.pre) ? 'includes preseason' : streakWords(t.streak));
    }
    if (from === 'sq' && ui.sel && !target) {
      // the twin lives in a collapsed list — open it, then scroll to it
      const g = vm.f.games.find((x) => x.id === ui.sel);
      if (g && g.date < vm.ctx.weekStart) { ui.allResults = true; redraw().then(() => scrollToSel()); }
    } else if (from === 'sq' && target) {
      target.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
  };
  const scrollToSel = () => {
    const t = el.querySelector('.r.sel');
    if (t) t.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
  };

  const draw = async (live) => {
    const focusId = live && document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset?.wt : null;
    const y = window.scrollY;
    vm = await compute();
    if (!alive) return;
    const kids = build(live).flat(4).filter(Boolean);
    el.classList.toggle('no-rise', Boolean(live));
    el.replaceChildren(...kids);
    prevRing = vm.s.ringValue;
    sig = stateSig(vm.f);
    if (live) {
      window.scrollTo(0, y);
      play(el);
      if (focusId) el.querySelector(`[data-wt="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    }
    tick();
  };

  function redraw() {
    if (!alive) return Promise.resolve();
    if (drawing) { queued = true; return drawing; }
    drawing = draw(true).catch((err) => console.warn('sports redraw failed', err)).finally(() => {
      drawing = null;
      if (queued) { queued = false; redraw(); }
    });
    return drawing;
  }

  async function refresh(force) {
    await sports.loadFeed({ force: Boolean(force) });
    redraw();
  }

  /** Countdowns tick in place; a game changing state (upcoming → live → pending) redraws the screen. */
  function tick() {
    clearTimeout(cdTimer);
    if (!alive || !vm) return;
    const now = Date.now();
    for (const n of el.querySelectorAll('[data-cd]')) {
      const start = Number(n.dataset.cd);
      if (!Number.isFinite(start)) continue;
      if (n.dataset.short) n.textContent = shortCd(start, now);
      else { const t = n.lastChild; if (t) t.textContent = countdownText(start, now); }
    }
    const fresh = vm.f.games.map((g) => sports.stateOf(g, now)[0]).join('') + vm.f.available;
    if (fresh !== sig) { sig = fresh; redraw(); return; }
    cdTimer = setTimeout(tick, 30000);
  }

  const onChange = (e) => {
    if (e && e.detail && e.detail.store === 'snapshots') return;
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(redraw, 60);
  };
  const onRefresh = () => { refresh(false); };

  await draw(false);
  store.events.addEventListener('change', onChange);
  window.addEventListener('clubhouse:refresh', onRefresh);
  window.addEventListener('online', onRefresh);
  window.addEventListener('offline', onRefresh);
  return () => {
    alive = false;
    clearTimeout(cdTimer);
    clearTimeout(redrawTimer);
    store.events.removeEventListener('change', onChange);
    window.removeEventListener('clubhouse:refresh', onRefresh);
    window.removeEventListener('online', onRefresh);
    window.removeEventListener('offline', onRefresh);
  };
}
