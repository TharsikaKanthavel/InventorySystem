import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { testDatabase } from './database.js';
import { seed } from '../db/seed.js';
import { createApp } from '../src/app.js';
let db, app, a, b, admin;
const headers = [
  'Audit Book Ref',
  'Date Purchased',
  'Source',
  'Details',
  'Category',
  'Dep %',
  'Original Cost',
];
const row = (ref = 'IMPORT-01') => [
  ref,
  '2025-01-31',
  'Hospital',
  'Patient bed',
  'Medical Equipment',
  15,
  120000,
];
async function book(rows = [row()], head = headers, configure) {
  const w = new ExcelJS.Workbook(),
    s = w.addWorksheet('Assets');
  s.addRow(head);
  rows.forEach((r) => s.addRow(r));
  configure?.(s);
  return Buffer.from(await w.xlsx.writeBuffer());
}
async function login(email, password) {
  const agent = request.agent(app),
    r = await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return { agent, csrf: r.body.csrf, user: r.body.user };
}
const upload = (u, bytes, branch = u.user.branch_id, filename = 'assets.xlsx') =>
  u.agent
    .post('/api/imports/preview')
    .query({ branch, filename })
    .set('X-CSRF-Token', u.csrf)
    .set('Content-Type', 'application/octet-stream')
    .send(bytes);
const commit = (u, id) =>
  u.agent
    .post('/api/imports/' + id + '/commit')
    .set('X-CSRF-Token', u.csrf)
    .send({});
const count = async () => (await db.query('SELECT count(*) AS n FROM assets')).rows[0].n;
before(async () => {
  db = await testDatabase();
  await seed(db, {
    passwords: ['Import-Admin-123!', 'Import-Jaffna-123!', 'Import-Moolai-123!'],
    mustChange: false,
  });
  app = createApp(db);
  admin = await login('admin@hospital.lk', 'Import-Admin-123!');
  a = await login('brancha@hospital.lk', 'Import-Jaffna-123!');
  b = await login('branchb@hospital.lk', 'Import-Moolai-123!');
});
after(async () => db?.end());
test('Excel preview saves no assets; confirmation is atomic, audited and idempotent', async () => {
  const bytes = await book([row(), row('IMPORT-02')]);
  const p = await upload(a, bytes).expect(200);
  assert.equal(p.body.branch, 'JAFFNA');
  assert.equal(p.body.valid, 2);
  assert.equal(await count(), 0);
  assert.ok(p.body.id);
  await commit(b, p.body.id).expect(404);
  const result = await commit(a, p.body.id).expect(200);
  assert.equal(result.body.count, 2);
  assert.equal(await count(), 2);
  assert.deepEqual((await commit(a, p.body.id).expect(200)).body, result.body);
  assert.equal(await count(), 2);
  assert.equal(
    (await db.query("SELECT count(*) AS n FROM audit_trail WHERE action='import.committed'"))
      .rows[0].n,
    1,
  );
  const logs = (await db.query('SELECT wdv,provision FROM depreciation_log')).rows;
  assert.ok(logs.length > 0);
  assert.ok(logs.every((r) => Number(r.wdv) >= 1));
  const duplicate = await upload(a, bytes).expect(200);
  assert.equal(duplicate.body.id, null);
  assert.ok(duplicate.body.rows.every((r) => r.errors.some((e) => e.includes('already exists'))));
});
test('imports enforce branch ownership, workbook branch and upload CSRF', async () => {
  const bytes = await book([row('BRANCH-TEST')]);
  await upload(a, bytes, b.user.branch_id).expect(403);
  await a.agent
    .post('/api/imports/preview')
    .query({ branch: a.user.branch_id, filename: 'a.xlsx' })
    .set('Content-Type', 'application/octet-stream')
    .send(bytes)
    .expect(403);
  const wrong = await upload(
    a,
    await book([[...row('BRANCH-WRONG'), 'MOOLAI']], [...headers, 'Branch']),
  ).expect(200);
  assert.equal(wrong.body.id, null);
  assert.ok(wrong.body.rows[0].errors.some((e) => e.includes('JAFFNA')));
  const p = await upload(admin, bytes, b.user.branch_id).expect(200);
  assert.equal(p.body.branch, 'MOOLAI');
  await commit(admin, p.body.id).expect(200);
  const own = (await a.agent.get('/api/assets')).body;
  assert.ok(!own.some((r) => r.audit_book_ref === 'BRANCH-TEST'));
});
test('all invalid rows and duplicates are reported and cannot be committed', async () => {
  const bad = row('INVALID');
  bad[2] = 'Unknown donor';
  bad[5] = 19;
  bad[6] = 0;
  const formula = row('FORMULA');
  formula[6] = { formula: '1+1', result: 2 };
  const p = await upload(a, await book([bad, formula, row('TWICE'), row('TWICE')])).expect(200);
  assert.equal(p.body.id, null);
  assert.ok(p.body.rows[0].errors.length >= 3);
  assert.ok(p.body.rows[1].errors.some((e) => e.includes('Formulas')));
  assert.ok(p.body.rows[3].errors.some((e) => e.includes('Duplicate row')));
  await commit(a, '00000000-0000-4000-8000-000000000000').expect(404);
});
test('Excel dates and percentage cells normalize correctly', async () => {
  const r = row('EXCEL-DATE');
  r[1] = new Date('2025-02-28T00:00:00Z');
  r[5] = 0.15;
  const p = await upload(
    a,
    await book([r], headers, (s) => {
      s.getCell('B2').numFmt = 'yyyy-mm-dd';
      s.getCell('F2').numFmt = '0%';
    }),
  ).expect(200);
  assert.equal(p.body.rows[0].date_purchased, '2025-02-28');
  assert.equal(p.body.rows[0].dep_percent, 15);
  assert.equal(p.body.valid, 1);
});
test('revalidation blocks duplicates added after preview and expired previews', async () => {
  const bytes = await book([row('RACE')]);
  const p = await upload(a, bytes).expect(200),
    p2 = await upload(a, bytes).expect(200);
  await commit(a, p.body.id).expect(200);
  const before = await count();
  await commit(a, p2.body.id).expect(409);
  assert.equal(await count(), before);
  const expired = await upload(a, await book([row('EXPIRED')])).expect(200);
  await db.query('UPDATE asset_imports SET expires_at=now()-INTERVAL 1 MINUTE WHERE id=$1', [
    expired.body.id,
  ]);
  await commit(a, expired.body.id).expect(409);
});
test('workbook headers, file size, format and row limits are enforced', async () => {
  await upload(a, Buffer.from('invalid xlsx')).expect(400);
  await upload(a, await book(), a.user.branch_id, 'old.xls').expect(400);
  await upload(a, await book([], headers)).expect(400);
  await upload(a, await book([['x']], ['wrong header'])).expect(400);
  await upload(a, await book(Array.from({ length: 501 }, (_, i) => row('LIMIT-' + i)))).expect(400);
  await upload(a, Buffer.alloc(2 * 1024 * 1024 + 1)).expect(413);
});
test('template is a real workbook with matching headers and managed dropdown values', async () => {
  const binary = (res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  const r = await a.agent.get('/api/imports/template').buffer(true).parse(binary).expect(200);
  const w = new ExcelJS.Workbook();
  await w.xlsx.load(r.body);
  assert.deepEqual(w.getWorksheet('Assets').getRow(1).values.slice(1), [...headers,'Donor / Supplier']);
  assert.ok(w.getWorksheet('Dropdown values').rowCount > 2);
  assert.ok(w.getWorksheet('Instructions'));
});
