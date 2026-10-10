import React, { useState } from 'react';
import { api, previewImport, downloadTemplate } from './api';

export default function ExcelImport({ auth, admin, lookups, initialBranch, onClose, onImported }) {
  const [branch, setBranch] = useState(auth.branch_id || initialBranch || lookups.branches[0]?.id || '');
  const [mode, setMode] = useState('opening');
  const [sheets, setSheets] = useState([]);
  const [sheet, setSheet] = useState('');
  const [file, setFile] = useState(null),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const chooseFile = (e) => {
    setSheets([]);
    setSheet('');
    setPreview(null);
    setError('');
    const selected = e.target.files[0] || null;
    setFile(selected);
    if (selected && (!/\.xlsx$/i.test(selected.name) || selected.size > 2 * 1024 * 1024))
      setError('Choose an .xlsx workbook smaller than 2 MB.');
  };
  return (
    <section className="panel import-panel" aria-label="Upload Excel file">
      <div className="panel-h">
        <h2>Upload Excel file</h2>
        <button type="button" className="btn sm" disabled={busy} onClick={onClose}>
          Close upload
        </button>
      </div>
      <p>
        Upload up to 500 assets. Preview the branch, opening balances and any errors before saving.
      </p>
      <div className="form-grid">
        <div className="field">
          <label>
            Upload type
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => {
                setMode(e.target.value);
                setPreview(null);
                setSheets([]);
                setSheet('');
              }}
            >
              <option value="opening">Original register — opening balances at 30 April 2026</option>
              <option value="new">New purchases — application template</option>
            </select>
          </label>
        </div>
        <div className="field">
          <label>
            Import into branch
            <select
              aria-label="Import into branch"
              value={branch}
              disabled={!admin || busy}
              onChange={(e) => {
                setBranch(e.target.value);
                setPreview(null);
                setError('');
              }}
            >
              {lookups.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <label>
            Excel workbook (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={chooseFile}
            />
          </label>
          <div className="hint">Maximum 2 MB. Save older .xls files as .xlsx first.</div>
        </div>
      </div>
      {sheets.length > 0 && (
        <div className="field">
          <label>
            Asset worksheet
            <select
              value={sheet}
              disabled={busy}
              onChange={(e) => {
                setSheet(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Select the approved worksheet</option>
              {sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            This workbook contains multiple asset sheets. Select one to avoid importing both
            versions.
          </p>
        </div>
      )}
      {mode === 'opening' ? (
        <p className="small muted">
          Uses original cost, accumulated depreciation and WDV at <b>30 April 2026</b>. Calculations
          continue from <b>May 2026</b> for the financial year <b>1 May 2026 – 30 April 2027</b>.
          Later years run from May to April. Saved Excel formula results are read; later Excel
          calculations are ignored. Missing dates stay unknown. Missing item and Hospital/Donation
          names are added on confirmation. Save the workbook after recalculating it in Excel before
          uploading.
        </p>
      ) : (
        <p className="small muted">
          Required columns: Audit Book Ref, Date Purchased, Source, Details, Category, Dep %,
          Original Cost. Sources, items and category rates must match the dropdown lists. Serial
          numbers, audit years, depreciation and WDV are calculated automatically.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          onClick={() => run(downloadTemplate)}
        >
          Download Excel template
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={busy || !file || file.size > 2 * 1024 * 1024 || !/\.xlsx$/i.test(file.name)}
          onClick={() =>
            run(async () => {
              setPreview(null);
              const result = await previewImport(file, branch, mode, sheet);
              if (result.needsSheet) {
                setSheets(result.sheets);
                return;
              }
              setPreview(result);
            })
          }
        >
          {busy ? 'Working…' : 'Preview upload'}
        </button>
      </div>
      {error && (
        <div className="note" role="alert">
          {error}
        </div>
      )}
      {preview && (
        <>
          <div className="calc" role="status">
            <b>{preview.filename}</b> · Sheet: {preview.sheet} · Branch: <b>{preview.branch}</b>
            <br />
            {preview.valid} of {preview.count} rows ready.{' '}
            {preview.valid === preview.count
              ? 'Review the rows below, then confirm import.'
              : 'No assets have been saved. Fix the highlighted errors in Excel and upload again.'}
          </div>
          {preview.mode === 'opening' && (
            <p className="calc">
              Opening balances: 30 April 2026 · Cost:{' '}
              {preview.totals.original_cost.toLocaleString('en-LK', { minimumFractionDigits: 2 })} ·
              Accumulated depreciation:{' '}
              {preview.totals.opening_accumulated.toLocaleString('en-LK', {
                minimumFractionDigits: 2,
              })}{' '}
              · WDV:{' '}
              {preview.totals.opening_wdv.toLocaleString('en-LK', { minimumFractionDigits: 2 })}
              <br />
              Existing assets, including samples, remain in reports. This upload adds records; it
              does not replace them.
            </p>
          )}
          <div className="tbl-wrap import-preview">
            <table>
              <thead>
                <tr>
                  {[
                    'Excel row',
                    'Audit ref',
                    'Purchased',
                    'Source',
                    'Details',
                    'Category',
                    'Dep %',
                    'Cost (LKR)',
                    ...(preview.mode === 'opening'
                      ? ['Opening acc. dep.', 'Opening WDV', 'May depreciation']
                      : []),
                    'Validation',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className={r.errors.length ? 'import-error' : ''}>
                    <td>{r.row}</td>
                    <td>{r.audit_book_ref}</td>
                    <td>{r.date_purchased || 'Unknown'}</td>
                    <td>{r.source}</td>
                    <td>{r.item}</td>
                    <td>{r.category}</td>
                    <td>{r.dep_percent}</td>
                    <td>{r.original_cost}</td>
                    {preview.mode === 'opening' && (
                      <>
                        <td>{r.opening_accumulated}</td>
                        <td>{r.opening_wdv}</td>
                        <td>{r.monthly_provision}</td>
                      </>
                    )}
                    <td>
                      {r.errors.length ? (
                        <ul>
                          {r.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="pill green">Ready</span>
                      )}
                      {r.warnings?.map((w) => (
                        <div className="small muted" key={w}>
                          {w}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Imports add new records only. Identical rows in this file or the selected branch are
            blocked. All rows must be valid; the complete import is saved together. This preview
            expires after 30 minutes.
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !preview.id}
            onClick={() =>
              run(async () => {
                const result = await api('/imports/' + preview.id + '/commit', { method: 'POST' });
                onImported(result.count, preview.branch);
              })
            }
          >
            {busy
              ? 'Importing…'
              : `Confirm import of ${preview.count} asset${preview.count === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </section>
  );
}
