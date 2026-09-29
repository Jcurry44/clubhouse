// Clubhouse — the + LOG quick-log sheet (SPEC §7.6, §4.4). Options come from every pillar's
// quickLog.kinds (order: Workout, Round, Pour, Game). Built-in detail forms write the
// SPEC's record shapes straight to IDB; a pillar may instead supply kind.render(el, api) + kind.save(api).
// Workouts are NOT logged here (DECISIONS 2026-09-28): Train's kind is a 'Log in Form' hand-off (mode:'link').
//
// Kind contract (extends SPEC §2 item 5):
//   { k, label, glyph, mode:'form'|'link', sub(facts) → string,
//     href?  (link mode target), cta? (link mode CTA text), ctaGlyph?, external? (open href in a new tab),
//     explain? (link mode: string, or (facts, h) → children),
//     render?(detailEl, api), save?(api) → Promise<{ message?, undo?() }> }
//   api = { ctx, facts, allFacts, goal, form, setCta(label, small), refresh(), close() }

import * as store from '../store.js';
import * as backup from '../backup.js';
import { makeCtx, DOW, monD, dayWord, time12 } from '../dates.js';
import { h, icon, uid, mount, MINUS } from '../dom.js';
import { openSheet, closeSheet, toast, isSheetOpen } from '../ui.js';

const ORDER = ['lift', 'round', 'pour', 'game'];
// mob / run / cardio / mobility all land on the one Train hand-off ("Log in Form")
const ALIAS = { golf: 'round', cardio: 'lift', run: 'lift', mob: 'lift', mobility: 'lift', workout: 'lift', train: 'lift', bourbon: 'pour', sports: 'game', watched: 'game', 'watch': 'game' };
const SCORES = [7, 7.5, 8, 8.5, 9, 9.5];
let S = null; // open-sheet state
let pillarsMod = null;

// repair (design review): the FAB opens on the kind used last (remembered in settings 'log.lastKind'); with no history it
// opens on the first kind logged right here (Pour) — never on the Workout hand-off that leaves the app.
const NATIVE_DEFAULT = 'pour';
let lastKind = null;
const lastKindReady = (typeof indexedDB !== 'undefined' ? store.setting('log.lastKind', null) : Promise.resolve(null))
  .then((v) => { if (typeof v === 'string' && !lastKind) lastKind = v; }).catch(() => {});
function rememberKind(k) {
  if (!k || k === lastKind) return Promise.resolve();
  lastKind = k;
  return store.setSetting('log.lastKind', k).catch(() => {});
}
function defaultKind(kinds) {
  const has = (k) => k && kinds.some((x) => x.k === k);
  if (has(lastKind)) return lastKind;
  if (has(NATIVE_DEFAULT)) return NATIVE_DEFAULT;
  return (kinds.find((x) => x.mode !== 'link') || kinds[0])?.k;
}

async function loadPillars() {
  if (!pillarsMod) pillarsMod = await import('../pillars/index.js');
  return pillarsMod.pillars;
}

/* ------------------------------------------------------------------ small builders */

function pillRow(options, value, onPick, { label } = {}) {
  return h('div.row', { role: 'group', 'aria-label': label || null }, options.map(([v, text]) => h('button', {
    type: 'button', class: `pill${v === value ? ' sel' : ''}`, 'aria-pressed': v === value ? 'true' : 'false',
    onclick: () => { if (S) S.dirty = true; onPick(v); },
  }, text)));
}

/* ------------------------------------------------------------------ counting for the CTA */

function pillarOf(k) { return S.kinds.find((x) => x.k === k)?.pillar; }

function ringFor(pillar) {
  const f = S.facts[pillar.id];
  const goal = S.goals[pillar.id] ?? pillar.meta.defaultGoal;
  if (!f) return { value: 0, goal };
  try {
    const s = pillar.summary(f, goal, S.ctx);
    return { value: s.ringValue, goal: s.ringGoal };
  } catch { return { value: 0, goal }; }
}

/** 'Save · 4 of 5' / 'Save · hits your goal 5 of 5' / 'Save · goal +1' */
function saveLabel(pillar, add = 1, verb = 'Save') {
  const { value, goal } = ringFor(pillar);
  const next = value + add;
  if (add <= 0) return [verb, null];
  if (next === goal) return [`${verb} · hits your goal`, `${goal} of ${goal}`];
  if (next > goal) return [`${verb} ·`, `goal +${next - goal}`];
  return [`${verb} ·`, `${next} of ${goal}`];
}

/* ------------------------------------------------------------------ built-in forms */

const FORMS = {
  pour: {
    init: () => {
      const open = (S.facts.bourbon?.openBottles || []).slice(0, 6);
      return { pick: open[0] ? open[0].bottleId : '__other', name: '', score: null, note: '' };
    },
    render(form, redraw, refreshCta) {
      const open = (S.facts.bourbon?.openBottles || []).slice(0, 6);
      const bottleOpts = [...open.map((b) => [b.bottleId, String(b.name).split(/\s+/).slice(0, 3).join(' ')]), ['__other', open.length ? 'Other…' : 'Name it…']];
      const nameInput = h('input.field', {
        type: 'text', placeholder: 'Bottle name', value: form.name, autocomplete: 'off', autocapitalize: 'words', 'aria-label': 'Bottle name', maxlength: 80,
        oninput: (e) => { S.dirty = true; form.name = e.target.value; refreshCta(); },
      });
      const noteInput = h('input.field', {
        type: 'text', placeholder: 'Note (optional)', value: form.note, autocomplete: 'off', 'aria-label': 'Note', maxlength: 200,
        oninput: (e) => { form.note = e.target.value; },
      });
      return [
        h('p.lbl', 'Bottle'),
        pillRow(bottleOpts, form.pick, (v) => { form.pick = v; redraw(); if (v === '__other') requestAnimationFrame(() => S.el.querySelector('.detail input')?.focus()); }, { label: 'Bottle' }),
        form.pick === '__other' ? h('div.row', nameInput) : null,
        h('p.lbl', 'Score · optional'),
        pillRow(SCORES.map((s) => [s, s.toFixed(1)]), form.score, (v) => { form.score = form.score === v ? null : v; redraw(); }, { label: 'Score' }),
        h('p.lbl', 'Note'),
        h('div.row', noteInput),
      ];
    },
    save: (form) => savePour(form),
    valid: (form) => form.pick !== '__other' || form.name.trim().length > 0,
    invalidLabel: 'Name the bottle',
  },
  game: {
    init: () => {
      const f = S.facts.sports || {};
      const watched = new Set(Object.keys(f.watched || {}));
      return { on: new Set((f.weekGames || []).filter((g) => watched.has(g.id)).map((g) => g.id)), was: watched };
    },
    render(form, redraw) {
      const f = S.facts.sports || {};
      const games = (f.weekGames || []).filter((g) => g.status === 'final' || g.status === 'live' || new Date(g.startUTC) <= new Date());
      if (!games.length) {
        return [h('p.explain', f.available
          ? 'No Buffalo games have started this week yet. Come back after puck drop or kickoff.'
          : h('span', 'The schedule isn’t here yet — ', h('b', 'the sports feed fills in on its first run'), '. Games you watch will count here.'))];
      }
      return games.map((g) => {
        const on = form.on.has(g.id);
        const team = f.teams?.[g.team]?.short || g.team;
        const score = g.score ? ` · ${g.result || ''} ${g.score.us}–${g.score.them}` : '';
        return h('button', {
          type: 'button', class: `checkrow${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
          onclick: () => { if (form.on.has(g.id)) form.on.delete(g.id); else form.on.add(g.id); redraw(); },
        },
        h('span.t', `${team} ${g.home ? 'vs' : 'at'} ${g.opponent?.short || ''}`, h('small', `${dayWord(g.date, S.ctx, { short: true })} ${g.tbd ? 'TBD' : time12(g.startUTC)}${score}`)),
        h('span.check', icon('check')));
      });
    },
    delta: (form) => {
      const f = S.facts.sports || {};
      let d = 0;
      for (const g of f.weekGames || []) {
        const was = form.was.has(g.id), now = form.on.has(g.id);
        if (now && !was) d++;
        if (!now && was) d--;
      }
      return d;
    },
    save: (form) => saveGames(form),
    valid: (form) => FORMS.game.delta(form) !== 0,
    invalidLabel: 'Nothing to log',
  },
};

/* ------------------------------------------------------------------ saves */

async function savePour(form) {
  const now = new Date();
  const open = S.facts.bourbon?.openBottles || [];
  const hit = open.find((b) => b.bottleId === form.pick);
  const rec = {
    id: uid('pour'), date: makeCtx(now).today, at: now.toISOString(),
    bottleId: hit ? hit.bottleId : null, bottleName: hit ? hit.name : form.name.trim(),
    score: form.score, note: form.note.trim(), source: 'clubhouse',
  };
  await store.put('pours', rec);
  const short = rec.bottleName.split(/\s+/).slice(0, 3).join(' ');
  return { message: `Noted · ${short}${rec.score != null ? ` · ${rec.score.toFixed(1)}` : ''}`, undo: () => store.del('pours', rec.id) };
}

async function saveGames(form) {
  const f = S.facts.sports || {};
  const adds = [], removes = [];
  for (const g of f.weekGames || []) {
    const was = form.was.has(g.id), now = form.on.has(g.id);
    if (now && !was) adds.push(g);
    if (!now && was) removes.push(g);
  }
  if (removes.length) await backup.snapshot('before-unwatch'); // clearing watched games is destructive (§3.7)
  const at = new Date().toISOString();
  for (const g of adds) await store.put('watched', { gameId: g.id, date: g.date, team: g.team, watchedAt: at, where: '', note: '' });
  for (const g of removes) await store.del('watched', g.id);
  const n = adds.length;
  return {
    message: n ? `Watched · ${n} game${n === 1 ? '' : 's'}` : `Unmarked ${removes.length} game${removes.length === 1 ? '' : 's'}`,
    undo: n && !removes.length ? async () => { for (const g of adds) await store.del('watched', g.id); } : null,
  };
}

/* ------------------------------------------------------------------ render */

function currentKind() { return S.kinds.find((k) => k.k === S.sel) || S.kinds[0]; }

function drawDetail() {
  const kind = currentKind();
  const pillar = kind.pillar;
  const detail = S.el.querySelector('.detail');
  const cta = S.el.querySelector('.cta');
  const secondary = S.el.querySelector('.secondary');
  secondary.replaceChildren();

  const setCta = (label, small, { disabled = false, glyph = null } = {}) => {
    mount(cta, glyph ? icon(glyph) : null, label, small ? h('small', small) : null);
    cta.disabled = disabled;
  };

  if (kind.mode === 'link') {
    const explain = typeof kind.explain === 'function' ? kind.explain(S.facts[pillar.id], h) : kind.explain;
    mount(detail, h('p.explain', explain || h('span', 'Rounds are scored hole by hole in ', h('b', 'Fairway Ledger'), ', with its own backups. The moment you save one there, it counts here.')));
    setCta(kind.cta || `Open ${kind.label}`, null, { glyph: kind.ctaGlyph || 'golf' });
    S.run = () => {
      // an external hand-off (Form) opens in its own tab so Clubhouse stays where it was (runSave closes the sheet).
      // A real <a target=_blank> click, inside the tap: window.open(…, 'noopener') always returns null, so it cannot be checked.
      if (kind.external) {
        const a = h('a', { href: kind.href, target: '_blank', rel: 'noopener noreferrer', style: 'display:none' });
        document.body.appendChild(a);
        a.click();
        a.remove();
        return { message: null };
      }
      closeSheet(S.el, 'link');
      location.href = kind.href;
    };
    return;
  }

  if (typeof kind.render === 'function' && typeof kind.save === 'function') {
    const api = {
      ctx: S.ctx, facts: S.facts[pillar.id], allFacts: S.facts, goal: S.goals[pillar.id], form: (S.forms[kind.k] ||= {}),
      setCta: (label, small, opts) => setCta(label, small, opts), refresh: drawDetail, close: () => closeSheet(S.el, 'saved'),
    };
    detail.replaceChildren();
    kind.render(detail, api);
    if (!cta.textContent) setCta(...saveLabel(pillar));
    S.run = () => kind.save(api);
    return;
  }

  const F = FORMS[kind.k];
  if (!F) {
    mount(detail, h('p.explain', 'This one isn’t ready to log from here yet.'));
    setCta('Close', null);
    S.run = async () => ({ message: null });
    return;
  }
  const form = (S.forms[kind.k] ||= F.init());
  const refreshCta = () => {
    if (!F.valid(form)) { setCta(F.invalidLabel || 'Save', null, { disabled: true }); return; }
    const add = F.delta ? F.delta(form) : 1;
    if (kind.k === 'game' && add < 0) { setCta('Save changes', null); return; }
    setCta(...saveLabel(pillar, add));
  };
  const redraw = () => { mount(detail, F.render(form, redraw, refreshCta)); refreshCta(); };
  redraw();
  if (F.secondary) {
    secondary.appendChild(h('button', { type: 'button', onclick: () => runSave(() => F.secondary.run(form)) }, F.secondary.label, icon('chev')));
  }
  S.run = () => F.save(form);
}

async function runSave(fn) {
  const cta = S.el.querySelector('.cta');
  if (cta.classList.contains('busy')) return;
  cta.classList.add('busy');
  const kind = currentKind();
  const remembered = rememberKind(S.sel);
  // an in-app hand-off (Round → the ledger) unloads this page: let the one-row write land first. Never before an
  // external hand-off (Form): that link must open inside the tap.
  if (kind.mode === 'link' && !kind.external) await remembered;
  try {
    const res = await fn();
    await closeSheet(S.el, 'saved');
    if (res && res.message) {
      toast(res.message, res.undo ? { action: { label: 'Undo', run: () => Promise.resolve(res.undo()).then(() => toast('Undone — nothing logged.', { icon: 'restore' })) } } : {});
    }
  } catch (err) {
    console.warn('quick log failed', err);
    toast('Couldn’t save that. Nothing changed.', { tone: 'warm' });
  } finally {
    cta.classList.remove('busy');
  }
}

function selectKind(k) {
  S.sel = k;
  S.el.querySelectorAll('.opt').forEach((o) => {
    const on = o.dataset.k === k;
    o.classList.toggle('sel', on);
    o.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  drawDetail();
}

function drawSubs() {
  for (const k of S.kinds) {
    const el = S.el.querySelector(`.opt[data-k="${k.k}"] .os`);
    if (!el) continue;
    let sub = '';
    try { sub = typeof k.sub === 'function' ? k.sub(S.facts[k.pillar.id] || null) : k.sub || ''; } catch { sub = ''; }
    el.textContent = sub || ' ';
  }
}

function skeleton() {
  const ctx = S.ctx;
  mount(S.el,
    h('div.grab', { 'aria-hidden': 'true' }),
    h('div.h', h('h2', { id: 'sheet-title' }, 'Log it'), h('span', `${DOW[ctx.dayIndex]}, ${monD(ctx.today)}`)),
    h('div.grid', { role: 'group', 'aria-label': 'What to log', style: S.kinds.length % 3 ? 'grid-template-columns:repeat(2,1fr)' : null }, S.kinds.map((k) => h('button', {
      type: 'button', class: `opt${k.k === S.sel ? ' sel' : ''}`, dataset: { k: k.k }, 'aria-pressed': k.k === S.sel ? 'true' : 'false',
      onclick: () => selectKind(k.k),
    },
    h('span.tick', { 'aria-hidden': 'true' }, icon('check')),
    icon(k.glyph || k.pillar.meta.glyph),
    h('div', h('b', k.label), h('span.os', ' '))))),
    h('div.detail'),
    h('button.cta', { type: 'button', onclick: () => runSave(() => S.run()) }),
    h('div.secondary'),
  );
  S.el.setAttribute('aria-labelledby', 'sheet-title');
}

/** Open the sheet, optionally on a kind ('lift', 'mob', 'run', 'round', 'pour', 'game' or an alias). */
export async function open(kindArg) {
  const el = document.getElementById('sheet');
  const [pillars] = await Promise.all([loadPillars(), Promise.race([lastKindReady, new Promise((r) => setTimeout(r, 200))])]);
  const kinds = [];
  for (const p of pillars) for (const k of p.quickLog?.kinds || []) kinds.push({ ...k, pillar: p });
  kinds.sort((a, b) => (ORDER.indexOf(a.k) + 1 || 99) - (ORDER.indexOf(b.k) + 1 || 99));
  const want = ALIAS[kindArg] || kindArg;
  const sel = kinds.some((k) => k.k === want) ? want : defaultKind(kinds);
  if (isSheetOpen(el) && S) { selectKind(sel); return; }
  S = { el, kinds, sel, ctx: makeCtx(new Date()), facts: {}, goals: { ...store.DEFAULT_GOALS }, forms: {}, run: null };
  skeleton();
  drawSubs();
  drawDetail();
  const loading = loadData(pillars);
  openSheet(el, { focus: '.opt.sel', onClose: () => { S = null; } });
  await loading;
}

async function loadData(pillars) {
  const mine = S;
  const [goals, ...factsList] = await Promise.all([
    store.goals().catch(() => ({ ...store.DEFAULT_GOALS })),
    ...pillars.map((p) => Promise.resolve().then(() => p.facts(mine.ctx)).catch(() => ({ available: false }))),
  ]);
  if (S !== mine) return;
  S.goals = goals;
  S.facts = Object.fromEntries(pillars.map((p, i) => [p.id, factsList[i]]));
  if (!S.dirty) S.forms = {}; // re-init with real facts (next focus, open bottles, this week's games)
  drawSubs();
  drawDetail();
}

export function close() {
  const el = document.getElementById('sheet');
  return closeSheet(el, 'close');
}

export { MINUS };
