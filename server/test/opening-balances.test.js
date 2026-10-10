import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { testDatabase } from './database.js';
import { seed } from '../db/seed.js';
import { createApp } from '../src/app.js';
import { position, assetSchedule } from '../src/depreciation.js';
import { parseOpeningWorkbook } from '../src/opening-workbook.js';
import { financialRow, reportPeriod } from '../src/fixed-assets.js';

const asset = { original_cost: 120000, dep_percent: 10, date_purchased: null, opening_balance_date: '2026-04-30', opening_accumulated: 24000 };
test('opening balance carries through May-April years with a capped final charge', () => {
  assert.equal(position(asset,'2026-04-30').wdv,96000);
  assert.equal(position(asset,'2026-05-31').wdv,95000);
  assert.equal(position(asset,'2027-04-30').accumulated,36000);
  assert.equal(position(asset,'2028-04-30').accumulated,48000);
  assert.throws(()=>position(asset,'2026-04-29'), /Opening balances/);
  assert.equal(assetSchedule(asset,'2027-04-30')[0].period,'2026-05-01');
  const nearFloor={...asset,opening_accumulated:119998};
  assert.equal(position(nearFloor,'2026-05-31').provision,1);
  assert.equal(position(nearFloor,'2026-06-30').provision,0);
  const row=financialRow(asset,reportPeriod({fromMonth:'2026-05',toMonth:'2027-04'}));
  assert.equal(row.openingAccumulated,24000);
  assert.equal(row.purchases,0);
  assert.equal(row.periodDep,12000);
  assert.equal(row.closingWdv,84000);
  assert.throws(()=>financialRow(asset,reportPeriod({fromMonth:'2025-05',toMonth:'2026-04'})),/May 2026/);
});

function workbook(branch='JAFFNA',configure) {
  const w=new ExcelJS.Workbook(); const s=w.addWorksheet('Fixed Assets');
  s.getRow(17).values=['Sr.No','Audit Book Ref','Audit Year','Date Purchased','Donation / Hospital','Details','Asset Category','Dep - %','Branch - MCH or Jaffna','Location','G.L.CODE','Original Cost'];
  s.getCell('BH17').value='Total Accumulated Depreciation as on30-04-2026';
  s.getCell('BI17').value='Written Down Value as on 30.04.2026';
  s.getRow(18).values=[1,null,null,null,'Hospital','Opening test bed','Medical Equipment',10,branch,null,null,120000];
  s.getCell('BH18').value={formula:'120000-96000',result:24000};
  s.getCell('BI18').value={formula:'L18-BH18',result:96000};
  s.getCell('G135').value='Medical Equipment'; // Summary labels, not assets.
  s.getCell('DH1597').numFmt='#,##0.00'; // Unused formatting must not count as assets.
  configure?.(w,s); return w;
}
test('legacy parser distinguishes cached zero, missing formulas, duplicate sheets and partial dates', async()=>{
  const w=workbook('JAFFNA',(_,s)=>{s.getCell('BH18').value={formula:'0',result:0};s.getCell('BI18').value=120000;s.getCell('D18').value='06.2021';});
  const p=parseOpeningWorkbook(w);
  assert.equal(p.rows.length,1);assert.equal(p.rows[0].opening_accumulated,0);
  assert.equal(p.rows[0].date_purchased,null);assert.equal(p.rows[0].purchase_date_note,'06.2021');
  w.getWorksheet('Fixed Assets').getCell('BH18').value={formula:'1+1'};
  assert.match(parseOpeningWorkbook(w).rows[0].parseErrors.join(' '),/saved numeric/);
});

let db, app, admin, jaffna, moolai;
before(async()=>{
  db=await testDatabase(); await seed(db,{passwords:['Opening-Admin-123!','Opening-Jaffna-123!','Opening-Moolai-123!'],mustChange:false});app=createApp(db);
  admin=request.agent(app);const login=await admin.post('/api/auth/login').send({email:'admin@hospital.lk',password:'Opening-Admin-123!'}).expect(200);admin.csrf=login.body.csrf;
  const branches=(await db.query('SELECT id,name FROM branches')).rows;
  jaffna=branches.find(b=>b.name==='JAFFNA').id;moolai=branches.find(b=>b.name==='MOOLAI').id;
});
after(async()=>db?.end());
const preview=async(w,branch=jaffna,sheet)=>admin.post('/api/imports/preview').query({mode:'opening',branch,filename:'original.xlsx',sheet}).set('X-CSRF-Token',admin.csrf).set('Content-Type','application/octet-stream').send(Buffer.from(await w.xlsx.writeBuffer()));
const commit=(id)=>admin.post('/api/imports/'+id+'/commit').set('X-CSRF-Token',admin.csrf).send({});
test('original workbook preview, branch-scoped commit, reports, duplicate protection and idempotency',async()=>{
  const beforeItems=(await db.query('SELECT count(*) AS n FROM items')).rows[0].n;
  const p=await preview(workbook());assert.equal(p.status,200);assert.equal(p.body.valid,1,JSON.stringify(p.body));
  assert.equal((await db.query('SELECT count(*) AS n FROM assets')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*) AS n FROM items')).rows[0].n,beforeItems);
  const c=await commit(p.body.id).expect(200);assert.equal(c.body.count,1);
  assert.deepEqual((await commit(p.body.id)).body,c.body);
  const saved=(await db.query('SELECT * FROM assets')).rows[0];assert.equal(saved.date_purchased,null);assert.equal(saved.opening_accumulated,24000);
  const monthly=await admin.get('/api/reports/monthly-branch').query({branch:jaffna,month:'2026-05'}).expect(200);assert.equal(monthly.body.total,1000);
  const report=await admin.get('/api/reports/fixed-assets').query({branch:jaffna,fromMonth:'2026-05',toMonth:'2027-04'}).expect(200);
  const row=report.body.rows.find(r=>r.type==='asset');assert.equal(row.periodDep,12000);assert.equal(row.closingWdv,84000);
  await admin.get('/api/reports/fixed-assets').query({branch:jaffna,fromMonth:'2025-05',toMonth:'2026-04'}).expect(400);
  const logs=(await db.query('SELECT period,wdv FROM depreciation_log WHERE asset_id=$1 ORDER BY period',[saved.id])).rows;
  assert.equal(logs[0].period,'2026-05-01');assert.equal(logs[0].wdv,95000);
  const duplicate=await preview(workbook());assert.equal(duplicate.body.id,null);assert.match(duplicate.body.rows[0].errors.join(),/already been imported/);
  const wrong=await preview(workbook(),moolai);assert.equal(wrong.body.id,null);
  const second=await preview(workbook('MCH'),moolai);assert.equal(second.body.valid,1);await commit(second.body.id).expect(200);
  assert.equal((await db.query('SELECT count(*) AS n FROM assets')).rows[0].n,2);
});
test('inconsistent balances block the whole import and multiple master sheets require selection',async()=>{
  const invalid=await preview(workbook('JAFFNA',(_,s)=>{s.getCell('BI18').value=95000;}));
  assert.equal(invalid.body.id,null);assert.match(invalid.body.rows[0].errors.join(),/must equal/);
  const w=workbook();const s=w.addWorksheet('Other version');const original=w.getWorksheet('Fixed Assets');
  for(const r of [17,18]) original.getRow(r).eachCell((cell,c)=>{s.getCell(r,c).value=cell.value;});
  const choice=await preview(w);assert.equal(choice.body.needsSheet,true);assert.equal(choice.body.sheets.length,2);
  const selected=await preview(w,jaffna,'Other version');assert.equal(selected.body.sheet,'Other version');
  assert.equal(selected.body.id,null); // Same opening asset is already present.
});
