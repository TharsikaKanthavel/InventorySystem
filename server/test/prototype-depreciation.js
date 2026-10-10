const Dep = (() => {
  const FLOOR = 100; // cents
  const toC = a => Math.round(Number(a) * 100);
  const mpC = (oc, r) => Math.round((toC(oc) * Number(r)) / 1200);
  function schedule(oc, r, months) {
    const ocC = toC(oc), mp = mpC(oc, r), rows = [];
    let wdv = ocC, fully = wdv <= FLOOR;
    for (let m = 1; m <= months; m++) {
      let p = 0;
      if (!fully) {
        if (wdv - mp < FLOOR) { p = Math.max(wdv - FLOOR, 0); fully = true; } else p = mp;
        wdv -= p; if (wdv <= FLOOR) fully = true;
      }
      rows.push({ month: m, provision: p / 100, wdv: wdv / 100, accumulated: (ocC - wdv) / 100, fully });
    }
    return rows;
  }
  function monthsElapsed(datePurchased, asOf, offset = 1) {
    const a = new Date(datePurchased), b = new Date(asOf);
    const diff = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    return Math.max(diff - offset + 1, 0);
  }
  function position(asset, asOf) {
    const n = monthsElapsed(asset.datePurchased, asOf);
    const mp = mpC(asset.originalCost, asset.depPercent) / 100;
    if (n === 0) return { months: 0, provision: 0, wdv: asset.originalCost, accumulated: 0, fully: toC(asset.originalCost) <= FLOOR, monthlyProvision: mp };
    const rows = schedule(asset.originalCost, asset.depPercent, n);
    return { months: n, monthlyProvision: mp, ...rows[n - 1] };
  }
  function periodLabel(datePurchased, m) {
    const d = new Date(datePurchased); d.setDate(1); d.setMonth(d.getMonth() + m);
    return d;
  }
  return { schedule, monthsElapsed, position, periodLabel, monthlyProvision: (oc, r) => mpC(oc, r) / 100 };
})();


export default Dep;