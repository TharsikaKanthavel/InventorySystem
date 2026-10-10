import React from 'react';

const amount = value => Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 });
function Bars({ title, rows }) {
  const max = Math.max(1, ...rows.map(row => Number(row.count) || 0));
  return <section className="panel dashboard-chart">
    <h3>{title}</h3>
    <div className="chart-bars" role="list" aria-label={title}>
      {rows.map(row => <div className="chart-bar-row" role="listitem" key={row.name}>
        <div className="chart-bar-label"><span>{row.name}</span><strong>{amount(row.count)}</strong></div>
        <div className="chart-track" aria-hidden="true"><div style={{ width: `${Number(row.count) / max * 100}%` }} /></div>
      </div>)}
    </div>
    {!rows.some(row => Number(row.count) > 0) && <p className="muted">No assets recorded yet.</p>}
  </section>;
}
export default function DashboardCharts({ data, admin }) {
  const cost = Number(data.totals.cost) || 0;
  const accumulated = Number(data.totals.acc) || 0;
  const wdv = Number(data.totals.wdv) || 0;
  const percent = cost > 0 ? Math.min(100, Math.max(0, accumulated / cost * 100)) : 0;
  return <div className="dashboard-charts">
    <Bars title="Assets by category" rows={data.categories} />
    {admin && <Bars title="Assets by branch" rows={data.branches} />}
    <section className="panel dashboard-chart">
      <h3>Asset value breakdown</h3>
      <div className="value-donut" role="img" aria-label={`Accumulated depreciation LKR ${amount(accumulated)}; remaining value LKR ${amount(wdv)}`}
        style={{ background: cost ? `conic-gradient(#c87823 0% ${percent}%, #2b7657 ${percent}% 100%)` : '#e9eeeb' }}>
        <div><strong>{cost ? `${(100 - percent).toFixed(1)}%` : '0%'}</strong><span>Remaining value</span></div>
      </div>
      <div className="value-legend"><span><i className="legend-dep" />Depreciation</span><strong>LKR {amount(accumulated)}</strong></div>
      <div className="value-legend"><span><i className="legend-wdv" />Remaining value</span><strong>LKR {amount(wdv)}</strong></div>
      {!cost && <p className="muted">No asset value recorded yet.</p>}
    </section>
  </div>;
}
