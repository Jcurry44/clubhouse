// Train — the "Train" block of Settings: where Train's data comes from. v1 = the Form export file (tap → the Train
// tab, which owns the import). "Connect live" is a visibly disabled row with an honest note (the trainSource seam
// in source.js; a live source needs a read-only route added to Form first).
import { h, icon } from '../dom.js';
import { monD } from '../dates.js';
import { loadMeta } from './data.js';
import { liveSource } from './source.js';

/** Read what Settings needs; never throws (a broken store just reads as "not imported"). */
export async function loadTrainSettings() {
  try { return await loadMeta(); } catch { return null; }
}

/** [section header, list card] for Settings. */
export function trainSection(meta) {
  const has = Boolean(meta && meta.sessions >= 0 && meta.asOf);
  const sessions = has ? `${meta.sessions} ${meta.sessions === 1 ? 'session' : 'sessions'}` : '';
  return [
    h('div.section-h.rise', h('h2', 'Train'), h('span.meta', 'Reads from Form')),
    h('section.card.list.rise', { dataset: { block: 'train-source' } },
      h('a.li', { href: '#/train' },
        h('div', { class: `lg${has ? ' good' : ''}` }, icon('import')),
        h('div.t', 'Form export file', h('small', has ? `${sessions} · as of ${monD(meta.asOfDate)}` : 'Not imported yet — tap to bring in your Form data')),
        h('div.end', icon('chev', 'chev')),
      ),
      h('button.li.is-disabled', { type: 'button', disabled: true, 'aria-disabled': 'true', 'aria-label': `${liveSource.label} — later` },
        h('div.lg', icon('bolt')),
        h('div.t', liveSource.label, h('small', liveSource.note)),
        h('div.end', h('span.later', 'Later')),
      ),
    ),
  ];
}
