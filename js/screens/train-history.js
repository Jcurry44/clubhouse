// Train history (#/train/history) — every session in the Form export, month by month, filterable
// (All · Strength · Mobility · Cardio · PRs). Tap a session to open its sets. Read-only.
import * as store from '../store.js';
import { h, icon, play } from '../dom.js';
import { MONTHS_LONG, parseYmd } from '../dates.js';
import { loadView, prBySession } from '../train/view.js';
import { sessionRow, KIND_LABEL } from '../train/ui.js';
import { asOfText } from '../train/model.js';
import { FORM_URL } from '../train/form-import.js';

export const title = 'History';

const FILTERS = [['all', 'All'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['cardio', 'Cardio'], ['pr', 'PRs']];
const enc = encodeURIComponent;

/** 'Barbell bench press' → '160×5 · 160×5 · 160×5' groups, per exercise. */
function setsDetail(s) {
  const by = new Map();
  for (const set of s.sets || []) {
    if (!by.has(set.exerciseId)) by.set(set.exerciseId, { name: set.exercise, sets: [] });
    by.get(set.exerciseId).sets.push(set);
  }
  if (!by.size) return h('div.tr-detail', h('p.none', s.kind === 'mobility' ? 'A guided flow — no sets to list.' : 'No sets were logged in this session.'));
  return h('div.tr-detail', [...by].map(([id, e]) => h('a.ex', { href: `#/train/exercise/${enc(id)}` },
    h('span.en', e.name),
    h('span.es', e.sets.map((x) => (x.weight ? `${x.weight}×${x.reps}` : `${x.reps}${x.lift === false && x.weight == null ? ' reps' : ''}`)).join(' · ')),
    icon('chev'))));
}

export async function mount(el) {
  let alive = true;
  let filter = 'all';
  const open = new Set();

  const draw = async (live = true) => {
    const vm = await loadView();
    if (!alive) return;
    const { f } = vm;
    const prs = prBySession(f);
    const all = f.sessions.slice().reverse();
    const counts = {
      all: all.length,
      strength: all.filter((s) => s.kind === 'strength').length,
      mobility: all.filter((s) => s.kind === 'mobility').length,
      cardio: all.filter((s) => s.kind === 'cardio').length,
      pr: all.filter((s) => prs.has(s.id)).length,
    };
    const shown = all.filter((s) => filter === 'all' || (filter === 'pr' ? prs.has(s.id) : s.kind === filter));
    const first = f.sessions[0];
    const eyebrow = f.available && first ? `${f.totalWorkouts} sessions since ${MONTHS_LONG[parseYmd(first.date).getMonth()].slice(0, 3)} ${parseYmd(first.date).getFullYear()} · ${asOfText(f)}` : 'Nothing imported yet';

    const groups = [];
    for (const s of shown) {
      const d = parseYmd(s.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) { g = { key, label: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`, rows: [] }; groups.push(g); }
      g.rows.push(s);
    }

    const rowFor = (s) => {
      const isOpen = open.has(s.id);
      const row = sessionRow(s, prs.get(s.id) || [], {
        sel: isOpen,
        onclick: () => { if (open.has(s.id)) open.delete(s.id); else open.add(s.id); draw(true); },
      });
      row.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      return isOpen ? h('div.tr-open', row, setsDetail(s)) : row;
    };

    const body = !f.available
      ? h('section.card.tr-quiet.rise', h('p', 'Import your Form export on the Train tab and every session lands here.'), h('a.pill.volt', { href: '#/train' }, icon('import'), 'Go to Train'))
      : shown.length
        ? groups.map((g) => [h('div.section-h.rise', h('h2', g.label), h('span.meta', `${g.rows.length} ${g.rows.length === 1 ? 'session' : 'sessions'}`)), h('section.card.rounds.rise', g.rows.map(rowFor))])
        : h('section.card.tr-quiet.rise', h('p', filter === 'pr' ? 'No PRs yet — a PR needs an earlier logged best to beat.' : `No ${KIND_LABEL[filter] ? KIND_LABEL[filter].toLowerCase() : ''} sessions in this export.`));

    const kids = [
      h('header.rise',
        h('div.subtop', h('a.back', { href: '#/train' }, icon('chevl'), 'Train'), h('a.action', { href: FORM_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('share'), 'Open Form')),
        h('h1.title', icon('train'), 'History'),
        h('div.eyebrow', { style: 'margin-top:6px' }, eyebrow)),
      f.available ? h('div.tr-filter.rise', { role: 'group', 'aria-label': 'Filter sessions' }, FILTERS.map(([k, label]) => h('button', {
        type: 'button', class: `pill${k === filter ? ' sel' : ''}`, 'aria-pressed': k === filter ? 'true' : 'false',
        onclick: () => { filter = k; draw(true); },
      }, label, h('span.n', String(counts[k]))))) : null,
      body,
    ];
    el.classList.toggle('no-rise', Boolean(live));
    el.replaceChildren(...kids.flat(3).filter(Boolean));
    if (live) play(el);
  };

  let t = null;
  const onChange = (e) => { if (e && e.detail && e.detail.store === 'snapshots') return; clearTimeout(t); t = setTimeout(() => draw(true), 60); };
  await draw(false);
  store.events.addEventListener('change', onChange);
  window.addEventListener('clubhouse:refresh', onChange);
  return () => { alive = false; clearTimeout(t); store.events.removeEventListener('change', onChange); window.removeEventListener('clubhouse:refresh', onChange); };
}
