import assert from 'node:assert/strict';
import * as d from '../js/dates.js';

export const tests = {
  'ymd uses the local calendar date (no UTC drift at 11 pm)'() {
    assert.equal(d.ymd(new Date(2026, 8, 25, 23, 30)), '2026-09-25');
    assert.equal(d.ymd(new Date(2026, 0, 5)), '2026-01-05');
  },
  'weeks start Monday; Sunday belongs to the week before'() {
    assert.equal(d.mondayOf('2026-09-25'), '2026-09-21');
    assert.equal(d.mondayOf('2026-09-27'), '2026-09-21');
    assert.equal(d.mondayOf('2026-09-28'), '2026-09-28');
    assert.equal(d.dowIndex('2026-09-21'), 0);
    assert.equal(d.dowIndex('2026-09-27'), 6);
  },
  'ISO week numbers'() {
    assert.equal(d.isoWeek('2026-09-25'), 39);
    assert.equal(d.isoWeek('2026-01-01'), 1);
    assert.equal(d.isoWeek('2027-01-01'), 53); // a Friday: belongs to 2026-W53
    assert.equal(d.isoWeek('2024-12-30'), 1);
  },
  'addDays / daysBetween across DST'() {
    assert.equal(d.addDays('2026-11-01', 1), '2026-11-02');
    assert.equal(d.addDays('2026-03-07', 2), '2026-03-09');
    assert.equal(d.daysBetween('2026-03-07', '2026-03-09'), 2);
    assert.equal(d.daysBetween('2026-09-25', '2026-09-20'), -5);
  },
  'makeCtx (Friday Sep 25 2026, 3 pm)'() {
    const c = d.makeCtx(new Date(2026, 8, 25, 15, 0));
    assert.equal(c.today, '2026-09-25');
    assert.equal(c.weekStart, '2026-09-21');
    assert.equal(c.weekEnd, '2026-09-27');
    assert.equal(c.prevWeekStart, '2026-09-14');
    assert.equal(c.weekNo, 39);
    assert.equal(c.dayIndex, 4);
    assert.equal(c.daysLeft, 2);
    assert.equal(c.hour, 15);
    assert.equal(c.season, 2026);
  },
  'day words'() {
    const c = d.makeCtx(new Date(2026, 8, 25, 12));
    assert.equal(d.dayWord('2026-09-25', c), 'today');
    assert.equal(d.dayWord('2026-09-26', c), 'tomorrow');
    assert.equal(d.dayWord('2026-09-27', c), 'Sunday');
    assert.equal(d.dayWord('2026-09-27', c, { short: true }), 'Sun');
    assert.equal(d.dayWord('2026-10-09', c), 'Oct 9');
  },
  'formatting'() {
    assert.equal(d.time12(new Date(2026, 8, 27, 13, 0)), '1:00');
    assert.equal(d.time12(new Date(2026, 8, 27, 19, 5), { ampm: true }), '7:05 pm');
    assert.equal(d.monD('2026-09-27'), 'Sep 27');
    assert.equal(d.fileStamp(new Date(2026, 8, 25, 9, 4)), '2026-09-25-0904');
    assert.equal(d.eyebrow(d.makeCtx(new Date(2026, 8, 25, 9))), 'Friday · Sep 25 · Week 39');
  },
  'lastWeeks returns n Mondays, oldest first'() {
    assert.deepEqual(d.lastWeeks('2026-09-25', 3), ['2026-09-07', '2026-09-14', '2026-09-21']);
  },
};
