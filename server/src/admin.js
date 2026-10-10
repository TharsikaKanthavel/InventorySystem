import { insertAndRead, updateAndRead } from './db.js';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { admin, publicUser, secret } from './auth.js';
import { uuid, text, userSchema, fail } from './validation.js';
import { transaction } from './db.js';
import { audit, scope } from './assets.js';
import { CATEGORIES } from './depreciation.js';
const tableOf = (kind) =>
  ({ sources: 'sources', items: 'items', rates: 'depreciation_rates' })[
    z.enum(['sources', 'items', 'rates']).parse(kind)
  ];
const rateSchema = z.object({
  category: z.enum(CATEGORIES),
  rate: z.coerce.number().min(0.01).max(100),
});
export function adminRoutes(app, db) {
  app.get('/api/lookups', async (req, res) => {
    const [branches, sources, items, rates, years] = await Promise.all([
      db.query('SELECT id,name FROM branches WHERE ($1 IS NULL OR id=$1) ORDER BY name', [
        scope(req.user),
      ]),
      db.query("SELECT * FROM sources WHERE name IN ('Hospital','Donation') ORDER BY name"),
      db.query('SELECT * FROM items ORDER BY name'),
      db.query('SELECT * FROM depreciation_rates ORDER BY category,rate'),
      db.query(
        'SELECT DISTINCT audit_year FROM assets WHERE deleted_at IS NULL AND ($1 IS NULL OR branch_id=$1) ORDER BY audit_year',
        [scope(req.user)],
      ),
    ]);
    res.json({
      branches: branches.rows,
      sources: sources.rows,
      items: items.rows,
      rates: rates.rows.map((r) => ({ ...r, rate: Number(r.rate) })),
      categories: CATEGORIES,
      years: years.rows.map((y) => y.audit_year),
    });
  });
  app.post('/api/lookups/:kind', async (req, res) => {
    const table = tableOf(req.params.kind);
    if(table==='sources')throw fail(400,'Classifications are fixed: Hospital and Donation. Enter donor/supplier on the asset.');
    if (table === 'depreciation_rates' && req.user.role !== 'admin')
      throw fail(403, 'Administrator access required');
    const b =
      table === 'depreciation_rates'
        ? rateSchema.parse(req.body)
        : { name: text.parse(req.body.name) };
    const row = await transaction(db, async (c) => {
      const row = (await insertAndRead(c, table, Object.keys(b).join(','), Object.values(b)))
        .rows[0];
      await audit(
        c,
        req.user,
        'lookup.added',
        req.params.kind,
        row.id,
        req.user.branch_id,
        `Added ${req.params.kind}: ${b.name || b.category + ' ' + b.rate + '%'}`,
      );
      return row;
    });
    res.status(201).json(row);
  });
  app.put('/api/lookups/:kind/:id', admin, async (req, res) => {
    const table = tableOf(req.params.kind);
    if(table==='sources')throw fail(400,'Classifications are fixed: Hospital and Donation. Enter donor/supplier on the asset.');
    uuid.parse(req.params.id);
    const b =
      table === 'depreciation_rates'
        ? rateSchema.parse(req.body)
        : { name: text.parse(req.body.name) };
    const row = await transaction(db, async (c) => {
      const old = (await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [req.params.id]))
        .rows[0];
      if (!old) throw fail(404, 'Entry not found');
      const row = (
        await updateAndRead(
          c,
          table,
          Object.keys(b)
            .map((k, i) => k + '=$' + (i + 2))
            .join(','),
          [req.params.id, ...Object.values(b)],
        )
      ).rows[0];
      await audit(
        c,
        req.user,
        'lookup.renamed',
        req.params.kind,
        row.id,
        null,
        'Dropdown entry updated',
        old,
        row,
      );
      return row;
    });
    res.json(row);
  });
  app.delete('/api/lookups/rates/:id', admin, async (req, res) => {
    uuid.parse(req.params.id);
    await transaction(db, async (c) => {
      const r = (
        await c.query('SELECT * FROM depreciation_rates WHERE id=$1 FOR UPDATE', [req.params.id])
      ).rows[0];
      if (!r) throw fail(404, 'Rate not found');
      if (
        (
          await c.query(
            'SELECT id FROM assets WHERE category=$1 AND dep_percent=$2 AND deleted_at IS NULL LIMIT 1',
            [r.category, r.rate],
          )
        ).rows.length
      )
        throw fail(409, 'Rate is in use by existing assets');
      await c.query('DELETE FROM depreciation_rates WHERE id=$1', [r.id]);
      await audit(
        c,
        req.user,
        'rate.removed',
        'rates',
        r.id,
        null,
        `Removed ${r.rate}% for ${r.category}`,
      );
    });
    res.json({ ok: true });
  });
  app.get('/api/users', admin, async (req, res) =>
    res.json((await db.query('SELECT * FROM users ORDER BY name')).rows.map(publicUser)),
  );
  app.post('/api/users', admin, async (req, res) => {
    const b = userSchema.parse(req.body),
      temporaryPassword = secret().slice(0, 24);
    const user = await transaction(db, async (c) => {
      const u = (
        await insertAndRead(c, 'users', 'name,email,role,branch_id,active,password_hash', [
          b.name,
          b.email,
          b.role,
          b.branch_id,
          b.active,
          await bcrypt.hash(temporaryPassword, 12),
        ])
      ).rows[0];
      await audit(
        c,
        req.user,
        'user.created',
        'user',
        u.id,
        null,
        `User created: ${u.name} (${u.role})`,
      );
      return publicUser(u);
    });
    res.status(201).json({ user, temporaryPassword });
  });
  app.put('/api/users/:id', admin, async (req, res) => {
    const b = userSchema.parse(req.body);
    uuid.parse(req.params.id);
    if (req.params.id === req.user.id && (!b.active || b.role !== 'admin'))
      throw fail(400, 'You cannot disable or demote your own account');
    const u = await transaction(db, async (c) => {
      const old = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.params.id]))
        .rows[0];
      if (!old) throw fail(404, 'User not found');
      const u = (
        await updateAndRead(c, 'users', 'name=$2,email=$3,role=$4,branch_id=$5,active=$6', [
          old.id,
          b.name,
          b.email,
          b.role,
          b.branch_id,
          b.active,
        ])
      ).rows[0];
      if (old.role !== u.role || old.branch_id !== u.branch_id || !u.active)
        await c.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
      await audit(
        c,
        req.user,
        'user.updated',
        'user',
        u.id,
        null,
        `User updated: ${u.name}`,
        publicUser(old),
        publicUser(u),
      );
      return publicUser(u);
    });
    res.json(u);
  });
  app.post('/api/users/:id/reset-password', admin, async (req, res) => {
    uuid.parse(req.params.id);
    const temporaryPassword = secret().slice(0, 24);
    await transaction(db, async (c) => {
      const u = (
        await updateAndRead(c, 'users', 'password_hash=$2,must_change_password=true', [
          req.params.id,
          await bcrypt.hash(temporaryPassword, 12),
        ])
      ).rows[0];
      if (!u) throw fail(404, 'User not found');
      await c.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
      await audit(
        c,
        req.user,
        'user.password_reset',
        'user',
        u.id,
        null,
        `Password reset for ${u.name}`,
      );
    });
    res.json({ temporaryPassword });
  });
  app.get('/api/audit', admin, async (req, res) => {
    const values = [],
      where = [];
    for (const [key, column] of [
      ['branch', 'e.branch_id'],
      ['actor', 'e.actor_id'],
    ])
      if (req.query[key]) {
        values.push(uuid.parse(req.query[key]));
        where.push(`${column}=$${values.length}`);
      }
    if (req.query.q) {
      values.push('%' + z.string().max(200).parse(req.query.q) + '%');
      where.push(`concat_ws(' ',e.action,e.detail) LIKE $${values.length}`);
    }
    res.json(
      (
        await db.query(
          `SELECT e.*,u.name AS actor,b.name AS branch FROM audit_trail e LEFT JOIN users u ON u.id=e.actor_id LEFT JOIN branches b ON b.id=e.branch_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.at DESC LIMIT 1000`,
          values,
        )
      ).rows,
    );
  });
}
