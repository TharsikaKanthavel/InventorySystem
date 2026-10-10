import { database } from './db.js';
import { createApp } from './app.js';
const db = database();
await db.query('SELECT 1');
const server = createApp(db).listen(process.env.PORT || 3001, process.env.HOST || '127.0.0.1', () =>
  console.log('Moolai Inventory API ready'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await db.end();
      process.exit(0);
    }),
  );
