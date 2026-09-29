// Shared pieces for the Golf and Bourbon screens (golf-bourbon lane): Coach cards, the first-run "bring your
// data over" teaching card, date blocks, and the open-the-app CTA. Markup mirrors Direction B's components
// (.insight, .empty, .rounds .date, .open-app) so it reads as one system with Home.
import * as backup from '../backup.js';
import { h, icon, rich, spark, dots7, play } from '../dom.js';
import { parseYmd, MONTHS, DOW, dowIndex } from '../dates.js';
import { toast } from '../ui.js';

function kicker(text) {
  const i = text.indexOf(' · ');
  return i < 0 ? h('div.kicker', text) : h('div.kicker', text.slice(0, i + 3), h('b', text.slice(i + 3)));
}

function vizEl(v) {
  if (!v) return null;
  if (v.type === 'spark') return h('div.viz', spark(v.values, { invert: v.invert }), h('span.cap', v.cap || 'Last 10'));
  if (v.type === 'dots7') return h('div.viz', dots7(v.on, v.todayIndex), v.cap ? h('span.cap', v.cap) : null);
  if (v.type === 'bottles') {
    return h('div.viz',
      h('div.bottles', { 'aria-hidden': 'true' }, (v.levels || []).map((l) => h('i', { class: l.wait ? 'wait' : null, style: `--lvl:${l.pct}%` }))),
      h('span.cap', 'Fill'));
  }
  if (v.type === 'delta') return h('div.viz', h('span', { class: `delta ${v.tone || ''}`.trim() }, v.icon ? icon(v.icon) : null, v.value));
  return null;
}

/** Run a Coach card action (the same verbs Home understands). */
export function runAction(run) {
  if (run === 'backup.export') {
    backup.exportNow().then((res) => toast(res.message, { tone: res.ok ? 'good' : 'warm', icon: res.ok ? 'check' : res.cancelled ? 'x' : 'warn' }))
      .catch(() => toast('Couldn’t build the backup. Nothing changed.', { tone: 'warm' }));
  } else if (run === 'backup.snooze') {
    backup.snooze().then(() => toast('Okay — reminding you in two days.', { icon: 'clock' }));
  }
}

/** One Coach card (§7.6 .insight). glyph = the pillar's sprite id. */
export function insightCard(ins, glyph) {
  const glyphCls = ins.tone === 'good' ? 'glyph good' : ins.tone === 'warm' ? 'glyph warm' : 'glyph';
  const viz = vizEl(ins.viz);
  const body = h('div.body', kicker(ins.kicker), h('h3', rich(ins.headline)), ins.sub ? h('div.sub', ins.sub) : null);
  const cls = `card insight rise${viz ? '' : ' no-viz'}`;
  if (ins.actions && ins.actions.length) {
    body.appendChild(h('div.actions', ins.actions.map((a, i) => h('button', {
      type: 'button', class: i === 0 ? 'pill volt' : 'pill', onclick: () => runAction(a.run),
    }, i === 0 && a.run === 'backup.export' ? icon('share') : null, a.label))));
    return h('div', { class: cls, dataset: { rule: ins.id } }, h('div', { class: glyphCls }, icon(glyph)), body, viz);
  }
  return h('a', { class: `${cls} press`, href: ins.href || '#/', dataset: { rule: ins.id } }, h('div', { class: glyphCls }, icon(glyph)), body, viz);
}

/**
 * COACH section: header + the pillar's cards in priority order (§6.2). repair (design review): the top `cap` show; the
 * rest wait behind an "All N" link in the header (the Golf tab ran to 7 cards, ~2,900 px).
 */
const coachOpen = new Set(); // pillars whose Coach is expanded this session (a redraw keeps it open)
export function coachSection(list, glyph, { cap = 4 } = {}) {
  if (!list.length) return [];
  if (list.some((i) => i.actions && i.actions.some((a) => a.run === 'backup.export'))) backup.prepare().catch(() => {});
  const cards = list.map((i) => insightCard(i, glyph));
  const extra = cards.slice(cap);
  if (!extra.length) {
    return [h('div.section-h.rise', h('h2', 'Coach'), h('span.meta', 'Plain-English read')), ...cards];
  }
  const label = h('span', `All ${list.length}`);
  const more = h('button.meta', {
    type: 'button', 'aria-expanded': 'false', 'aria-label': `Show all ${list.length} Coach insights`, dataset: { coachMore: String(extra.length) },
    onclick: () => set(more.getAttribute('aria-expanded') !== 'true', true),
  }, label, icon('chev'));
  function set(open, animate) {
    extra.forEach((c, n) => { c.hidden = !open; c.style.animationDelay = animate ? `${n * 0.05}s` : '0s'; });
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
    more.setAttribute('aria-label', open ? 'Show the top Coach insights only' : `Show all ${list.length} Coach insights`);
    label.textContent = open ? `Top ${cap}` : `All ${list.length}`;
    more.querySelector('svg')?.style.setProperty('transform', open ? 'rotate(-90deg)' : 'rotate(90deg)');
    if (open) coachOpen.add(glyph); else coachOpen.delete(glyph);
  }
  set(coachOpen.has(glyph), false);
  return [h('div.section-h.rise', h('h2', 'Coach'), more), ...cards];
}

/**
 * First-run teaching card: how the data gets here. steps = [{ b, small }]; primary = { label, href };
 * the secondary "Import here" goes to Backups, where the shell's import recognises the file and hands it over.
 */
export function teachCard({ glyph, title, body, steps, primary, secondary }) {
  return h('section.card.teach.rise',
    h('div.teach-head',
      h('div.glyph', icon(glyph)),
      h('div', h('h3', title), h('p', body)),
    ),
    h('ol.steps', steps.map((s, i) => h('li',
      h('span.n', String(i + 1)),
      h('span.t', h('b', s.b), s.small ? h('small', s.small) : null),
    ))),
    h('div.teach-btns',
      h('a.cta', { href: primary.href }, primary.label, icon('chev')),
      secondary ? h('a.cta.quiet.sm', { href: secondary.href }, icon('import'), secondary.label) : null,
    ),
    secondary && secondary.note ? h('p.teach-note', secondary.note) : null,
  );
}

/** '27' + 'SEP' date block used by the rounds / pours lists. */
export function dateBlock(ymd) {
  const d = parseYmd(ymd);
  return h('div.date', h('b', String(d.getDate())), h('span', MONTHS[d.getMonth()]));
}
export const dow = (ymd) => DOW[dowIndex(ymd)];

/** The volt "Open the ledger" / "Open Barrel Proof" CTA pinned as the last card. */
export function openApp({ href, label, sub, warn = false }) {
  return h('div.open-app.rise',
    h('a.cta', { href }, label, icon('chev')),
    sub ? h('div', { class: `sub${warn ? ' warnline' : ''}` }, warn ? icon('warn') : null, sub) : null,
  );
}

/**
 * An in-place redraw (refresh, goal change) shows final values at once — the entrance plays once per visit.
 * A ring marked `.live` (built with from = its previous value) is left for play() to animate old → new (§7.5).
 */
export function settle(root) {
  root.querySelectorAll('[data-w]').forEach((b) => { b.dataset.played = '1'; b.style.setProperty('--w', b.dataset.w); });
  root.querySelectorAll('.count[data-to]').forEach((c) => {
    if (c.closest('.ring.live')) return;
    c.dataset.played = '1';
    c.textContent = Number(c.dataset.to).toFixed(Number(c.dataset.dec || 0));
  });
  root.querySelectorAll('.ring:not(.live) .fill[data-p]').forEach((f) => { f.dataset.played = '1'; f.classList.toggle('zero', Number(f.dataset.p) === 0); f.style.setProperty('--p', f.dataset.p); });
  play(root);
}
