import { z } from 'zod';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { listAssets, scope, audit } from './assets.js';
import { CATEGORIES, position, today, toCents } from './depreciation.js';
import { uuid, fail } from './validation.js';
const monthSchema = z.string().regex(/^(19\d{2}|20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/);
export const financialKeys = [
  'openingCost',
  'purchases',
  'closingCost',
  'openingWdv',
  'openingAccumulated',
  'openingAssetDep',
  'purchaseDep',
  'periodDep',
  'closingAccumulated',
  'closingWdv',
];
export function reportPeriod(q) {
  const to = monthSchema.parse(q.toMonth);
  const from = monthSchema.parse(
    q.fromMonth || `${Number(to.slice(0, 4)) - (Number(to.slice(5, 7)) < 5 ? 1 : 0)}-05`,
  );
  if (from > to) throw fail(400, 'From month must not be after To month');
  const end = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  const opening = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 0))
    .toISOString()
    .slice(0, 10);
  return { fromMonth: from, toMonth: to, start: from + '-01', end, opening };
}
// All differences and totals are calculated in whole cents.
export function financialRow(a, p) {
  if (a.opening_balance_date && p.opening < a.opening_balance_date)
    throw fail(
      400,
      'Imported opening balances start at 30 April 2026. Select May 2026 or later for the reporting period.',
    );
  if ((a.opening_balance_date || a.date_purchased) > p.end) return null;
  const old = (a.opening_balance_date || a.date_purchased) < p.start;
  const cost = toCents(a.original_cost);
  const openingAccumulated = old ? toCents(position(a, p.opening).accumulated) : 0;
  const closingAccumulated = toCents(position(a, p.end).accumulated);
  const dep = closingAccumulated - openingAccumulated;
  const values = [
    old ? cost : 0,
    old ? 0 : cost,
    cost,
    old ? cost - openingAccumulated : 0,
    openingAccumulated,
    old ? dep : 0,
    old ? 0 : dep,
    dep,
    closingAccumulated,
    cost - closingAccumulated,
  ];
  return {
    type: 'asset',
    id: a.id,
    sr: a.sr_no,
    reference: a.audit_book_ref,
    source: a.source,
    details: a.item,
    category: a.category,
    rate: Number(a.dep_percent),
    ...Object.fromEntries(financialKeys.map((key, i) => [key, values[i] / 100])),
  };
}
export const sumFinancial = (rows) =>
  Object.fromEntries(
    financialKeys.map((key) => [key, rows.reduce((s, r) => s + toCents(r[key]), 0) / 100]),
  );
const displayDate = (s) => s.split('-').reverse().join('.');
export function reportColumns(p) {
  return [
    { key: 'sr', label: 'Sr. No', width: 36 },
    { key: 'reference', label: 'Audit Book Ref', width: 65 },
    { key: 'source', label: 'Hospital / Donation', width: 62 },
    { key: 'details', label: 'Details', width: 150 },
    { key: 'rate', label: 'Dep. %', width: 40 },
    ...financialKeys.map((key, i) => ({
      key,
      label: [
        `1. Opening cost\n${displayDate(p.opening)}`,
        '2. Purchases during period',
        `3. Closing cost\n${displayDate(p.end)}`,
        `4. Opening WDV\n${displayDate(p.opening)}`,
        `5. Opening accumulated depreciation\n${displayDate(p.opening)}`,
        '6. Depreciation on opening assets',
        '7. Depreciation on purchases',
        '8. Total period depreciation',
        `9. Closing accumulated depreciation\n${displayDate(p.end)}`,
        `10. Closing WDV\n${displayDate(p.end)}`,
      ][i],
      width: 79,
    })),
  ];
}
export async function fixedAssetData(db, user, q) {
  const period = reportPeriod(q);
  const branchId = scope(user, q.branch);
  if (!branchId) throw fail(400, 'Select one branch');
  const branch = (await db.query('SELECT id,name FROM branches WHERE id=$1', [branchId])).rows[0];
  if (!branch) throw fail(404, 'Branch not found');
  let source = null;
  if (q.source) {
    source = (await db.query('SELECT id,name FROM sources WHERE id=$1', [uuid.parse(q.source)]))
      .rows[0];
    if (!source) throw fail(404, 'Source not found');
  }
  const assets = await listAssets(db, user, {
    branch: branchId,
    source: source?.id,
    asOf: period.end,
  });
  const items = assets.map((a) => financialRow(a, period)).filter(Boolean);
  const rows = [];
  for (const category of CATEGORIES) {
    const group = items.filter((a) => a.category === category);
    rows.push({ type: 'category', details: category });
    rows.push(...group);
    rows.push({ type: 'subtotal', details: category + ' — Total', ...sumFinancial(group) });
  }
  rows.push({ type: 'total', details: 'Grand total', ...sumFinancial(items) });
  return {
    ...period,
    branchId,
    branch: branch.name,
    sourceId: source?.id || null,
    source: source?.name || 'Hospital & Donation',
    projected: period.end.slice(0, 7) > today().slice(0, 7),
    title: `${branch.name} Branch — Fixed Asset and Depreciation Schedule`,
    columns: reportColumns(period),
    rows,
    assetCount: items.length,
  };
}
export async function fixedAssetWorkbook(r) {
  const book = new ExcelJS.Workbook();
  book.creator = 'Moolai Hospital';
  const s = book.addWorksheet('Fixed asset schedule');
  const n = r.columns.length;
  s.columns = r.columns.map((c) => ({
    key: c.key,
    width: c.key === 'details' ? 35 : c.width / 5.4,
  }));
  s.mergeCells(1, 1, 1, n);
  s.getCell(1, 1).value = r.title;
  s.getRow(1).font = { bold: true, size: 16 };
  s.getRow(1).height = 28;
  s.mergeCells(2, 1, 2, n);
  s.getCell(2, 1).value =
    `${displayDate(r.start)} to ${displayDate(r.end)} | ${r.source} | LKR${r.projected ? ' | Projected' : ''}`;
  s.getRow(2).height = 24;
  s.mergeCells(3, 1, 3, n);
  s.getCell(3, 1).value =
    'Calculated from current asset records. Deleted assets are excluded; this is not a locked historical ledger.';
  s.getRow(3).height = 22;
  s.getRow(4).values = r.columns.map((c) => c.label);
  s.getRow(4).height = 85;
  s.getRow(4).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22452B' } };
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  });
  for (const row of r.rows) {
    const excel = s.addRow(r.columns.map((c) => row[c.key] ?? ''));
    excel.height = row.type === 'asset' ? 32 : 27;
    excel.eachCell({ includeEmpty: true }, (cell, i) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD5DDD7' } } };
      cell.alignment = {
        wrapText: true,
        vertical: 'middle',
        horizontal: i >= 6 ? 'right' : 'left',
      };
      if (i >= 6) cell.numFmt = '#,##0.00';
      if (row.type !== 'asset') {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: row.type === 'total' ? 'FFCFE2D4' : 'FFEDF3EF' },
        };
      }
    });
    if (row.type === 'category') {
      s.mergeCells(excel.number, 1, excel.number, n);
      excel.getCell(1).value = row.details;
    }
  }
  s.views = [{ state: 'frozen', ySplit: 4, xSplit: 4 }];
  s.pageSetup = {
    paperSize: 8,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:4',
  };
  return Buffer.from(await book.xlsx.writeBuffer());
}
export function fixedAssetPdf(r) {
  const doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 24, bufferPages: true });
  const cols = r.columns;
  const scale = (doc.page.width - 48) / cols.reduce((s, c) => s + c.width, 0);
  const widths = cols.map((c) => c.width * scale);
  let y;
  const draw = (values, height, bold = false, fill = null, font = 7) => {
    let x = 24;
    if (fill) doc.rect(24, y, doc.page.width - 48, height).fill(fill);
    values.forEach((value, i) => {
      doc.rect(x, y, widths[i], height).lineWidth(0.4).strokeColor('#aebbb1').stroke();
      doc
        .fillColor('#172c1d')
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(font)
        .text(String(value), x + 4, y + 6, {
          width: widths[i] - 8,
          align: i >= 5 ? 'right' : 'left',
        });
      x += widths[i];
    });
    y += height;
  };
  const heading = () => {
    doc
      .fillColor('#22452b')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(r.title.replace('—', '-'), 24, 24);
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(
        `${displayDate(r.start)} to ${displayDate(r.end)} | ${r.source} | LKR${r.projected ? ' | Projected' : ''}`,
        24,
        46,
      );
    doc
      .fontSize(8)
      .text(
        'Calculated from current asset records; excludes deleted assets. Not a locked historical ledger.',
        24,
        62,
      );
    y = 82;
    draw(
      cols.map((c) => c.label),
      86,
      true,
      '#e6efe8',
      7,
    );
  };
  heading();
  for (const row of r.rows) {
    if (row.type === 'category') {
      if (y + 80 > doc.page.height - 42) {
        doc.addPage();
        heading();
      }
      doc.rect(24, y, doc.page.width - 48, 25).fill('#dce9df');
      doc
        .fillColor('#22452b')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(row.details, 30, y + 7);
      y += 25;
      continue;
    }
    const values = cols.map((c, i) =>
      i >= 5
        ? Number(row[c.key] || 0).toLocaleString('en-LK', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : (row[c.key] ?? ''),
    );
    doc.font(row.type === 'asset' ? 'Helvetica' : 'Helvetica-Bold').fontSize(7);
    const height = Math.max(
      28,
      ...values.map((v, i) => doc.heightOfString(String(v), { width: widths[i] - 8 }) + 12),
    );
    if (y + height > doc.page.height - 42) {
      doc.addPage();
      heading();
    }
    draw(values, height, row.type !== 'asset', row.type === 'asset' ? null : '#edf3ef');
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(`Page ${i + 1} of ${pages.count}`, 24, doc.page.height - 28, { lineBreak: false });
  }
  return doc;
}
export function fixedAssetRoutes(app, db) {
  app.get('/api/reports/fixed-assets', async (req, res) => {
    const r = await fixedAssetData(db, req.user, req.query);
    if (!req.query.format) return res.json(r);
    const format = z.enum(['xlsx', 'pdf']).parse(req.query.format);
    await audit(
      db,
      req.user,
      'export.fixed-assets',
      'report',
      'fixed-assets',
      r.branchId,
      `${r.start} to ${r.end}; ${r.source}; ${format}`,
    );
    res.attachment(
      `${r.branch}-Fixed-Assets-${r.fromMonth}-to-${r.toMonth}-${r.source.replace(/[^a-zA-Z0-9-]/g, '-')}.${format}`,
    );
    if (format === 'xlsx') {
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(await fixedAssetWorkbook(r));
    }
    res.type('application/pdf');
    const doc = fixedAssetPdf(r);
    doc.pipe(res);
    doc.end();
  });
}
