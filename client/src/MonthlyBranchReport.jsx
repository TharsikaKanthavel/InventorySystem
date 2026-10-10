import React, { useState } from 'react';
import { api, query } from './api';
const money = (n) =>
  Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export default function MonthlyBranchReport({ lookups, auth, asOf }) {
  const [branch, setBranch] = useState(auth.branch_id || lookups.branches[0]?.id || '');
  const [source, setSource] = useState('');
  const [month, setMonth] = useState(asOf.slice(0, 7));
  const [report, setReport] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function generate(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setReport(null);
    try {
      setReport(await api('/reports/monthly-branch?' + query({ branch, month, source })));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function exportReport(format) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        '/api/reports/monthly-branch?' +
          query({ branch: report.branchId, month: report.month, source: report.sourceId, format }),
        { credentials: 'same-origin' },
      );
      if (!response.ok) throw Error((await response.json()).error || 'Export failed');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report.branch}-Depreciation-${report.month}-${report.source.replace(/[^a-zA-Z0-9-]/g, '-')}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-h">
        <h2>Monthly depreciation by branch</h2>
      </div>
      <form onSubmit={generate} className="actions">
        <label>
          Branch{' '}
          <select
            aria-label="Report branch"
            value={branch}
            disabled={busy || auth.role !== 'admin'}
            onChange={(e) => {
              setBranch(e.target.value);
              setReport(null);
            }}
          >
            {lookups.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Month{' '}
          <input
            aria-label="Report month"
            type="month"
            required
            min="1900-01"
            max="2200-12"
            value={month}
            disabled={busy}
            onChange={(e) => {
              setMonth(e.target.value);
              setReport(null);
            }}
          />
        </label>
        <label>
          Source{' '}
          <select
            aria-label="Report source"
            value={source}
            disabled={busy}
            onChange={(e) => {
              setSource(e.target.value);
              setReport(null);
            }}
          >
            <option value="">Hospital &amp; Donation</option>
            {lookups.sources
              .filter((s) => ['hospital', 'donation'].includes(s.name.toLowerCase()))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name.toUpperCase()}
                </option>
              ))}
          </select>
        </label>
        <button className="btn" disabled={busy || !branch}>
          {busy ? 'Please wait…' : 'Generate report'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <h3>
            {report.title}
            {report.projected ? ' (Projected)' : ''}
          </h3>
          <div className="actions">
            <button className="btn" disabled={busy} onClick={() => exportReport('xlsx')}>
              Export Excel
            </button>
            <button className="btn" disabled={busy} onClick={() => exportReport('pdf')}>
              Export PDF
            </button>
          </div>
          <table style={{ width: '100%', maxWidth: 850, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Asset Category</th>
                <th style={{ textAlign: 'right' }}>Depreciation (LKR)</th>
              </tr>
            </thead>
            <tbody>
              {[...report.rows, { category: 'Total', provision: report.total }].map((r) => (
                <tr
                  key={r.category}
                  style={{ fontWeight: r.category === 'Total' ? 'bold' : 'normal' }}
                >
                  <td style={{ padding: 10, border: '1px solid #ccd5cf' }}>{r.category}</td>
                  <td style={{ padding: 10, border: '1px solid #ccd5cf', textAlign: 'right' }}>
                    {money(r.provision)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="small muted">
        Generate each branch separately. Figures show depreciation charged for the selected month,
        including any reduced final charge.
      </p>
    </section>
  );
}
