// Keep the Vercel project Root Directory at the repository root.
const value = process.env.BACKEND_URL;
if (!value) throw new Error('Set BACKEND_URL to the Railway HTTPS origin before deploying.');
const backend = new URL(value);
if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') {
  throw new Error('BACKEND_URL must be a plain HTTPS origin, without credentials, path or query.');
}
export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'client/dist',
  rewrites: [
    { source: '/api/:path*', destination: `${backend.origin}/api/:path*` },
  ],
  headers: [
    { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    { source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] },
  ],
};
