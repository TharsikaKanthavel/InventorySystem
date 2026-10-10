import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { seed } from '../db/seed.js';
import { transaction, allocateSerial } from '../src/db.js';
let db;
before(async () => {
  db = await testDatabase();
  await seed(db, {
    passwords: ['Mysql-Admin-123!', 'Mysql-Jaffna-123!', 'Mysql-Moolai-123!'],
    samples: true,
  });
});
after(async () => db?.end());
test('MySQL preserves dates, decimals, booleans, JSON and Unicode', async () => {
  const asset = (await db.query('SELECT * FROM assets LIMIT 1')).rows[0];
  assert.match(asset.date_purchased, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof asset.original_cost, 'number');
  const user = (await db.query('SELECT * FROM users LIMIT 1')).rows[0];
  assert.equal(user.active, true);
  assert.equal(user.must_change_password, true);
  const name = "தமிழ் மருத்துவப் பொருள் ' $1 ?";
  const id = randomUUID();
  await db.query('INSERT INTO items(id,name) VALUES($1,$2)', [id, name]);
  assert.equal((await db.query('SELECT name FROM items WHERE id=$1', [id])).rows[0].name, name);
  await db.query(
    'INSERT INTO audit_trail(action,entity,entity_id,detail,after_data) VALUES($1,$2,$3,$4,$5)',
    ['test', 'item', id, name, JSON.stringify({ name })],
  );
  assert.deepEqual(
    (await db.query('SELECT after_data FROM audit_trail WHERE entity_id=$1', [id])).rows[0]
      .after_data,
    { name },
  );
});
test('MySQL enforces foreign keys, check constraints and case-insensitive uniqueness', async () => {
  await assert.rejects(
    db.query(
      'INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now())',
      ['missing-user', randomUUID(), 'token'],
    ),
    { code: 'ER_NO_REFERENCED_ROW_2' },
  );
  await assert.rejects(
    db.query('INSERT INTO depreciation_rates(category,rate) VALUES($1,$2)', [
      'Medical Equipment',
      0,
    ]),
    { code: 'ER_CHECK_CONSTRAINT_VIOLATED' },
  );
  await db.query('INSERT INTO items(name) VALUES($1)', ['Unique MySQL Item']);
  await assert.rejects(db.query('INSERT INTO items(name) VALUES($1)', ['unique mysql item']), {
    code: 'ER_DUP_ENTRY',
  });
});
test('failed transactions roll back serial allocation and all writes', async () => {
  const branch = (await db.query('SELECT * FROM branches ORDER BY name LIMIT 1')).rows[0];
  const id = randomUUID();
  await assert.rejects(
    transaction(db, async (c) => {
      await allocateSerial(c, branch.id);
      await c.query('INSERT INTO items(id,name) VALUES($1,$2)', [id, 'Rolled back item']);
      throw new Error('Deliberate rollback');
    }),
    /Deliberate rollback/,
  );
  assert.equal(
    (await db.query('SELECT next_sr FROM branches WHERE id=$1', [branch.id])).rows[0].next_sr,
    branch.next_sr,
  );
  assert.equal((await db.query('SELECT id FROM items WHERE id=$1', [id])).rows.length, 0);
});
