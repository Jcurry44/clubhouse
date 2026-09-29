// Clubhouse — DOM helpers: h(), esc(), rich(), icon(), fmt, on(), animateCount(), ring(), play().
// No DOM access at import time, so pure parts (esc, fmt) are usable from Node tests.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'use', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'stop', 'clipPath', 'mask', 'pattern']);
export const MINUS = '−';

/** Escape a string for HTML text or attribute context. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Hyperscript. h('a.card.press', { href, onclick }, child, 'text', [more]).
 * attrs: class/className, style (string|object; '--vars' ok), dataset {}, on<event> functions,
 * booleans (true → attribute present, false/null → skipped). Children: Node | string | number | array | null.
 * SVG tags are created in the SVG namespace automatically.
 */
export function h(tag, attrs, ...children) {
  let name = tag, classes = [], id = null;
  const m = String(tag).match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/);
  if (m) {
    name = m[1] || 'div';
    for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') classes.push(part.slice(1)); else id = part.slice(1);
    }
  }
  const isSvg = SVG_TAGS.has(name);
  const el = isSvg ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  if (id) el.id = id;
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') { classes.push(...String(v).split(/\s+/).filter(Boolean)); continue; }
      if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else for (const [p, pv] of Object.entries(v)) { if (pv != null) el.style.setProperty(p, String(pv)); }
        continue;
      }
      if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) if (dv != null) el.dataset[dk] = dv; continue; }
      if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2).toLowerCase(), v); continue; }
      if (k === 'text') { el.textContent = v; continue; }
      if (k === 'value' && 'value' in el && !isSvg) { el.value = v; continue; }
      if (k === 'checked' && !isSvg) { el.checked = Boolean(v); continue; }
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (classes.length) {
    if (isSvg) el.setAttribute('class', classes.join(' '));
    else el.className = classes.join(' ');
  }
  append(el, children);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Replace an element's children. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** <svg><use href="#i-name"/></svg> */
export function icon(name, cls, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (cls) svg.setAttribute('class', cls);
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/**
 * Safe rich text for coach copy: keeps only <strong>, <b>, <em>, <br> and <span class="warn">;
 * every other tag is unwrapped to its text. Input strings should still esc() interpolated values.
 */
export function rich(str) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(str ?? '');
  const frag = document.createDocumentFragment();
  const walk = (src, dst) => {
    for (const n of Array.from(src.childNodes)) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { dst.appendChild(document.createElement('br')); continue; }
      if (tag === 'strong' || tag === 'b' || tag === 'em' || (tag === 'span' && n.classList.contains('warn'))) {
        const e = document.createElement(tag);
        if (tag === 'span') e.className = 'warn';
        walk(n, e);
        dst.appendChild(e);
      } else {
        walk(n, dst);
      }
    }
  };
  walk(tpl.content, frag);
  return frag;
}

/** Delegated listener: on(root, 'click', '.opt', (e, el) => …). Returns an off() function. */
export function on(root, type, selector, fn, opts) {
  const handler = (e) => {
    const el = e.target instanceof Element ? e.target.closest(selector) : null;
    if (el && root.contains(el)) fn(e, el);
  };
  root.addEventListener(type, handler, opts);
  return () => root.removeEventListener(type, handler, opts);
}

/* ---------------------------------------------------------------- numbers */

const toNum = (v) => (typeof v === 'number' ? v : Number(v));
export const fmt = {
  /** integer count */
  int: (v) => (Number.isFinite(toNum(v)) ? String(Math.round(toNum(v))) : '–'),
  /** one decimal: 2.2, never 2.20 or 2 */
  one: (v) => (Number.isFinite(toNum(v)) ? toNum(v).toFixed(1).replace('-', MINUS) : '–'),
  /** grouped integer: 12,480 */
  group: (v) => (Number.isFinite(toNum(v)) ? Math.round(toNum(v)).toLocaleString('en-US') : '–'),
  pct: (v) => (Number.isFinite(toNum(v)) ? `${Math.round(toNum(v))}%` : '–'),
  /** signed with a real minus: +1.2 / −1.2 / 0.0 */
  signed1: (v) => {
    const n = toNum(v);
    if (!Number.isFinite(n)) return '–';
    const s = Math.abs(n).toFixed(1);
    return n > 0 ? `+${s}` : n < 0 ? `${MINUS}${s}` : s;
  },
  signedInt: (v) => {
    const n = Math.round(toNum(v));
    if (!Number.isFinite(n)) return '–';
    return n > 0 ? `+${n}` : n < 0 ? `${MINUS}${Math.abs(n)}` : '0';
  },
  lb: (v) => `${Math.round(toNum(v))} lb`,
  mi: (v) => `${toNum(v).toFixed(1)} mi`,
  /** replace ASCII hyphen-minus before a digit with U+2212 (odds lines, records) */
  minus: (s) => String(s ?? '').replace(/-(?=\d)/g, MINUS),
  /** '1 round' / '2 rounds' */
  count: (n, one, many) => `${n} ${n === 1 ? one : many}`,
  plural: (n, one, many) => (n === 1 ? one : many || `${one}s`),
  /** bytes → '1.2 MB' */
  bytes: (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`),
};

/* ---------------------------------------------------------------- motion */

export function reduceMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

let readyResolve;
const readyPromise = new Promise((r) => { readyResolve = r; });
/** Resolves once body.is-ready is set (fonts ready + 150 ms, SPEC §7.5). */
export function whenReady() { return readyPromise; }
export function markReady() {
  document.body.classList.add('is-ready');
  readyResolve();
}

/** Count-up: 900 ms, ease 1 − (1−k)^3; integers round, decimals toFixed(dec). */
export function animateCount(el, to, { from = 0, dec = 0, dur = 900, reduce = reduceMotion() } = {}) {
  const target = Number(to);
  const show = (v) => { el.textContent = dec ? v.toFixed(dec) : String(Math.round(v)); };
  if (!Number.isFinite(target)) { el.textContent = String(to); return; }
  if (reduce || from === target) { show(target); return; }
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    show(from + (target - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  show(from);
  requestAnimationFrame(tick);
}

/**
 * Progress ring (SPEC §7.3). Returns <div class="ring [hero|mini] [empty]">.
 * value shows uncapped with "/goal"; p = min(1, value/goal). `from` = previous value (animate old → new).
 */
export function ring({ value = 0, goal = 1, size = 'tile', empty = false, from = 0, label } = {}) {
  const p = goal > 0 ? Math.max(0, Math.min(1, value / goal)) : 0;
  const p0 = goal > 0 ? Math.max(0, Math.min(1, from / goal)) : 0;
  const over = Math.max(0, value - goal);
  const svg = h('svg', { viewBox: '0 0 84 84', 'aria-hidden': 'true' },
    h('circle.track', { cx: 42, cy: 42, r: 35, pathLength: 100 }),
    h('circle.fill', { cx: 42, cy: 42, r: 35, pathLength: 100, style: `--p:${p0}`, dataset: { p: String(p) } }),
  );
  if (p === 0 && p0 === 0) svg.lastChild.classList.add('zero');
  const cls = ['ring'];
  if (size === 'hero') cls.push('hero');
  if (size === 'mini') cls.push('mini');
  if (empty) cls.push('empty');
  const el = h('div', { class: cls.join(' '), role: 'img', 'aria-label': label || `${value} of ${goal}` }, svg);
  if (size !== 'mini') {
    el.appendChild(h('div.num', h('span.count', { dataset: { to: String(value), from: String(from) } }, String(from)), h('small', `/${goal}`)));
    if (over > 0) el.appendChild(h('span.over.pop', `+${over}`));
  }
  return el;
}

/**
 * Play entrance values inside root: ring fills (data-p), count-ups (.count[data-to]) and bars ([data-w]).
 * Called by the router after every mount and by screens after an in-place re-render. Idempotent per element.
 */
export async function play(root, { reduce = reduceMotion() } = {}) {
  await whenReady();
  if (!root || !root.isConnected) return;
  const fills = root.querySelectorAll('.ring .fill[data-p]:not([data-played])');
  const counts = root.querySelectorAll('.count[data-to]:not([data-played])');
  const bars = root.querySelectorAll('[data-w]:not([data-played])');
  if (!fills.length && !counts.length && !bars.length) return;
  // two frames so the start value is committed before the transition target is set
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  fills.forEach((f) => {
    f.dataset.played = '1';
    const p = Number(f.dataset.p);
    f.classList.toggle('zero', p === 0);
    f.style.setProperty('--p', String(p));
  });
  counts.forEach((c) => {
    c.dataset.played = '1';
    const dec = Number(c.dataset.dec || 0);
    const from = Number(c.dataset.from || 0);
    const live = c.closest('.ring.live');
    animateCount(c, Number(c.dataset.to), { from, dec, reduce, dur: live ? 700 : 900 });
  });
  bars.forEach((b) => {
    b.dataset.played = '1';
    b.style.setProperty('--w', b.dataset.w);
  });
}

/** Mini sparkline (SPEC §7.6 .spark): grey older half, volt newer half, volt dot on the last point. */
export function spark(values, { invert = false, w = 72, hgt = 28 } = {}) {
  const svg = h('svg.spark', { viewBox: `0 0 ${w} ${hgt}`, 'aria-hidden': 'true' });
  const vals = (values || []).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return svg;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 4) + 2;
    const k = (v - min) / span;
    const y = invert ? 3 + k * (hgt - 6) : hgt - 3 - k * (hgt - 6);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
  const mid = Math.floor((pts.length - 1) / 2) + 1;
  const str = (a) => a.map((p) => p.join(',')).join(' ');
  svg.append(
    h('polygon.area', { points: `${str(pts)} ${pts[pts.length - 1][0]},${hgt} ${pts[0][0]},${hgt}` }),
    h('polyline.l', { points: str(pts.slice(0, mid + 1)) }),
    h('polyline.l.hi', { points: str(pts.slice(mid)) }),
    h('circle.dot', { r: 3.5, cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1] }),
  );
  return svg;
}

/** Seven-day dots (.dots7). */
export function dots7(on = [], todayIndex = -1) {
  return h('div.dots7', { 'aria-hidden': 'true' }, Array.from({ length: 7 }, (_, i) => h('i', { class: [on[i] ? 'on' : '', !on[i] && i === todayIndex ? 'today' : ''].join(' ').trim() || null })));
}

/**
 * Fit a single-line label: try each text variant (longest first) until the element no longer overflows.
 * Re-runs once fonts are ready. fitText(eyebrowEl, ['Thursday · Sep 25 · Week 39', 'Thu · Sep 25 · Week 39']).
 */
export function fitText(el, variants) {
  const run = () => {
    if (!el.isConnected) return;
    for (const v of variants) {
      el.textContent = v;
      if (el.scrollWidth <= el.clientWidth + 0.5) return;
    }
  };
  requestAnimationFrame(run);
  whenReady().then(() => requestAnimationFrame(run));
}

/** Unique id per SPEC §0. */
export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}
