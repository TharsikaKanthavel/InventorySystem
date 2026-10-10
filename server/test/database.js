import { randomUUID } from 'node:crypto';
import { database } from '../src/db.js';
import { migrate } from '../db/migrate.js';
export async function testDatabase() {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      'Integration tests require TEST_DATABASE_URL=mysql://test_user:password@127.0.0.1:3306/mysql (a MySQL 8.4 account allowed to create/drop test databases).',
    );
  const name = 'test_' + randomUUID().replaceAll('-', '');
  const owner = database(process.env.TEST_DATABASE_URL);
  await owner.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const db = database(url.href);
  const end = db.end.bind(db);
  db.end = async () => {
    try {
      await end();
      await owner.query(`DROP DATABASE \`${name}\``);
    } finally {
      await owner.end();
    }
  };
  try {
    await migrate(db);
    await migrate(db);
    return db;
  } catch (e) {
    await db.end();
    throw e;
  }
}
