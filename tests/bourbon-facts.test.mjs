// BourbonFacts (SPEC §2.3 / §8.B.5), summary, and the bourbon Coach rules (§6.3) on the Barrel Proof fixture.
import assert from 'node:assert/strict';
import * as bourbon from '../js/pillars/bourbon.js';
import { makeCtx, addDays } from '../js/dates.js';
import { readFixtures, TODAY } from './helpers/golf-bourbon.mjs';
import { buildBourbonSample } from '../js/sample.js';

const ctx = makeCtx(new Date(2026, 8, 28, 21, 0)); // Monday Sep 28 2026, 9 pm
const { bp } = readFixtures();
const clone = (x) => JSON.parse(JSON.stringify(x));
const NAMES = {
  'eagle-rare-10': 'Eagle Rare 10 Year', 'rare-breed': 'Wild Turkey Rare Breed', 'old-forester-1920': 'Old Forester 1920',
  'four-roses-single-barrel': 'Four Roses Single Barrel', 'russells-reserve-10': "Russell's Reserve 10 Year", stagg: 'Stagg',
  'woodford-double-oaked': 'Woodford Reserve Double Oaked', 'elijah-craig-barrel-proof': 'Elijah Craig Barrel Proof',
  'michters-us1-bourbon': "Michter's US*1 Bourbon", 'weller-antique-107': 'Weller Antique 107',
};
const opts = { nameOf: (id) => NAMES[id] || bourbon.humanize(id), metaOf: () => null };
const facts = (st = bp.state, pours = bp.clubhousePours, c = ctx) => bourbon.computeFacts(st, pours, c, opts);
const F = (f, goal = 3, c = ctx) => ({ facts: { bourbon: f }, goals: { golf: 2, train: 5, bourbon: goal, sports: 3 }, ctx: c });

export const tests = {
  'fixture matches the sample builder for its day'() {
    const b = buildBourbonSample(TODAY);
    assert.deepEqual(bp.state, JSON.parse(JSON.stringify(b.state)));
    assert.deepEqual(bp.clubhousePours, JSON.parse(JSON.stringify(b.pours)));
  },
  'open bottles: owned with a count, most-waiting first; the waiting one is the Weller at 40 days'() {
    const f = facts();
    assert.equal(f.openCount, 7);
    assert.equal(f.cabinetCount, 8);
    assert.equal(f.openBottles[0].name, 'Weller Antique 107');
    assert.equal(f.openBottles[0].daysWaiting, 40);
    assert.deepEqual(f.waitingLongest, { bottleId: 'weller-antique-107', name: 'Weller Antique 107', days: 40 });
    const days = f.openBottles.map((b) => b.daysWaiting);
    assert.deepEqual(days, days.slice().sort((a, b) => b - a));
  },
  'openBottles excludes a bottle whose killLog entry is on/after its last tasting'() {
    const st = clone(bp.state);
    st.killLog.push({ bottleId: 'woodford-double-oaked', date: addDays(TODAY, -2), rebuy: null });
    const f = facts(st);
    assert.ok(!f.openBottles.some((b) => b.bottleId === 'woodford-double-oaked'));
    assert.equal(f.rebuyPending, 2);
  },
  'never-tasted owned bottles sort last with daysWaiting null'() {
    const st = clone(bp.state);
    st.statuses['blantons-new'] = 'owned';
    st.collection['blantons-new'] = { count: 1, batches: [], note: '' };
    const f = facts(st);
    const last = f.openBottles[f.openBottles.length - 1];
    assert.equal(last.bottleId, 'blantons-new');
    assert.equal(last.daysWaiting, null);
    assert.equal(last.name, 'Blantons New'); // nameOf falls back to humanize
  },
  'humanize drops a trailing catalog number and title-cases'() {
    assert.equal(bourbon.humanize('weller-special-reserve'), 'Weller Special Reserve');
    assert.equal(bourbon.humanize('michigan-lcc-blanton-bbn-750ml-93730'), 'Michigan Lcc Blanton Bbn 750ml');
    assert.equal(bourbon.nameOf('some-unknown-bottle'), 'Some Unknown Bottle');
  },
  'tastings = Barrel Proof ∪ Clubhouse quick pours, ascending, no dedupe'() {
    const f = facts();
    assert.equal(f.tastings.length, 24 + 2);
    assert.equal(f.tastings.filter((t) => t.source === 'clubhouse').length, 2);
    for (let i = 1; i < f.tastings.length; i++) assert.ok(f.tastings[i - 1].date <= f.tastings[i].date);
    const dupe = [...bp.clubhousePours, { id: 'pour-x', date: TODAY, at: `${TODAY}T20:00:00.000Z`, bottleId: 'eagle-rare-10', bottleName: 'Eagle Rare 10 Year', score: 8.6, note: '', source: 'clubhouse' }];
    assert.equal(facts(bp.state, dupe).tastings.filter((t) => t.date === TODAY && t.bottleId === 'eagle-rare-10').length, 2);
    assert.equal(f.poursCount, 2);
  },
  'week / month / best this month (tie → latest) / last tasting'() {
    const f = facts();
    assert.equal(f.weekTastings.length, 2);
    assert.deepEqual(bourbon.dayMarks(f, ctx), [true, false, false, false, false, false, false]);
    assert.equal(f.bestThisMonth.name, 'Stagg');
    assert.equal(f.bestThisMonth.score, 9.3);
    const st = clone(bp.state);
    st.tastings.unshift({ id: 't-tie', bottleId: 'rare-breed', date: addDays(TODAY, -1), score: 9.3, context: 'Neat pour', blind: false, tags: [], note: '' });
    assert.equal(facts(st).bestThisMonth.name, 'Wild Turkey Rare Breed');
    assert.equal(f.lastTasting.daysAgo, 0);
  },
  'blind90 uses Barrel Proof’s own generous guess matching; null under 3'() {
    const f = facts();
    assert.deepEqual(f.blind90, { n: 3, guessed: 2, pct: 67 });
    const st = clone(bp.state);
    st.tastings = st.tastings.filter((t) => t.id !== 'taste-sample-night-C');
    assert.equal(facts(st).blind90, null);
    assert.ok(bourbon.guessCorrect('eagle rare', 'Eagle Rare 10 Year'));
    assert.ok(!bourbon.guessCorrect('ea', 'Eagle Rare 10 Year'));
    assert.ok(bourbon.isBlind({ context: 'Blind — Tasting Night' }));
  },
  'recent flight within 7 days: winner by the room average'() {
    const f = facts();
    assert.equal(f.recentFlight.winnerName, 'Four Roses Single Barrel');
    assert.equal(f.recentFlight.avg, 9);
    assert.equal(f.recentFlight.glasses, 3);
    const later = makeCtx(new Date(2026, 9, 9, 12, 0));
    assert.equal(facts(bp.state, bp.clubhousePours, later).recentFlight, null);
  },
  'finished bottles carry the rebuy call; a pending one counts toward rebuyPending'() {
    const f = facts();
    assert.equal(f.finishedCount, 2);
    assert.deepEqual(f.finished.map((b) => [b.name, b.rebuy]), [['Stagg', 'pending'], ['Elijah Craig Barrel Proof', 'yes']]);
    assert.equal(f.rebuyPending, 1);
    assert.equal(f.wishlistCount, 1);
  },
  'summary: ring = pours noted this week; waiting note (warm, clock) → best → open count; empty only with nothing at all'() {
    const f = facts();
    const s = bourbon.summary(f, 3, ctx);
    assert.equal(s.ringValue, 2);
    assert.equal(s.sublabel, 'of 3 pours noted');
    assert.deepEqual(s.note, {
      text: 'Weller Antique waiting 40d', tone: 'warm', icon: 'clock',
      // Home tries these in order (fitText): the "40d" survives the one-line tile at every width
      fit: ['Weller Antique waiting 40d', 'Weller waiting 40d', 'Waiting 40d · Weller Antique'],
    });
    const noWait = { ...f, waitingLongest: null };
    assert.deepEqual(bourbon.summary(noWait, 3, ctx).note, { text: 'Best: Stagg 9.3', tone: 'good', fit: ['Best: Stagg 9.3', 'Best 9.3 · Stagg'] });
    // a weak first word is never used alone: the number goes first instead
    assert.deepEqual(bourbon.noteFit('Old Forester 1920', (n) => `${n} waiting 41d`, (n) => `Waiting 41d · ${n}`), ['Old Forester waiting 41d', 'Waiting 41d · Old Forester']);
    assert.deepEqual(bourbon.noteFit('Blanton’s Original', (n) => `Best: ${n} 9.1`, (n) => `Best 9.1 · ${n}`), ['Best: Blanton’s Original 9.1', 'Best: Blanton’s 9.1', 'Best 9.1 · Blanton’s Original']);
    const none = bourbon.computeFacts(null, [], ctx, opts);
    assert.equal(bourbon.summary(none, 3, ctx).empty.cta.href, './apps/barrel-proof/index.html');
    const quickOnly = bourbon.computeFacts(null, bp.clubhousePours, ctx, opts);
    assert.equal(bourbon.summary(quickOnly, 3, ctx).empty, null, 'quick pours alone still fill the ring');
  },
  'rules: B0 when Barrel Proof is empty; the sample fires B1 B2 B5 B6 B3 B4 with exact copy'() {
    assert.deepEqual(bourbon.insights(F(bourbon.computeFacts(null, [], ctx, opts))).map((i) => i.id), ['B0']);
    const list = bourbon.insights(F(facts()));
    assert.deepEqual(list.map((i) => i.id), ['B1', 'B2', 'B5', 'B6', 'B3', 'B4']);
    const by = Object.fromEntries(list.map((i) => [i.id, i]));
    assert.equal(by.B1.headline, 'The <span class="warn">Weller Antique 107</span> has been waiting 40 days.');
    assert.equal(by.B1.sub, 'Eagle Rare poured today · Wild Turkey poured today · 8 in the cabinet');
    assert.deepEqual(by.B1.viz.levels[0], { pct: 60, wait: true });
    assert.equal(by.B2.headline, 'Best pour this month: <strong>Stagg, 9.3</strong>.');
    assert.equal(by.B5.headline, 'One more pour noted <strong>hits your goal</strong>.');
    assert.equal(by.B5.sub, '7 open · last: Eagle Rare 8.6');
    assert.equal(by.B6.headline, 'Tasting Night Thursday: <strong>Four Roses Single Barrel</strong> took the flight.');
    assert.equal(by.B3.headline, '<strong>1 finished bottle</strong> waiting on a rebuy call.');
    assert.equal(by.B4.headline, 'Blind tasting: <strong>2 of 3</strong> called right in 90 days.');
  },
  'rules escape names that go into rich text'() {
    const st = clone(bp.state);
    st.statuses['evil'] = 'owned';
    st.collection.evil = { count: 1, batches: [], note: '' };
    st.tastings.push({ id: 't-evil', bottleId: 'evil', date: addDays(TODAY, -300), score: 5, context: '', blind: false, tags: [], note: '' });
    const f = bourbon.computeFacts(st, [], ctx, { nameOf: (id) => (id === 'evil' ? '<img src=x onerror=alert(1)>' : NAMES[id]), metaOf: () => null });
    const b1 = bourbon.insights(F(f)).find((i) => i.id === 'B1');
    assert.ok(!b1.headline.includes('<img'));
    assert.ok(b1.headline.includes('&lt;img'));
  },
};
