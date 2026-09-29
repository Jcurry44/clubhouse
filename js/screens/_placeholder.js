// Shell-lane factory for pillar screens that haven't landed yet. Direction B structure:
// subtop (‹ Home · action) → TITLE → eyebrow → ring hero → empty state or summary → open-app CTA.
// Each pillar lane replaces screens/<pillar>.js with its real screen; nothing else imports this file.
import * as store from '../store.js';
import * as dates from '../dates.js';
import { byId } from '../pillars/index.js';
import { h, icon, ring, mount as fill } from '../dom.js';

export function pillarScreen(pillarId, { title, eyebrow, action, openApp } = {}) {
  return {
    title,
    async mount(el) {
      const p = byId[pillarId];
      const ctx = dates.makeCtx(new Date());
      const goals = await store.goals();
      let f = {};
      try { f = await p.facts(ctx); } catch (err) { f = { available: false, error: String(err) }; }
      const s = p.summary(f, goals[pillarId], ctx);
      const draw = () => {
        fill(el,
          h('header.rise',
            h('div.subtop',
              h('a.back', { href: '#/' }, icon('chevl'), 'Home'),
              action ? h('a.action', { href: action.href }, icon('plus'), action.label) : h('span'),
            ),
            h('h1.title', icon(p.meta.glyph), title),
            h('div.eyebrow', { style: 'margin-top:6px' }, eyebrow ? eyebrow(f, s) : `${s.ringValue} of ${s.ringGoal} this week`),
          ),
          h('section.card.rise',
            h('div.ring-hero',
              ring({ value: s.ringValue, goal: s.ringGoal, size: 'hero', empty: Boolean(s.empty), label: `${s.ringValue} ${s.sublabel}` }),
              h('div.facts',
                h('div', h('div.k', 'This week'), h('div.v', `${s.ringValue}`, h('small', s.sublabel))),
                h('div', h('div.k', 'Weekly goal'), h('div.v', `${s.ringGoal}`, h('small', `${s.ringGoal === 1 ? p.meta.unit.one : p.meta.unit.many} · edit in Settings`))),
              ),
            ),
          ),
          s.empty ? h('section.card.rise',
            h('div.empty',
              h('div.glyph', icon(p.meta.glyph)),
              h('div',
                h('h3', s.empty.title),
                h('p', s.empty.body),
                s.empty.cta ? h('div.btns', h('a.pill.sel', { href: s.empty.cta.href }, s.empty.cta.label, icon('chev'))) : null,
              ),
            ),
          ) : h('section.card.rise',
            h('div.empty',
              h('div.glyph', icon('bolt')),
              h('div', h('h3', 'More on the way'), h('p', 'The full screen for this pillar is being built. Home already counts everything you log.')),
            ),
          ),
          openApp ? h('div.open-app.rise', h('a.cta', { href: openApp.href }, openApp.label, icon('chev')), openApp.sub ? h('div.sub', openApp.sub) : null) : null,
        );
      };
      draw();
    },
  };
}

/** Sub-routes (train logger, exercise, history) before Lane C lands. */
export function soonScreen({ title, back = '#/', backLabel = 'Home', body }) {
  return {
    title,
    mount(el) {
      fill(el,
        h('header.rise', h('div.subtop', h('a.back', { href: back }, icon('chevl'), backLabel), h('span')), h('h1.title', title)),
        h('section.card.soon.rise', h('div.empty',
          h('div.glyph', icon('bolt')),
          h('div', h('h3', 'Coming together'), h('p', body || 'This screen is being built. Everything you log still counts on Home.'),
            h('div.btns', h('a.pill.sel', { href: '#log:lift' }, icon('plus'), 'Quick log'))),
        )),
      );
    },
  };
}
