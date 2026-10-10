import FixedAssetReport from './FixedAssetReport';
import DashboardCharts from './DashboardCharts';
import MonthlyBranchReport from './MonthlyBranchReport';
import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { api, query, download } from './api';
import './styles.css';
import './production.css';
import ExcelImport from './ExcelImport';
import ResetAssets from './ResetAssets';
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const money = (n) => 'LKR ' + num(n),
  num = (n) =>
    Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fy = (y) => (y ? `FY ${y - 1}/${String(y).slice(-2)}` : 'Unknown'),
  date = (s) =>
    s
      ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : '',
  dt = (s) => (s ? new Date(s).toLocaleString('en-GB') : '');
const titles = {
  dashboard: 'Dashboard',
  assets: 'Asset register',
  'asset-new': 'Add asset',
  'asset-edit': 'Edit asset',
  'asset-view': 'Asset detail and depreciation schedule',
  deletes: 'Delete requests',
  reports: 'Reports',
  users: 'Users',
  lookups: 'Dropdown lists',
  audit: 'Audit trail',
};
function Btn({ children, onClick, primary, danger, small = true, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={`btn ${primary ? 'primary' : ''} ${danger ? 'danger' : ''} ${small ? 'sm' : ''}`}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
function Field({ label, required, hint, children, full }) {
  return (
    <div className={'field ' + (full ? 'full' : '')}>
      <label>
        <span className={required ? 'req' : ''}>{label}</span>
        {children}
      </label>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
function PagedTable({ rows, ...props }) {
  const [size, setSize] = useState(25);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  useEffect(() => setPage(1), [size, rows.length]);
  return <>
    <div className="asset-pagination" aria-label="Table pagination">
      <label>Rows per page <select value={size} onChange={e => setSize(Number(e.target.value))}>
        {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <span aria-live="polite">{rows.length ? `${start + 1}–${Math.min(start + size, rows.length)} of ${rows.length} rows` : '0 rows'}</span>
      <div className="actions">
        <Btn disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</Btn>
        <span>Page {current} of {pages}</span>
        <Btn disabled={current === pages} onClick={() => setPage(current + 1)}>Next</Btn>
      </div>
    </div>
    <Table {...props} rows={rows.slice(start, start + size)} />
  </>;
}
function Table({ headers, rows, empty = 'No records.', footer }) {
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              {footer.map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
function Cards({ t, label, asOf }) {
  return (
    <div className="cards">
      {[
        ['Assets', t.count, `${t.fully} fully depreciated`],
        ['Total original cost', money(t.cost), label],
        ['Accumulated depreciation', money(t.acc), 'to ' + date(asOf)],
        ['Current WDV', money(t.wdv), 'Monthly provision ' + money(t.monthly)],
      ].map(([k, v, d]) => (
        <div className="card" key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
          <div className="d">{d}</div>
        </div>
      ))}
    </div>
  );
}
function App() {
  const [auth, setAuth] = useState(undefined),
    [route, setRoute] = useState({ screen: 'dashboard' }),
    [asOf, setAsOf] = useState(today()),
    [lookups, setLookups] = useState(null),
    [requests, setRequests] = useState([]),
    [revision, setRevision] = useState(0),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState(null);
  const notify = useCallback((s) => setNotice(s), []),
    go = (screen, params = {}) => {
      setRoute({ screen, ...params });
      setNotice('');
      window.scrollTo(0, 0);
    },
    refresh = () => setRevision((v) => v + 1);
  useEffect(() => {
    api('/auth/me')
      .then((d) => setAuth(d.user))
      .catch(() => setAuth(null));
  }, []);
  useEffect(() => {
    if (auth && !auth.must_change_password)
      Promise.all([api('/lookups'), api('/delete-requests')])
        .then(([l, r]) => {
          setLookups(l);
          setRequests(r);
        })
        .catch((e) => notify(e.message));
  }, [auth, revision, notify]);
  const run = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      notify(e.message);
      return null;
    }
  };
  if (auth === undefined) return <div className="login">Loading…</div>;
  if (!auth) return <Login onLogin={setAuth} />;
  if (auth.must_change_password) return <ChangePassword onDone={() => setAuth(null)} />;
  if (!lookups)
    return (
      <div className="login">
        <div className="box">
          <p>{notice || 'Loading your register…'}</p>
          <Btn onClick={refresh}>Retry</Btn>
          <Btn onClick={() => api('/auth/logout', { method: 'POST' }).then(() => setAuth(null))}>
            Sign out
          </Btn>
        </div>
      </div>
    );
  const admin = auth.role === 'admin',
    pending = requests.filter((r) => r.status === 'pending'),
    branchName = lookups.branches.find((b) => b.id === auth.branch_id)?.name;
  const ctx = {
    auth,
    admin,
    asOf,
    lookups,
    requests,
    revision,
    go,
    refresh,
    run,
    notify,
    setModal,
  };
  const deletion = (a) =>
    setModal({
      title: admin ? 'Delete asset' : 'Request deletion',
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
      description: `${a.item} - Sr ${a.sr_no}, ${a.audit_book_ref}, ${money(a.original_cost)}. ${admin ? 'The record is removed from the register; the audit trail keeps the event and reason.' : 'The record stays in the register until the Administrator approves.'}`,
      submit: admin ? 'Delete now' : 'Submit request',
      save: async (b) => {
        await api('/assets/' + a.id + (admin ? '' : '/delete-requests'), {
          method: admin ? 'DELETE' : 'POST',
          body: b,
        });
        refresh();
        notify(admin ? 'Asset deleted' : 'Delete request submitted for approval');
      },
    });
  ctx.deletion = deletion;
  const logout = () =>
    run(async () => {
      await api('/auth/logout', { method: 'POST' });
      setAuth(null);
      setLookups(null);
      setRoute({ screen: 'dashboard' });
    });
  return (
    <>
      <div className="shell">
        <nav className="side">
          <div className="brand">
            <img className="brand-crest" src="/branding/hospital-logo.png" alt="Moolai Hospital crest" />
            <div className="t">Moolai Hospital</div>
            <div className="s">Inventory Register</div>
          </div>
          <div className="nav">
            <div className="sec">Register</div>
            {['dashboard', 'assets', 'asset-new', 'deletes', 'reports'].map((s) => (
              <button
                key={s}
                className={
                  route.screen === s ||
                  (s === 'assets' && ['asset-edit', 'asset-view'].includes(route.screen))
                    ? 'active'
                    : ''
                }
                onClick={() => go(s)}
              >
                {titles[s]}
                {s === 'deletes' && pending.length > 0 && (
                  <span className="badge">{pending.length}</span>
                )}
              </button>
            ))}
            {admin && (
              <>
                <div className="sec">Administration</div>
                {['users', 'lookups', 'audit'].map((s) => (
                  <button
                    className={route.screen === s ? 'active' : ''}
                    key={s}
                    onClick={() => go(s)}
                  >
                    {titles[s]}
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="foot">
            Signed in as <b>{auth.name}</b>
            <br />
            {admin ? 'Administrator (all branches)' : branchName + ' only'}
            <br />
            <Btn onClick={() => setAuth({ ...auth, must_change_password: true })}>
              Change password
            </Btn>{' '}
            <Btn onClick={logout}>Sign out</Btn>
          </div>
        </nav>
        <main className="main">
          <div className="topbar">
            <h1>{titles[route.screen]}</h1>
            <div className="who">
              <label className="asof">
                Figures as of{' '}
                <input
                  aria-label="Figures as of"
                  type="date"
                  value={asOf}
                  min="1900-01-01"
                  max="2200-12-31"
                  onChange={(e) => e.target.value && setAsOf(e.target.value)}
                />
              </label>
              <span className={'pill ' + (admin ? 'green' : 'blue')}>
                {admin ? 'Admin' : branchName}
              </span>
            </div>
          </div>
          {notice && (
            <div role="status" className="note">
              {notice} <Btn onClick={() => setNotice('')}>Dismiss</Btn>
            </div>
          )}
          {route.screen === 'dashboard' && <Dashboard {...ctx} />}{' '}
          {route.screen === 'assets' && <Register {...ctx} />}{' '}
          {['asset-new', 'asset-edit'].includes(route.screen) && (
            <AssetForm key={route.id || 'new'} {...ctx} id={route.id} />
          )}{' '}
          {route.screen === 'asset-view' && <Detail {...ctx} id={route.id} />}{' '}
          {route.screen === 'deletes' && <DeleteQueue {...ctx} />}{' '}
          {route.screen === 'reports' && <Reports {...ctx} initialTab={route.tab} />}{' '}
          {admin && route.screen === 'users' && <Users {...ctx} />}{' '}
          {admin && route.screen === 'lookups' && <Lookups {...ctx} />}{' '}
          {admin && route.screen === 'audit' && <Audit {...ctx} />}
        </main>
      </div>
      {modal && (
        <Modal
          key={modal.title + JSON.stringify(modal.initial)}
          {...modal}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
function Login({ onLogin }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login hospital-login">
      <div className="hospital-welcome">
        <img src="/branding/hospital-photo.png" alt="Co-operative Hospital, Moolai" />
        <h2>Care for every asset.<br />Support every patient.</h2>
        <p>Co-operative Hospital Society Ltd., Moolai</p>
      </div>
      <div className="box">
        <img className="login-crest" src="/branding/hospital-logo.png" alt="Moolai Hospital crest" />
        <h1>Moolai Hospital - Inventory Register</h1>
        <p className="muted">Sign in with your hospital account.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const b = Object.fromEntries(new FormData(e.currentTarget));
              const d = await api('/auth/login', { method: 'POST', body: b });
              onLogin(d.user);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email" required>
            <input type="email" name="email" autoComplete="username" required />
          </Field>
          <Field label="Password" required>
            <input type="password" name="password" autoComplete="current-password" required />
          </Field>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <Btn primary type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Btn>
        </form>
      </div>
    </div>
  );
}
function ChangePassword({ onDone }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="box">
        <h1>Change password</h1>
        <p>Choose a new password of at least 12 characters. You will sign in again afterward.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const b = Object.fromEntries(new FormData(e.currentTarget));
            if (b.newPassword !== b.confirm) return setError('New passwords do not match');
            setBusy(true);
            try {
              await api('/auth/password', { method: 'POST', body: b });
              onDone();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Current password">
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password">
            <input
              name="newPassword"
              type="password"
              minLength="12"
              maxLength="72"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          {error && <p className="err">{error}</p>}
          <Btn type="submit" primary disabled={busy}>
            Change password
          </Btn>{' '}
          <Btn onClick={() => api('/auth/logout', { method: 'POST' }).then(onDone)}>Sign out</Btn>
        </form>
      </div>
    </div>
  );
}
function useLoad(path, revision, notify) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    setData(null);
    api(path)
      .then((d) => live && setData(d))
      .catch((e) => live && notify(e.message));
    return () => {
      live = false;
    };
  }, [path, revision, notify]);
  return data;
}
function Dashboard(c) {
  const d = useLoad('/dashboard?' + query({ asOf: c.asOf }), c.revision, c.notify);
  if (!d) return <p>Loading dashboard…</p>;
  return (
    <>
      <Cards
        t={d.totals}
        label={c.admin ? 'All branches' : c.lookups.branches[0].name}
        asOf={c.asOf}
      />
      <DashboardCharts data={d} admin={c.admin} />
      {c.admin && (
        <div className="panel">
          <div className="panel-h">
            <h3>By branch</h3>
            <Btn onClick={() => c.go('reports', { tab: 'branch' })}>
              Open branch comparison report
            </Btn>
          </div>
          <Table
            headers={[
              'Branch',
              'Assets',
              'Original cost',
              'Accumulated dep.',
              'WDV',
              'Fully depreciated',
            ]}
            rows={d.branches.map((b) => [
              b.name,
              b.count,
              num(b.cost),
              num(b.acc),
              num(b.wdv),
              b.fully,
            ])}
          />
        </div>
      )}
      <div className="grid2">
        <div className="panel">
          <h3>By category</h3>
          <Table
            headers={['Category', 'Assets', 'WDV']}
            rows={d.categories.map((b) => [b.name, b.count, num(b.wdv)])}
          />
        </div>
        <div className="panel">
          <div className="panel-h">
            <h3>{c.admin ? 'Awaiting your approval' : 'Your pending delete requests'}</h3>
            <Btn onClick={() => c.go('deletes')}>Open queue</Btn>
          </div>
          <ul>
            {c.requests
              .filter((r) => r.status === 'pending')
              .map((r) => (
                <li key={r.id}>
                  {r.item} (Sr {r.sr_no}, {r.branch}) - requested {date(r.created_at)}
                </li>
              ))}
          </ul>
          {!c.requests.some((r) => r.status === 'pending') && <p className="muted">None.</p>}
          <h3>Recent activity</h3>
          <ul className="small">
            {d.recent.map((r, i) => (
              <li key={i}>
                {dt(r.at)} - {r.actor}: {r.detail}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
function Exports({ kind, params, run }) {
  return (
    <>
      {[
        ['csv', 'Export CSV'],
        ['xlsx', 'Export Excel'],
        ['pdf', 'Export PDF'],
      ].map(([f, label]) => (
        <Btn key={f} onClick={() => run(() => download(kind, params, f))}>
          {label}
        </Btn>
      ))}
    </>
  );
}
function Filters({ c, f, setF }) {
  const field = (key, label, options, type) => (
    <Field key={key} label={label}>
      {options ? (
        <select value={f[key] || ''} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
          <option value="">All</option>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type || 'text'}
          placeholder={key === 'q' ? 'item, ref, source' : undefined}
          value={f[key] || ''}
          onChange={(e) => setF({ ...f, [key]: e.target.value })}
        />
      )}
    </Field>
  );
  return (
    <div className="filters">
      {field('q', 'Search')}
      {c.admin &&
        field(
          'branch',
          'Branch',
          c.lookups.branches.map((b) => [b.id, b.name]),
        )}
      {field(
        'category',
        'Category',
        c.lookups.categories.map((s) => [s, s]),
      )}
      {field(
        'year',
        'Audit year',
        c.lookups.years.map((y) => [y, fy(y)]),
      )}
      {field(
        'source',
        'Source',
        c.lookups.sources.map((s) => [s.id, s.name]),
      )}
      {field('from', 'Purchased from', null, 'date')}
      {field('to', 'Purchased to', null, 'date')}
      {field('status', 'Status', [
        ['active', 'Active'],
        ['fully', 'Fully depreciated'],
      ])}
    </div>
  );
}
function Register(c) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [uploadBranch, setUploadBranch] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({}),
    params = { ...f, asOf: c.asOf };
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const assetsPath = '/assets?' + query(params);
  useEffect(() => {
    let live = true;
    setRows(null);
    setLoadError('');
    api(assetsPath)
      .then(data => { if (live) setRows(data); })
      .catch(error => { if (live) setLoadError(error.message || 'Please try again.'); });
    return () => { live = false; };
  }, [assetsPath, c.revision, retry]);
  const pageCount = Math.max(1, Math.ceil((rows?.length || 0) / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  useEffect(() => setPage(1), [f, c.asOf, pageSize]);
  useEffect(() => setPage(p => Math.min(p, pageCount)), [pageCount]);
  const totals = (key) =>
    (rows || []).reduce(
      (n, a) => n + Number(key === 'original_cost' ? a[key] : a.position[key]),
      0,
    );
  return (
    <div className="panel">
      {resetOpen && c.admin && <ResetAssets branches={c.lookups.branches} onClose={()=>setResetOpen(false)} onDone={(branch,restored)=>{setResetOpen(false);setUploadBranch(branch);setF({branch});c.refresh();setUploadOpen(!restored);c.notify(restored?'Saved branch assets restored.':'Branch reset complete. Preview and confirm the new Excel upload.');}} />}
      {uploadOpen && (
        <ExcelImport
          initialBranch={uploadBranch}
          auth={c.auth}
          admin={c.admin}
          lookups={c.lookups}
          onClose={() => setUploadOpen(false)}
          onImported={(count, branch) => {
            setUploadOpen(false);
            c.refresh();
            c.notify(`Imported ${count} assets into ${branch}.`);
          }}
        />
      )}
      <Filters c={c} f={f} setF={setF} />
      <div className="panel-h">
        <div className="muted small">{loadError ? 'Asset count unavailable' : rows ? `${rows.length} asset(s)` : 'Loading assets…'}</div>
        <div className="actions">
          <Btn onClick={() => setF({})}>Clear filters</Btn>
          <Exports kind="register" params={params} run={c.run} />
          <Btn onClick={() => setUploadOpen(true)}>Upload Excel file</Btn>
          {c.admin && <Btn danger onClick={()=>{setUploadOpen(false);setResetOpen(true);}}>Reset branch assets</Btn>}
          <Btn primary onClick={() => c.go('asset-new')}>
            Add asset
          </Btn>
        </div>
      </div>
      {loadError && <div className="note" role="alert">
        <p>Unable to load assets. {loadError}</p>
        <Btn onClick={() => setRetry(value => value + 1)}>Retry loading assets</Btn>
      </div>}
      <Table
        headers={[
          'Sr',
          ...(c.admin ? ['Branch'] : []),
          'Audit ref',
          'Audit year',
          'Purchased',
          'Source',
          'Details',
          'Category',
          'Dep %',
          'Original cost',
          'Acc. dep.',
          'WDV',
          'Status',
          'Actions',
        ]}
        rows={(rows || []).slice(start, start + pageSize).map((a) => [
          a.sr_no,
          ...(c.admin ? [a.branch] : []),
          a.audit_book_ref,
          fy(a.audit_year),
          a.purchase_date_note || date(a.date_purchased) || 'Unknown',
          a.source,
          a.item,
          a.category,
          a.dep_percent,
          num(a.original_cost),
          num(a.position.accumulated),
          num(a.position.wdv),
          <span
            className={'pill ' + (a.delete_pending ? 'amber' : a.position.fully ? 'grey' : 'green')}
          >
            {a.delete_pending
              ? 'Delete pending'
              : a.position.fully
                ? 'Fully depreciated'
                : 'Active'}
          </span>,
          <AssetActions key={a.id} asset={a} context={c} />,
        ])}
        empty={loadError ? 'Asset records unavailable.' : rows ? 'No assets match the filters.' : 'Loading assets…'}
      />
      <div className="asset-pagination" aria-label="Asset pagination">
        <label>Rows per page
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <span aria-live="polite">{loadError ? 'Pagination unavailable' : rows ? (rows.length ? `${start + 1}–${Math.min(start + pageSize, rows.length)} of ${rows.length} assets` : '0 assets') : 'Loading assets…'}</span>
        <div className="actions">
          <Btn disabled={!rows || currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Btn>
          {rows && <span>Page {currentPage} of {pageCount}</span>}
          <Btn disabled={!rows || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Btn>
        </div>
      </div>
      {rows ? <p className="right">
        <b>Totals (all matching assets):</b> Original cost {money(totals('original_cost'))} · Accumulated depreciation{' '}
        {money(totals('accumulated'))} · WDV {money(totals('wdv'))}
      </p> : <p className="right">Totals unavailable{loadError ? ' because assets could not be loaded.' : ' while assets are loading.'}</p>}
    </div>
  );
}
function AssetActions({ asset: a, context: c }) {
  const id = useId(), popup = useRef(null);
  const [open, setOpen] = useState(false);
  const run = action => { popup.current?.hidePopover(); action(); };
  return <>
    <button type="button" className="asset-more" aria-label={`Actions for ${a.item}, asset ${a.sr_no}`}
      aria-expanded={open} aria-controls={id} popoverTarget={id}
      onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect(), panel = popup.current;
        panel.style.left = `${Math.max(8, Math.min(rect.right - 164, window.innerWidth - 172))}px`;
        panel.style.top = `${rect.bottom + 148 > window.innerHeight ? Math.max(8, rect.top - 144) : rect.bottom + 5}px`;
      }}><span aria-hidden="true">&#8943;</span></button>
    <div id={id} ref={popup} popover="auto" className="asset-action-menu" role="group" aria-label="Asset actions"
      onToggle={e => setOpen(e.newState === 'open')}>
      <button type="button" onClick={() => run(() => c.go('asset-view', { id: a.id }))}>Schedule</button>
      {!a.opening_balance_date && <button type="button" onClick={() => run(() => c.go('asset-edit', { id: a.id }))}>Edit</button>}
      {!a.delete_pending && <button type="button" className="danger-action" onClick={() => run(() => c.deletion(a))}>{c.admin ? 'Delete' : 'Request delete'}</button>}
    </div>
  </>;
}
function AssetForm(c) {
  const [f, setF] = useState({
      branch_id: c.auth.branch_id || c.lookups.branches[0].id,
      audit_book_ref: '',
      date_purchased: '',
      donation_source_id: '',
      donor_supplier: '',
      item_id: '',
      category: '',
      dep_percent: '',
      original_cost: '',
    }),
    [loaded, setLoaded] = useState(!c.id),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c.id)
      api('/assets/' + c.id)
        .then((a) => {
          setF(a);
          setLoaded(true);
        })
        .catch((e) => c.notify(e.message));
  }, [c.id]);
  useEffect(() => {
    let live = true;
    setPreview(null);
    if (f.date_purchased && Number(f.original_cost) >= 1 && f.dep_percent) {
      const timer = setTimeout(
        () =>
          api('/depreciation/preview?' + query({ asOf: c.asOf }), { method: 'POST', body: f })
            .then((d) => live && setPreview(d))
            .catch(() => {}),
        250,
      );
      return () => {
        live = false;
        clearTimeout(timer);
      };
    }
  }, [f.date_purchased, f.original_cost, f.dep_percent, c.asOf]);
  const change = (key, value) =>
    setF((v) => ({ ...v, [key]: value, ...(key === 'category' ? { dep_percent: '' } : {}) }));
  const add = (kind, key) =>
    c.setModal({
      title: 'Add new ' + (kind === 'sources' ? 'source' : 'item'),
      fields: [{ name: 'name', label: 'Name', required: true }],
      description:
        'The new entry becomes available in the dropdown for everyone and is recorded in the audit trail.',
      save: async (b) => {
        const a = await api('/lookups/' + kind, { method: 'POST', body: b });
        c.refresh();
        change(key, a.id);
      },
    });
  const select = (key, opts, disabled = false) => (
    <select
      required
      value={f[key]}
      disabled={disabled}
      onChange={(e) => change(key, e.target.value)}
    >
      <option value="">{disabled ? 'Choose a category first' : 'Select'}</option>
      {opts.map(([v, n]) => (
        <option key={v} value={v}>
          {n}
        </option>
      ))}
    </select>
  );
  if (!loaded) return <p>Loading asset…</p>;
  return (
    <div className="panel">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await c.run(async () => {
            const a = await api('/assets' + (c.id ? '/' + c.id : ''), {
              method: c.id ? 'PUT' : 'POST',
              body: f,
            });
            c.refresh();
            c.go('asset-view', { id: a.id });
            c.notify(c.id ? 'Changes saved and logged' : `Asset saved as Sr ${a.sr_no}`);
          });
          setBusy(false);
        }}
      >
        <div className="form-grid">
          <Field label="Branch" required>
            {c.admin ? (
              select(
                'branch_id',
                c.lookups.branches.map((b) => [b.id, b.name]),
              )
            ) : (
              <input disabled value={c.lookups.branches[0].name} />
            )}
          </Field>
          <Field label="Sr. No" hint="Numbered per branch in order of entry.">
            <input disabled value={f.sr_no || 'Auto-generated on save'} />
          </Field>
          <Field label="Audit Book Ref" required>
            <input
              required
              placeholder="e.g. AB-2026/14"
              value={f.audit_book_ref}
              onChange={(e) => change('audit_book_ref', e.target.value)}
            />
          </Field>
          <Field label="Date Purchased" required hint="Calendar picker; typing is not needed.">
            <input
              type="date"
              min="1900-01-01"
              max={today()}
              required
              value={f.date_purchased}
              onChange={(e) => change('date_purchased', e.target.value)}
            />
          </Field>
          <Field
            label="Audit Year"
            hint="Derived from the purchase date; financial year ends 30 April."
          >
            <input
              disabled
              value={
                f.date_purchased
                  ? fy(
                      Number(f.date_purchased.slice(0, 4)) +
                        (Number(f.date_purchased.slice(5, 7)) > 4 ? 1 : 0),
                    )
                  : ''
              }
            />
          </Field>
          <Field label="Donor / Supplier (optional)"><input maxLength={500} value={f.donor_supplier || ''} onChange={e=>setF({...f,donor_supplier:e.target.value})}/></Field>
          <Field label="Classification" required>
            <span className="inline">
              {select(
                'donation_source_id',
                c.lookups.sources.map((s) => [s.id, s.name]),
              )}

            </span>
          </Field>
          <Field label="Details (item)" required>
            <span className="inline">
              {select(
                'item_id',
                c.lookups.items.map((s) => [s.id, s.name]),
              )}
              <Btn onClick={() => add('items', 'item_id')}>Add new</Btn>
            </span>
          </Field>
          <Field label="Asset Category" required hint="Fixed list of five categories.">
            {select(
              'category',
              c.lookups.categories.map((s) => [s, s]),
            )}
          </Field>
          <Field
            label="Dep %"
            required
            hint="Standard rates per category; placeholders until the accountant confirms them."
          >
            {select(
              'dep_percent',
              [
                ...new Set([
                  ...c.lookups.rates
                    .filter((r) => r.category === f.category)
                    .map((r) => Number(r.rate)),
                  ...(f.dep_percent ? [Number(f.dep_percent)] : []),
                ]),
              ].map((r) => [r, r + '% per year']),
              !f.category,
            )}
          </Field>
          <Field label="Original Cost (LKR)" required>
            <input
              type="number"
              min="1"
              max="999999999999.99"
              step="0.01"
              required
              value={f.original_cost}
              onChange={(e) => change('original_cost', e.target.value)}
            />
          </Field>
          <div className="field full">
            <div className="calc">
              {preview ? (
                <>
                  Preview as of {date(c.asOf)}: monthly provision{' '}
                  <b>{money(preview.currentMonthlyProvision)}</b>; {preview.months} month(s)
                  charged; accumulated depreciation <b>{money(preview.accumulated)}</b>; WDV{' '}
                  <b>{money(preview.wdv)}</b>
                  {preview.fully ? ' - fully depreciated (WDV held at 1.00)' : ''}. Fields 10-15 are
                  calculated by the system and shown on the schedule screen.
                </>
              ) : (
                'Enter date, category, rate and cost to preview the depreciation position.'
              )}
            </div>
          </div>
        </div>
        <div className="modal-f" style={{ justifyContent: 'flex-start' }}>
          <Btn primary type="submit" disabled={busy}>
            {busy ? 'Saving…' : c.id ? 'Save changes' : 'Save asset'}
          </Btn>
          <Btn onClick={() => c.go('assets')}>Cancel</Btn>
        </div>
        {c.id && (
          <p className="small muted">
            Created {dt(f.created_at)}
            {f.updated_at ? '; last edited ' + dt(f.updated_at) : ''}. Every change is written to
            the audit trail with the previous and new values.
          </p>
        )}
      </form>
    </div>
  );
}
function Detail(c) {
  const a = useLoad('/assets/' + c.id + '?' + query({ asOf: c.asOf }), c.revision, c.notify);
  if (!a) return <p>Loading schedule…</p>;
  const years = {};
  for (const r of a.schedule) {
    years[r.audit_year] ??= { provision: 0, wdv: 0 };
    years[r.audit_year].provision += r.provision;
    years[r.audit_year].wdv = r.wdv;
  }
  return (
    <>
      <div className="panel">
        <div className="panel-h">
          <h2>
            {a.item} - Sr {a.sr_no}, {a.branch}
          </h2>
          <div className="actions">
            {!a.opening_balance_date && (
              <Btn onClick={() => c.go('asset-edit', { id: a.id })}>Edit</Btn>
            )}
            {c.admin && <Btn onClick={()=>c.setModal({title:'Correct classification / donor',initial:{donation_source_id:c.lookups.sources.some(s=>s.id===a.donation_source_id)?a.donation_source_id:'',donor_supplier:a.donor_supplier||'',reason:''},fields:[{name:'donation_source_id',required:true,label:'Classification',type:'select',options:c.lookups.sources.map(s=>[s.id,s.name]),value:a.donation_source_id},{name:'donor_supplier',label:'Donor / Supplier',value:a.donor_supplier||''},{name:'reason',label:'Reason',required:true}],submit:'Save correction',save:async values=>{await api('/assets/'+a.id+'/classification',{method:'PATCH',body:{...values,version:a.version}});c.refresh();c.go('assets');}})}>Correct classification / donor</Btn>}
            <Exports kind="asset-schedule" params={{ asset: a.id, asOf: c.asOf }} run={c.run} />
            <Btn onClick={() => c.go('assets')}>Back to register</Btn>
          </div>
        </div>
        <div className="grid3">
          <div>
            <b>Audit Book Ref</b>
            <br />
            {a.audit_book_ref}
            <br />
            <b>Audit Year</b>
            <br />
            {fy(a.audit_year)}
          </div>
          <div>
            <b>Date Purchased</b>
            <br />
            {a.purchase_date_note || date(a.date_purchased) || 'Unknown'}
            <br />
            <b>Source</b>
            <br />
            {a.source}<br/><b>Donor / Supplier</b><br/>{a.donor_supplier || 'Not specified'}
          </div>
          <div>
            <b>Category</b>
            <br />
            {a.category}
            <br />
            <b>Dep %</b>
            <br />
            {a.dep_percent}% per year
          </div>
        </div>
      </div>
      {a.opening_balance_date && (
        <p className="calc">
          Opening balance at {date(a.opening_balance_date)}: accumulated depreciation{' '}
          {money(a.opening_accumulated)}. Monthly calculations start in May 2026.
        </p>
      )}
      <div className="cards">
        {[
          ['Original cost (9)', a.original_cost],
          ['Monthly provision', a.position.currentMonthlyProvision],
          ['Accumulated depreciation', a.position.accumulated],
          ['WDV', a.position.wdv],
        ].map(([label, value]) => (
          <div className="card" key={label}>
            <div className="k">{label}</div>
            <div className="v">{money(value)}</div>
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Yearly summary (fields 10-12)</h3>
          <Table
            headers={['Financial year', 'Provision in year', 'WDV at year end']}
            rows={Object.entries(years).map(([y, r]) => [fy(y), num(r.provision), num(r.wdv)])}
          />
          <p className="small muted">
            Year end 30 April. The current year shows provision to date.
          </p>
        </div>
        <div className="panel">
          <h3>Monthly schedule (fields 13-15)</h3>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <Table
              headers={['#', 'Period', 'Provision', 'Accumulated', 'WDV']}
              rows={a.schedule.map((r) => [
                r.month,
                date(r.period),
                <span className={r.fully && r.provision > 0 ? 'pill amber' : ''}>
                  {num(r.provision)}
                </span>,
                num(r.accumulated),
                num(r.wdv),
              ])}
            />
          </div>
          <p className="small muted">
            Month 1 is the first full month after purchase (rule to be confirmed by the accountant).
            The highlighted charge is reduced so WDV lands exactly on 1.00.
          </p>
        </div>
      </div>
    </>
  );
}
function DeleteQueue(c) {
  const review = (r, status) =>
    c.setModal({
      title: status === 'approved' ? 'Approve delete' : 'Reject request',
      description: `${r.item} (Sr ${r.sr_no}, ${r.branch}). Reason: ${r.reason}`,
      fields: [],
      submit: status === 'approved' ? 'Approve delete' : 'Reject',
      save: async () => {
        await api('/delete-requests/' + r.id + '/review', { method: 'POST', body: { status } });
        c.refresh();
        c.notify(
          status === 'approved' ? 'Deleted; branch user will see the decision' : 'Request rejected',
        );
      },
    });
  return (
    <div className="panel">
      <p className="muted small">
        {c.admin
          ? 'Branch users cannot delete records directly. Each request stays here until you approve or reject it; the record remains visible in the register meanwhile.'
          : 'Your delete requests. The record stays in the register until the Administrator approves.'}
      </p>
      <Table
        headers={[
          'Requested',
          'Branch',
          'Asset',
          'Original cost',
          'Reason',
          'Requested by',
          'Status',
          'Reviewed',
          ...(c.admin ? ['Action'] : []),
        ]}
        rows={c.requests.map((r) => [
          date(r.created_at),
          r.branch,
          `${r.item} (Sr ${r.sr_no}, ${r.audit_book_ref})`,
          num(r.original_cost),
          r.reason,
          r.requested_by_name,
          <span
            className={
              'pill ' +
              (r.status === 'pending' ? 'amber' : r.status === 'approved' ? 'red' : 'grey')
            }
          >
            {r.status}
          </span>,
          r.reviewed_at ? dt(r.reviewed_at) + ' ' + r.reviewed_by_name : '',
          ...(c.admin
            ? [
                r.status === 'pending' ? (
                  <div className="actions">
                    <Btn danger onClick={() => review(r, 'approved')}>
                      Approve delete
                    </Btn>
                    <Btn onClick={() => review(r, 'rejected')}>Reject</Btn>
                  </div>
                ) : (
                  ''
                ),
              ]
            : []),
        ])}
        empty="No delete requests."
      />
    </div>
  );
}
function Reports(c) {
  const [selected, setSelected] = useState(c.initialTab || 'fixed');
  const groups = [
    ['Depreciation', [['fixed', 'Fixed asset schedule', 'Opening balances, purchases and closing values.'], ['monthly', 'Monthly branch report', 'Depreciation by category for a selected month.'], ['schedule', 'Monthly asset schedule', 'Opening and closing values for each asset.']]],
    ['Inventory', [['register', 'Asset register', 'Full asset details and values.'], ['asset-quantities', 'Assets and quantities', 'Item counts for each branch.'], ['category', 'Category summary', 'Asset counts and values by category.']]],
    ...(c.admin ? [['Branch comparison', [['asset-comparison', 'Compare quantities', 'Item counts across JAFFNA and MOOLAI.'], ['branch', 'Compare values', 'Cost, depreciation and remaining value by branch.']]]] : []),
  ];
  const active = groups.flatMap(g => g[1]).find(r => r[0] === selected) || groups[0][1][0];
  return <div className="report-workspace">
    <aside className="report-picker panel" aria-label="Choose a report">
      <h2>Report library</h2><p className="muted small">Choose the report you need.</p>
      {groups.map(([group, options]) => <div className="report-group" key={group}>
        <h3>{group}</h3>
        {options.map(([id, name]) => <button type="button" key={id} aria-pressed={selected === id}
          className={selected === id ? 'selected' : ''} onClick={() => setSelected(id)}>{name}<span aria-hidden="true">›</span></button>)}
      </div>)}
    </aside>
    <div className="report-content">
      <header className="report-intro"><span className="report-eyebrow">REPORTS</span><h2>{active[1]}</h2><p>{active[2]}</p></header>
      {selected === 'fixed' ? <FixedAssetReport {...c} /> : selected === 'monthly' ? <MonthlyBranchReport {...c} /> : <StandardReport key={selected} {...c} tab={selected} />}
    </div>
  </div>;
}
function StandardReport(c) {
  const tab = c.tab;
  const [f, setF] = useState({}),
    params = { ...f, asOf: c.asOf },
    rows = useLoad('/reports/' + tab + '?' + query(params), c.revision, c.notify);
  return (
      <div className="panel report-standard">
        <div className="report-filter-heading"><h3>Filter your report</h3><span className="muted small">Updates automatically</span></div>
        <Filters c={c} f={f} setF={setF} />
        <div className="actions report-export-bar">
          <Btn onClick={() => setF({})}>Clear filters</Btn>
          <Exports kind={tab} params={params} run={c.run} />
        </div>
        {['asset-quantities', 'asset-comparison'].includes(tab) && <p className="small muted">
          Current non-deleted asset records grouped by category and item. Each register row counts as one asset record.
          {' '}{tab === 'asset-comparison' ? 'Choose All branches to compare JAFFNA and MOOLAI side by side.' : 'Select a branch for its separate report, or All for both branches.'}
          {' '}Hospital / Donation and other filters apply to the report and exports.
        </p>}
        {tab === 'schedule' && (
          <p className="small muted">
            Opening WDV, provision and closing WDV for {date(c.asOf)}. Depreciation starts in the
            month after purchase.
          </p>
        )}
        <PagedTable
          headers={rows?.length ? Object.keys(rows[0]) : ['Report']}
          rows={(rows || []).map((r) =>
            Object.values(r).map((v) =>
              typeof v === 'number' && !Number.isInteger(v) ? num(v) : v,
            ),
          )}
          empty={rows ? 'No records match the filters.' : 'Loading report…'}
        />
      </div>
  );
}
function Modal({ title, description, fields, initial = {}, save, submit = 'Save', onClose }) {
  const [values, setValues] = useState(initial),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const ref = React.useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal native-modal"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await save(values);
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        <div className="form-grid">
          {fields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required} full={f.type === 'textarea'}>
              {f.options ? (
                <select
                  required={f.required}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                >
                  <option value="">Select</option>
                  {f.options.map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  required={f.required}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                />
              ) : (
                <input
                  required={f.required}
                  type={f.type || 'text'}
                  step={f.type === 'number' ? '0.01' : undefined}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
        {error && (
          <p role="alert" className="err">
            {error}
          </p>
        )}
        <div className="modal-f">
          <Btn disabled={busy} onClick={onClose}>
            Cancel
          </Btn>
          <Btn type="submit" primary disabled={busy}>
            {busy ? 'Saving…' : submit}
          </Btn>
        </div>
      </form>
    </dialog>
  );
}
function Users(c) {
  const users = useLoad('/users', c.revision, c.notify),
    [credential, setCredential] = useState(null);
  const edit = (u) =>
    c.setModal({
      title: u ? 'Edit user' : 'Add user',
      initial: u || { role: 'branch_user', branch_id: c.lookups.branches[0].id, active: true },
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'email', label: 'Email (login)', type: 'email', required: true },
        {
          name: 'role',
          label: 'Role',
          required: true,
          options: [
            ['branch_user', 'Branch user'],
            ['admin', 'Administrator'],
          ],
        },
        {
          name: 'branch_id',
          label: 'Branch',
          options: c.lookups.branches.map((b) => [b.id, b.name]),
        },
      ],
      save: async (b) => {
        const d = await api('/users' + (u ? '/' + u.id : ''), {
          method: u ? 'PUT' : 'POST',
          body: { ...b, branch_id: b.role === 'admin' ? null : b.branch_id },
        });
        if (d.temporaryPassword) setCredential({ name: b.name, password: d.temporaryPassword });
        c.refresh();
      },
    });
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>User accounts</h3>
        <Btn primary onClick={() => edit(null)}>
          Add user
        </Btn>
      </div>
      {credential && (
        <div className="note">
          Temporary password for {credential.name}: <code>{credential.password}</code>
          <p>Shown only here. Share it securely; the user must change it at first login.</p>
          <Btn onClick={() => setCredential(null)}>Dismiss password</Btn>
        </div>
      )}
      <Table
        headers={['Name', 'Email', 'Role', 'Branch', 'Status', 'Actions']}
        rows={(users || []).map((u) => [
          u.name,
          u.email,
          u.role === 'admin' ? 'Administrator' : 'Branch user',
          c.lookups.branches.find((b) => b.id === u.branch_id)?.name || 'All branches',
          u.active ? 'Active' : 'Disabled',
          <div className="actions">
            <Btn onClick={() => edit(u)}>Edit</Btn>
            <Btn
              onClick={() =>
                c.setModal({
                  title: 'Reset password',
                  description: `Issue a new temporary password for ${u.name}? Existing sessions will end.`,
                  fields: [],
                  save: async () => {
                    const d = await api('/users/' + u.id + '/reset-password', { method: 'POST' });
                    setCredential({ name: u.name, password: d.temporaryPassword });
                    c.refresh();
                  },
                })
              }
            >
              Reset password
            </Btn>
            {u.id !== c.auth.id && (
              <Btn
                onClick={() =>
                  c.run(async () => {
                    await api('/users/' + u.id, {
                      method: 'PUT',
                      body: { ...u, active: !u.active },
                    });
                    c.refresh();
                  })
                }
              >
                {u.active ? 'Disable' : 'Enable'}
              </Btn>
            )}
          </div>,
        ])}
      />
    </div>
  );
}
function Lookups(c) {
  const change = (kind, row) =>
    c.setModal({
      title: (row ? 'Rename ' : 'Add new ') + (kind === 'sources' ? 'source' : 'item'),
      initial: row || {},
      fields: [{ name: 'name', label: 'Name', required: true }],
      description: row ? 'Existing assets using this value are updated too.' : undefined,
      save: async (b) => {
        await api('/lookups/' + kind + (row ? '/' + row.id : ''), {
          method: row ? 'PUT' : 'POST',
          body: b,
        });
        c.refresh();
      },
    });
  const rate = (r) =>
    c.setModal({
      title: r ? 'Edit depreciation rate' : 'Add depreciation rate',
      initial: r || {},
      description:
        'Changes affect the dropdown for new entries. Existing asset rates stay unchanged.',
      fields: [
        {
          name: 'category',
          label: 'Category',
          required: true,
          options: c.lookups.categories.map((s) => [s, s]),
        },
        { name: 'rate', label: 'Rate % per year', required: true, type: 'number' },
      ],
      save: async (b) => {
        await api('/lookups/rates' + (r ? '/' + r.id : ''), {
          method: r ? 'PUT' : 'POST',
          body: b,
        });
        c.refresh();
      },
    });
  return (
    <>
      <div className="note">
        Sources and depreciation rates are placeholders until confirmed by the hospital accountant.
      </div>
      <div className="grid2">
        {['items'].map((kind) => (
          <div className="panel" key={kind}>
            <div className="panel-h">
              <h3>{kind === 'sources' ? 'Donation / Hospital sources' : 'Details (items)'}</h3>
              <Btn onClick={() => change(kind)}>Add new</Btn>
            </div>
            <Table
              headers={['Name', 'Action']}
              rows={c.lookups[kind].map((r) => [
                r.name,
                <Btn onClick={() => change(kind, r)}>Rename</Btn>,
              ])}
            />
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Asset categories</h3>
          <p className="small muted">Fixed list of five categories.</p>
          <ul>
            {c.lookups.categories.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-h">
            <h3>Depreciation rates</h3>
            <Btn onClick={() => rate()}>Add rate</Btn>
          </div>
          <Table
            headers={['Category', 'Rate %', 'Action']}
            rows={c.lookups.rates.map((r) => [
              r.category,
              r.rate,
              <div className="actions">
                <Btn onClick={() => rate(r)}>Edit</Btn>
                <Btn
                  danger
                  onClick={() =>
                    c.run(async () => {
                      await api('/lookups/rates/' + r.id, { method: 'DELETE' });
                      c.refresh();
                    })
                  }
                >
                  Remove
                </Btn>
              </div>,
            ])}
          />
        </div>
      </div>
    </>
  );
}
function Audit(c) {
  const [q, setQ] = useState(''),
    [branch, setBranch] = useState(''),
    rows = useLoad('/audit?' + query({ q, branch }), c.revision, c.notify);
  return (
    <div className="panel">
      <div className="filters">
        <Field label="Search action or detail">
          <input value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Branch">
          <select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">All</option>
            {c.lookups.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="small muted">
        Most recent 1,000 matching events. All events are retained in the database.
      </p>
      <PagedTable
        headers={['When', 'Who', 'Action', 'Branch', 'Entity', 'Detail', 'Changes']}
        rows={(rows || []).map((r) => [
          dt(r.at),
          r.actor || 'System',
          r.action,
          r.branch || 'System',
          r.entity,
          r.detail,
          (r.before_data || r.after_data) && (
            <details>
              <summary>View values</summary>
              <pre>{JSON.stringify({ before: r.before_data, after: r.after_data }, null, 2)}</pre>
            </details>
          ),
        ])}
      />
    </div>
  );
}
createRoot(document.getElementById('app')).render(<App />);
