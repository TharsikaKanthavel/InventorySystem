import { insertAndRead } from '../src/db.js';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { database, transaction } from '../src/db.js';
import sampleData from './sample-data.js';
import { password } from '../src/validation.js';
import { persistSchedule } from '../src/depreciation.js';
// TODO: confirm with client: source names and exact rates per category.
export async function seed(db, { passwords, samples = false, mustChange = true }) {
  passwords.forEach((p) => password.parse(p));
  if (new Set(passwords).size !== 3) throw new Error('Seed passwords must be different');
  return transaction(db, async (c) => {
    if ((await c.query('SELECT id FROM users LIMIT 1')).rows.length)
      throw new Error('Database already has users; seed refuses to overwrite existing data');
    const sample = sampleData(),
      branches = {},
      users = {},
      sources = {},
      items = {};
    for (const b of sample.branches)
      branches[b.id] = (await insertAndRead(c, 'branches', 'name', [b.name])).rows[0].id;
    for (let n = 0; n < sample.users.length; n++) {
      const u = sample.users[n];
      users[u.id] = (
        await insertAndRead(
          c,
          'users',
          'name,email,role,branch_id,password_hash,must_change_password',
          [
            u.name,
            u.email,
            u.role,
            branches[u.branchId] || null,
            await bcrypt.hash(passwords[n], 12),
            mustChange,
          ],
        )
      ).rows[0].id;
    }
    for(const name of ['Hospital','Donation']) {
      await c.query('INSERT INTO sources(name) VALUES($1) ON DUPLICATE KEY UPDATE name=name',[name]);
      sources[name]=(await c.query('SELECT id FROM sources WHERE name=$1',[name])).rows[0].id;
    }
    // Synthetic fixtures only: preserve their descriptive source separately.
    for(const name of sample.sources) sources[name]=sources[name==='Hospital purchase'||name==='MCH'?'Hospital':'Donation'];
    for (const s of sample.items)
      items[s] = (await insertAndRead(c, 'items', 'name', [s])).rows[0].id;
    for (const r of sample.rates)
      await c.query('INSERT INTO depreciation_rates(category,rate) VALUES($1,$2)', [
        r.category,
        r.rate,
      ]);
    if (samples) {
      const ids = {};
      for (const a of sample.assets) {
        const row = (
          await insertAndRead(
            c,
            'assets',
            'branch_id,sr_no,audit_book_ref,audit_year,date_purchased,donation_source_id,item_id,category,dep_percent,original_cost,created_by,donor_supplier',
            [
              branches[a.branchId],
              a.srNo,
              a.auditBookRef,
              a.auditYear,
              a.datePurchased,
              sources[a.source],
              items[a.item],
              a.category,
              a.depPercent,
              a.originalCost,
              users[a.createdBy],
              a.source,
            ],
          )
        ).rows[0];
        ids[a.id] = row.id;
        await persistSchedule(c, row);
        await c.query(
          "INSERT INTO audit_trail(actor_id,action,entity,entity_id,branch_id,detail) VALUES($1,'asset.created','asset',$2,$3,$4)",
          [
            users[a.createdBy],
            row.id,
            row.branch_id,
            `${a.item} (Sr ${a.srNo}) added, LKR ${a.originalCost} (synthetic sample)`,
          ],
        );
      }
      for (const r of sample.deleteRequests)
        await c.query(
          'INSERT INTO delete_requests(asset_id,requested_by,reason) VALUES($1,$2,$3)',
          [ids[r.assetId], users[r.requestedBy], r.reason],
        );
      await c.query(
        'UPDATE branches b SET next_sr=(SELECT COALESCE(MAX(sr_no),0)+1 FROM assets a WHERE a.branch_id=b.id)',
      );
    }
    await c.query(
      "INSERT INTO audit_trail(actor_id,action,entity,entity_id,detail) VALUES($1,'system.seeded','system','seed',$2)",
      [
        users['U-ADMIN'],
        samples
          ? 'Initialized with prototype synthetic assets'
          : 'Initialized accounts and placeholder dropdown lists',
      ],
    );
    return { branches, users };
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = database();
  try {
    await seed(db, {
      passwords: [
        process.env.SEED_ADMIN_PASSWORD,
        process.env.SEED_BRANCH_A_PASSWORD,
        process.env.SEED_BRANCH_B_PASSWORD,
      ],
      samples: process.env.SEED_SAMPLE_ASSETS === 'true',
    });
    console.log('Seed complete. All users must change their initial password.');
  } finally {
    await db.end();
  }
}
