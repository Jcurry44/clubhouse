// #/train/log — there is no native workout logger any more (DECISIONS 2026-09-28): workouts are logged in Form.
// The route stays so old links and the LOG sheet's history never dead-end; it explains and hands off.
import { h, icon } from '../dom.js';
import { FORM_URL } from '../train/form-import.js';

export const title = 'Log in Form';

export function mount(el) {
  el.replaceChildren(
    h('header.rise', h('div.subtop', h('a.back', { href: '#/train' }, icon('chevl'), 'Train'), h('span')), h('h1.title', icon('train'), 'Log in Form')),
    h('section.card.tr-onboard.rise',
      h('div.empty',
        h('div.glyph', icon('train')),
        h('div',
          h('h3', 'Workouts are logged in Form'),
          h('p', 'Form has the programs, the timers and every exercise. Log it there, export, and import the file on the Train tab — your ring, streak and PRs update from it.'),
        ),
      ),
      h('a.cta', { href: FORM_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('share'), 'Open Form'),
      h('a.cta.ghost', { href: '#/train' }, icon('import'), 'Import from Form'),
    ),
  );
}
