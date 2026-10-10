# Hosting trial: Vercel + Railway

Status: deployment files prepared. No GitHub push, hosted deployment or hosted login test has been completed yet.

Use a private GitHub repository and a separate empty trial database. Never commit server/.env, account passwords, database exports or hospital spreadsheets. Existing desktop and web archives are unchanged.

## 1. GitHub

Put this folder's CONTENTS at the repository root (package.json, Dockerfile and vercel.mjs must be at the top level). Commit the code and connect the same repository to Railway and Vercel. The included .gitignore excludes local secrets. Do not upload a ZIP as the repository's only file.

## 2. Railway backend and MySQL

Create a trial project. Add MySQL, using MySQL 8.4 for compatibility with this application's migrations. Add an application service from the repository, keeping its Root Directory at the repository root. The Dockerfile builds the app. railway.json runs migrations before each deployment and checks /health. Migration failure must block deployment; never add automatic seed/reset commands to the deployment lifecycle.

Set the BACKEND service's variables:

| Variable | Value |
| --- | --- |
| DATABASE_URL | Reference the MySQL service's MYSQL_URL, using Railway's variable picker; keep the connection private |
| NODE_ENV | production |
| HOST | 0.0.0.0 |
| APP_ORIGIN | Exact Vercel production origin, e.g. https://your-project.vercel.app, without a trailing slash |
| TRUST_PROXY | 1; verify client-IP forwarding and rate limiting after hosting |
| SEED_SAMPLE_ASSETS | false |

Railway supplies PORT. Generate a public HTTPS domain for the backend and save that origin. /health should return status ok when the database is reachable. Do not expose MySQL publicly for normal operation.

Initialize accounts only once on the empty trial database. Set three DIFFERENT temporary values of at least 12 characters for SEED_ADMIN_PASSWORD, SEED_BRANCH_A_PASSWORD and SEED_BRANCH_B_PASSWORD. Run npm run db:seed in Railway's deployed service environment (with private database access), then remove those seed variables. Do not paste passwords into chat or commit them. Seed refuses to replace existing accounts. First login requires changing each temporary password.

## 3. Vercel frontend

Import the same repository. Keep Root Directory at the repository root. vercel.mjs sets the build command and client/dist output directory. Choose the project's stable production domain and use that exact origin in Railway APP_ORIGIN.

Set BACKEND_URL to the Railway service's HTTPS origin, without /api, credentials or query parameters. Set it for Production. vercel.mjs proxies /api requests to Railway, so the existing same-origin cookies and CSRF checks remain enabled. Do not add DATABASE_URL or passwords to Vercel or any VITE_ variables. BACKEND_URL is routing configuration, not a database credential.

Preview deployments need a separate backend/database and exact matching APP_ORIGIN. Do not point arbitrary preview deployments at the production database. This setup deliberately does not allow all *.vercel.app origins.

## 4. Hosted acceptance checks

Verify backend /health, login through the Vercel domain, mandatory initial password change, session persistence, logout, branch isolation, an Excel preview/commit and report downloads. Check cookies are Secure and HttpOnly, API responses are not cached, and rate limiting sees the expected client IP. Verify proxy upload/time limits with representative files; local tests do not establish provider limits. Confirm both providers deploy the intended commit after a push to the connected production branch.

## 5. Automatic deployment and cost

Enable GitHub integration on both providers for the chosen production branch. Each service builds independently after a push; deploy backwards-compatible API/database changes because frontend and backend releases are not atomic. Review provider charges/quotas in your own accounts before provisioning resources. No paid plan is selected by this package.

This hosting configuration has not yet been exercised on Vercel or Railway. Full database backup/restore and accountant validation are still required before real hospital use.

References:
- https://vercel.com/docs/project-configuration/vercel-ts
- https://vercel.com/docs/routing/rewrites
- https://docs.railway.com/config-as-code/reference
- https://docs.railway.com/databases/mysql
- https://docs.railway.com/deployments/healthchecks
