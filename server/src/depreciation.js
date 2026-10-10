export const CATEGORIES = [
  'Computer Accessories',
  'Furniture & Fitting',
  'Land & Building',
  'Machineries & Equipment',
  'Medical Equipment',
];
// TODO: confirm with client: financial year ends 30 April; first charge is the month after purchase.
export const auditYearOf = (iso) => Number(iso.slice(0, 4)) + (Number(iso.slice(5, 7)) > 4 ? 1 : 0);
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const toCents = (n) => Math.round(Number(n) * 100);
export const monthlyProvision = (cost, rate) =>
  Math.round((toCents(cost) * Number(rate)) / 1200) / 100;
export function monthsElapsed(purchased, asOf, offset = 1) {
  return Math.max(
    (Number(asOf.slice(0, 4)) - Number(purchased.slice(0, 4))) * 12 +
      Number(asOf.slice(5, 7)) -
      Number(purchased.slice(5, 7)) -
      offset +
      1,
    0,
  );
}
export function periodLabel(purchased, month) {
  return new Date(
    Date.UTC(Number(purchased.slice(0, 4)), Number(purchased.slice(5, 7)) - 1 + month, 1),
  )
    .toISOString()
    .slice(0, 10);
}
export function schedule(cost, rate, months, openingAccumulated = 0) {
  const original = toCents(cost),
    normal = Math.round((original * Number(rate)) / 1200),
    rows = [];
  let wdv = original - toCents(openingAccumulated),
    fully = wdv <= 100;
  for (let month = 1; month <= months; month++) {
    const provision = fully ? 0 : Math.min(normal, Math.max(wdv - 100, 0));
    wdv -= provision;
    fully = wdv <= 100;
    rows.push({
      month,
      provision: provision / 100,
      wdv: wdv / 100,
      accumulated: (original - wdv) / 100,
      fully,
    });
  }
  return rows;
}
export function position(asset, asOf) {
  if (asset.opening_balance_date && asOf < asset.opening_balance_date)
    throw Object.assign(
      new Error(
        'Opening balances are available from ' +
          asset.opening_balance_date +
          '. Choose a later reporting date.',
      ),
      { status: 400 },
    );
  const months = monthsElapsed(asset.opening_balance_date || asset.date_purchased, asOf),
    normal = monthlyProvision(asset.original_cost, asset.dep_percent);
  const row = months
    ? schedule(asset.original_cost, asset.dep_percent, months, asset.opening_accumulated || 0).at(
        -1,
      )
    : {
        provision: 0,
        wdv: (toCents(asset.original_cost) - toCents(asset.opening_accumulated || 0)) / 100,
        accumulated: Number(asset.opening_accumulated || 0),
        fully: toCents(asset.original_cost) - toCents(asset.opening_accumulated || 0) <= 100,
      };
  return {
    ...row,
    months,
    monthlyProvision: normal,
    currentMonthlyProvision: row.fully ? 0 : normal,
  };
}
export function assetSchedule(asset, asOf) {
  position(asset, asOf); // Refuse unavailable historical periods.
  const start = asset.opening_balance_date || asset.date_purchased;
  return schedule(
    asset.original_cost,
    asset.dep_percent,
    monthsElapsed(start, asOf),
    asset.opening_accumulated || 0,
  ).map((r) => ({
    ...r,
    period: periodLabel(start, r.month),
    audit_year: auditYearOf(periodLabel(start, r.month)),
  }));
}
export function totals(assets) {
  const t = { count: assets.length, cost: 0, acc: 0, wdv: 0, fully: 0, monthly: 0 };
  for (const a of assets) {
    t.cost += toCents(a.original_cost);
    t.acc += toCents(a.position.accumulated);
    t.wdv += toCents(a.position.wdv);
    t.monthly += toCents(a.position.currentMonthlyProvision);
    t.fully += Number(a.position.fully);
  }
  for (const k of ['cost', 'acc', 'wdv', 'monthly']) t[k] /= 100;
  return t;
}
export async function persistSchedule(c, asset, asOf = today()) {
  const rows = assetSchedule(asset, asOf);
  await c.query('DELETE FROM depreciation_log WHERE asset_id=$1', [asset.id]);
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    const values = batch.flatMap((r) => [asset.id, r.period, r.provision, r.wdv]);
    await c.query(
      'INSERT INTO depreciation_log(asset_id,period,provision,wdv) VALUES ' +
        batch
          .map((_, i) => '(' + [1, 2, 3, 4].map((n) => '$' + (i * 4 + n)).join(',') + ')')
          .join(','),
      values,
    );
  }
  await c.query('UPDATE assets SET status=$2 WHERE id=$1', [
    asset.id,
    position(asset, asOf).fully ? 'fully_depreciated' : 'active',
  ]);
}
