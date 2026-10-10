import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import {testDatabase} from './database.js';
import {seed} from '../db/seed.js';
import {createApp} from '../src/app.js';
let db,app,admin,branchUser,branch,other,lookup,asset;
const password='Workflow-Test-Admin-123!';
async function login(email,p){const agent=request.agent(app),r=await agent.post('/api/auth/login').send({email,password:p}).expect(200);return {agent,csrf:r.body.csrf,user:r.body.user};}
const send=(u,method,url,data)=>u.agent[method]('/api'+url).set('X-CSRF-Token',u.csrf).send(data);
before(async()=>{db=await testDatabase();await seed(db,{passwords:[password,'Workflow-Branch-A-123!','Workflow-Branch-B-123!'],samples:true,mustChange:false});app=createApp(db);admin=await login('admin@hospital.lk',password);branchUser=await login('brancha@hospital.lk','Workflow-Branch-A-123!');branch=(await db.query('SELECT * FROM branches WHERE id=$1',[branchUser.user.branch_id])).rows[0];lookup=(await admin.agent.get('/api/lookups').expect(200)).body;other=lookup.branches.find(b=>b.id!==branch.id);asset=(await db.query('SELECT * FROM assets WHERE branch_id=$1 LIMIT 1',[branch.id])).rows[0];});
after(async()=>db?.end());
test('only Hospital and Donation are offered; users cannot add or rename classifications',async()=>{
 assert.deepEqual(lookup.sources.map(s=>s.name),['Donation','Hospital']);
 await send(admin,'post','/lookups/sources',{name:'Other'}).expect(400);
 await send(admin,'put','/lookups/sources/'+lookup.sources[0].id,{name:'Other'}).expect(400);
});
test('audited metadata correction preserves values, handles stale versions and restricts branch users',async()=>{
 const body={donation_source_id:lookup.sources[0].id,donor_supplier:'Example donor',version:asset.version,reason:'Verified classification'};
 await send(branchUser,'patch','/assets/'+asset.id+'/classification',body).expect(403);
 await admin.agent.patch('/api/assets/'+asset.id+'/classification').send(body).expect(403);
 const updated=(await send(admin,'patch','/assets/'+asset.id+'/classification',body).expect(200)).body;
 assert.equal(updated.donor_supplier,'Example donor');assert.equal(updated.original_cost,asset.original_cost);assert.equal(updated.dep_percent,asset.dep_percent);
 await send(admin,'patch','/assets/'+asset.id+'/classification',body).expect(409);
 const audit=(await db.query("SELECT * FROM audit_trail WHERE action='asset.classification_corrected' AND entity_id=$1",[asset.id])).rows[0];assert.ok(audit.before_data);assert.equal(audit.after_data.donor_supplier,'Example donor');
});
test('optional donor imports separately and register exports keep classification distinct',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Assets');s.addRow(['Audit Book Ref','Date Purchased','Source','Details','Category','Dep %','Original Cost','Donor / Supplier']);s.addRow(['DONOR-TEST','2026-05-01','Donation',lookup.items[0].name,'Furniture & Fitting',10,120000,'Example supplier']);
 const preview=(await admin.agent.post('/api/imports/preview').query({branch:branch.id,filename:'donor.xlsx'}).set('X-CSRF-Token',admin.csrf).set('Content-Type','application/octet-stream').send(Buffer.from(await w.xlsx.writeBuffer())).expect(200)).body;
 assert.ok(preview.id);await send(admin,'post','/imports/'+preview.id+'/commit',{}).expect(200);
 const a=(await admin.agent.get('/api/assets').expect(200)).body.find(a=>a.audit_book_ref==='DONOR-TEST');assert.equal(a.source,'Donation');assert.equal(a.donor_supplier,'Example supplier');
 const rows=(await admin.agent.get('/api/reports/register').expect(200)).body;assert.ok(rows.some(r=>r['Donor / Supplier']==='Example supplier'&&r.Classification==='Donation'));
});
test('manual add and edit persist optional donor without altering classification choices',async()=>{
 const body={branch_id:branch.id,audit_book_ref:'MANUAL-DONOR',date_purchased:'2026-05-01',donation_source_id:lookup.sources[1].id,item_id:lookup.items[0].id,category:'Furniture & Fitting',dep_percent:10,original_cost:12000,donor_supplier:'Local supplier'};
 const added=(await send(branchUser,'post','/assets',body).expect(201)).body;assert.equal(added.donor_supplier,'Local supplier');
 const updated=(await send(branchUser,'put','/assets/'+added.id,{...body,donor_supplier:'Corrected supplier',version:added.version}).expect(200)).body;assert.equal(updated.donor_supplier,'Corrected supplier');assert.equal(updated.original_cost,12000);
});
test('approval protection requires admin password, confirmation and CSRF',async()=>{
 const data={password,confirmation:'PROTECT '+branch.name,reason:'Approved test accounts',approved_through:'2026-04-30'};
 await send(branchUser,'post','/branches/'+branch.id+'/reset-protection',data).expect(403);
 await admin.agent.post('/api/branches/'+branch.id+'/reset-protection').send(data).expect(403);
 await send(admin,'post','/branches/'+branch.id+'/reset-protection',{...data,password:'wrong'}).expect(400);
 await send(admin,'post','/branches/'+branch.id+'/reset-protection',{...data,confirmation:'wrong'}).expect(400);
});
test('protecting approved records blocks new and already-prepared resets, leaving the other branch available',async()=>{
 const preview=(await send(admin,'post','/branches/'+branch.id+'/reset-preview',{}).expect(200)).body;
 await admin.agent.get('/api/asset-resets/'+preview.id+'/backup').expect(200);
 const before=(await db.query('SELECT count(*) AS n FROM assets WHERE branch_id=$1',[branch.id])).rows[0].n;
 await send(admin,'post','/branches/'+branch.id+'/reset-protection',{password,confirmation:'PROTECT '+branch.name,reason:'Approved test accounts',approved_through:'2026-04-30'}).expect(200);
 await send(admin,'post','/branches/'+branch.id+'/reset-preview',{}).expect(409);
 await send(admin,'post','/asset-resets/'+preview.id+'/commit',{password,confirmation:'RESET '+branch.name,reason:'Must fail'}).expect(409);
 assert.equal((await db.query('SELECT count(*) AS n FROM assets WHERE branch_id=$1',[branch.id])).rows[0].n,before);
 await send(admin,'post','/branches/'+other.id+'/reset-preview',{}).expect(200);
 assert.equal((await db.query("SELECT count(*) AS n FROM audit_trail WHERE action='branch.reset_protected'")).rows[0].n,1);
});
