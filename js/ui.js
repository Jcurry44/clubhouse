// Clubhouse — shell UI services shared by every screen: toast(), confirm(), sheets.
// import { toast, confirm, openSheet, closeSheet } from './ui.js';

import { h, icon, mount } from './dom.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ toast */

let toastTimer = null;
/**
 * toast('Saved · Legs · 45 min', { action: { label: 'Undo', run: fn }, tone: 'good'|'warm', icon: 'check' })
 * Auto-hides after 4 s, 6 s with an action.
 */
export function toast(message, { action = null, tone = 'good', icon: glyph, duration } = {}) {
  const el = $('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  const g = glyph || (tone === 'warm' ? 'warn' : 'check');
  const kids = [h('span', { class: `msg${tone === 'warm' ? ' warm' : ''}` }, icon(g), h('span', message))];
  if (action) {
    kids.push(h('button.action', {
      type: 'button',
      onclick: () => { hideToast(); try { action.run(); } catch (err) { console.warn(err); } },
    }, action.label));
  }
  mount(el, ...kids);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  toastTimer = setTimeout(hideToast, duration || (action ? 6000 : 4000));
}
export function hideToast() {
  clearTimeout(toastTimer);
  $('toast')?.classList.remove('show');
}

/* ------------------------------------------------------------------ sheets */

const openStack = []; // [{ el, opener, onClose }]
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function syncChrome() {
  const any = openStack.length > 0;
  $('scrim')?.classList.toggle('on', any);
  document.body.classList.toggle('sheet-open', any);
}

/** Open a sheet element (#sheet or #confirm). Focus moves in and is trapped; Escape/scrim/drag close it. */
export function openSheet(el, { onClose, focus } = {}) {
  if (!el) return;
  const existing = openStack.find((s) => s.el === el);
  if (existing) { existing.onClose = onClose || existing.onClose; return; }
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  hideToast(); // a stale toast must never sit on top of a sheet's buttons
  openStack.push({ el, opener, onClose });
  el.hidden = false;
  el.scrollTop = 0;
  void el.offsetWidth; // commit translateY(105%) before transitioning in
  el.classList.add('open');
  syncChrome();
  requestAnimationFrame(() => {
    const target = (focus && el.querySelector(focus)) || el.querySelector('[autofocus]') || el;
    if (target === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}

/** Close a sheet (default: the top one). Resolves after the slide-out. */
export function closeSheet(el, reason = 'close') {
  const idx = el ? openStack.findIndex((s) => s.el === el) : openStack.length - 1;
  if (idx < 0) return Promise.resolve();
  const [entry] = openStack.splice(idx, 1);
  const sheet = entry.el;
  sheet.classList.remove('open', 'dragging');
  sheet.style.transform = '';
  syncChrome();
  if (entry.opener && entry.opener.isConnected) entry.opener.focus({ preventScroll: true });
  try { entry.onClose?.(reason); } catch (err) { console.warn(err); }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (!sheet.classList.contains('open')) sheet.hidden = true;
      resolve();
    };
    sheet.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 450);
  });
}

export function isSheetOpen(el) {
  return el ? openStack.some((s) => s.el === el) : openStack.length > 0;
}

function trapFocus(e) {
  const top = openStack[openStack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSheet(top.el, 'escape'); return; }
  if (e.key !== 'Tab') return;
  const items = Array.from(top.el.querySelectorAll(FOCUSABLE)).filter((n) => !n.hidden && n.offsetParent !== null);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === top.el)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Grab-drag down > 80 px closes (pointer events on the grab handle + header). */
function wireDrag(sheet) {
  let startY = null, dy = 0, pid = null;
  sheet.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.grab, .h, .ttl')) return;
    if (sheet.scrollTop > 0) return;
    startY = e.clientY; dy = 0; pid = e.pointerId;
    sheet.classList.add('dragging');
    try { sheet.setPointerCapture(pid); } catch { /* ok */ }
  });
  sheet.addEventListener('pointermove', (e) => {
    if (startY == null || e.pointerId !== pid) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (startY == null || (e && e.pointerId !== pid)) return;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    const shouldClose = dy > 80;
    startY = null; dy = 0;
    if (shouldClose) closeSheet(sheet, 'drag');
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

let wired = false;
export function initSheets() {
  if (wired) return;
  wired = true;
  $('scrim')?.addEventListener('click', () => { const top = openStack[openStack.length - 1]; if (top) closeSheet(top.el, 'scrim'); });
  document.addEventListener('keydown', trapFocus);
  for (const id of ['sheet', 'confirm']) { const el = $(id); if (el) wireDrag(el); }
}

/* ------------------------------------------------------------------ confirm */

/**
 * The confirm sheet (§7.6) for every destructive action. Resolves true only on the verb button.
 * confirm({ title, sub, rows:[{label, now, file}], cols:['Now','File'], note, verb, cancel, tone:'amber'|'volt', glyph })
 */
export function confirm({ title, sub = '', rows = null, cols = ['Now', 'File'], note = 'A snapshot of everything you have now is saved first — undo from Backups.', verb = 'Confirm', cancel = 'Cancel', tone = 'amber', glyph = 'warn' } = {}) {
  const el = $('confirm');
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const table = rows && rows.length ? h('table.cmp-table',
      h('thead', h('tr', h('th', { scope: 'col' }, 'Store'), h('th', { scope: 'col' }, cols[0]), h('th', { scope: 'col', 'aria-label': 'becomes' }, ''), h('th', { scope: 'col' }, cols[1]))),
      h('tbody', rows.map((r) => h('tr',
        h('td', r.label),
        h('td.now', String(r.now)),
        h('td.arrow', { 'aria-hidden': 'true' }, '→'),
        h('td.file', String(r.file), r.file !== r.now ? h('span.chg', r.file > r.now ? `+${r.file - r.now}` : `−${r.now - r.file}`) : null),
      ))),
    ) : null;
    const cancelBtn = h('button.cta.ghost', { type: 'button', onclick: () => { settle(false); closeSheet(el, 'cancel'); } }, cancel);
    const goBtn = h('button', { type: 'button', class: `cta ${tone === 'amber' ? 'amber' : ''}`.trim(), onclick: () => { settle(true); closeSheet(el, 'confirm'); } }, icon(glyph), verb);
    mount(el,
      h('div.grab', { 'aria-hidden': 'true' }),
      h('h2.ttl', { id: 'confirm-title' }, title),
      sub ? h('p.sub', sub) : null,
      table,
      note ? h('p.note', icon('shield'), h('span', note)) : null,
      h('div.actions', cancelBtn, goBtn),
    );
    el.setAttribute('aria-labelledby', 'confirm-title');
    openSheet(el, { onClose: () => settle(false), focus: '.cta.ghost' });
  });
}
