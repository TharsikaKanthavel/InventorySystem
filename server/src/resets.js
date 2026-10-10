import {createHash,randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import {rateLimit} from 'express-rate-limit';
import {admin} from './auth.js';
import {transaction} from './db.js';
import {uuid,fail,text,date} from './validation.js';
import {audit} from './assets.js';

const canonical=value=>value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function lockBranch(c,id){const b=(await c.query('SELECT * FROM branches WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!b)throw fail(404,'Branch not found');return b;}
async function snapshot(c,b){
 const assets=(await c.query('SELECT * FROM assets WHERE branch_id=$1 ORDER BY id FOR UPDATE',[b.id])).rows;
 const logs=(await c.query('SELECT d.* FROM depreciation_log d JOIN assets a ON a.id=d.asset_id WHERE a.branch_id=$1 ORDER BY d.id FOR UPDATE',[b.id])).rows;
 const requests=(await c.query('SELECT d.* FROM delete_requests d JOIN assets a ON a.id=d.asset_id WHERE a.branch_id=$1 ORDER BY d.id FOR UPDATE',[b.id])).rows.map(({pending_asset_id,...r})=>r);
 const imports=(await c.query('SELECT * FROM asset_imports WHERE branch_id=$1 ORDER BY id FOR UPDATE',[b.id])).rows;
 return canonical({format:'moolai-branch-reset-v1',branch:{id:b.id,name:b.name,next_sr:b.next_sr},assets,logs,requests,imports});
}
const summary=r=>({id:r.id,branchId:r.branch_id,status:r.status,createdAt:r.created_at,completedAt:r.completed_at,downloaded:!!r.downloaded_at,branch:r.snapshot.branch.name,count:r.snapshot.assets.filter(a=>!a.deleted_at).length,storedCount:r.snapshot.assets.length});
async function authorized(req){const input=z.object({confirmation:z.string(),password:z.string().max(200),reason:text}).parse(req.body);if(!await bcrypt.compare(input.password,req.user.password_hash))throw fail(400,'Administrator password is incorrect');return input;}
async function getReset(c,id){const r=(await c.query('SELECT * FROM asset_resets WHERE id=$1 FOR UPDATE',[uuid.parse(id)])).rows[0];if(!r)throw fail(404,'Reset backup not found');return r;}
// Only server-created snapshots are restored. This endpoint never executes uploaded SQL/JSON.
async function insertRows(c,table,rows){for(const row of rows){const keys=Object.keys(row);if(!keys.every(k=>/^[a-z_]+$/.test(k)))throw Error('Invalid snapshot');const values=keys.map(k=>{const v=row[k];return v && typeof v==='object'?JSON.stringify(v):typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)?new Date(v):v;});await c.query(`INSERT INTO ${table} (${keys.map(k=>'`'+k+'`').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);}}
async function assertResetAllowed(c,id){
 if((await c.query('SELECT branch_id FROM branch_reset_protection WHERE branch_id=$1',[id])).rows.length)
  throw fail(409,'This branch has approved records and is protected from reset. Use an audited correction or a reviewed migration instead.');
}
export function resetRoutes(app,db){
 app.get('/api/branches/:id/reset-protection',admin,async(req,res)=>{res.json((await db.query('SELECT approved_through,reason,created_at FROM branch_reset_protection WHERE branch_id=$1',[uuid.parse(req.params.id)])).rows[0]||null);});
 app.post('/api/branches/:id/reset-protection',admin,rateLimit({windowMs:900000,limit:10}),async(req,res)=>{
  const id=uuid.parse(req.params.id),input=await authorized(req),through=date.parse(req.body.approved_through);
  if(through>new Date().toISOString().slice(0,10))throw fail(400,'Approved-through date cannot be in the future');
  await transaction(db,async c=>{const b=await lockBranch(c,id);
   if(input.confirmation!==`PROTECT ${b.name}`)throw fail(400,`Type PROTECT ${b.name} exactly`);
   if(!(await c.query('SELECT id FROM assets WHERE branch_id=$1 LIMIT 1',[id])).rows.length)throw fail(409,'Import and verify assets before protecting the branch');
   if((await c.query('SELECT branch_id FROM branch_reset_protection WHERE branch_id=$1',[id])).rows.length)throw fail(409,'This branch is already protected');
   await c.query('INSERT INTO branch_reset_protection(branch_id,approved_through,reason,approved_by) VALUES($1,$2,$3,$4)',[id,through,input.reason,req.user.id]);
   await audit(c,req.user,'branch.reset_protected','branch',id,id,`Approved through ${through}. Reset disabled. ${input.reason}`);
  });res.json({ok:true});
 });
 app.use('/api/asset-resets/:id', (req,res,next)=>['POST'].includes(req.method)?admin(req,res,next):next(), rateLimit({windowMs:15*60*1000,limit:30,skip:req=>req.method!=='POST',standardHeaders:'draft-8',legacyHeaders:false}));
 app.get('/api/asset-resets',admin,async(req,res)=>{const id=uuid.parse(req.query.branch);const rows=(await db.query('SELECT * FROM asset_resets WHERE branch_id=$1 ORDER BY created_at DESC LIMIT 10',[id])).rows;res.json(rows.map(summary));});
 app.post('/api/branches/:id/reset-preview',admin,async(req,res)=>{const id=uuid.parse(req.params.id);const result=await transaction(db,async c=>{const b=await lockBranch(c,id);await assertResetAllowed(c,id);const s=await snapshot(c,b);if(!s.assets.length)throw fail(409,'This branch has no stored assets to reset');const resetId=randomUUID();await c.query('INSERT INTO asset_resets(id,branch_id,requested_by,snapshot,fingerprint) VALUES($1,$2,$3,$4,$5)',[resetId,id,req.user.id,JSON.stringify(s),digest(s)]);return summary((await c.query('SELECT * FROM asset_resets WHERE id=$1',[resetId])).rows[0]);});res.json(result);});
 app.get('/api/asset-resets/:id/backup',admin,async(req,res)=>{const id=uuid.parse(req.params.id),r=(await db.query('SELECT * FROM asset_resets WHERE id=$1',[id])).rows[0];if(!r)throw fail(404,'Reset backup not found');await db.query('UPDATE asset_resets SET downloaded_at=now() WHERE id=$1',[id]);res.attachment(`Moolai-${r.snapshot.branch.name}-reset-${id}.json`).json({backupId:id,createdAt:r.created_at,...r.snapshot});});
 app.post('/api/asset-resets/:id/commit',admin,async(req,res)=>{const input=await authorized(req);const result=await transaction(db,async c=>{const r=await getReset(c,req.params.id),b=await lockBranch(c,r.branch_id);await assertResetAllowed(c,b.id);if(input.confirmation!==`RESET ${b.name}`)throw fail(400,`Type RESET ${b.name} exactly`);if(r.requested_by!==req.user.id)throw fail(403,'Only the administrator who prepared this reset can confirm it');if(r.status!=='prepared')throw fail(409,'This reset has already been used');if(!r.downloaded_at)throw fail(409,'Download the reset backup before confirming');if(Date.now()-new Date(r.created_at).getTime()>30*60*1000)throw fail(409,'Reset preview expired. Prepare a new backup');const current=await snapshot(c,b);if(digest(current)!==r.fingerprint)throw fail(409,'Branch records changed. Prepare and download a new backup');
 await c.query('DELETE d FROM depreciation_log d JOIN assets a ON a.id=d.asset_id WHERE a.branch_id=$1',[b.id]);await c.query('DELETE d FROM delete_requests d JOIN assets a ON a.id=d.asset_id WHERE a.branch_id=$1',[b.id]);await c.query('DELETE FROM assets WHERE branch_id=$1',[b.id]);await c.query('DELETE FROM asset_imports WHERE branch_id=$1',[b.id]);await c.query('UPDATE branches SET next_sr=1 WHERE id=$1',[b.id]);await c.query("UPDATE asset_resets SET status='completed',completed_at=now() WHERE id=$1",[r.id]);await audit(c,req.user,'branch.assets_reset','branch',b.id,b.id,`Reset ${b.name}: ${current.assets.length} stored assets archived; numbering restarts at 1. Backup ${r.id}. Reason: ${input.reason}`);return {ok:true,branch:b.name,count:current.assets.length};});res.json(result);});
 app.post('/api/asset-resets/:id/restore',admin,async(req,res)=>{const input=await authorized(req);const result=await transaction(db,async c=>{const r=await getReset(c,req.params.id),b=await lockBranch(c,r.branch_id);await assertResetAllowed(c,b.id);if(input.confirmation!==`RESTORE ${b.name}`)throw fail(400,`Type RESTORE ${b.name} exactly`);if(r.status!=='completed')throw fail(409,'Only a completed reset can be restored');const latest=(await c.query("SELECT id FROM asset_resets WHERE branch_id=$1 AND status IN ('completed','restored') ORDER BY completed_at DESC LIMIT 1",[b.id])).rows[0];if(latest?.id!==r.id)throw fail(409,'Only the latest reset can be restored');if((await c.query('SELECT id FROM assets WHERE branch_id=$1 LIMIT 1',[b.id])).rows.length||b.next_sr!==1)throw fail(409,'Restore is available only before new assets have been added');
 await insertRows(c,'assets',r.snapshot.assets);await insertRows(c,'depreciation_log',r.snapshot.logs);await insertRows(c,'delete_requests',r.snapshot.requests);await c.query('DELETE FROM asset_imports WHERE branch_id=$1',[b.id]);await c.query('UPDATE branches SET next_sr=$2 WHERE id=$1',[b.id,r.snapshot.branch.next_sr]);await c.query("UPDATE asset_resets SET status='restored',restored_at=now() WHERE id=$1",[r.id]);await audit(c,req.user,'branch.assets_restored','branch',b.id,b.id,`Restored reset backup ${r.id}. Reason: ${input.reason}`);return {ok:true,branch:b.name,count:r.snapshot.assets.length};});res.json(result);});
}
