// The IndexedDB-backed half of the Sports pillar, against the shared in-memory IndexedDB (tests/helpers/fake-idb.mjs):
// facts() end to end (fetch → feed → rows → settings), the watched-row writers with their snapshot rule, and the
// watched games inside a Clubhouse backup (export → wipe → restore → undo). Every test leaves the stores it touched empty.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, installLocalStorage } from './helpers/fake-idb.mjs';
import * as store from '../js/store.js';
import * as backup from '../js/backup.js';
import * as sports from '../js/pillars/sports.js';
import { makeCtx } from '../js/dates.js';

install();
installLocalStorage();

const FEED = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sports.sample.json'), 'utf8'));
const NOW = new Date('2026-09-28T17:00:00Z');
const ctx = makeCtx(NOW);
const G = (id) => sports.buildFacts({ feed: JSON.parse(JSON.stringify(FEED)), ctx }).games.find((g) => g.id === id);

async function wipe() {
  for (const s of ['watched', 'settings', 'snapshots']) await store.clear(s);
  sports._resetFeedCache();
}

/** Runs fn with a stubbed fetch (and optionally navigator.onLine), always restoring both. */
async function withNet({ fetch: fake, onLine }, fn) {
  const realFetch = globalThis.fetch;
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.fetch = fake;
  if (onLine !== undefined) Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  try { return await fn(); } finally {
    globalThis.fetch = realFetch;
    if (onLine !== undefined) { if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete globalThis.navigator; }
  }
}
const okFeed = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(FEED)) });

export const tests = {
  async 'facts(): reads the feed, the watched rows and the team / dismissed settings'() {
    await wipe();
    try {
      await store.put('watched', { gameId: 'nfl-401872953', date: '2026-09-27', team: 'bills', watchedAt: '2026-09-27T22:00:00Z', where: '', note: '' });
      await store.setSetting('sports.teams', ['bills', 'sabres']);
      await store.setSetting('sports.dismissed.nhl-2026010055', true);
      await store.setSetting('sports.dismissed.nfl-1', false);
      const f = await withNet({ fetch: okFeed }, () => sports.facts(ctx));
      assert.equal(f.available, true);
      assert.deepEqual(f.followed, ['bills', 'sabres']);
      assert.ok(f.games.every((g) => g.team !== 'bisons'));
      assert.equal(f.lastResultWatched, true);
      assert.deepEqual(f.dismissed, { 'nhl-2026010055': true });
      assert.equal(f.watchedCount, 1);
      assert.equal(f.prevWeekWatched, 1);
      assert.equal(f.offline, false);
      assert.equal(f.fetchFailed, false);
    } finally { await wipe(); }
  },

  async 'facts(): default teams when the setting is missing or empty'() {
    await wipe();
    try {
      let f = await withNet({ fetch: okFeed }, () => sports.facts(ctx));
      assert.deepEqual(f.followed, ['bills', 'sabres', 'bisons']);
      await store.setSetting('sports.teams', []);
      sports._resetFeedCache();
      f = await withNet({ fetch: okFeed }, () => sports.facts(ctx));
      assert.deepEqual(f.followed, ['bills', 'sabres', 'bisons']);
    } finally { await wipe(); }
  },

  async 'facts(): a 404 or a network error is "unavailable", a later failure keeps the last good feed'() {
    await wipe();
    try {
      let f = await withNet({ fetch: async () => ({ ok: false, status: 404 }) }, () => sports.facts(ctx));
      assert.equal(f.available, false);
      assert.equal(f.fetchFailed, true);
      assert.match(f.error, /404/);
      sports._resetFeedCache();
      f = await withNet({ fetch: async () => { throw new TypeError('Failed to fetch'); } }, () => sports.facts(ctx));
      assert.equal(f.available, false);
      assert.match(f.error, /Failed to fetch/);

      sports._resetFeedCache();
      f = await withNet({ fetch: okFeed }, () => sports.facts(ctx));
      assert.equal(f.available, true);
      // the next fetch (forced) fails → the copy in memory is still shown, and it says the refresh failed
      await withNet({ fetch: async () => { throw new TypeError('offline'); } }, async () => {
        await sports.loadFeed({ force: true });
        f = await sports.facts(ctx);
      });
      assert.equal(f.available, true);
      assert.equal(f.fetchFailed, true);
      assert.equal(f.generatedAt, '2026-09-28T17:00:00Z');
      assert.equal(f.games.length > 0, true);
    } finally { await wipe(); }
  },

  async 'facts(): a feed from a newer schema is refused, not half-read'() {
    await wipe();
    try {
      const f = await withNet({ fetch: async () => ({ ok: true, json: async () => ({ ...FEED, schemaVersion: 2 }) }) }, () => sports.facts(ctx));
      assert.equal(f.available, false);
      assert.match(f.error, /unrecognised/);
    } finally { await wipe(); }
  },

  async 'facts(): navigator.onLine === false is reported as offline (the cached copy is still shown)'() {
    await wipe();
    try {
      const f = await withNet({ fetch: okFeed, onLine: false }, () => sports.facts(ctx));
      assert.equal(f.available, true);
      assert.equal(f.offline, true);
    } finally { await wipe(); }
  },

  async 'markWatched writes the row the sheet and the screen share; unmarkWatched snapshots first, once per burst'() {
    await wipe();
    try {
      const bills = G('nfl-401872953');
      const row = await sports.markWatched(bills);
      assert.deepEqual(Object.keys(row).sort(), ['date', 'gameId', 'note', 'team', 'watchedAt', 'where']);
      assert.equal(row.gameId, 'nfl-401872953');
      assert.equal(row.date, '2026-09-27');
      assert.equal(row.team, 'bills');
      assert.equal(row.where, '');
      assert.equal((await store.get('watched', 'nfl-401872953')).gameId, 'nfl-401872953');
      await sports.markWatched(G('nhl-2026010055'));
      await sports.markWatched(G('nhl-2026010041'));
      assert.equal(await store.count('watched'), 3);
      assert.equal(await store.count('snapshots'), 0, 'marking watched is not destructive');

      const removed = await sports.unmarkWatched('nfl-401872953');
      assert.equal(removed.gameId, 'nfl-401872953');
      assert.equal(await store.get('watched', 'nfl-401872953'), undefined);
      assert.equal(await store.count('watched'), 2);
      const snaps = await backup.listSnapshots();
      assert.equal(snaps.length, 1);
      assert.equal(snaps[0].label, 'before-unwatch');
      assert.equal(snaps[0].counts.watched, 3, 'the snapshot has the game that was just removed');

      await sports.unmarkWatched('nhl-2026010055');
      assert.equal((await backup.listSnapshots()).length, 1, 'a burst of taps must not push older snapshots out of the rolling five');

      // Undo puts the exact row back
      await sports.restoreWatched(removed);
      assert.deepEqual(await store.get('watched', 'nfl-401872953'), removed);

      assert.equal(await sports.unmarkWatched('nope'), null);
    } finally { await wipe(); }
  },

  async 'unmarkWatched takes a new snapshot when the newest one is not a recent before-unwatch'() {
    await wipe();
    try {
      await sports.markWatched(G('nfl-401872953'));
      await sports.markWatched(G('nhl-2026010055'));
      await backup.snapshot('before-import');
      await sports.unmarkWatched('nfl-401872953');
      const labels = (await backup.listSnapshots()).map((s) => s.label);
      assert.deepEqual(labels, ['before-unwatch', 'before-import']);
    } finally { await wipe(); }
  },

  async 'dismissGame writes the settings row S2 reads'() {
    await wipe();
    try {
      await sports.dismissGame('nfl-401872953');
      assert.equal(await store.setting('sports.dismissed.nfl-401872953', false), true);
      const f = await withNet({ fetch: okFeed }, () => sports.facts(ctx));
      assert.equal(f.dismissed['nfl-401872953'], true);
      assert.equal(sports.insights({ facts: { sports: f }, goals: { sports: 3 }, ctx }).find((i) => i.id === 'S2'), undefined);
    } finally { await wipe(); }
  },

  async 'backup: watched games are in the payload, survive wipe → restore, and the Undo snapshot brings back what was there'() {
    await wipe();
    try {
      for (const id of ['nfl-401872953', 'nhl-2026010055', 'nhl-2026010041']) await sports.markWatched(G(id));
      await store.setSetting('sports.dismissed.nhl-2026010016', true);
      const payload = await backup.buildPayload(new Date('2026-09-28T20:00:00Z'));
      assert.equal(payload.counts.watched, 3);
      assert.deepEqual(payload.idb.watched.map((r) => r.gameId).sort(), ['nfl-401872953', 'nhl-2026010041', 'nhl-2026010055']);
      assert.ok(payload.idb.settings.some((r) => r.key === 'sports.dismissed.nhl-2026010016'));
      assert.deepEqual(Object.keys(payload.idb).indexOf('watched') > -1, true);
      const json = JSON.parse(JSON.stringify(payload));

      // wipe the phone, then bring the file back
      await store.clear('watched');
      await store.clear('settings');
      assert.equal(await store.count('watched'), 0);
      const res = await backup.restore(json, 'before-import');
      assert.equal(res.counts.watched, 3);
      assert.equal(await store.count('watched'), 3);
      assert.equal((await store.get('watched', 'nhl-2026010041')).team, 'sabres');
      assert.equal(await store.setting('sports.dismissed.nhl-2026010016', false), true);

      // the restore snapshotted the empty state first; Undo returns to it
      assert.equal(res.snap.counts.watched, 0);
      await backup.restoreSnapshot(res.snap.id, 'before-restore');
      assert.equal(await store.count('watched'), 0);
    } finally { await wipe(); }
  },

  async 'backup: a Clubhouse file from before Sports (no watched store) leaves the watched games alone'() {
    await wipe();
    try {
      await sports.markWatched(G('nfl-401872953'));
      const old = { app: 'clubhouse', format: 1, exportedAt: '2026-09-01T00:00:00Z', device: 'x', cacheVersion: 'x', counts: {}, idb: { workouts: [] }, localStorage: {} };
      await backup.restore(old, 'before-import');
      assert.equal(await store.count('watched'), 1);
    } finally { await wipe(); }
  },

  async 'backup: a watched row without its gameId is refused before anything is written'() {
    await wipe();
    try {
      await sports.markWatched(G('nfl-401872953'));
      const bad = { app: 'clubhouse', format: 1, idb: { watched: [{ date: '2026-09-27', team: 'bills' }] }, localStorage: {} };
      await assert.rejects(() => backup.restore(bad, 'before-import'), /without gameId/);
      assert.equal(await store.count('watched'), 1);
      assert.equal(await store.count('snapshots'), 0, 'an invalid file must not even snapshot');
    } finally { await wipe(); }
  },

  async 'backup: the volume nudge sees watched games through facts.sports.watchedCount'() {
    await wipe();
    try {
      for (const id of ['nfl-401872953', 'nhl-2026010055', 'nhl-2026010041']) await sports.markWatched(G(id));
      const f = await withNet({ fetch: okFeed }, () => sports.facts(ctx));
      const n = await backup.nudgeState({ sports: f }, new Date('2026-09-28T20:00:00Z'));
      assert.equal(n.newRecords, 3);
      assert.equal(n.due, true);
    } finally { await wipe(); }
  },
};
