// Bourbon (#/bourbon) — SPEC §7.7. Direction B.
// Hero (pours noted this week ring + best this month + last pour) → on the shelf (open bottles, days since the
// last pour, the waiting one hatched and worded) → recent pours (Barrel Proof + Clubhouse quick pours) → finished
// bottles (rebuy calls) → Tasting Night → Coach (bourbon rules, uncapped) → Open Barrel Proof.
// Reads Barrel Proof's own storage (vendored app, same scope) + the Clubhouse `pours` store; never writes either.
import * as store from '../store.js';
import * as bourbon from '../pillars/bourbon.js';
import { h, icon, ring, mount as fill, fmt } from '../dom.js';
import { makeCtx, monD, dayWord } from '../dates.js';
import { coachSection, teachCard, dateBlock, openApp, settle } from './_pillar-ui.js';

export const title = 'Bourbon';
const BP = bourbon.BP_HREF;
const WAIT_DAYS = 30;
const sn = bourbon.sn;

function header(f) {
  return h('header.rise',
    h('div.subtop',
      h('a.back', { href: '#/' }, icon('chevl'), 'Home'),
      h('a.action', { href: '#log:pour' }, icon('plus'), 'Log pour'),
    ),
    h('h1.title', icon('bourbon'), 'Bourbon'),
    h('div.eyebrow', { style: 'margin-top:6px' },
      f.available ? `${f.openCount} open · ${f.cabinetCount} in the cabinet · Barrel Proof` : 'Barrel Proof'),
  );
}

function heroCard(f, goal, prev) {
  const n = f.weekTastings.length;
  const r = ring({ value: n, goal, size: 'hero', from: prev ?? 0, label: `${n} of ${goal} pours noted this week` });
  const best = f.bestThisMonth, last = f.lastTasting;
  const ago = last ? (last.daysAgo === 0 ? 'today' : last.daysAgo === 1 ? 'yesterday' : `${last.daysAgo}d ago`) : '';
  return h('section.card.bourbon-hero.rise', { 'aria-label': 'This week' },
    h('div.ring-hero',
      r,
      h('div.facts',
        h('div', h('div.k', 'Pours noted this week'), h('div.v', `${n}`, h('small', `of ${goal}${n >= goal ? ' · goal hit' : goal - n === 1 ? ' · one more' : ''}`))),
        h('div', h('div.k', 'Best this month'), h('div.v', best ? [sn(best.name), ' ', h('span.num.volt', fmt.one(best.score))] : h('span.muted', 'No scores yet'))),
        h('div', h('div.k', 'Last pour'), h('div.v', last ? [sn(last.name), h('small', ago)] : h('span.muted', 'None yet'))),
      ),
    ),
  );
}

function shelf(f, state) {
  const open = f.openBottles;
  if (!open.length) {
    return [
      h('div.section-h.rise', h('h2', 'On the shelf'), h('span.meta', 'Nothing open')),
      h('section.card.rise', h('div.empty', h('div.glyph', icon('bourbon')),
        h('div', h('h3', 'Nothing open'), h('p', 'Bottles you own in Barrel Proof show up here with the days since their last pour.')))),
    ];
  }
  const shown = state.allShelf ? open : open.slice(0, 8);
  return [
    h('div.section-h.rise', h('h2', 'On the shelf'),
      open.length > 8 ? h('button.meta', { type: 'button', 'aria-expanded': state.allShelf ? 'true' : 'false', onclick: () => { state.allShelf = !state.allShelf; state.redraw(); } }, state.allShelf ? 'Fewer' : `All ${open.length}`, icon('chev'))
        : h('span.meta', 'Longest wait first')),
    h('section.card.shelf.rise', shown.map((b) => {
      const waiting = b.daysWaiting != null && b.daysWaiting >= WAIT_DAYS;
      const lvl = bourbon.levelOf(b.daysWaiting);
      return h('div', { class: `s${waiting ? ' waiting' : ''}`, role: 'group', 'aria-label': `${b.name}: ${b.count} ${b.count === 1 ? 'bottle' : 'bottles'}, ${b.lastTasted ? `last poured ${monD(b.lastTasted)}, ${b.daysWaiting} days` : 'never poured'}${waiting ? ', waiting' : ''}` },
        h('div.bottles', { 'aria-hidden': 'true' }, h('i', { class: waiting ? 'wait' : null, style: `--lvl:${lvl}%` })),
        h('div', { style: 'min-width:0' },
          h('div.name', b.name),
          h('div.meta', `${b.count} btl · last poured ${b.lastTasted ? monD(b.lastTasted) : 'never'}`),
        ),
        h('div.wait',
          b.daysWaiting == null ? [h('b', '—'), h('span', 'unpoured')]
            : b.daysWaiting === 0 ? [h('b', icon('check'), 'Today'), h('span', 'poured')]
              : [h('b', `${b.daysWaiting}d`), h('span', waiting ? [icon('clock'), 'waiting'] : 'since a pour')]),
      );
    })),
  ];
}

function pours(f, state) {
  const list = f.tastings.slice().reverse();
  if (!list.length) return [];
  const shown = state.allPours ? list : list.slice(0, 10);
  return [
    h('div.section-h.rise', h('h2', 'Recent pours'),
      list.length > 10 ? h('button.meta', { type: 'button', 'aria-expanded': state.allPours ? 'true' : 'false', onclick: () => { state.allPours = !state.allPours; state.redraw(); } }, state.allPours ? 'Fewer' : `All ${list.length}`, icon('chev'))
        : h('span.meta', `${list.length} noted`)),
    h('section.card.rounds.pours.rise', shown.map((t) => {
      const ctx = t.source === 'clubhouse' ? 'Quick pour' : t.blind ? 'Blind' : t.context || 'Tasting';
      return h('div', { class: 'r', role: 'group', 'aria-label': `${t.name}, ${monD(t.date)}${t.score != null ? `, ${fmt.one(t.score)}` : ''}${t.source === 'clubhouse' ? ', Clubhouse quick pour' : ''}` },
        dateBlock(t.date),
        h('div', { style: 'min-width:0' },
          h('div.course', t.name),
          h('div.meta', t.source === 'clubhouse' ? h('span.src', { title: 'Logged in Clubhouse' }, 'CH') : null, [ctx, t.note].filter(Boolean).join(' · ')),
        ),
        h('div.score', h('b', t.score != null ? fmt.one(t.score) : '—'), h('span', t.score != null ? '/ 10' : 'no score')),
      );
    })),
  ];
}

function finished(f) {
  if (!f.finished.length) return [];
  const pending = f.finished.filter((x) => x.rebuy === 'pending').length;
  return [
    h('div.section-h.rise', h('h2', 'Finished bottles'), pending ? h('a.meta', { href: BP }, `${pending} to decide`, icon('chev')) : h('span.meta', `${f.finished.length} emptied`)),
    h('section.card.shelf.finished.rise', f.finished.slice(0, 8).map((b) => h('div.s', { role: 'group', 'aria-label': `${b.name}, finished${b.date ? ` ${monD(b.date)}` : ''}, rebuy ${b.rebuy === 'yes' ? 'yes' : b.rebuy === 'no' ? 'no' : 'undecided'}` },
      h('div.bottles', { 'aria-hidden': 'true' }, h('i.emptied', { style: '--lvl:0%' })),
      h('div', { style: 'min-width:0' },
        h('div.name', b.name),
        h('div.meta', [b.date ? `Finished ${monD(b.date)}` : 'Finished', `${b.pours} ${b.pours === 1 ? 'pour' : 'pours'}`, b.avg != null ? `avg ${fmt.one(b.avg)}` : null].filter(Boolean).join(' · ')),
      ),
      h('span', { class: `rebuy ${b.rebuy}` },
        b.rebuy === 'yes' ? [icon('check'), 'Rebuy'] : b.rebuy === 'no' ? [icon('x'), 'Pass'] : [icon('clock'), 'Undecided']),
    ))),
  ];
}

function night(f, ctx) {
  const fl = f.recentFlight;
  if (!fl) return [];
  return [
    h('div.section-h.rise', h('h2', 'Tasting Night'), h('span.meta', dayWord(fl.date, ctx) === 'today' ? 'Tonight' : `${dayWord(fl.date, ctx)}`)),
    h('a.card.press.night.rise', { href: BP },
      h('div.k', icon('trophy'), 'Took the flight'),
      h('div.w', fl.winnerName),
      h('div.m', h('b', fmt.one(fl.avg)), ` room average · ${fl.glasses} glasses · ${fl.tasters} ${fl.tasters === 1 ? 'taster' : 'tasters'}`),
      fl.headline ? h('p.hl', fl.headline) : null,
    ),
  ];
}

function emptyScreen(f, goals, ctx, state, prev) {
  const F = { facts: { bourbon: f }, goals, ctx };
  return [
    header(f),
    teachCard({
      glyph: 'bourbon',
      title: 'Cabinet’s empty',
      body: 'Your bottles, tastings and Tasting Nights live in Barrel Proof. Bring them over once and every pour counts here and on Home.',
      steps: [
        { b: 'Export from Barrel Proof', small: 'In the Barrel Proof you use today: Data → Export backup. It saves barrel-proof-backup-(date).json.' },
        { b: 'Import it here', small: 'Open Barrel Proof below → Data → Import and pick that file. Clubhouse takes a snapshot first, so it can be undone.' },
      ],
      primary: { label: 'Open Barrel Proof', href: BP },
      secondary: { label: 'Import here', href: '#/backup', note: 'Picked the file in Backups instead? Clubhouse recognises a Barrel Proof backup and hands it to Barrel Proof’s own Import.' },
    }),
    f.tastings.length ? heroCard(f, goals.bourbon, prev) : null,
    ...pours(f, state),
    ...coachSection(bourbon.insights(F).filter((i) => i.id !== 'B0'), 'bourbon'),
  ];
}

export async function mount(el) {
  let alive = true;
  let prev = null;
  const state = { allShelf: false, allPours: false, redraw: () => draw(true) };

  async function draw(live) {
    const ctx = makeCtx(new Date());
    const [goals, f] = await Promise.all([store.goals(), bourbon.facts(ctx)]);
    if (!alive) return;
    el.classList.toggle('no-rise', Boolean(live));
    if (!f.available) {
      fill(el, ...emptyScreen(f, goals, ctx, state, live ? prev : 0).flat());
    } else {
      const F = { facts: { bourbon: f }, goals, ctx };
      fill(el,
        header(f),
        heroCard(f, goals.bourbon, live ? prev : 0),
        ...shelf(f, state),
        ...pours(f, state),
        ...finished(f),
        ...night(f, ctx),
        ...coachSection(bourbon.insights(F), 'bourbon'),
        openApp({ href: BP, label: 'Open Barrel Proof', sub: `Barrel Proof · ${f.cabinetCount} in the cabinet · ${f.wishlistCount} on the wishlist` }),
      );
    }
    if (live) {
      // the ring animates old → new (a pour just logged); everything else shows its final value at once
      el.querySelectorAll('.ring').forEach((r) => r.classList.add('live'));
      settle(el);
    }
    prev = f.weekTastings.length;
  }

  await draw(false);
  let t = null;
  const refresh = () => { clearTimeout(t); t = setTimeout(() => { if (alive) draw(true).catch((err) => console.warn('bourbon redraw failed', err)); }, 60); };
  const onStore = (e) => { const s = e && e.detail && e.detail.store; if (s === 'pours' || s === 'settings') refresh(); };
  window.addEventListener('clubhouse:refresh', refresh);
  store.events.addEventListener('change', onStore);
  return () => {
    alive = false;
    clearTimeout(t);
    window.removeEventListener('clubhouse:refresh', refresh);
    store.events.removeEventListener('change', onStore);
  };
}
