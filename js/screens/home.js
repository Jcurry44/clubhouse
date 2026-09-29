// Home — SPEC §2.4 render order, the Direction B mock (design/directions/b-performance-rings/index.html) is the look.
// header (eyebrow · streak pill · greeting) → Get set up (first run) → rings → week strip (tap a day: what happened)
// → COACH → NEXT UP → STREAKS → LAST WEEK / THIS WEEK recap.
// Re-renders in place on store changes / clubhouse:refresh, animating rings from their previous values.
import * as store from '../store.js';
import * as backup from '../backup.js';
import * as coach from '../coach.js';
import { buildHome } from '../pillars/home.js';
import { byId } from '../pillars/index.js';
import { h, icon, rich, ring, spark, dots7, play, fitText } from '../dom.js';
import { eyebrow, DOW, DOW_LONG, monD } from '../dates.js';
import { toast } from '../ui.js';

export const title = 'Home';

const EXTERNAL = /^https?:\/\//i;

/* ------------------------------------------------------------------ pieces */

function noteEl(s) {
  if (s.empty) {
    const label = s.empty.cta ? s.empty.cta.label : s.empty.title;
    return h('div.note.go', h('span', label), icon('chev'));
  }
  if (!s.note) return h('div.note', { 'aria-hidden': 'true' }, ' ');
  const cls = s.note.tone === 'good' ? 'note up' : s.note.tone === 'warm' ? 'note warm' : 'note';
  const span = h('span', s.note.text);
  // repair: the tile is one line; try shorter wordings so the number is never what the ellipsis eats
  if (Array.isArray(s.note.fit) && s.note.fit.length) fitText(span, s.note.fit);
  return h('div', { class: cls }, s.note.icon ? icon(s.note.icon) : null, span);
}

function ringTile(s, prev) {
  const meta = byId[s.pillar]?.meta || { glyph: s.pillar, label: s.label };
  const from = prev && prev[s.pillar] != null ? prev[s.pillar] : 0;
  const note = s.empty ? (s.empty.cta ? s.empty.cta.label : s.empty.title) : s.note ? s.note.text : '';
  const r = ring({ value: s.ringValue, goal: s.ringGoal, empty: Boolean(s.empty), from, label: `${s.label}: ${s.ringValue} ${s.sublabel}` });
  if (prev) r.classList.add('live');
  return h('a.card.press.ring-tile', { href: s.href, dataset: { pillar: s.pillar }, 'aria-label': `${s.label}, ${s.ringValue} ${s.sublabel}${note ? `. ${note}` : ''}` },
    r,
    h('div.glyph', icon(meta.glyph)),
    h('div.pillar', s.label),
    h('div.goal', s.sublabel),
    noteEl(s),
  );
}

function weekStrip(week, ui, onPick) {
  const sel = ui.day;
  const days = week.map((d, i) => {
    const cls = ['day', d.hit && 'hit', d.today && 'today', d.future && 'future', sel === i && 'sel'].filter(Boolean).join(' ');
    const inner = [h('span.d', d.hit ? icon('check', null, 12) : String(d.dayNum)), d.label];
    const label = `${DOW_LONG[i]} ${monD(d.date)}${d.hit ? `, ${d.items.length || 1} logged` : ', nothing logged'}${d.today ? ', today' : ''}`;
    if (d.future) return h('div', { class: cls, 'aria-label': `${DOW_LONG[i]} ${monD(d.date)}, coming up` }, ...inner);
    return h('button', { type: 'button', class: cls, 'aria-label': label, 'aria-pressed': sel === i ? 'true' : 'false', onclick: () => onPick(i) }, ...inner);
  });
  let detail = null;
  if (sel != null && week[sel] && !week[sel].future) {
    const d = week[sel];
    detail = h('div.day-detail', { role: 'status' },
      h('div.dh', `${d.today ? 'Today' : DOW_LONG[sel]} · ${monD(d.date)}`),
      d.items.length
        ? h('div.items', d.items.map((it) => h('a.item', { href: it.href }, icon(it.glyph), h('span', it.text))))
        : h('div.none', 'Nothing logged.'),
    );
  }
  return h('section.week-wrap.rise', { 'aria-label': 'Days with activity this week' }, h('div.week-strip', days), detail);
}

function kicker(text, fresh) {
  const i = text.indexOf(' · ');
  const tag = fresh ? h('span.new', 'New') : null;
  return i < 0 ? h('div.kicker', text, tag) : h('div.kicker', text.slice(0, i + 3), h('b', text.slice(i + 3)), tag);
}

function vizEl(v) {
  if (!v) return null;
  if (v.type === 'spark') return h('div.viz', spark(v.values, { invert: v.invert }), h('span.cap', v.cap || 'Last 10'));
  if (v.type === 'dots7') return h('div.viz', dots7(v.on, v.todayIndex), v.cap ? h('span.cap', v.cap) : null);
  if (v.type === 'bottles') return h('div.viz', h('div.bottles', { 'aria-hidden': 'true' }, (v.levels || []).map((l) => h('i', { class: l.wait ? 'wait' : null, style: `--lvl:${l.pct}%` }))), h('span.cap', 'Fill'));
  if (v.type === 'delta') return h('div.viz', h('span', { class: `delta ${v.tone || ''}`.trim() }, v.icon ? icon(v.icon) : null, v.value));
  return null;
}

function glyphOf(ins) {
  if (ins.glyph) return ins.glyph;
  if (ins.pillar === 'system') return 'shield';
  return byId[ins.pillar]?.meta.glyph || ins.pillar;
}

function insightCard(ins, act) {
  const glyphCls = ins.tone === 'good' ? 'glyph good' : ins.tone === 'warm' ? 'glyph warm' : 'glyph';
  const viz = vizEl(ins.viz);
  const body = h('div.body', kicker(ins.kicker, ins.fresh), h('h3', rich(ins.headline)), ins.sub ? h('div.sub', ins.sub) : null);
  const cls = `card insight rise${viz ? '' : ' no-viz'}`;
  const data = { rule: ins.id, pillar: ins.pillar };
  if (ins.actions && ins.actions.length) {
    body.appendChild(h('div.actions', ins.actions.map((a, i) => h('button', {
      type: 'button', class: i === 0 ? 'pill volt' : 'pill', onclick: (e) => act(a, ins, e.currentTarget),
    }, i === 0 && a.run === 'backup.export' ? icon('share') : i === 0 && a.run === 'sports.watched' ? icon('check') : null, a.label))));
    return h('div', { class: cls, dataset: data }, h('div', { class: glyphCls }, icon(glyphOf(ins))), body, viz);
  }
  const ext = EXTERNAL.test(ins.href || '');
  return h('a', {
    class: `${cls} press`, href: ins.href || '#/', dataset: { ...data, tap: ins.tap || null },
    target: ext ? '_blank' : null, rel: ext ? 'noopener' : null,
  }, h('div', { class: glyphCls }, icon(glyphOf(ins))), body, viz);
}

function coachSection(vm, act) {
  const list = vm.insights;
  if (!list.length && !vm.setup.show) {
    return [
      h('div.section-h.rise', h('h2', 'Coach'), h('span.meta', 'Plain-English read')),
      h('div.card.coach-quiet.rise', icon('check'), h('span', 'All quiet — nothing worth a card right now.')),
    ];
  }
  if (!list.length) {
    return [
      h('div.section-h.rise', h('h2', 'Coach'), h('span.meta', 'Plain-English read')),
      h('div.card.coach-quiet.rise', icon('bolt'), h('span', 'The Coach starts talking once your first file is in — every card shows its numbers and taps through to where they came from.')),
    ];
  }
  return [
    h('div.section-h.rise', h('h2', 'Coach'), h('span.meta', 'Plain-English read')),
    list.map((i) => insightCard(i, act)),
  ];
}

function stepAction(a, s, on) {
  const cls = a.primary ? 'cta sm' : 'pill quiet';
  const glyph = a.kind === 'form' ? 'import' : a.kind === 'keep' ? 'check' : a.kind === 'ext' ? 'share' : 'chev';
  const kids = [a.kind === 'form' || a.kind === 'keep' ? icon(glyph) : null, h('span', a.label), a.kind === 'link' || a.kind === 'ext' ? icon(glyph) : null];
  if (a.kind === 'form') return h('button', { type: 'button', class: cls, dataset: { act: 'form' }, onclick: on.pickForm }, ...kids);
  if (a.kind === 'keep') return h('button', { type: 'button', class: cls, dataset: { act: 'keep' }, onclick: on.keepGoals }, ...kids);
  if (a.kind === 'ext') return h('a', { class: cls, href: a.href, target: '_blank', rel: 'noopener', dataset: { act: 'ext' } }, ...kids);
  return h('a', {
    class: cls, href: a.href, dataset: { act: 'link' },
    onclick: (e) => on.link(e, a, s),
  }, ...kids);
}

function setupCard(setup, ui, on) {
  return h('section.card.setup.home-setup.rise', { 'aria-label': 'Get set up' },
    h('div.head',
      h('h2', 'Get set up', h('span.n', `${setup.done} of ${setup.total}`)),
      h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Hide the setup card', onclick: on.dismiss }, icon('x')),
    ),
    h('div.segs', { 'aria-hidden': 'true' }, setup.steps.map((s) => h('i', { class: s.done ? 'on' : null }))),
    setup.steps.map((s) => {
      const open = ui.open === s.id;
      return h('div', { class: `step${s.done ? ' done' : ''}${open ? ' open' : ''}`, dataset: { step: s.id } },
        h('button.step-h', {
          type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': `setup-${s.id}`,
          onclick: () => on.toggle(s.id),
        },
          h('span.d', s.done ? icon('check', null, 12) : String(s.n)),
          h('span.t', s.title, s.done ? h('span.sr-only', ' — done') : null, h('small', s.sub)),
          icon('chev', 'go'),
        ),
        open ? h('div.step-b', { id: `setup-${s.id}` },
          h('ol.how', s.how.map((x, i) => h('li', h('span.k', String(i + 1)), h('span', rich(x))))),
          h('div.btns', s.actions.map((a) => stepAction(a, s, on))),
          s.note ? h('p.fine', s.note) : null,
        ) : null,
      );
    }),
  );
}

/** repair: the mock's name slot is one line — "Blue Jackets" falls back to "Jackets" when it would wrap. */
function teamName(name) {
  const el = h('div.name', name);
  const words = String(name || '').split(/\s+/).filter(Boolean);
  if (words.length > 1) fitText(el, [name, words[words.length - 1]]);
  return el;
}

function nextUpCard(n) {
  if (!n) return [];
  return [
    h('div.section-h.rise', h('h2', 'Next up'), h('a.meta', { href: '#/sports' }, 'Schedule', icon('chev'))),
    h('a.card.press.game.rise', { href: '#/sports', dataset: { game: n.game?.id } },
      h('div.row',
        h('div.team.away', h('div', { class: `badge${n.away.buf ? ' buf' : ''}` }, n.away.abbr), h('div', teamName(n.away.name), h('div.rec', n.away.rec))),
        h('div.when', h('b', n.when.time), h('span', n.when.day)),
        h('div.team.home', h('div', teamName(n.home.name), h('div.rec', n.home.rec)), h('div', { class: `badge${n.home.buf ? ' buf' : ''}` }, n.home.abbr)),
      ),
      h('div.foot', h('span', n.venue, n.tv ? [n.venue ? ' · ' : '', h('b', n.tv)] : null), n.line ? h('span.tag', h('i'), n.line) : null),
      n.next2 ? h('div.next2', h('span', n.next2.team ? [h('b', n.next2.team), ` ${n.next2.rest}`] : n.next2.text), h('span', n.next2.when)) : null,
    ),
  ];
}

function streakChips(chips) {
  if (!chips.length) return [];
  return [
    h('div.section-h.rise', h('h2', 'Streaks')),
    h('div.chips.rise', chips.map((c) => h('a', { class: `chip${c.tone === 'warm' ? ' warm' : ''}`, href: c.href, dataset: { chip: c.id } }, icon(c.glyph), h('b', String(c.n)), ` ${c.label}`))),
  ];
}

function recapCard(r) {
  return [
    h('div.section-h.rise', h('h2', r.label), h('span.meta', r.range)),
    h('section.card.recap.rise', { id: 'recap', dataset: { week: r.weekStart } },
      h('p.line', h('strong', r.headline), ` ${r.line}`),
      h('div.grid', r.stats.map((s) => h('a.stat', { href: s.href, dataset: { stat: s.id } },
        h('div.k', s.k),
        h('div.v', String(s.v), s.g != null ? h('small', `/${s.g}`) : null),
        h('div.bar', { dataset: { w: s.w } }),
        h('div', { class: `cmp${s.cmp.good ? ' good' : ''}` }, s.cmp.icon ? icon(s.cmp.icon) : null, h('span', s.cmp.text)),
      ))),
    ),
  ];
}

/* ------------------------------------------------------------------ screen */

export async function mount(el) {
  let prev = null;
  let alive = true;
  let drawing = null;
  let queued = false;
  let vm = null;
  const ui = { open: undefined, day: null };

  const fileInput = h('input.file-input', { type: 'file', accept: 'application/json,.json', tabindex: '-1', 'aria-hidden': 'true' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { importFromFile } = await import('../train/import-flow.js');
      await importFromFile(file);
    } catch (err) {
      console.warn('form import failed', err);
      toast('Couldn’t import that file. Nothing changed.', { tone: 'warm' });
    }
  });

  const act = async (a, ins, btn) => {
    if (a.run === 'backup.export') {
      backup.exportNow().then((res) => toast(res.message, { tone: res.ok ? 'good' : 'warm', icon: res.ok ? 'check' : res.cancelled ? 'x' : 'warn' }))
        .catch(() => toast('Couldn’t build the backup. Nothing changed.', { tone: 'warm' }));
    } else if (a.run === 'backup.snooze') {
      backup.snooze().then(() => toast('Okay — reminding you in two days.', { icon: 'clock' }));
    } else if (a.run === 'sports.watched' || a.run === 'sports.missed') {
      const sports = byId.sports;
      const game = (vm?.facts.sports?.games || []).find((g) => g.id === a.arg);
      if (btn) btn.disabled = true;
      try {
        if (a.run === 'sports.watched' && game) {
          await sports.markWatched(game);
          const lastWeek = Boolean(vm) && game.date < vm.ctx.weekStart;
          toast(lastWeek ? 'Marked watched — it counts in last week’s recap.' : 'Marked watched — it counts on the Sports ring.', {
            icon: 'check',
            action: { label: 'Undo', run: async () => { await sports.unmarkWatched(game.id); toast('Undone.', { icon: 'restore' }); } },
          });
        } else if (a.run === 'sports.missed') {
          await sports.dismissGame(a.arg);
          toast('Okay — won’t ask about that one.', {
            icon: 'x',
            action: { label: 'Undo', run: async () => { await store.setSetting(`sports.dismissed.${a.arg}`, false); } },
          });
        }
      } catch (err) {
        console.warn(err);
        toast('Couldn’t save that. Try again.', { tone: 'warm' });
        if (btn) btn.disabled = false;
      }
    }
  };

  const setupOn = {
    toggle: (id) => { ui.open = ui.open === id ? null : id; paint(); },
    dismiss: async () => {
      await store.setSetting('onboarding.dismissed', true);
      toast('Setup hidden — each tab still shows how to bring its data in.', {
        icon: 'x', action: { label: 'Undo', run: () => store.setSetting('onboarding.dismissed', false) },
      });
    },
    pickForm: () => fileInput.click(),
    keepGoals: async () => {
      await store.setSetting('onboarding.goals', new Date().toISOString());
      toast('Goals set. Change them any time in Settings.', { icon: 'check' });
    },
    link: async (e, a, s) => {
      if (a.mark) store.setSetting('onboarding.goals', new Date().toISOString()).catch(() => {});
      if (!a.snapshot) return; // plain navigation
      // Barrel Proof's Restore replaces its whole state without asking — snapshot Clubhouse (incl. Barrel Proof) first
      e.preventDefault();
      try {
        await backup.snapshot('before-barrel-proof-restore');
      } catch (err) {
        console.warn(err);
        toast('Couldn’t take a snapshot first — nothing opened. Try again.', { tone: 'warm' });
        return;
      }
      location.href = a.href;
    },
  };

  const pickDay = (i) => { ui.day = ui.day === i ? null : i; paint(); };

  /** Build the DOM from the current view-model (no data reads). */
  function paint(live = true) {
    if (!vm || !alive) return;
    const setup = vm.setup;
    if (ui.open === undefined) ui.open = setup.open; // first paint: the first unfinished step is open
    const pill = vm.pill;
    const kids = [
      h('header.top.rise',
        h('div.row1',
          h('div.eyebrow', eyebrow(vm.ctx)),
          h('div.side',
            pill ? h('a.streak-pill', { href: pill.href, 'aria-label': `${pill.n}-week streak: ${pill.n} ${pill.label}` }, icon(pill.glyph), h('b', String(pill.n)), ' wk streak') : null,
            h('a.icon-btn', { href: '#/settings', 'aria-label': 'Settings and backups' }, icon('settings')),
          ),
        ),
        h('h1.greet', `${vm.greeting.hello} `, h('em', vm.greeting.tail)),
      ),
      setup.show ? setupCard(setup, ui, setupOn) : null,
      h('section.rings.rise', { 'aria-label': 'This week' }, vm.rings.map((s) => ringTile(s, live ? prev : null))),
      weekStrip(vm.week, ui, pickDay),
      coachSection(vm, act),
      nextUpCard(vm.nextUp),
      streakChips(vm.streaks),
      vm.lastWeek ? recapCard(vm.lastWeek) : null,
      fileInput,
    ].flat(3).filter(Boolean);
    const y = window.scrollY;
    // keep the recap card still if it is on screen (a Coach card above it may appear or retire)
    const anchor = live ? el.querySelector('#recap') : null;
    const aTop = anchor ? anchor.getBoundingClientRect().top : null;
    const anchored = Boolean(anchor) && aTop < window.innerHeight && anchor.getBoundingClientRect().bottom > 0;
    el.classList.toggle('no-rise', Boolean(live));
    el.replaceChildren(...kids);
    if (live) {
      const now = anchored ? el.querySelector('#recap') : null;
      window.scrollTo(0, now ? y + (now.getBoundingClientRect().top - aTop) : y);
    }
    const eb = el.querySelector('.top .eyebrow');
    const long = eyebrow(vm.ctx);
    if (eb) fitText(eb, [long, long.replace(/^\w+/, DOW[vm.ctx.dayIndex]), long.replace(/^\w+ · /, '')]);
    prev = Object.fromEntries(vm.rings.map((r) => [r.pillar, r.ringValue]));
    if (live) play(el);
  }

  const draw = async (live) => {
    const next = await buildHome();
    if (!alive) return;
    const wasDone = vm ? new Set(vm.setup.steps.filter((s) => s.done).map((s) => s.id)) : null;
    vm = next;
    // a step that just got done (an import landed, goals kept) hands the card to the next unfinished step
    if (wasDone && ui.open && !wasDone.has(ui.open) && vm.setup.steps.some((s) => s.id === ui.open && s.done)) ui.open = vm.setup.open;
    paint(live);
    if (vm.insights.some((i) => i.id === 'X1')) backup.prepare().catch(() => {});
    // novelty memory: what Home showed today (only written when something new appeared)
    const { map, changed } = coach.remember(vm.seen, vm.insights, vm.ctx.today);
    if (changed) store.setSetting('coach.seen', map).catch(() => {});
  };

  const redraw = () => {
    if (!alive) return;
    if (drawing) { queued = true; return; }
    drawing = draw(true).catch((err) => console.warn('home redraw failed', err)).finally(() => {
      drawing = null;
      if (queued) { queued = false; redraw(); }
    });
  };
  let t = null;
  const QUIET = new Set(['coach.seen']);
  const onChange = (e) => {
    const d = e && e.detail;
    if (d && d.store === 'snapshots') return;
    if (d && d.store === 'settings' && QUIET.has(d.key)) return;
    clearTimeout(t);
    t = setTimeout(redraw, 60);
  };

  // X2 "your recap is in" → scroll to the recap, mark it seen
  const onTap = (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[data-tap="recap"]') : null;
    if (!a) return;
    e.preventDefault();
    const card = el.querySelector('#recap');
    if (card) card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    // mark it seen once the scroll has landed (the redraw that retires the card keeps the recap where it is)
    const ws = vm && vm.lastWeek ? vm.lastWeek.weekStart : null;
    if (ws) setTimeout(() => { if (alive) store.setSetting('home.lastRecapSeen', ws).catch(() => {}); }, 900);
  };
  el.addEventListener('click', onTap);

  await draw(false);
  store.events.addEventListener('change', onChange);
  window.addEventListener('clubhouse:refresh', onChange);
  return () => {
    alive = false;
    clearTimeout(t);
    el.removeEventListener('click', onTap);
    store.events.removeEventListener('change', onChange);
    window.removeEventListener('clubhouse:refresh', onChange);
  };
}
