import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

// Repeated numbered parameters are bound values, never interpolated user input.
function query(client) {
  return async (sql, values = []) => {
    const params = [];
    const statement = sql.replace(/\$(\d+)/g, (_, n) => {
      if (Number(n) > values.length) throw new Error('Missing SQL parameter');
      params.push(values[Number(n) - 1]);
      return '?';
    });
    const [result] = params.length
      ? await client.execute(statement, params)
      : await client.query(statement);
    return {
      rows: Array.isArray(result) ? result : [],
      rowCount: result.affectedRows ?? result.length,
    };
  };
}
export function database(url = process.env.DATABASE_URL) {
  if (!url)
    throw new Error(
      'DATABASE_URL is required. Copy server/.env.example to server/.env and enter your MySQL settings.',
    );
  if (!url.startsWith('mysql://')) throw new Error('DATABASE_URL must start with mysql://');
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    timezone: 'Z',
    dateStrings: ['DATE'],
    decimalNumbers: true,
    charset: 'utf8mb4_0900_ai_ci',
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === '1';
      }
      return next();
    },
  });
  const connect = async () => {
    const c = await pool.getConnection();
    try {
      await c.query("SET time_zone = '+00:00'");
    } catch (e) {
      c.release();
      throw e;
    }
    return { query: query(c), release: () => c.release() };
  };
  return {
    connect,
    query: async (...args) => {
      const c = await connect();
      try {
        return await c.query(...args);
      } finally {
        c.release();
      }
    },
    end: () => pool.end(),
  };
}
export async function transaction(db, fn) {
  const c = await db.connect();
  try {
    await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await c.query('START TRANSACTION');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
const identifier = (name) => {
  if (!/^[a-z_]+$/.test(name)) throw new Error('Invalid internal SQL identifier');
  return '`' + name + '`';
};
// Only server-owned table/column names are passed to these helpers.
export async function insertAndRead(c, table, columns, values) {
  const id = randomUUID();
  await c.query(
    `INSERT INTO ${identifier(table)} (id,${columns.split(',').map(identifier).join(',')}) VALUES (${[id, ...values].map((_, i) => '$' + (i + 1)).join(',')})`,
    [id, ...values],
  );
  return c.query(`SELECT * FROM ${identifier(table)} WHERE id=$1`, [id]);
}
export async function updateAndRead(c, table, assignments, values) {
  await c.query(`UPDATE ${identifier(table)} SET ${assignments} WHERE id=$1`, values);
  return c.query(`SELECT * FROM ${identifier(table)} WHERE id=$1`, [values[0]]);
}
// Caller owns a transaction; branch lock serializes serial number allocation.
export async function allocateSerial(c, branchId) {
  const branch = (await c.query('SELECT next_sr FROM branches WHERE id=$1 FOR UPDATE', [branchId]))
    .rows[0];
  if (!branch) return { rows: [] };
  await c.query('UPDATE branches SET next_sr=next_sr+1 WHERE id=$1', [branchId]);
  return { rows: [{ sr: branch.next_sr }] };
}
