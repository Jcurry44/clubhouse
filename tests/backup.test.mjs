// Pure parts of js/backup.js (the IDB paths — replaceAll atomicity, snapshot cap, export byte order,
// import cancel/replace/undo — are verified in a real browser by design/build/shell-verify.py).
import assert from 'node:assert/strict';
import * as b from '../js/backup.js';

const day = 864e5;
const NOW = new Date('2026-09-25T20:00:00Z');
const facts = (w = 0, r = 0, t = 0) => ({ train: { totalWorkouts: w }, golf: { rounds: Array(r).fill({}) }, bourbon: { tastings: Array(t).fill({ source: 'barrel-proof' }) } });

export const tests = {
  'detect: the four file kinds'() {
    assert.equal(b.detect({ app: 'clubhouse', format: 1, idb: {} }), 'clubhouse');
    assert.equal(b.detect({ app: 'clubhouse', format: 2, idb: {} }), 'unknown'); // from the future
    assert.equal(b.detect({ app: 'clubhouse', format: '1', idb: {} }), 'unknown');
    assert.equal(b.detect({ courses: [], rounds: [] }), 'fairway-ledger');
    assert.equal(b.detect({ app: 'barrel-proof', state: {} }), 'barrel-proof');
    assert.equal(b.detect({ hello: 1 }), 'unknown');
    assert.equal(b.detect(null), 'unknown');
    assert.equal(b.detect([1, 2]), 'unknown');
  },
  'validate refuses rows without their key and non-string vendored values'() {
    assert.equal(b.validate({ app: 'clubhouse', format: 1, idb: { workouts: [{ id: 'wk-1' }] }, localStorage: {} }), null);
    assert.match(b.validate({ app: 'clubhouse', format: 1, idb: { workouts: [{ date: 'x' }] } }), /without id/);
    assert.match(b.validate({ app: 'clubhouse', format: 1, idb: { watched: [{ id: 'x' }] } }), /without gameId/);
    assert.match(b.validate({ app: 'clubhouse', format: 1, idb: { workouts: {} } }), /not a list/);
    assert.match(b.validate({ app: 'clubhouse', format: 1, idb: {}, localStorage: { 'fairwayLedger.v1': { rounds: [] } } }), /raw string/);
  },
  'fileCounts + previewRows only show what the file carries'() {
    const file = { app: 'clubhouse', format: 1, idb: { workouts: [{ id: 1 }, { id: 2 }], prs: [], pours: [{ id: 'p' }] }, localStorage: { 'fairwayLedger.v1': JSON.stringify({ courses: [], rounds: [{}, {}, {}] }) } };
    const fc = b.fileCounts(file);
    assert.deepEqual(fc, { workouts: 2, prs: 0, pours: 1, rounds: 3 });
    const rows = b.previewRows({ workouts: 5, prs: 1, pours: 0, rounds: 1, tastings: 9 }, fc);
    assert.deepEqual(rows.map((r) => r.key), ['workouts', 'prs', 'pours', 'rounds']);
    assert.deepEqual(rows[0], { key: 'workouts', label: 'Workouts', now: 5, file: 2 });
  },
  'vendoredCounts reads rounds and tastings from raw strings, tolerating junk'() {
    assert.deepEqual(b.vendoredCounts({ 'fairwayLedger.v1': '{"courses":[1],"rounds":[1,2]}', 'barrel-proof-state-v1': '{"tastings":[1]}' }), { rounds: 2, courses: 1, tastings: 1 });
    assert.deepEqual(b.vendoredCounts({ 'fairwayLedger.v1': 'not json' }), { rounds: 0, courses: 0, tastings: 0 });
  },
  'nudge: nothing to back up is never due'() {
    assert.equal(b.needsNudge(facts(), {}, NOW).due, false);
  },
  'nudge: never backed up + data -> due (age, days null)'() {
    const n = b.needsNudge(facts(1), {}, NOW);
    assert.equal(n.due, true);
    assert.equal(n.reason, 'age');
    assert.equal(n.days, null);
  },
  'nudge: age boundary is 7 days'() {
    const last = { workouts: 1, rounds: 0, tastings: 0 };
    const at7 = new Date(NOW - 7 * day).toISOString();
    const over7 = new Date(NOW - 7 * day - 60000).toISOString();
    assert.equal(b.needsNudge(facts(1), { lastExportAt: at7, lastExportCounts: last }, NOW).due, false);
    const n = b.needsNudge(facts(1), { lastExportAt: over7, lastExportCounts: last }, NOW);
    assert.equal(n.due, true);
    assert.equal(n.reason, 'age');
    assert.equal(n.days, 7);
  },
  'nudge: volume = 3 new records since the last export'() {
    const s = { lastExportAt: new Date(NOW - day).toISOString(), lastExportCounts: { workouts: 4, rounds: 10, tastings: 2 } };
    assert.equal(b.needsNudge(facts(5, 11, 2), s, NOW).due, false); // 2 new
    const n = b.needsNudge(facts(5, 11, 3), s, NOW); // 3 new
    assert.equal(n.due, true);
    assert.equal(n.reason, 'volume');
    assert.equal(n.newRecords, 3);
  },
  'nudge: accepts the backup.* setting keys too'() {
    const s = { 'backup.lastExportAt': new Date(NOW - day).toISOString(), 'backup.lastExportCounts': { workouts: 0 } };
    assert.equal(b.needsNudge(facts(3), s, NOW).reason, 'volume');
  },
  'nudge: snooze suppresses until it passes'() {
    const s = { snoozedUntil: new Date(NOW.getTime() + 2 * day).toISOString() };
    assert.equal(b.needsNudge(facts(9), s, NOW).due, false);
    assert.equal(b.needsNudge(facts(9), s, new Date(NOW.getTime() + 2 * day + 1)).due, true);
  },
  'nudge: Clubhouse quick pours count once (not as Barrel Proof tastings)'() {
    const f = { train: { totalWorkouts: 0 }, golf: { rounds: [] }, bourbon: { tastings: [{ source: 'clubhouse' }, { source: 'clubhouse' }] } };
    const s = { lastExportAt: new Date(NOW - day).toISOString(), lastExportCounts: { pours: 2 }, pours: 2 };
    assert.equal(b.needsNudge(f, s, NOW).due, false);
  },
  'fileName + deviceLabel'() {
    assert.equal(b.fileName(new Date(2026, 8, 25, 21, 7)), 'clubhouse-backup-2026-09-25-2107.json');
    assert.equal(b.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari 26');
    assert.equal(b.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'), 'Windows · Edge 140');
  },
};
