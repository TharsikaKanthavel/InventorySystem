import { insertAndRead, allocateSerial } from './db.js';
import express from 'express';
import { Worker } from 'node:worker_threads';
import { rateLimit } from 'express-rate-limit';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { transaction } from './db.js';
import { scope, audit } from './assets.js';
import { assetSchema, uuid, fail } from './validation.js';
import { auditYearOf, persistSchedule } from './depreciation.js';
import { validateOpeningRows, openingLookups } from './opening-import.js';

const columns = [
  'Audit Book Ref',
  'Date Purchased',
  'Source',
  'Details',
  'Category',
  'Dep %',
  'Original Cost',
];
const keys = [
  'audit_book_ref',
  'date_purchased',
  'source',
  'item',
  'category',
  'dep_percent',
  'original_cost',
];
const normal = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
const aliases = {
  'donation / hospital (source)': 'source',
  'donation / hospital': 'source',
  'details (item)': 'details',
  item: 'details',
  'asset category': 'category',
  'original cost (lkr)': 'original cost',
};
const header = (value) => aliases[normal(value)] || normal(value);
function readWorkbook(bytes, mode, sheet) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.js', import.meta.url), {
      workerData: { bytes, mode, sheet },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      error ? reject(fail(400, error)) : resolve(value);
    };
    const timer = setTimeout(
      () => finish('Workbook took too long to read. Use a smaller file.'),
      15000,
    );
    worker.once('message', (data) => (data.error ? finish(data.error) : finish(null, data)));
    worker.once('error', () =>
      finish('The workbook could not be read. Save a smaller, unencrypted .xlsx file.'),
    );
    worker.once('exit', () => {
      if (!settled) finish('The workbook reader stopped unexpectedly.');
    });
  });
}
const fingerprint = (a) =>
  JSON.stringify([
    normal(a.audit_book_ref),
    a.date_purchased,
    a.donation_source_id,
    a.item_id,
    a.category,
    Number(a.dep_percent),
    Number(a.original_cost),
  ]);
async function validateRows(db, branchId, rows) {
  const sources = (await db.query("SELECT id,name FROM sources WHERE name IN ('Hospital','Donation')")).rows;
  const items = (await db.query('SELECT id,name FROM items')).rows;
  const rates = (await db.query('SELECT category,rate FROM depreciation_rates')).rows;
  const branch = (await db.query('SELECT id,name FROM branches WHERE id=$1', [branchId])).rows[0];
  if (!branch) throw fail(400, 'Unknown branch');
  const existing = new Set(
    (
      await db.query('SELECT * FROM assets WHERE branch_id=$1 AND deleted_at IS NULL', [branchId])
    ).rows.map(fingerprint),
  );
  const seen = new Set();
  return rows.map((row) => {
    const errors = [...(row.parseErrors || [])];
    if (row.branch && normal(row.branch) !== normal(branch.name))
      errors.push('Branch must match the selected branch: ' + branch.name);
    const source = sources.find((s) => normal(s.name) === normal(row.source));
    const item = items.find((s) => normal(s.name) === normal(row.item));
    if (!source) errors.push('Source must be Hospital or Donation. Put donor/supplier in its separate optional column.');
    if (!item) errors.push('Item is not in the dropdown list. Add it before importing.');
    const parsed = assetSchema.safeParse({
      ...row,
      branch_id: branchId,
      donation_source_id: source?.id,
      item_id: item?.id,
    });
    if (!parsed.success)
      errors.push(
        ...parsed.error.issues
          .filter((i) => !['donation_source_id', 'item_id'].includes(i.path[0]))
          .map((i) => `${i.path[0]}: ${i.message}`),
      );
    if (
      !rates.some((r) => r.category === row.category && Number(r.rate) === Number(row.dep_percent))
    )
      errors.push('Choose a configured depreciation rate for this category.');
    if (parsed.success) {
      const key = fingerprint(parsed.data);
      if (seen.has(key)) errors.push('Duplicate row in this file.');
      if (existing.has(key)) errors.push('An identical asset already exists in this branch.');
      seen.add(key);
    }
    return { ...row, branch: branch.name, errors, data: parsed.success ? parsed.data : null };
  });
}
function parseRows(workbook) {
  const first = workbook.rows.find((r) => r.number === 1);
  if (!first)
    throw fail(400, 'Put column headers in row 1. Download the template for the expected format.');
  const headers = first.cells.map((c) => header(c.value));
  for (const label of columns) {
    if (headers.filter((h) => h === normal(label)).length !== 1)
      throw fail(400, 'Include exactly one ' + label + ' column.');
  }
  const rows = workbook.rows
    .filter((r) => r.number > 1)
    .map((r) => {
      const result = { row: r.number, parseErrors: [] };
      for (let i = 0; i < columns.length; i++) {
        const cell = r.cells[headers.indexOf(normal(columns[i]))] || { value: '' };
        let v = cell.value;
        if (v && typeof v === 'object') {
          result.parseErrors.push(columns[i] + ': ' + v.error);
          v = '';
        }
        if (typeof v === 'string') v = v.trim();
        if (keys[i] === 'dep_percent') {
          if (typeof v === 'number' && cell.percent) v *= 100;
          if (typeof v === 'string' && v.endsWith('%')) v = v.slice(0, -1).trim();
        }
        if (
          keys[i] === 'original_cost' &&
          typeof v === 'string' &&
          /^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(v)
        )
          v = v.replaceAll(',', '');
        result[keys[i]] = v;
      }
      const b = headers.indexOf('branch');
      if (b >= 0) {
        const value = r.cells[b]?.value;
        if (value && typeof value === 'object')
          result.parseErrors.push('Branch: invalid cell value');
        else result.branch = String(value || '').trim();
      }
      const donor=headers.indexOf('donor / supplier');
      if(donor>=0){const v=r.cells[donor]?.value;if(v&&typeof v==='object')result.parseErrors.push('Donor / Supplier: invalid cell');else result.donor_supplier=String(v??'').trim();}
      return result;
    });
  if (!rows.length) throw fail(400, 'The worksheet has no asset rows.');
  return rows;
}
export function importRoutes(app, db) {
  app.get('/api/imports/template', async (req, res) => {
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('Assets');
    sheet.columns = [...columns,'Donor / Supplier'].map((h) => ({ header: h, key: h, width: h === 'Category' ? 30 : 24 }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22452B' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getColumn(2).numFmt = 'yyyy-mm-dd';
    sheet.getColumn(7).numFmt = '#,##0.00';
    const guide = workbook.addWorksheet('Instructions');
    guide.getColumn(1).width = 110;
    [
      'Fill the Assets sheet, one asset per row. Keep row 1 headers. Maximum 500 rows and 2 MB.',
      'Choose JAFFNA or MOOLAI in the application. Branch users can import only into their own branch.',
      'Date Purchased: Excel date or YYYY-MM-DD. Do not use formulas; paste values.',
      'Dep %: use 15 for 15%, or an Excel percentage cell. Use a configured rate for the category.',
      'Original Cost: numeric LKR value of at least 1.00. Do not enter depreciation or WDV.',
      'Sources and items must already exist in the dropdown lists. Add missing entries in the application first.',
      'The application calculates serial number, audit year, depreciation and WDV.',
      'Preview every row. Fix all errors before confirming. Identical existing rows are blocked.',
      'Import adds new assets only; existing records are never updated by this upload.',
    ].forEach((t) => guide.addRow([t]));
    const lists = workbook.addWorksheet('Dropdown values');
    lists.columns = [
      { header: 'Sources', width: 32 },
      { header: 'Items', width: 32 },
      { header: 'Category', width: 32 },
      { header: 'Rate %', width: 16 },
    ];
    const sources = (await db.query("SELECT name FROM sources WHERE name IN ('Hospital','Donation') ORDER BY name")).rows;
    const items = (await db.query('SELECT name FROM items ORDER BY name')).rows;
    const rates = (
      await db.query('SELECT category,rate FROM depreciation_rates ORDER BY category,rate')
    ).rows;
    for (let i = 0; i < Math.max(sources.length, items.length, rates.length); i++)
      lists.addRow([
        sources[i]?.name || '',
        items[i]?.name || '',
        rates[i]?.category || '',
        rates[i] ? Number(rates[i].rate) : '',
      ]);
    res
      .attachment('Moolai_Asset_Import_Template.xlsx')
      .send(Buffer.from(await workbook.xlsx.writeBuffer()));
  });
  app.post(
    '/api/imports/preview',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    express.raw({ type: 'application/octet-stream', limit: '2mb' }),
    async (req, res) => {
      const branchId = scope(req.user, req.query.branch);
      if (!branchId) throw fail(400, 'Select a branch for this import');
      const filename = z
        .string()
        .min(1)
        .max(200)
        .regex(/\.xlsx$/i, 'Upload an .xlsx file. Save older .xls files as .xlsx first.')
        .parse(req.query.filename);
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw fail(400, 'Upload an Excel workbook');
      const mode = z.enum(['new', 'opening']).default('new').parse(req.query.mode);
      const sheet = z.string().max(31).optional().parse(req.query.sheet);
      const workbook = await readWorkbook(req.body, mode, sheet);
      if (workbook.needsSheet) return res.json({ needsSheet: true, sheets: workbook.sheets });
      const raw = mode === 'opening' ? workbook.rows : parseRows(workbook);
      const rows = await (mode === 'opening' ? validateOpeningRows : validateRows)(
        db,
        branchId,
        raw,
      );
      let id = null;
      if (rows.every((r) => !r.errors.length)) {
        await db.query("DELETE FROM asset_imports WHERE status='preview' AND expires_at<now()");
        id = (
          await insertAndRead(db, 'asset_imports', 'requested_by,branch_id,filename,import_rows', [
            req.user.id,
            branchId,
            filename,
            JSON.stringify(raw),
          ])
        ).rows[0].id;
      }
      res.json({
        id,
        filename,
        mode,
        openingDate: mode === 'opening' ? '2026-04-30' : null,
        totals:
          mode === 'opening'
            ? Object.fromEntries(
                ['original_cost', 'opening_accumulated', 'opening_wdv'].map((key) => [
                  key,
                  rows.reduce((s, r) => s + Math.round((Number(r[key]) || 0) * 100), 0) / 100,
                ]),
              )
            : null,
        sheet: workbook.sheet,
        branch: rows[0].branch,
        count: rows.length,
        valid: rows.filter((r) => !r.errors.length).length,
        rows: rows.map(({ data, parseErrors, ...row }) => row),
      });
    },
  );
  app.post('/api/imports/:id/commit', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const result = await transaction(db, async (c) => {
      const batch = (
        await c.query('SELECT * FROM asset_imports WHERE id=$1 AND requested_by=$2 FOR UPDATE', [
          id,
          req.user.id,
        ])
      ).rows[0];
      if (!batch) throw fail(404, 'Import preview not found');
      scope(req.user, batch.branch_id);
      if (batch.status === 'committed') return batch.result;
      if (new Date(batch.expires_at) <= new Date())
        throw fail(409, 'Preview expired. Upload the file again.');
      await c.query('SELECT id FROM branches WHERE id=$1 FOR UPDATE', [batch.branch_id]);
      const opening = batch.import_rows[0]?.opening_balance_date === '2026-04-30';
      const rows = await (opening ? validateOpeningRows : validateRows)(
        c,
        batch.branch_id,
        batch.import_rows,
      );
      if (rows.some((r) => r.errors.length))
        throw fail(
          409,
          'The register or dropdown lists changed. Upload again to review current validation results.',
        );
      const created = [];
      for (const row of rows) {
        const b = row.data;
        if (opening) await openingLookups(c, b);
        const sr = (await allocateSerial(c, b.branch_id)).rows[0].sr;
        const a = (
          await insertAndRead(
            c,
            'assets',
            'branch_id,sr_no,audit_book_ref,audit_year,date_purchased,donation_source_id,item_id,category,dep_percent,original_cost,created_by,opening_balance_date,opening_accumulated,opening_import_key,purchase_date_note,donor_supplier',
            [
              b.branch_id,
              sr,
              b.audit_book_ref,
              b.date_purchased ? auditYearOf(b.date_purchased) : null,
              b.date_purchased,
              b.donation_source_id,
              b.item_id,
              b.category,
              b.dep_percent,
              b.original_cost,
              req.user.id,
              b.opening_balance_date || null,
              b.opening_accumulated ?? null,
              b.opening_import_key || null,
              b.purchase_date_note || null,
              b.donor_supplier || '',
            ],
          )
        ).rows[0];
        await persistSchedule(c, a);
        await audit(
          c,
          req.user,
          'asset.created',
          'asset',
          a.id,
          a.branch_id,
          `Imported ${row.item} (Sr ${sr}) from ${batch.filename}, row ${row.row}`,
          null,
          a,
        );
        created.push({ id: a.id, sr_no: sr });
      }
      const result = { count: created.length, assets: created };
      await c.query(
        "UPDATE asset_imports SET status='committed',result=$2,committed_at=now() WHERE id=$1",
        [id, JSON.stringify(result)],
      );
      await audit(
        c,
        req.user,
        'import.committed',
        'import',
        id,
        batch.branch_id,
        `Imported ${created.length} assets from ${batch.filename}`,
      );
      return result;
    });
    res.json(result);
  });
}
