import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPeriod, financialRow, sumFinancial } from '../src/fixed-assets.js';
const p = reportPeriod({ toMonth: '2026-09' });
const asset = (date, cost = 1200, rate = 12) => ({
  id: date,
  date_purchased: date,
  original_cost: cost,
  dep_percent: rate,
});
test('financial year defaults, custom month ranges and invalid periods', () => {
  assert.equal(p.start, '2026-05-01');
  assert.equal(p.opening, '2026-04-30');
  assert.equal(p.end, '2026-09-30');
  assert.equal(reportPeriod({ toMonth: '2026-04' }).start, '2025-05-01');
  assert.equal(reportPeriod({ fromMonth: '2024-02', toMonth: '2024-02' }).end, '2024-02-29');
  assert.throws(() => reportPeriod({ fromMonth: '2026-10', toMonth: '2026-09' }));
  assert.throws(() => reportPeriod({ toMonth: '2026-13' }));
});
test('ten financial columns reconcile old assets, new purchases and the final reduced charge', () => {
  const old = financialRow(asset('2025-04-30'), p);
  assert.equal(old.openingCost, 1200);
  assert.equal(old.purchases, 0);
  assert.equal(old.openingAccumulated, 144);
  assert.equal(old.openingWdv, 1056);
  assert.equal(old.periodDep, 60);
  assert.equal(old.closingAccumulated, 204);
  assert.equal(old.closingWdv, 996);
  const purchase = financialRow(asset('2026-06-01'), p);
  assert.equal(purchase.openingCost, 0);
  assert.equal(purchase.purchases, 1200);
  assert.equal(purchase.openingWdv, 0);
  assert.equal(purchase.purchaseDep, 36);
  const boundary = financialRow(asset('2026-05-01'), p);
  assert.equal(boundary.purchases, 1200);
  assert.equal(boundary.periodDep, 48);
  const final = financialRow(asset('2026-04-30', 1.01, 100), p);
  assert.equal(final.periodDep, 0.01);
  assert.equal(final.closingWdv, 1);
  assert.equal(financialRow(asset('2026-10-01'), p), null);
  const totals = sumFinancial([old, purchase, boundary, final]);
  for (const r of [old, purchase, boundary, final, totals]) {
    const cents = (n) => Math.round(n * 100);
    assert.equal(cents(r.openingCost) + cents(r.purchases), cents(r.closingCost));
    assert.equal(cents(r.openingCost) - cents(r.openingAccumulated), cents(r.openingWdv));
    assert.equal(cents(r.openingAssetDep) + cents(r.purchaseDep), cents(r.periodDep));
    assert.equal(cents(r.openingAccumulated) + cents(r.periodDep), cents(r.closingAccumulated));
    assert.equal(cents(r.closingCost) - cents(r.closingAccumulated), cents(r.closingWdv));
  }
});
