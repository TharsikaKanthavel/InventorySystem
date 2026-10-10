# Moolai Inventory Web 1.0.8

Separate browser edition of the MySQL desktop v1.0.7 system. Includes branch assets, Excel imports, reports, admin reset with branch backup and recovery. No Electron installation is needed. Data is stored in MySQL on the server, not in each user's browser.

## Local setup

Install Node.js 22.16+ and MySQL 8.4. Extract this entire folder. Run commands in this folder:

1. `npm ci`
2. Copy `server/.env.example` to `server/.env`.
3. Set DATABASE_URL to an existing MySQL database and application account. The database must already exist. URL-encode special characters in its password. Do not use a MySQL root account for routine operation.
4. Set APP_ORIGIN to `http://localhost:3001`. Leave NODE_ENV=development for this local HTTP check. HOST defaults to 127.0.0.1.
5. Back up an existing database before running `npm run db:migrate`. Migration 006 adds the donor/supplier field and branch reset-protection records. Back up first; run migrations once using the supplied command.
6. For a NEW, EMPTY database ONLY, set three different seed passwords (at least 12 characters), keep SEED_SAMPLE_ASSETS=false, then run `npm run db:seed`. Do not seed an existing hospital database. Remove seed passwords from the settings afterward.
7. Run `npm run build`, then `npm start`.
8. Open `http://localhost:3001` in a browser. Keep the server running.

Initial account names: admin@hospital.lk, brancha@hospital.lk (JAFFNA), branchb@hospital.lk (MOOLAI). Passwords are the values you chose when initializing a new database. Existing databases retain existing logins. Initial passwords must be changed at first login.

For frontend development use `npm run dev` and APP_ORIGIN=http://localhost:5173. The Vite frontend forwards API calls to port 3001. For normal use, build and serve both UI and API from port 3001.

## Shared web hosting

The server needs Node.js and MySQL; branch users need only a browser and a connection to it. Both branches can use the same deployment and database. This archive is prepared for deployment but is not already hosted.

Use server/.env.production.example as the settings template. Configure your real HTTPS domain as APP_ORIGIN, NODE_ENV=production, and a trusted HTTPS reverse proxy forwarding to the local backend. Production session cookies require HTTPS. TRUST_PROXY=1 is for exactly one trusted proxy; keep the backend bound to loopback and block public access to its port. Configure your process manager to restart the application after a server reboot. Keep MySQL private. Store secrets outside version control and maintain tested database backups.

Install dependencies with `npm ci`, run migrations after a backup, run `npm run build`, then start the server with `npm start`. This package does not provision a domain, TLS certificate, cloud account or database. Hosting and another-computer access have not yet been verified.

## Reset and reimport

Admin > Asset register > Reset branch assets. Choose one branch, prepare and download its archive, enter the confirmation phrase, administrator password and reason. Numbering restarts at 1. Admin or the branch user can then upload its opening-balance Excel sheet. A 30 April 2026 opening balance continues depreciation from May 2026.

Recovery is available only before adding/importing new assets. It uses the snapshot retained in MySQL. The JSON archive is not a full database backup and cannot be uploaded to recreate a lost database. Keep a full MySQL backup separately.

## Testing

`npm test` runs server tests. Database-backed cases require TEST_DATABASE_URL pointing to a dedicated test MySQL instance with permission to create temporary test databases. Never set it to the live hospital database. See TEST RESULTS.txt for checks performed on this web package.

## Contents

- client: React/Vite frontend and compiled browser files
- server: Express backend, MySQL migrations and tests
- package-lock.json: reproducible dependency installation

This is an independent copy. The desktop v1.0.7 ZIP is unchanged.

