// Clubhouse — hash router (SPEC §1.2).
// register(path, loader, opts) — loader: a screen module or () => import('./screens/x.js').
// A screen module exports mount(el, params, ctx) → optional unmount(), and `title`.
// Behaviour: unmount previous → view emptied → mount new → document.title → nav .on (longest prefix)
// → scroll restored per route → entrance values played. `pageshow` (bfcache) and
// visibilitychange→visible dispatch `clubhouse:refresh` on window.

import { h, icon, play } from './dom.js';

const routes = [];
const scrollMap = new Map();
let view = null;
let nav = null;
let appCtx = {};
let current = null; // { path, unmount }
let token = 0;
let lastHash = '#/';

function compile(path) {
  const keys = [];
  const src = path.split('/').filter(Boolean).map((seg) => {
    const m = /^:(\w+)(\?)?$/.exec(seg);
    if (!m) return `/${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
    keys.push(m[1]);
    return m[2] ? '(?:/([^/]+))?' : '/([^/]+)';
  }).join('');
  return { re: new RegExp(`^${src || '/'}$`), keys };
}

export function register(path, loader, opts = {}) {
  routes.push({ path, loader, opts, ...compile(path) });
}

/** '#/train/log/wk-1?x=1' → { path:'/train/log/wk-1', query:URLSearchParams } ; '#backup' → '/backup'. */
export function parse(hash = location.hash) {
  let raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith('/')) raw = `/${raw}`;
  const [p, q = ''] = raw.split('?');
  const path = p.length > 1 ? p.replace(/\/+$/, '') : '/';
  return { path, query: new URLSearchParams(q) };
}

export function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { if (m[i + 1] != null) params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

export function navigate(to, { replace = false } = {}) {
  const hash = to.startsWith('#') ? to : `#${to.startsWith('/') ? to : `/${to}`}`;
  if (hash === location.hash) { render(); return; }
  if (replace) { history.replaceState(null, '', hash); render(); } else location.hash = hash;
}

export function currentPath() {
  return current ? current.path : parse().path;
}

function markNav(path) {
  if (!nav) return;
  let best = null, bestLen = -1;
  for (const a of nav.querySelectorAll('a[data-route]')) {
    const r = a.dataset.route;
    const hit = r === '/' ? true : path === r || path.startsWith(`${r}/`);
    if (hit && r.length > bestLen) { best = a; bestLen = r.length; }
  }
  for (const a of nav.querySelectorAll('a[data-route]')) {
    const on = a === best;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function errorPanel(title, detail) {
  return h('section.card.soon.rise',
    h('div.empty',
      h('div.glyph', icon('warn')),
      h('div', h('h3', title), h('p', detail),
        h('div.btns', h('a.pill.sel', { href: '#/' }, 'Home'), h('button.pill', { type: 'button', onclick: () => location.reload() }, 'Reload'))),
    ),
  );
}

export async function render() {
  const my = ++token;
  const hash = location.hash || '#/';
  const { path, query } = parse(hash);
  const m = match(path);
  if (!m) { history.replaceState(null, '', '#/'); if (path !== '/') return render(); return; }
  lastHash = hash;

  // unmount the previous screen and remember its scroll
  if (current) {
    scrollMap.set(current.path, window.scrollY);
    try { current.unmount?.(); } catch (err) { console.warn('unmount failed', err); }
    current = null;
  }
  view.innerHTML = '';
  view.classList.remove('no-rise');
  document.body.classList.toggle('no-fab', Boolean(m.route.opts.noFab));
  document.body.dataset.route = m.route.path;
  markNav(path);

  let mod;
  try {
    mod = typeof m.route.loader === 'function' ? await m.route.loader() : m.route.loader;
  } catch (err) {
    if (my !== token) return;
    console.warn('screen failed to load', m.route.path, err);
    document.title = 'Clubhouse';
    view.appendChild(errorPanel('Couldn’t open this screen', 'This part of Clubhouse didn’t load. Your data is safe — it lives on this phone.'));
    current = { path, unmount: null };
    return;
  }
  if (my !== token) return;
  const screen = mod.default && typeof mod.default.mount === 'function' ? mod.default : mod;
  const title = screen.title || m.route.opts.title || 'Clubhouse';
  document.title = `Clubhouse — ${title}`;

  let unmount = null;
  try {
    unmount = await screen.mount(view, m.params, { ...appCtx, path, params: m.params, query, route: m.route.path });
  } catch (err) {
    if (my !== token) return;
    console.warn('screen failed to mount', m.route.path, err);
    view.innerHTML = '';
    view.appendChild(errorPanel('Something went sideways', 'This screen hit an error while drawing. Nothing was changed.'));
  }
  if (my !== token) { try { if (typeof unmount === 'function') unmount(); } catch { /* ignore */ } return; }
  current = { path, unmount: typeof unmount === 'function' ? unmount : null };

  const y = scrollMap.get(path) || 0;
  requestAnimationFrame(() => window.scrollTo(0, y));
  try { view.focus({ preventScroll: true }); } catch { /* ignore */ }
  play(view);
}

export function start({ view: v, nav: n, ctx = {} }) {
  view = v;
  nav = n;
  appCtx = ctx;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#log:')) {
      // quick-log deep link: open the sheet, keep the current screen
      const kind = decodeURIComponent(location.hash.slice(5));
      history.replaceState(null, '', lastHash);
      appCtx.openLog?.(kind);
      return;
    }
    render();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) window.dispatchEvent(new Event('clubhouse:refresh')); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') window.dispatchEvent(new Event('clubhouse:refresh'));
  });
  if (location.hash.startsWith('#log:')) {
    const kind = decodeURIComponent(location.hash.slice(5));
    history.replaceState(null, '', '#/');
    render().then(() => appCtx.openLog?.(kind));
    return;
  }
  render();
}
