import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  schedule,
  monthsElapsed,
  position,
  auditYearOf,
  periodLabel,
} from '../src/depreciation.js';
import Dep from './prototype-depreciation.js';
import samples from '../db/sample-data.js';
test('floor-at-1: reduced final charge, then zero forever', () => {
  const r = schedule(120000, 10, 125);
  assert.equal(r[0].provision, 1000);
  assert.equal(r[119].provision, 999);
  assert.equal(r[119].wdv, 1);
  assert.equal(r[120].provision, 0);
  assert.equal(r[124].wdv, 1);
  assert.equal(r[124].fully, true);
});
test('all 16 prototype sample assets match every monthly schedule and position', () => {
  for (const a of samples().assets) {
    for (const asOf of ['2026-09-17', '2030-04-30', a.datePurchased]) {
      const n = Dep.monthsElapsed(a.datePurchased, asOf);
      assert.equal(monthsElapsed(a.datePurchased, asOf), n);
      assert.deepEqual(
        schedule(a.originalCost, a.depPercent, n),
        Dep.schedule(a.originalCost, a.depPercent, n),
      );
      const actual = position(
        {
          date_purchased: a.datePurchased,
          original_cost: a.originalCost,
          dep_percent: a.depPercent,
        },
        asOf,
      );
      const expected = Dep.position(a, asOf);
      for (const k of Object.keys(expected))
        assert.equal(actual[k], expected[k], `${a.item}: ${k}`);
    }
  }
});
test('dates, leap year, future purchase and month boundary follow prototype policy', () => {
  assert.equal(monthsElapsed('2024-02-29', '2024-02-29'), 0);
  assert.equal(monthsElapsed('2024-02-29', '2024-03-01'), 1);
  assert.equal(monthsElapsed('2027-01-01', '2026-09-17'), 0);
  assert.equal(periodLabel('2024-01-31', 1), '2024-02-01');
  assert.equal(auditYearOf('2026-04-30'), 2026);
  assert.equal(auditYearOf('2026-05-01'), 2027);
});
test('minimum cost, rounding and exact-floor cases', () => {
  assert.deepEqual(
    schedule(1, 100, 2).map((r) => r.provision),
    [0, 0],
  );
  assert.equal(schedule(100, 33.33, 1)[0].provision, 2.78);
  assert.equal(schedule(101, 100, 12).at(-1).wdv, 1);
  assert.equal(
    position({ date_purchased: '2000-01-01', original_cost: 120000, dep_percent: 10 }, '2026-01-01')
      .currentMonthlyProvision,
    0,
  );
});
test('long schedules never lose or create cents and never fall below 1', () => {
  for (const cost of [1, 1.01, 2, 99.99, 120000, 12500000])
    for (const rate of [0.01, 2.5, 15, 33.33, 100]) {
      let prev = cost;
      for (const r of schedule(cost, rate, 2400)) {
        assert.ok(r.wdv >= 1);
        assert.equal(Math.round((r.wdv + r.accumulated) * 100), Math.round(cost * 100));
        assert.equal(Math.round((prev - r.provision) * 100), Math.round(r.wdv * 100));
        prev = r.wdv;
      }
    }
});
