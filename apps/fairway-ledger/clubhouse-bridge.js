/* CLUBHOUSE: deep-link helper injected into the vendored copy (new file, not in the original app).
   Clubhouse Home's "Get set up" opens this app at #clubhouse-import. This points at the app's OWN import control
   (Fairway Ledger: opens the Data menu; Barrel Proof: the Restore arrow) with a one-line hint. It never picks a file,
   never imports and never writes storage. */
/* CLUBHOUSE (repair 2026-09-28): fold the return pill to its chevron once the page scrolls; unfold back at the top. */
(function () {
  'use strict';
  function sync(e) {
    var pill = document.querySelector('.clubhouse-return');
    if (!pill) return;
    var t = e && e.target && e.target !== document && e.target.nodeType === 1 ? e.target : null;
    var y = Math.max(window.scrollY || 0, t && t.scrollHeight > t.clientHeight + 40 ? t.scrollTop : 0);
    pill.classList.toggle('clubhouse-min', y > 48);
  }
  document.addEventListener('scroll', sync, { passive: true, capture: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
(function () {
  'use strict';
  if (location.hash !== '#clubhouse-import') return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  var root = document.documentElement;
  var tipEl = null;
  function done() {
    root.removeAttribute('data-clubhouse-import');
    if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    tipEl = null;
  }
  function tip(parts) {
    root.setAttribute('data-clubhouse-import', '');
    tipEl = document.createElement('div');
    tipEl.className = 'clubhouse-tip';
    tipEl.setAttribute('role', 'status');
    var p = document.createElement('p');
    parts.forEach(function (x, i) { var n = document.createElement(i % 2 ? 'b' : 'span'); n.textContent = x; p.appendChild(n); });
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Got it';
    b.addEventListener('click', function (e) { e.stopPropagation(); done(); });
    tipEl.appendChild(p);
    tipEl.appendChild(b);
    document.body.appendChild(tipEl);
  }
  // a file picked (Fairway Ledger's input is in the page) or Restore tapped (Barrel Proof builds its picker off-page)
  document.addEventListener('change', function (e) { if (e.target && e.target.type === 'file') done(); }, true);
  document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('[data-action="import"]')) done(); }, true);
  function start() {
    var toggle = document.getElementById('headerActionsToggle');
    if (toggle && document.getElementById('importInput')) {
      // Fairway Ledger: open the Data menu (opening a menu is all this does)
      var tries = 0;
      (function open() {
        if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
        if (toggle.getAttribute('aria-expanded') !== 'true' && ++tries < 10) setTimeout(open, 200);
      })();
      window.scrollTo(0, 0);
      tip(['Tap ', 'Import', ' (highlighted, top right) and choose the file your old Fairway Ledger made with ', 'Data \u2192 Export', '.']);
      return;
    }
    var waits = 0;
    (function wait() {
      // Barrel Proof draws its header after boot
      if (document.querySelector('[data-action="import"]')) {
        window.scrollTo(0, 0);
        tip(['Tap the highlighted ', 'upload arrow', ' (Restore) at the top and choose the backup your old Barrel Proof made with its ', 'download arrow', '.']);
        return;
      }
      if (++waits < 60) setTimeout(wait, 150);
    })();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
