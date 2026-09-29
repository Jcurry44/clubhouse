// Clubhouse — boot: storage check, persist(), router, nav, FAB + LOG sheet, toasts, service worker.

import * as store from './store.js';
import * as router from './router.js';
import { initSheets, toast, confirm, openSheet, closeSheet } from './ui.js';
import { h, icon, markReady, reduceMotion } from './dom.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const fab = document.getElementById('fab');

function fatal() {
  document.body.classList.add('no-fab');
  nav.hidden = true;
  fab.hidden = true;
  view.replaceChildren(h('section.fatal', h('div',
    h('div.mark', icon('warn')),
    h('h1', 'Clubhouse needs storage'),
    h('p', 'Open it from the home-screen icon, not a private tab. Everything you log lives on this phone, so Clubhouse needs somewhere to keep it.'),
  )));
}

async function openLog(kind) {
  try {
    const sheet = await import('./screens/sheet.js');
    await sheet.open(kind);
  } catch (err) {
    console.warn('log sheet failed', err);
    toast('The log sheet didn’t load. Try again.', { tone: 'warm' });
  }
}

function persistStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then((granted) => store.setSetting('storage.persisted', Boolean(granted))).catch(() => {});
    }
  } catch { /* ignore */ }
}

function registerRoutes() {
  router.register('/', () => import('./screens/home.js'), { title: 'Home' });
  router.register('/golf', () => import('./screens/golf.js'), { title: 'Golf' });
  router.register('/train', () => import('./screens/train.js'), { title: 'Train' });
  router.register('/train/log/:id?', () => import('./screens/train-log.js'), { title: 'Log workout', noFab: true });
  router.register('/train/exercise/:id', () => import('./screens/train-exercise.js'), { title: 'Exercise' });
  router.register('/train/history', () => import('./screens/train-history.js'), { title: 'History' });
  router.register('/bourbon', () => import('./screens/bourbon.js'), { title: 'Bourbon' });
  router.register('/sports', () => import('./screens/sports.js'), { title: 'Sports' });
  router.register('/backup', () => import('./screens/backup.js'), { title: 'Backups' });
  router.register('/settings', () => import('./screens/settings.js'), { title: 'Settings' });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
  const offer = (run) => toast('Update ready — reload', { icon: 'bolt', duration: 12000, action: { label: 'Reload', run } });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // A worker left waiting (older release without skipWaiting): activate it, then reload.
    if (reg.waiting && hadController) {
      offer(() => { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); setTimeout(reload, 1500); });
    }
    // check for a new version whenever the app comes back to the foreground
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((err) => console.warn('service worker registration failed', err));
  // sw.js skips waiting, so a new release takes control right away; the page offers the reload.
  // The first claim of a fresh install is silent; every later change is a new release.
  let controlled = hadController;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    if (controlled) offer(reload);
    controlled = true;
  });
}

async function boot() {
  try {
    await store.open();
  } catch (err) {
    console.warn('storage unavailable', err);
    fatal();
    return;
  }
  persistStorage();
  initSheets();

  fab.addEventListener('click', () => openLog());
  // Quick-log deep links anywhere in the app: <a href="#log:lift">
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest('a[href^="#log:"]') : null;
    if (!a) return;
    e.preventDefault();
    openLog(decodeURIComponent(a.getAttribute('href').slice(5)));
  });

  registerRoutes();
  router.start({
    view,
    nav,
    ctx: {
      navigate: router.navigate,
      toast,
      confirm,
      openLog,
      openSheet,
      closeSheet,
      refresh: () => window.dispatchEvent(new Event('clubhouse:refresh')),
    },
  });

  const fontsReady = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  fontsReady.then(() => requestAnimationFrame(() => setTimeout(markReady, reduceMotion() ? 0 : 150)));

  registerServiceWorker();
}

boot();
