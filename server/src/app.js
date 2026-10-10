import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { authRoutes } from './auth.js';
import { assetRoutes } from './assets.js';
import { adminRoutes } from './admin.js';
import { reportRoutes } from './reports.js';
import { importRoutes } from './imports.js';
import { resetRoutes } from './resets.js';
export function createApp(db, config = {}) {
  const app = express(),
    secure = config.secure ?? process.env.NODE_ENV === 'production',
    origin = config.origin || process.env.APP_ORIGIN || 'http://localhost:5173';
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.get('/health', async (req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  authRoutes(app, db, { secure, origin });
  resetRoutes(app, db);
  importRoutes(app, db);
  assetRoutes(app, db);
  adminRoutes(app, db);
  reportRoutes(app, db);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  const dist = config.distDir || fileURLToPath(new URL('../../client/dist/', import.meta.url));
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile(dist + 'index.html'));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ZodError)
      return res
        .status(400)
        .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'This entry or pending request already exists' });
    if (
      [
        'ER_NO_REFERENCED_ROW_2',
        'ER_ROW_IS_REFERENCED_2',
        'ER_CHECK_CONSTRAINT_VIOLATED',
        'ER_TRUNCATED_WRONG_VALUE',
        'ER_DATA_TOO_LONG',
        'WARN_DATA_TRUNCATED',
      ].includes(err.code)
    )
      return res.status(400).json({ error: 'Invalid reference or field value' });
    const status = err.status || 500;
    if (status >= 500) console.error('Request failed:', err.message);
    res
      .status(status)
      .json({ error: status < 500 ? err.message : 'The server could not complete this request' });
  });
  return app;
}
