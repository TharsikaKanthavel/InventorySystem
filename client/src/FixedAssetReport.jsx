import React, { useState } from 'react';
import { api, query } from './api';
const fyStart = (month) =>
  `${Number(month.slice(0, 4)) - (Number(month.slice(5, 7)) < 5 ? 1 : 0)}-05`;
const amount = (n) =>
  Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export default function FixedAssetReport({ lookups, auth, asOf }) {
  const [branch, setBranch] = useState(auth.branch_id || lookups.branches[0]?.id || '');
  const [toMonth, setTo] = useState(asOf.slice(0, 7));
  const [fromMonth, setFrom] = useState(fyStart(asOf.slice(0, 7)));
  const [source, setSource] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (setter) => (e) => {
    setter(e.target.value);
    setReport(null);
  };
  async function generate(e) {
    e.preventDefault();
    setBusy(true);
    setReport(null);
    setError('');
    try {
      setReport(
        await api('/reports/fixed-assets?' + query({ branch, source, fromMonth, toMonth })),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function download(format) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        '/api/reports/fixed-assets?' +
          query({
            branch: report.branchId,
            source: report.sourceId,
            fromMonth: report.fromMonth,
            toMonth: report.toMonth,
            format,
          }),
        { credentials: 'same-origin' },
      );
      if (!res.ok) throw Error((await res.json()).error || 'Export failed');
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.branch}-Fixed-Assets-${report.fromMonth}-to-${report.toMonth}-${report.source.replace(/[^a-zA-Z0-9-]/g, '-')}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel fixed-asset-report" style={{ marginBottom: 20 }}>
      <div className="panel-h">
        <div>
          <h2>Fixed asset and depreciation schedule</h2>
          <p className="small muted">
            Opening balances, purchases, period depreciation and closing balances.
          </p>
        </div>
      </div>
      <form className="actions" onSubmit={generate}>
        <label>
          Financial year
          <select
            aria-label="Financial year"
            disabled={busy}
            value={
              fromMonth.endsWith('-05') && toMonth === `${Number(fromMonth.slice(0, 4)) + 1}-04`
                ? fromMonth.slice(0, 4)
                : ''
            }
            onChange={(e) => {
              if (e.target.value) {
                setFrom(e.target.value + '-05');
                setTo(`${Number(e.target.value) + 1}-04`);
                setReport(null);
              }
            }}
          >
            <option value="">Custom month range</option>
            {Array.from({ length: 12 }, (_, i) => 2025 + i).map((y) => (
              <option key={y} value={y}>
                {y}–{y + 1} (1 May – 30 April)
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch
          <select
            aria-label="Fixed asset branch"
            value={branch}
            disabled={busy || auth.role !== 'admin'}
            onChange={change(setBranch)}
          >
            {lookups.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From month
          <input
            aria-label="Fixed asset from month"
            type="month"
            required
            min="1900-01"
            max={toMonth}
            value={fromMonth}
            disabled={busy}
            onChange={change(setFrom)}
          />
        </label>
        <label>
          To month
          <input
            aria-label="Fixed asset to month"
            type="month"
            required
            min="1900-01"
            max="2200-12"
            value={toMonth}
            disabled={busy}
            onChange={(e) => {
              setTo(e.target.value);
              if (e.target.value) setFrom(fyStart(e.target.value));
              setReport(null);
            }}
          />
        </label>
        <label>
          Source
          <select
            aria-label="Fixed asset source"
            value={source}
            disabled={busy}
            onChange={change(setSource)}
          >
            <option value="">Hospital &amp; Donation</option>
            {lookups.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy || !branch}>
          {busy ? 'Please wait…' : 'Generate schedule'}
        </button>
      </form>
      <p className="small muted">
        Selecting a To month sets From month to the financial-year start in May. Change From month
        afterward for a custom period. All amounts are in LKR.
      </p>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <h3>{report.title}</h3>
          <p>
            {report.start} to {report.end} · {report.source} · {report.assetCount} assets
            {report.projected ? ' · Projected' : ''}
          </p>
          <div className="actions">
            <button className="btn" disabled={busy} onClick={() => download('xlsx')}>
              Export Excel
            </button>
            <button className="btn" disabled={busy} onClick={() => download('pdf')}>
              Export PDF
            </button>
          </div>
          {!report.assetCount && <p>No assets match this branch, source and period.</p>}
          <div
            style={{ overflowX: 'auto' }}
            tabIndex="0"
            role="region"
            aria-label="Fixed asset schedule"
          >
            <table style={{ minWidth: 2200, width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th
                      key={c.key}
                      style={{
                        whiteSpace: 'pre-line',
                        padding: 10,
                        background: '#22452b',
                        color: 'white',
                        border: '1px solid #bacabc',
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, index) =>
                  r.type === 'category' ? (
                    <tr key={index}>
                      <th
                        colSpan={report.columns.length}
                        style={{ textAlign: 'left', padding: 10, background: '#dce9df' }}
                      >
                        {r.details}
                      </th>
                    </tr>
                  ) : (
                    <tr
                      key={index}
                      style={{
                        background: r.type === 'asset' ? 'white' : '#edf3ef',
                        fontWeight: r.type === 'asset' ? 'normal' : 'bold',
                      }}
                    >
                      {report.columns.map((c, i) => (
                        <td
                          key={c.key}
                          style={{
                            padding: 9,
                            border: '1px solid #d5ddd7',
                            textAlign: i >= 5 ? 'right' : 'left',
                          }}
                        >
                          {i >= 5 ? amount(r[c.key] || 0) : (r[c.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Calculated from current asset records. Deleted assets are excluded. This report is not a
            locked historical ledger; edits to asset dates or values can change past figures.
          </p>
        </>
      )}
    </section>
  );
}
