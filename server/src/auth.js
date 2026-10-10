import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { password, fail } from './validation.js';
import { transaction } from './db.js';
export const secret = () => randomBytes(32).toString('hex');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  branch_id: u.branch_id,
  active: u.active,
  must_change_password: u.must_change_password,
});
export const admin = (req, res, next) =>
  req.user.role === 'admin' ? next() : next(fail(403, 'Administrator access required'));
export function authRoutes(app, db, { secure, origin }) {
  const options = {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/api',
    maxAge: 8 * 60 * 60 * 1000,
  };
  app.use('/api', async (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== origin
    )
      throw fail(403, 'Untrusted request origin');
    if (req.cookies.moolai_session) {
      const r = await db.query(
        'SELECT u.*,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true',
        [hash(req.cookies.moolai_session)],
      );
      if (r.rows[0]) req.user = r.rows[0];
    }
    next();
  });
  app.post(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 15,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res) => {
      const input = z.object({ email: z.email(), password: z.string().max(200) }).parse(req.body);
      const u = (await db.query('SELECT * FROM users WHERE lower(email)=lower($1)', [input.email]))
        .rows[0];
      const ok = await bcrypt.compare(
        input.password,
        u?.password_hash || '$2b$12$6MsLBKlZnHhRX85CFWVMCuLP53wxWxmkdtaNLuZow.8IDJeJFQNQe',
      );
      if (!u || !ok || !u.active) throw fail(401, 'Email or password is incorrect');
      const token = secret(),
        csrf = secret();
      await transaction(db, async (c) => {
        await c.query('DELETE FROM sessions WHERE expires_at<=now() OR token_hash=$1', [
          hash(req.cookies.moolai_session || ''),
        ]);
        await c.query(
          'INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+INTERVAL 8 HOUR)',
          [hash(token), u.id, csrf],
        );
      });
      res.cookie('moolai_session', token, options).json({ user: publicUser(u), csrf });
    },
  );
  app.use('/api', (req, res, next) => {
    if (!req.user) throw fail(401, 'Please sign in');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-csrf-token'] !== req.user.csrf_token
    )
      throw fail(403, 'Invalid request token');
    next();
  });
  app.get('/api/auth/me', (req, res) =>
    res.json({ user: publicUser(req.user), csrf: req.user.csrf_token }),
  );
  app.post('/api/auth/logout', async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(req.cookies.moolai_session)]);
    res.clearCookie('moolai_session', options).json({ ok: true });
  });
  app.post('/api/auth/password', async (req, res) => {
    const b = z.object({ currentPassword: z.string(), newPassword: password }).parse(req.body);
    if (!(await bcrypt.compare(b.currentPassword, req.user.password_hash)))
      throw fail(400, 'Current password is incorrect');
    if (b.currentPassword === b.newPassword) throw fail(400, 'Choose a different password');
    await transaction(db, async (c) => {
      await c.query('UPDATE users SET password_hash=$1,must_change_password=false WHERE id=$2', [
        await bcrypt.hash(b.newPassword, 12),
        req.user.id,
      ]);
      await c.query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);
      await c.query(
        "INSERT INTO audit_trail(actor_id,action,entity,entity_id,branch_id,detail) VALUES($1,'user.password_changed','user',$2,$3,'Password changed; existing sessions revoked')",
        [req.user.id, req.user.id, req.user.branch_id],
      );
    });
    res.clearCookie('moolai_session', options).json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    if (req.user.must_change_password)
      throw fail(403, 'Change your temporary password before continuing');
    next();
  });
}
