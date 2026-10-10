import { database, transaction } from '../src/db.js';
import { persistSchedule, today } from '../src/depreciation.js';
const db = database();
try {
  await transaction(db, async (c) => {
    const assets = (await c.query('SELECT * FROM assets WHERE deleted_at IS NULL FOR UPDATE')).rows;
    for (const a of assets) await persistSchedule(c, a);
    await c.query(
      "INSERT INTO audit_trail(action,entity,entity_id,detail) VALUES('depreciation.rollforward','job',$1,$2)",
      [today(), `Monthly roll-forward refreshed ${assets.length} assets`],
    );
    console.log(`Updated ${assets.length} assets through ${today()}`);
  });
} finally {
  await db.end();
}
