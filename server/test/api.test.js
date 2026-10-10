import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'node:fs/promises';
import { testDatabase } from './database.js';
import { seed } from '../db/seed.js';
import { createApp } from '../src/app.js';
import { csv } from '../src/reports.js';
import { transaction } from '../src/db.js';
import { persistSchedule } from '../src/depreciation.js';
let db, app, admin, a, b, ids, lookup, assetA, assetB;
const passwords = [
  'Test-Admin-Password-123',
  'Test-Branch-A-Password-123',
  'Test-Branch-B-Password-123',
];
async function login(email, password) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return { agent, csrf: r.body.csrf, user: r.body.user };
}
const mutate = (u, method, path, body = {}) =>
  u.agent[method](path).set('X-CSRF-Token', u.csrf).send(body);
before(async () => {
  db = await testDatabase();
  ids = await seed(db, { passwords, samples: true, mustChange: false });
  app = createApp(db);
  admin = await login('admin@hospital.lk', passwords[0]);
  a = await login('brancha@hospital.lk', passwords[1]);
  b = await login('branchb@hospital.lk', passwords[2]);
  lookup = (await a.agent.get('/api/lookups')).body;
  assetA = (await a.agent.get('/api/assets')).body[0];
  assetB = (await b.agent.get('/api/assets')).body[0];
});
after(async () => db?.end());
test('monthly branch summary separates branches, reconciles charges and exports the selected month', async () => {
  const month = '2026-08';
  const path = '/api/reports/monthly-branch?month=' + month + '&branch=' + a.user.branch_id;
  const r = await a.agent.get(path).expect(200);
  assert.equal(r.body.branch, 'JAFFNA');
  assert.equal(r.body.rows.length, 5);
  const schedule = (await a.agent.get('/api/reports/schedule?asOf=2026-08-31').expect(200)).body;
  const expected = schedule.reduce((sum, row) => sum + Math.round(row.Provision * 100), 0) / 100;
  assert.equal(r.body.total, expected);
  const adminReport = (await admin.agent.get(path).expect(200)).body;
  assert.deepEqual(adminReport, r.body);
  await b.agent.get(path).expect(403);
  await b.agent.get(path + '&format=xlsx').expect(403);
  await admin.agent.get('/api/reports/monthly-branch?month=' + month).expect(400);
  await a.agent.get('/api/reports/monthly-branch?month=2026-13').expect(400);
  assert.equal(
    (await a.agent.get('/api/reports/monthly-branch?month=1900-01').expect(200)).body.total,
    0,
  );
  const xlsx = await a.agent
    .get(path + '&format=xlsx')
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(xlsx.body);
  const sheet = book.worksheets[0];
  assert.match(sheet.getCell('A1').value, /JAFFNA.*August 2026/);
  assert.equal(sheet.getCell('A8').value, 'Total');
  assert.equal(sheet.getCell('B8').value, expected);
  const pdf = await a.agent
    .get(path + '&format=pdf')
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  await mkdir('../test-results', { recursive: true });
  await writeFile('../test-results/monthly-branch.pdf', pdf.body);
  await writeFile('../test-results/monthly-branch.xlsx', xlsx.body);
});
test('monthly branch source filter reconciles totals and remains applied to exports', async () => {
  const sources = lookup.sources;
  let total = 0;
  for (const source of sources) {
    const path = '/api/reports/monthly-branch?month=2026-08&source=' + source.id;
    const report = (await a.agent.get(path).expect(200)).body;
    assert.equal(report.sourceId, source.id);
    assert.equal(report.source, source.name);
    const schedule = (
      await a.agent.get('/api/reports/schedule?asOf=2026-08-31&source=' + source.id).expect(200)
    ).body;
    assert.equal(
      report.total,
      schedule.reduce((n, r) => n + Math.round(r.Provision * 100), 0) / 100,
    );
    total += Math.round(report.total * 100);
    const xlsx = await a.agent
      .get(path + '&format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(xlsx.body);
    assert.ok(book.worksheets[0].getCell('A1').value.includes(source.name));
    assert.equal(book.worksheets[0].getCell('B8').value, report.total);
  }
  assert.equal(
    total / 100,
    (await a.agent.get('/api/reports/monthly-branch?month=2026-08').expect(200)).body.total,
  );
  await a.agent.get('/api/reports/monthly-branch?month=2026-08&source=invalid').expect(400);
  await a.agent
    .get('/api/reports/monthly-branch?month=2026-08&source=00000000-0000-4000-8000-000000000000')
    .expect(404);
  await b.agent
    .get(
      '/api/reports/monthly-branch?month=2026-08&branch=' +
        a.user.branch_id +
        '&source=' +
        sources[0].id,
    )
    .expect(403);
});
test('detailed fixed asset report scopes branches and sources, reconciles totals and exports', async () => {
  const path = '/api/reports/fixed-assets?toMonth=2026-09&branch=' + a.user.branch_id;
  const report = (await a.agent.get(path).expect(200)).body;
  assert.equal(report.start, '2026-05-01');
  assert.equal(report.branch, 'JAFFNA');
  assert.equal(report.columns.length, 15);
  assert.equal(report.rows.at(-1).type, 'total');
  const register = (await a.agent.get('/api/reports/register?asOf=2026-09-30').expect(200)).body;
  assert.equal(
    Math.round(report.rows.at(-1).closingCost * 100),
    register.reduce((s, r) => s + Math.round(r['Original Cost'] * 100), 0),
  );
  await b.agent.get(path).expect(403);
  await b.agent.get(path + '&format=pdf').expect(403);
  await admin.agent.get('/api/reports/fixed-assets?toMonth=2026-09').expect(400);
  await a.agent.get(path + '&fromMonth=2026-10').expect(400);
  const source = lookup.sources[0];
  const filtered = (await a.agent.get(path + '&source=' + source.id).expect(200)).body;
  assert.ok(filtered.rows.filter((r) => r.type === 'asset').every((r) => r.source === source.name));
  const parse = (res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  const x = (
    await a.agent
      .get(path + '&format=xlsx')
      .buffer(true)
      .parse(parse)
      .expect(200)
  ).body;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(x);
  const sheet = book.worksheets[0];
  assert.equal(sheet.getCell('D' + sheet.rowCount).value, 'Grand total');
  assert.equal(sheet.getCell('O' + sheet.rowCount).value, report.rows.at(-1).closingWdv);
  const pdf = (
    await a.agent
      .get(path + '&format=pdf')
      .buffer(true)
      .parse(parse)
      .expect(200)
  ).body;
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  await mkdir('../test-results', { recursive: true });
  await writeFile('../test-results/fixed-assets.pdf', pdf);
  await writeFile('../test-results/fixed-assets.xlsx', x);
  const empty = (
    await a.agent.get('/api/reports/fixed-assets?fromMonth=1900-01&toMonth=1900-01').expect(200)
  ).body;
  assert.equal(empty.assetCount, 0);
  assert.equal(empty.rows.at(-1).closingWdv, 0);
});
test('authentication, CSRF, origin and privileged endpoints', async () => {
  await request(app).get('/api/assets').expect(401);
  await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@hospital.lk', password: 'wrong' })
    .expect(401);
  await a.agent.post('/api/assets').send({}).expect(403);
  await mutate(a, 'post', '/api/assets', {}).set('Origin', 'https://untrusted.example').expect(403);
  for (const path of [
    '/api/users',
    '/api/audit',
    '/api/reports/branch',
    '/api/reports/branch?format=csv',
  ])
    await a.agent.get(path).expect(403);
  await mutate(a, 'delete', '/api/assets/' + assetA.id, { reason: 'not authorized' }).expect(403);
  await mutate(a, 'post', '/api/lookups/rates', { category: assetA.category, rate: 11 }).expect(
    403,
  );
});
test('branch users never receive other branch assets, reports, lookups, schedules or delete requests', async () => {
  for (const user of [a, b]) {
    const own = user.user.branch_id,
      other = user === a ? assetB : assetA;
    const list = (await user.agent.get('/api/assets').expect(200)).body;
    assert.ok(list.length > 0);
    assert.ok(list.every((r) => r.branch_id === own));
    await user.agent.get('/api/assets/' + other.id).expect(404);
    await user.agent.get('/api/assets?branch=' + other.branch_id).expect(403);
    await user.agent.get('/api/reports/asset-schedule?asset=' + other.id).expect(404);
    await mutate(user, 'put', '/api/assets/' + other.id, { ...other, branch_id: own }).expect(404);
    await mutate(user, 'post', '/api/assets/' + other.id + '/delete-requests', {
      reason: 'attack',
    }).expect(404);
    const l = (await user.agent.get('/api/lookups')).body;
    assert.equal(l.branches.length, 1);
    assert.equal(l.branches[0].id, own);
    const dash = (await user.agent.get('/api/dashboard')).body;
    assert.equal(dash.branches.length, 1);
    assert.equal(dash.totals.count, list.length);
    const rr = (await user.agent.get('/api/delete-requests')).body;
    assert.ok(rr.every((r) => r.branch_id === own && r.requested_by === user.user.id));
    const report = (await user.agent.get('/api/reports/register')).body;
    assert.ok(report.every((r) => r.Branch === l.branches[0].name));
  }
});
test('asset create/edit validates input, persists schedules and audits atomically', async () => {
  const data = {
    branch_id: a.user.branch_id,
    audit_book_ref: 'TEST-2026',
    date_purchased: '2020-01-31',
    donation_source_id: lookup.sources[0].id,
    item_id: lookup.items[0].id,
    category: 'Medical Equipment',
    dep_percent: 15,
    original_cost: 120000,
  };
  await mutate(a, 'post', '/api/assets', { ...data, branch_id: b.user.branch_id }).expect(403);
  await mutate(a, 'post', '/api/assets', { ...data, original_cost: 0.99 }).expect(400);
  await mutate(a, 'post', '/api/assets', { ...data, date_purchased: '2024-02-30' }).expect(400);
  await mutate(a, 'post', '/api/assets', { ...data, dep_percent: 19.19 }).expect(400);
  const result = await mutate(a, 'post', '/api/assets', data).expect(201);
  const created = result.body;
  assert.ok(created.id);
  const log = (await db.query('SELECT * FROM depreciation_log WHERE asset_id=$1', [created.id]))
    .rows;
  assert.ok(log.length > 0);
  assert.ok(log.every((r) => Number(r.wdv) >= 1));
  const updated = await mutate(a, 'put', '/api/assets/' + created.id, {
    ...data,
    version: created.version,
    original_cost: 130000,
  }).expect(200);
  assert.equal(updated.body.version, 2);
  await mutate(a, 'put', '/api/assets/' + created.id, { ...data, version: 1 }).expect(409);
  const audit = (
    await db.query("SELECT * FROM audit_trail WHERE entity_id=$1 AND action='asset.updated'", [
      created.id,
    ])
  ).rows[0];
  assert.equal(Number(audit.before_data.original_cost), 120000);
  assert.equal(Number(audit.after_data.original_cost), 130000);
});
test('delete workflow: pending uniqueness, reject retains, approve removes, review requires admin', async () => {
  const r = await mutate(a, 'post', '/api/assets/' + assetA.id + '/delete-requests', {
    reason: 'Broken test asset',
  }).expect(201);
  await mutate(a, 'post', '/api/assets/' + assetA.id + '/delete-requests', {
    reason: 'duplicate',
  }).expect(409);
  await mutate(a, 'post', '/api/delete-requests/' + r.body.id + '/review', {
    status: 'approved',
  }).expect(403);
  await a.agent.get('/api/assets/' + assetA.id).expect(200);
  await mutate(admin, 'post', '/api/delete-requests/' + r.body.id + '/review', {
    status: 'rejected',
  }).expect(200);
  await a.agent.get('/api/assets/' + assetA.id).expect(200);
  await mutate(admin, 'post', '/api/delete-requests/' + r.body.id + '/review', {
    status: 'approved',
  }).expect(409);
  const second = await mutate(a, 'post', '/api/assets/' + assetA.id + '/delete-requests', {
    reason: 'Disposed',
  }).expect(201);
  await mutate(admin, 'post', '/api/delete-requests/' + second.body.id + '/review', {
    status: 'approved',
  }).expect(200);
  await a.agent.get('/api/assets/' + assetA.id).expect(404);
  assert.equal(
    (await db.query('SELECT status FROM delete_requests WHERE id=$1', [second.body.id])).rows[0]
      .status,
    'approved',
  );
});
test('filters and reports reconcile with dashboard and monthly roll-forward', async () => {
  const q = '?asOf=2026-09-17';
  const d = (await admin.agent.get('/api/dashboard' + q)).body;
  const r = (await admin.agent.get('/api/reports/register' + q)).body;
  assert.equal(Math.round(r.reduce((n, x) => n + x.WDV, 0) * 100), Math.round(d.totals.wdv * 100));
  const monthly = (await a.agent.get('/api/reports/schedule' + q)).body;
  for (const row of monthly)
    assert.equal(
      Math.round((row['Opening WDV'] - row.Provision) * 100),
      Math.round(row['Closing WDV'] * 100),
    );
  const filtered = (await a.agent.get('/api/assets?category=Medical%20Equipment&from=2020-01-01'))
    .body;
  assert.ok(
    filtered.every((r) => r.category === 'Medical Equipment' && r.date_purchased >= '2020-01-01'),
  );
  const exported = await a.agent
    .get('/api/reports/register?category=Medical%20Equipment&format=csv')
    .expect(200);
  assert.ok(exported.text.includes('JAFFNA'));
  assert.ok(!exported.text.includes('MOOLAI'));
});
function binary(res, callback) {
  const data = [];
  res.on('data', (c) => data.push(c));
  res.on('end', () => callback(null, Buffer.concat(data)));
}
test('real CSV, Excel and PDF exports; formula-safe CSV; export audit', async () => {
  assert.ok(csv([{ name: '=1+1' }]).includes("'=1+1"));
  await mkdir(new URL('../../test-results/', import.meta.url), { recursive: true });
  const excel = await a.agent
    .get('/api/reports/register?format=xlsx')
    .buffer(true)
    .parse(binary)
    .expect(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(excel.body);
  assert.equal(book.worksheets.length, 1);
  assert.ok(book.worksheets[0].rowCount > 1);
  const pdf = await a.agent
    .get('/api/reports/register?format=pdf')
    .buffer(true)
    .parse(binary)
    .expect(200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  await writeFile(new URL('../../test-results/register.pdf', import.meta.url), pdf.body);
  await writeFile(new URL('../../test-results/register.xlsx', import.meta.url), excel.body);
  const events = (await db.query("SELECT * FROM audit_trail WHERE action='export.register'")).rows;
  assert.ok(events.length >= 3);
});
test('lookup additions and renames are audited; branches cannot rename; fixed categories', async () => {
  const r = await mutate(a, 'post', '/api/lookups/items', {
    name: 'Test item',
  }).expect(201);
  await mutate(a, 'put', '/api/lookups/items/' + r.body.id, { name: 'Forbidden' }).expect(403);
  await mutate(admin, 'put', '/api/lookups/items/' + r.body.id, {
    name: 'Renamed item',
  }).expect(200);
  await mutate(admin, 'post', '/api/lookups/categories', { name: 'Unexpected' }).expect(400);
});
test('temporary passwords must be changed; disabled users and reset sessions are revoked', async () => {
  const created = await mutate(admin, 'post', '/api/users', {
    name: 'Temporary tester',
    email: 'temp@example.test',
    role: 'branch_user',
    branch_id: a.user.branch_id,
  }).expect(201);
  assert.ok(!created.body.user.password_hash);
  const temp = await login('temp@example.test', created.body.temporaryPassword);
  await temp.agent.get('/api/assets').expect(403);
  await mutate(temp, 'post', '/api/auth/password', {
    currentPassword: created.body.temporaryPassword,
    newPassword: 'New-Temporary-Password-123',
  }).expect(200);
  await temp.agent.get('/api/assets').expect(401);
  const signed = await login('temp@example.test', 'New-Temporary-Password-123');
  await signed.agent.get('/api/assets').expect(200);
  await mutate(admin, 'put', '/api/users/' + created.body.user.id, {
    ...created.body.user,
    active: false,
  }).expect(200);
  await signed.agent.get('/api/assets').expect(401);
  await mutate(admin, 'put', '/api/users/' + admin.user.id, {
    ...admin.user,
    active: false,
  }).expect(400);
});

test('concurrent asset creation allocates unique serials; direct Admin deletion is audited', async () => {
  const data = {
    branch_id: b.user.branch_id,
    audit_book_ref: 'CONCURRENCY-QA',
    date_purchased: '2025-01-31',
    donation_source_id: lookup.sources[0].id,
    item_id: lookup.items[0].id,
    category: 'Medical Equipment',
    dep_percent: 15,
    original_cost: 10000,
  };
  const results = await Promise.all(
    Array.from({ length: 3 }, () => mutate(b, 'post', '/api/assets', data).expect(201)),
  );
  assert.equal(new Set(results.map((r) => r.body.sr_no)).size, 3);
  const id = results[0].body.id;
  await mutate(admin, 'delete', '/api/assets/' + id, { reason: 'QA direct deletion' }).expect(200);
  await b.agent.get('/api/assets/' + id).expect(404);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) AS n FROM audit_trail WHERE entity_id=$1 AND action='asset.deleted'",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.ok((await db.query('SELECT deleted_at FROM assets WHERE id=$1', [id])).rows[0].deleted_at);
});

test('monthly roll-forward is idempotent and retains the WDV floor', async () => {
  const asset = (await db.query('SELECT * FROM assets WHERE id=$1', [assetB.id])).rows[0];
  const run = () => transaction(db, (c) => persistSchedule(c, asset, '2026-09-17'));
  await run();
  const first = (
    await db.query(
      'SELECT period,provision,wdv FROM depreciation_log WHERE asset_id=$1 ORDER BY period',
      [asset.id],
    )
  ).rows;
  await run();
  const second = (
    await db.query(
      'SELECT period,provision,wdv FROM depreciation_log WHERE asset_id=$1 ORDER BY period',
      [asset.id],
    )
  ).rows;
  assert.deepEqual(second, first);
  assert.ok(second.every((r) => Number(r.wdv) >= 1 && Number(r.provision) >= 0));
});

test('password reset and logout revoke authenticated sessions', async () => {
  const other = await login('branchb@hospital.lk', passwords[2]);
  await mutate(admin, 'post', '/api/users/' + b.user.id + '/reset-password').expect(200);
  await other.agent.get('/api/assets').expect(401);
  await mutate(a, 'post', '/api/auth/logout').expect(200);
  await a.agent.get('/api/assets').expect(401);
});

