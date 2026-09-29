// Train — what every Train screen needs, loaded once per draw: ctx, goal, the stored dataset (through the trainSource
// seam) and the facts computed from it. Never throws: a broken read becomes zero-shaped, "not imported" facts.
import * as store from '../store.js';
import { makeCtx } from '../dates.js';
import { activeSource } from './source.js';
import { analyze, emptyFacts } from './model.js';

export async function loadView(now = new Date()) {
  const ctx = makeCtx(now);
  let goal = 5;
  try { goal = (await store.goals()).train; } catch { /* default */ }
  try {
    const { dataset } = await activeSource().load();
    return { ctx, goal, dataset, f: analyze(dataset, ctx, goal), error: null };
  } catch (err) {
    console.warn('train data failed to load', err);
    return { ctx, goal, dataset: null, f: emptyFacts(goal, err), error: err };
  }
}

/** The other pillars' facts some Train insights read (Golf, for the golf-mobility nudge). Best effort. */
export async function siblingFacts(ctx) {
  const out = {};
  try {
    const { byId } = await import('../pillars/index.js');
    if (byId.golf && typeof byId.golf.facts === 'function') out.golf = await byId.golf.facts(ctx);
  } catch { /* the insight simply stays quiet */ }
  return out;
}

/** sessionId → PRs set in that session, from facts.prsAll. */
export function prBySession(f) {
  const m = new Map();
  for (const p of f.prsAll || []) {
    if (!m.has(p.sessionId)) m.set(p.sessionId, []);
    m.get(p.sessionId).push(p);
  }
  return m;
}
