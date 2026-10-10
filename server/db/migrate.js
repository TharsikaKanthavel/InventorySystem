import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { database } from '../src/db.js';
export async function migrate(db) {
  const c = await db.connect();
  let locked = false;
  try {
    const name = (await c.query('SELECT DATABASE() AS name')).rows[0].name;
    const lockName = 'moolai:migrate:' + name;
    locked =
      (await c.query('SELECT GET_LOCK($1,30) AS acquired', [lockName])).rows[0].acquired === 1;
    if (!locked) throw new Error('Another migration is running. Try again shortly.');
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name varchar(255) PRIMARY KEY, applied_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB',
    );
    for (const name of (await readdir(new URL('./migrations/', import.meta.url)))
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      if ((await c.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rows.length)
        continue;
      const sql = await readFile(new URL('./migrations/' + name, import.meta.url), 'utf8');
      // Migrations contain simple DDL/DML only, no procedures or semicolons in literals.
      // MySQL DDL auto-commits. CREATE TABLE IF NOT EXISTS permits resuming partial setup.
      for (const statement of sql
        .replace(/^--.*$/gm, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await c.query(statement);
      await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
    await c.query('SELECT RELEASE_LOCK($1)', [lockName]);
    locked = false;
  } finally {
    if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT('moolai:migrate:',DATABASE()))");
    c.release();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = database();
  try {
    await migrate(db);
    console.log('MySQL migrations complete');
  } finally {
    await db.end();
  }
}
