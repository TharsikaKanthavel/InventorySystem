// Synthetic QA preview using a disposable MySQL database. Requires TEST_DATABASE_URL.
// Normal persistent use: npm start. The test database is removed on graceful shutdown.
import { testDatabase } from './database.js';
import { seed } from '../db/seed.js';
import { createApp } from '../src/app.js';
const db = await testDatabase();
await seed(db, {
  passwords: ['Preview-Admin-2026!', 'Preview-BranchA-2026!', 'Preview-BranchB-2026!'],
  samples: true,
  mustChange: false,
});
const server = createApp(db, { origin: 'http://localhost:3001', secure: false }).listen(
  3001,
  '127.0.0.1',
  () => console.log('Synthetic QA preview: http://localhost:3001'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await db.end();
      process.exit(0);
    }),
  );
