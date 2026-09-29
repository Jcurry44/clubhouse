// Train — the .trend bar chart (golf.html's pattern): bars, an optional dashed line series, an optional dashed goal
// line, value labels above the bars, tap-linking to a list (both directions live in the caller via select()/onSelect).
// Colour never carries meaning alone: bars at or above the goal are lighter (luminance) AND every bar has its number.
import { h } from '../dom.js';

/**
 * barChart({ bars:[{ k, x, v, hi?, label? }], goal?, line?:(number|null)[], lo?, hi, ticks?, onSelect?, aria })
 *   bars   k = stable key (data-k), x = x label, v = value, hi = lighter bar, label = value label (default v)
 *   line   one value per bar (nullable) → dashed volt polyline on the same y scale
 *   goal   a horizontal dashed line at that value, captioned `goal N` (or goalLabel)
 * → { el, select(key) }
 */
export function barChart({ bars, goal = null, goalLabel = null, line = null, lo = 0, hi, ticks = [], onSelect = null, aria = 'Chart', xEvery = 1 } = {}) {
  const W = 358, H = 170, padT = 18, padB = 22, gut = 24;
  const n = Math.max(1, bars.length);
  const top = hi != null ? hi : Math.max(1, ...bars.map((b) => b.v), goal || 0) + 1;
  const y = (v) => padT + (1 - (v - lo) / (top - lo)) * (H - padT - padB);
  const slot = (W - gut) / n;
  const bw = Math.min(22, Math.max(8, slot * 0.62));
  const kids = [];
  for (const g of ticks) kids.push(h('line.grid', { x1: gut, x2: W, y1: y(g), y2: y(g) }), h('text.gl', { x: 0, y: y(g) + 3.5 }, String(g)));
  bars.forEach((b, i) => {
    const x = gut + slot * i + slot / 2 - bw / 2;
    const yy = y(Math.max(lo, b.v));
    const bh = Math.max(b.v > lo ? 3 : 0, H - padB - yy);
    kids.push(h('rect', { class: `bar${b.hi ? ' hi' : ''}`, dataset: { k: b.k }, x, y: H - padB - bh, width: bw, height: bh, rx: 4 }));
    if ((n - 1 - i) % xEvery === 0) kids.push(h('text.xl', { x: x + bw / 2, y: H - 6 }, b.x)); // anchored on the newest bar so labels never collide
    kids.push(h('rect.hit', { dataset: { k: b.k }, x: gut + slot * i, y: 0, width: slot, height: H }));
  });
  if (goal != null) {
    kids.push(h('polyline.avg', { points: `${gut},${y(goal)} ${W},${y(goal)}` }));
    kids.push(h('text.gl', { x: W, y: y(goal) - 5, 'text-anchor': 'end' }, goalLabel || `goal ${goal}`));
  }
  if (line) {
    const pts = line.map((v, i) => (v == null ? null : [gut + slot * i + slot / 2, y(v)])).filter(Boolean);
    if (pts.length > 1) kids.push(h('polyline.avg', { points: pts.map((p) => p.join(',')).join(' ') }));
  }
  bars.forEach((b, i) => {
    const x = gut + slot * i + slot / 2;
    const yy = y(Math.max(lo, b.v));
    kids.push(h('text.vl', { dataset: { k: b.k }, x, y: yy - 6 }, b.label != null ? String(b.label) : String(b.v)));
  });
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria }, kids);
  const select = (key) => {
    svg.querySelectorAll('.bar, .vl').forEach((el) => el.classList.toggle('sel', el.dataset.k === String(key)));
    const bar = bars.find((b) => String(b.k) === String(key));
    if (bar && onSelect) onSelect(key, bar);
  };
  svg.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-k]') : null;
    if (t) select(t.dataset.k);
  });
  return { el: svg, select };
}
