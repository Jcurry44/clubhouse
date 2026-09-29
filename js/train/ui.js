// Train — small shared view builders for the Train screens (Direction B markup; the class names are the mock's).
import { h, icon, rich, spark, dots7, fmt } from '../dom.js';
import { DOW, DOW_LONG, MONTHS, parseYmd, dowIndex, monD, addDays } from '../dates.js';

export const KIND_LABEL = { strength: 'Strength', mobility: 'Mobility', cardio: 'Cardio', mixed: 'Mixed' };

/** 'Mon' … for a YYYY-MM-DD. */
export const dow = (date) => DOW[dowIndex(date)];
export const dowLong = (date) => DOW_LONG[dowIndex(date)];

/** Two-line date block: 24 / SEP. */
export function dateBlock(date) {
  const d = parseYmd(date);
  return h('div.date', h('b', String(d.getDate())), h('span', MONTHS[d.getMonth()]));
}

/** '52 min · 5 exercises · 12,480 lb' — only the parts that are known (minutes are measured, never guessed). */
export function sessionMeta(s) {
  const parts = [KIND_LABEL[s.kind] || 'Workout'];
  if (s.durationMin) parts.push(`${s.durationMin} min`);
  if (s.exercises) parts.push(`${s.exercises} ${s.exercises === 1 ? 'exercise' : 'exercises'}`);
  return `${dow(s.date)} · ${parts.join(' · ')}`;
}

/** Right-hand number of a session row: lifted volume for strength, minutes otherwise, else sets. */
function sessionScore(s) {
  if (s.volume > 0) return [fmt.group(s.volume), 'lb'];
  if (s.durationMin) return [String(s.durationMin), 'min'];
  if (s.setCount) return [String(s.setCount), s.setCount === 1 ? 'set' : 'sets'];
  return ['—', ''];
}

/**
 * A .rounds row for a session. prs = the PRs set in it (badge: trophy + PR + how many).
 * opts: { sel, week (data-week for tap-linking), onclick, expanded, tag }
 */
export function sessionRow(s, prs = [], { sel = false, onclick = null, tag = 'button', extra = null } = {}) {
  const [num, unit] = sessionScore(s);
  return h(`${tag}.r${sel ? '.sel' : ''}`, { type: tag === 'button' ? 'button' : null, dataset: { id: s.id, week: s.week || null }, onclick },
    dateBlock(s.date),
    h('div',
      h('div.course', s.title, prs.length ? h('span.badge-pr', { style: 'margin-left:8px' }, icon('trophy'), prs.length > 1 ? `PR ×${prs.length}` : 'PR') : null),
      h('div.meta', sessionMeta(s)),
    ),
    h('div.score', h('b', num), unit ? h('span', unit) : h('span', ' ')),
    extra,
  );
}

/** The Home/Train week strip (Mon…Sun). marks = boolean[7]. */
export function weekStrip(marks, ctx) {
  return h('section.week-strip.rise', { 'aria-label': 'Days with a Form session this week' },
    DOW.map((label, i) => {
      const hit = Boolean(marks[i]);
      const today = i === ctx.dayIndex;
      const future = i > ctx.dayIndex;
      const dayNum = Number(addDays(ctx.weekStart, i).slice(8));
      return h('div', { class: ['day', hit && 'hit', today && 'today', future && 'future'].filter(Boolean).join(' '), 'aria-label': `${label}${hit ? ', session' : ''}${today ? ', today' : ''}` },
        h('span.d', hit ? icon('check', null, 12) : String(dayNum)),
        label,
      );
    }),
  );
}

/** '.kicker' with the part after " · " in bold. */
function kicker(text) {
  const i = text.indexOf(' · ');
  return i < 0 ? h('div.kicker', text) : h('div.kicker', text.slice(0, i + 3), h('b', text.slice(i + 3)));
}

function vizEl(v) {
  if (!v) return null;
  if (v.type === 'spark') return h('div.viz', spark(v.values, { invert: v.invert }), h('span.cap', v.cap || 'Last 10'));
  if (v.type === 'dots7') return h('div.viz', dots7(v.on, v.todayIndex), v.cap ? h('span.cap', v.cap) : null);
  if (v.type === 'delta') return h('div.viz', h('span', { class: `delta ${v.tone || ''}`.trim() }, v.icon ? icon(v.icon) : null, v.value));
  return null;
}

/** A Coach card (same markup as Home's). */
export function insightCard(ins) {
  const glyphCls = ins.tone === 'good' ? 'glyph good' : ins.tone === 'warm' ? 'glyph warm' : 'glyph';
  const viz = vizEl(ins.viz);
  const glyph = ins.tone === 'warm' ? 'warn' : ins.id === 'T2' ? 'trophy' : 'train';
  return h('a', { class: `card insight rise press${viz ? '' : ' no-viz'}`, href: ins.href || '#/train', dataset: { rule: ins.id }, target: /^https?:/.test(ins.href || '') ? '_blank' : null, rel: /^https?:/.test(ins.href || '') ? 'noopener noreferrer' : null },
    h('div', { class: glyphCls }, icon(glyph)),
    h('div.body', kicker(ins.kicker), h('h3', rich(ins.headline)), ins.sub ? h('div.sub', ins.sub) : null),
    viz,
  );
}

/** '+12' / '−5' / '0' with a real minus. */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export { monD };
