// Settings (#/settings) — SPEC §7.8: goals, name, teams, backups, storage, version, reset goals.
import * as store from '../store.js';
import * as backup from '../backup.js';
import { h, icon, mount as fill, fmt } from '../dom.js';
import { ago } from '../dates.js';
import { toast, confirm } from '../ui.js';
import { CACHE_VERSION } from '../version.js';
import { trainSection, loadTrainSettings } from '../train/settings-section.js';

export const title = 'Settings';

const GOALS = [
  { id: 'golf', label: 'Golf', glyph: 'golf', one: 'round', many: 'rounds' },
  { id: 'train', label: 'Train', glyph: 'train', one: 'workout', many: 'workouts' },
  { id: 'bourbon', label: 'Bourbon', glyph: 'bourbon', one: 'pour noted', many: 'pours noted' },
  { id: 'sports', label: 'Sports', glyph: 'sports', one: 'game caught', many: 'games caught' },
];
const TEAMS = [
  { id: 'bills', label: 'Bills', sub: 'NFL' },
  { id: 'sabres', label: 'Sabres', sub: 'NHL' },
  { id: 'bisons', label: 'Bisons', sub: 'Triple-A baseball' },
];
const DEFAULT_TEAMS = ['bills', 'sabres', 'bisons'];

async function storageInfo() {
  const out = { persisted: null, usageMB: null };
  try { if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.usageMB = e.usage != null ? e.usage / 1048576 : null;
    }
  } catch { /* ignore */ }
  return out;
}

/**
 * repair (QA minor): Fairway Ledger, Barrel Proof and Clubhouse's restore share ONE localStorage (~5 MB per origin in
 * Safari and Chromium). The ledger's rolling snapshots fill whatever is free, so a big write can fail. Counted in
 * characters (keys + values) — ASCII JSON is ~1 byte each; the quota is an estimate and the row says so ("about").
 */
export const LS_QUOTA = 5 * 1024 * 1024;
export const LS_WARN = 0.8;
export function lsUsage(storage = globalThis.localStorage) {
  try {
    const out = { total: 0, ledger: 0, ledgerSnaps: 0, cabinet: 0 };
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i) || '';
      const n = k.length + (storage.getItem(k) || '').length;
      out.total += n;
      if (k.startsWith('fairwayLedger.snapshot')) out.ledgerSnaps += n;
      else if (k.startsWith('fairwayLedger')) out.ledger += n;
      else if (k.startsWith('barrel-proof')) out.cabinet += n;
    }
    out.pct = out.total / LS_QUOTA;
    return out;
  } catch { return null; }
}
const mb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) : n >= 10486 ? (n / 1048576).toFixed(2) : '0');

function lsRow(u) {
  if (!u) return null;
  const full = u.pct >= LS_WARN;
  const pct = `${Math.min(100, Math.round(u.pct * 100))}%`;
  const parts = `ledger ${mb(u.ledger)} · its snapshots ${mb(u.ledgerSnaps)} · cabinet ${mb(u.cabinet)} MB`;
  return h('div.li', { dataset: { ls: full ? 'full' : 'ok' } },
    h('div', { class: `lg${full ? ' warm' : ''}` }, icon(full ? 'warn' : 'phone')),
    h('div.t', full ? 'Shared app space: nearly full' : 'Shared app space',
      h('small', full
        ? (u.ledgerSnaps >= u.total * 0.25
          ? `${mb(u.total)} of about 5 MB, ${mb(u.ledgerSnaps)} of it the ledger’s own snapshots. Back up, then delete old ones in Fairway Ledger → Profile so saves keep fitting.`
          : `${mb(u.total)} of about 5 MB · ${parts}. Back up first — a big save could fail when it’s full.`)
        : `${mb(u.total)} of about 5 MB · ${parts}`)),
    h('div.end', full ? h('span.warn', pct) : pct),
  );
}

function goalRow(g, value, onSet) {
  const small = h('small', `${value === 1 ? g.one : g.many} a week`);
  const out = h('output', { 'aria-live': 'polite' }, String(value));
  let v = value;
  const minus = h('button', { type: 'button', 'aria-label': `Lower ${g.label} goal` }, icon('minus'));
  const plus = h('button', { type: 'button', 'aria-label': `Raise ${g.label} goal` }, icon('plus'));
  const set = (nv) => {
    v = Math.max(store.GOAL_RANGE.min, Math.min(store.GOAL_RANGE.max, nv));
    out.textContent = String(v);
    small.textContent = `${v === 1 ? g.one : g.many} a week`;
    minus.disabled = v <= store.GOAL_RANGE.min;
    plus.disabled = v >= store.GOAL_RANGE.max;
    onSet(v);
  };
  minus.addEventListener('click', () => set(v - 1));
  plus.addEventListener('click', () => set(v + 1));
  minus.disabled = v <= store.GOAL_RANGE.min;
  plus.disabled = v >= store.GOAL_RANGE.max;
  return h('div.goal-row',
    h('div.lg', icon(g.glyph)),
    h('div.t', g.label, small),
    h('div.stepper', minus, out, plus),
  );
}

export async function mount(el) {
  let alive = true;
  const timers = {};
  const pending = {};
  const saveGoal = (id, v) => {
    clearTimeout(timers[id]);
    pending[id] = v;
    timers[id] = setTimeout(() => { delete pending[id]; store.setSetting(`goal.${id}`, v); }, 250);
  };

  async function draw() {
    const [goals, map, snaps, info, trainMeta] = await Promise.all([store.goals(), store.settingsMap(), backup.listSnapshots(), storageInfo(), loadTrainSettings()]);
    if (!alive) return;
    const name = map['profile.name'] || 'Joe';
    const teams = Array.isArray(map['sports.teams']) ? map['sports.teams'] : DEFAULT_TEAMS;
    const last = map['backup.lastExportAt'];
    const persisted = info.persisted ?? map['storage.persisted'] ?? null;
    // golf-bourbon lane: the clearly-labelled dev toggle that seeds sample golf + bourbon data (never automatic)
    const devRow = await import('../sample.js').then((m) => m.settingsRow({ h, icon, toast, confirm, snapshot: backup.snapshot, onChange: draw })).catch(() => null);
    if (!alive) return;

    const nameInput = h('input.field', {
      id: 'set-name', type: 'text', value: name, autocomplete: 'given-name', autocapitalize: 'words', maxlength: 24, enterkeyhint: 'done',
      onchange: async (e) => {
        const v = e.target.value.trim() || 'Joe';
        e.target.value = v;
        await store.setSetting('profile.name', v);
        toast(`Hi, ${v}.`, { icon: 'user' });
      },
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    });

    const teamRow = (t) => {
      const on = teams.includes(t.id);
      return h('button', {
        type: 'button', class: `li${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
        onclick: async () => {
          const next = on ? teams.filter((x) => x !== t.id) : [...teams, t.id];
          if (!next.length) { toast('Keep at least one team.', { tone: 'warm' }); return; }
          await store.setSetting('sports.teams', DEFAULT_TEAMS.filter((x) => next.includes(x)));
          draw();
        },
      },
      h('div.lg', icon('sports')),
      h('div.t', t.label, h('small', t.sub)),
      h('div.end', h('span', { class: `check${on ? ' on' : ''}` }, icon('check'))));
    };

    fill(el,
      h('header.rise',
        h('div.subtop', h('a.back', { href: '#/' }, icon('chevl'), 'Home'), h('span')),
        h('h1.title', icon('settings'), 'Settings'),
        h('div.eyebrow', { style: 'margin-top:6px' }, 'Goals, backups, this phone'),
      ),
      h('div.section-h.rise', h('h2', 'Weekly goals'), h('span.meta', 'Rings fill at these')),
      h('section.card.list.rise', GOALS.map((g) => goalRow(g, goals[g.id], (v) => saveGoal(g.id, v)))),

      h('div.section-h.rise', h('h2', 'Backups')),
      h('section.card.list.rise',
        h('a.li', { href: '#/backup' },
          h('div', { class: `lg ${last && Date.now() - new Date(last) <= backup.NUDGE_DAYS * 864e5 ? 'good' : 'warm'}` }, icon(last ? 'shield' : 'warn')),
          h('div.t', 'Back up and restore', h('small', `${last ? `Last backup ${ago(last)}` : 'Never backed up'} · ${snaps.length} ${snaps.length === 1 ? 'snapshot' : 'snapshots'}`)),
          h('div.end', icon('chev', 'chev')),
        ),
        h('div.li',
          h('div', { class: `lg ${persisted ? 'good' : ''}` }, icon('phone')),
          h('div.t', persisted ? 'Storage: persistent' : 'Storage: not guaranteed',
            h('small', `${info.usageMB != null ? `${info.usageMB.toFixed(1)} MB used` : 'Usage unknown'}${persisted ? ' · the phone won’t clear it' : ' · open from the home-screen icon'}`)),
          h('div.end', persisted ? h('span.check.on', icon('check')) : null),
        ),
        lsRow(lsUsage()), // repair: the ledger + cabinet share ~5 MB of localStorage; warn at 80 %
      ),

      trainSection(trainMeta), // Train lane: Form export file + a disabled "Connect live" row

      h('div.section-h.rise', h('h2', 'Teams'), h('span.meta', 'Sports ring + schedule')),
      h('section.card.list.rise', TEAMS.map(teamRow)),

      h('div.section-h.rise', h('h2', 'You')),
      h('section.card.name-row.rise', h('label', { for: 'set-name' }, 'Name on the greeting'), nameInput),

      devRow ? [h('div.section-h.rise', h('h2', 'Developer'), h('span.meta', 'Testing aid · never automatic')), devRow] : null, // golf-bourbon lane

      h('section.card.about.rise',
        h('div', h('b', 'Clubhouse'), ' · ', h('code', CACHE_VERSION)),
        h('div', { style: 'margin-top:6px' }, 'Everything lives on this phone — no accounts, no servers. Back up weekly; a snapshot is taken automatically before anything destructive.'),
      ),
      h('button.cta.ghost.sm.rise', {
        type: 'button',
        onclick: async () => {
          const ok = await confirm({
            title: 'Reset goals?',
            sub: 'Golf 2, Train 5, Bourbon 3, Sports 3 a week.',
            note: 'A snapshot of everything you have now is saved first — undo from Backups.',
            verb: 'Reset goals',
          });
          if (!ok) return;
          try {
            await backup.snapshot('before-reset-goals');
          } catch { toast('Couldn’t snapshot — nothing changed.', { tone: 'warm' }); return; }
          for (const [p, v] of Object.entries(store.DEFAULT_GOALS)) await store.setSetting(`goal.${p}`, v);
          toast('Goals reset', { icon: 'restore' });
          draw();
        },
      }, 'Reset goals'),
    );
  }

  await draw();
  el.classList.add('no-rise'); // later redraws update in place; the entrance plays once per visit
  return () => {
    alive = false;
    for (const t of Object.values(timers)) clearTimeout(t);
    // flush pending goal writes immediately so leaving the screen never loses a change
    for (const [id, v] of Object.entries(pending)) store.setSetting(`goal.${id}`, v).catch(() => {});
  };
}

export { fmt };
