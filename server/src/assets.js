import { insertAndRead, updateAndRead, allocateSerial } from './db.js';
import { z } from 'zod';
import { uuid, date, assetSchema, fail, text } from './validation.js';
import {
  position,
  totals,
  today,
  CATEGORIES,
  auditYearOf,
  persistSchedule,
  assetSchedule,
  monthsElapsed,
  periodLabel,
} from './depreciation.js';
import { transaction } from './db.js';
import { admin } from './auth.js';
export async function audit(c, u, action, entity, id, branch, detail, before = null, after = null) {
  await c.query(
    'INSERT INTO audit_trail(actor_id,action,entity,entity_id,branch_id,detail,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      u.id,
      action,
      entity,
      id,
      branch,
      detail,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    ],
  );
}
export const asOf = (q) => (q.asOf ? date.parse(q.asOf) : today());
export const scope = (user, requested) => {
  if (user.role === 'admin') return requested ? uuid.parse(requested) : null;
  if (requested && requested !== user.branch_id)
    throw fail(403, 'Other branch records are not accessible');
  return user.branch_id;
};
export async function assetById(db, u, id, lock = false) {
  uuid.parse(id);
  const a = (
    await db.query(
      `SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL AND ($2 IS NULL OR branch_id=$2) ${lock ? 'FOR UPDATE' : ''}`,
      [id, scope(u)],
    )
  ).rows[0];
  if (!a) throw fail(404, 'Asset not found');
  return a;
}
export async function listAssets(db, u, q = {}) {
  const branch = scope(u, q.branch),
    values = [branch],
    where = ['a.deleted_at IS NULL', '($1 IS NULL OR a.branch_id=$1)'];
  const add = (sql, v) => {
    values.push(v);
    where.push(sql.replace('?', `$${values.length}`));
  };
  if (q.category) add('a.category=?', z.enum(CATEGORIES).parse(q.category));
  if (q.year) add('a.audit_year=?', z.coerce.number().int().min(1900).max(2201).parse(q.year));
  if (q.source) add('a.donation_source_id=?', uuid.parse(q.source));
  if (q.from) add('a.date_purchased>=?', date.parse(q.from));
  if (q.to) add('COALESCE(a.date_purchased,a.opening_balance_date)<=?', date.parse(q.to));
  if (q.q)
    add(
      "concat_ws(' ',i.name,s.name,a.donor_supplier,a.audit_book_ref,a.category,a.sr_no) LIKE ?",
      '%' + z.string().max(200).parse(q.q) + '%',
    );
  const rows = (
    await db.query(
      `SELECT a.*,b.name AS branch,CASE WHEN s.name IN ('Hospital','Donation') THEN s.name ELSE 'Needs classification' END AS source,s.name AS legacy_source,i.name AS item,EXISTS(SELECT 1 FROM delete_requests r WHERE r.asset_id=a.id AND r.status='pending') AS delete_pending FROM assets a JOIN branches b ON b.id=a.branch_id JOIN sources s ON s.id=a.donation_source_id JOIN items i ON i.id=a.item_id WHERE ${where.join(' AND ')} ORDER BY b.name,a.sr_no`,
      values,
    )
  ).rows;
  let list = rows.map((a) => ({
    ...a,
    original_cost: Number(a.original_cost),
    dep_percent: Number(a.dep_percent),
    position: position(a, asOf(q)),
  }));
  if (q.status) {
    z.enum(['active', 'fully']).parse(q.status);
    list = list.filter((a) => a.position.fully === (q.status === 'fully'));
  }
  return list;
}
async function validateRate(c, input, old) {
  if (old && old.category === input.category && Number(old.dep_percent) === input.dep_percent)
    return;
  if (
    !(
      await c.query('SELECT id FROM depreciation_rates WHERE category=$1 AND rate=$2', [
        input.category,
        input.dep_percent,
      ])
    ).rows.length
  )
    throw fail(400, 'Choose a configured depreciation rate');
}
async function validateClassification(c,id){
 const row=(await c.query("SELECT id FROM sources WHERE id=$1 AND name IN ('Hospital','Donation')",[id])).rows[0];
 if(!row) throw fail(400,'Choose Hospital or Donation as the classification');
}
export function assetRoutes(app, db) {
 app.patch('/api/assets/:id/classification',admin,async(req,res)=>{
  const input=z.object({donation_source_id:uuid,donor_supplier:z.string().trim().max(500),version:z.number().int().positive(),reason:text}).parse(req.body);
  const updated=await transaction(db,async c=>{const old=await assetById(c,req.user,req.params.id,true);
   if(old.version!==input.version)throw fail(409,'This asset changed. Reload it before saving.');
   await validateClassification(c,input.donation_source_id);
   const row=(await updateAndRead(c,'assets','donation_source_id=$2,donor_supplier=$3,updated_by=$4,updated_at=now(),version=version+1',[old.id,input.donation_source_id,input.donor_supplier,req.user.id])).rows[0];
   await audit(c,req.user,'asset.classification_corrected','asset',old.id,old.branch_id,input.reason,old,row);return row;});res.json(updated);
 });
  app.get('/api/assets', async (req, res) => res.json(await listAssets(db, req.user, req.query)));
  app.get('/api/dashboard', async (req, res) => {
    const list = await listAssets(db, req.user, req.query);
    const branches = (
      await db.query('SELECT id,name FROM branches WHERE ($1 IS NULL OR id=$1) ORDER BY name', [
        scope(req.user),
      ])
    ).rows;
    res.json({
      totals: totals(list),
      branches: branches.map((b) => ({
        name: b.name,
        ...totals(list.filter((a) => a.branch_id === b.id)),
      })),
      categories: CATEGORIES.map((name) => ({
        name,
        ...totals(list.filter((a) => a.category === name)),
      })),
      recent: (
        await db.query(
          'SELECT e.at,e.action,e.detail,u.name AS actor FROM audit_trail e LEFT JOIN users u ON u.id=e.actor_id WHERE ($1 IS NULL OR e.branch_id=$1) ORDER BY e.at DESC LIMIT 6',
          [scope(req.user)],
        )
      ).rows,
    });
  });
  app.post('/api/depreciation/preview', async (req, res) => {
    const a = z
      .object({
        date_purchased: date,
        original_cost: z.coerce.number().min(1).max(999999999999.99),
        dep_percent: z.coerce.number().positive().max(100),
      })
      .parse(req.body);
    res.json(position(a, asOf(req.query)));
  });
  app.get('/api/assets/:id', async (req, res) => {
    await assetById(db, req.user, req.params.id);
    const a = (await listAssets(db, req.user, req.query)).find((a) => a.id === req.params.id);
    if (!a) throw fail(404, 'Asset not found');
    res.json({
      ...a,
      schedule: assetSchedule(a, asOf(req.query)),
    });
  });
  app.post('/api/assets', async (req, res) => {
    const b = assetSchema.parse(req.body);
    scope(req.user, b.branch_id);
    const result = await transaction(db, async (c) => {
      await validateRate(c, b);
      await validateClassification(c,b.donation_source_id);
      const branch = (await allocateSerial(c, b.branch_id)).rows[0];
      if (!branch) throw fail(400, 'Unknown branch');
      const a = (
        await insertAndRead(
          c,
          'assets',
          'branch_id,sr_no,audit_book_ref,audit_year,date_purchased,donation_source_id,item_id,category,dep_percent,original_cost,created_by,donor_supplier',
          [
            b.branch_id,
            branch.sr,
            b.audit_book_ref,
            auditYearOf(b.date_purchased),
            b.date_purchased,
            b.donation_source_id,
            b.item_id,
            b.category,
            b.dep_percent,
            b.original_cost,
            req.user.id,
            b.donor_supplier,
          ],
        )
      ).rows[0];
      await persistSchedule(c, a);
      await audit(
        c,
        req.user,
        'asset.created',
        'asset',
        a.id,
        a.branch_id,
        `Asset (Sr ${a.sr_no}) added, LKR ${a.original_cost}`,
        null,
        a,
      );
      return a;
    });
    res.status(201).json(result);
  });
  app.put('/api/assets/:id', async (req, res) => {
    const b = assetSchema.parse(req.body);
    scope(req.user, b.branch_id);
    if (!b.version) throw fail(400, 'Record version is required');
    const a = await transaction(db, async (c) => {
      const old = await assetById(c, req.user, req.params.id, true);
      if (old.opening_balance_date)
        throw fail(
          409,
          'Imported opening balances cannot be edited here. Keep the approved cost and balance intact.',
        );
      if (old.version !== b.version)
        throw fail(409, 'This asset changed. Reload it before saving.');
      await validateRate(c, b, old);
      await validateClassification(c,b.donation_source_id);
      let sr = old.sr_no;
      if (old.branch_id !== b.branch_id) {
        if (
          (
            await c.query("SELECT id FROM delete_requests WHERE asset_id=$1 AND status='pending'", [
              old.id,
            ])
          ).rows.length
        )
          throw fail(409, 'Review the pending delete request before moving this asset');
        sr = (await allocateSerial(c, b.branch_id)).rows[0]?.sr;
        if (!sr) throw fail(400, 'Unknown branch');
      }
      const updated = (
        await updateAndRead(
          c,
          'assets',
          'branch_id=$2,sr_no=$3,audit_book_ref=$4,audit_year=$5,date_purchased=$6,donation_source_id=$7,item_id=$8,category=$9,dep_percent=$10,original_cost=$11,updated_by=$12,donor_supplier=$13,updated_at=now(),version=version+1',
          [
            old.id,
            b.branch_id,
            sr,
            b.audit_book_ref,
            auditYearOf(b.date_purchased),
            b.date_purchased,
            b.donation_source_id,
            b.item_id,
            b.category,
            b.dep_percent,
            b.original_cost,
            req.user.id,
            b.donor_supplier,
          ],
        )
      ).rows[0];
      await persistSchedule(c, updated);
      await audit(
        c,
        req.user,
        'asset.updated',
        'asset',
        old.id,
        updated.branch_id,
        `Asset (Sr ${sr}) edited; depreciation schedule regenerated`,
        old,
        updated,
      );
      return updated;
    });
    res.json(a);
  });
  app.delete('/api/assets/:id', admin, async (req, res) => {
    const reason = text.parse(req.body.reason);
    await transaction(db, async (c) => {
      const a = await assetById(c, req.user, req.params.id, true);
      if (
        (
          await c.query("SELECT id FROM delete_requests WHERE asset_id=$1 AND status='pending'", [
            a.id,
          ])
        ).rows.length
      )
        throw fail(409, 'Review the pending request in Delete requests');
      await c.query(
        'UPDATE assets SET deleted_at=now(),deleted_by=$2,version=version+1 WHERE id=$1',
        [a.id, req.user.id],
      );
      await audit(
        c,
        req.user,
        'asset.deleted',
        'asset',
        a.id,
        a.branch_id,
        `Asset (Sr ${a.sr_no}) deleted: ${reason}`,
        a,
      );
    });
    res.json({ ok: true });
  });
  app.get('/api/delete-requests', async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT r.*,a.branch_id,a.sr_no,a.audit_book_ref,a.original_cost,i.name AS item,b.name AS branch,u.name AS requested_by_name,v.name AS reviewed_by_name FROM delete_requests r JOIN assets a ON a.id=r.asset_id JOIN items i ON i.id=a.item_id JOIN branches b ON b.id=a.branch_id JOIN users u ON u.id=r.requested_by LEFT JOIN users v ON v.id=r.reviewed_by WHERE ($1 IS NULL OR (a.branch_id=$1 AND r.requested_by=$2)) ORDER BY (r.status='pending') DESC,r.created_at DESC`,
          [scope(req.user), req.user.id],
        )
      ).rows,
    ),
  );
  app.post('/api/assets/:id/delete-requests', async (req, res) => {
    const reason = text.parse(req.body.reason);
    const r = await transaction(db, async (c) => {
      const a = await assetById(c, req.user, req.params.id, true);
      const r = (
        await insertAndRead(c, 'delete_requests', 'asset_id,requested_by,reason', [
          a.id,
          req.user.id,
          reason,
        ])
      ).rows[0];
      await audit(
        c,
        req.user,
        'delete.requested',
        'asset',
        a.id,
        a.branch_id,
        `Delete requested: Sr ${a.sr_no} - ${reason}`,
      );
      return r;
    });
    res.status(201).json(r);
  });
  app.post('/api/delete-requests/:id/review', admin, async (req, res) => {
    const status = z.enum(['approved', 'rejected']).parse(req.body.status);
    uuid.parse(req.params.id);
    await transaction(db, async (c) => {
      const existing = (await c.query('SELECT * FROM delete_requests WHERE id=$1', [req.params.id]))
        .rows[0];
      if (!existing) throw fail(404, 'Request not found');
      const a = await assetById(c, req.user, existing.asset_id, true);
      const r = (
        await c.query('SELECT * FROM delete_requests WHERE id=$1 FOR UPDATE', [existing.id])
      ).rows[0];
      if (r.status !== 'pending') throw fail(409, 'Request already reviewed');
      await c.query(
        'UPDATE delete_requests SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1',
        [r.id, status, req.user.id],
      );
      if (status === 'approved')
        await c.query(
          'UPDATE assets SET deleted_at=now(),deleted_by=$2,version=version+1 WHERE id=$1',
          [a.id, req.user.id],
        );
      await audit(
        c,
        req.user,
        'delete.' + status,
        'asset',
        a.id,
        a.branch_id,
        `Delete request ${status}: Sr ${a.sr_no}; ${r.reason}`,
      );
    });
    res.json({ ok: true });
  });
}
