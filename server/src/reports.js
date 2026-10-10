import { fixedAssetRoutes } from './fixed-assets.js';
import { assetCounts } from './asset-counts.js';
import { monthlyBranchRoutes } from './monthly-branch.js';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { listAssets, asOf, audit, scope, assetById } from './assets.js';
import {
  CATEGORIES,
  totals,
  position,
  periodLabel,
  assetSchedule,
  monthsElapsed,
} from './depreciation.js';
import { fail } from './validation.js';
export async function reportData(db, u, kind, q) {
  z.enum(['register', 'schedule', 'category', 'branch', 'asset-schedule', 'asset-quantities', 'asset-comparison']).parse(kind);
  if (['branch', 'asset-comparison'].includes(kind) && u.role !== 'admin') throw fail(403, 'Administrator access required');
  const date = asOf(q);
  if (kind === 'asset-schedule') {
    const a = await assetById(db, u, q.asset);
    return assetSchedule(a, date).map((r) => ({
      Month: r.month,
      Period: r.period,
      Provision: r.provision,
      Accumulated: r.accumulated,
      WDV: r.wdv,
    }));
  }
  const list = await listAssets(db, u, q);
  if (kind === 'asset-quantities' || kind === 'asset-comparison') {
    const branches = kind === 'asset-comparison'
      ? (await db.query('SELECT name FROM branches ORDER BY name')).rows.map(b => b.name) : [];
    return assetCounts(list, branches, kind === 'asset-comparison');
  }
  if (kind === 'register')
    return list.map((a) => ({
      Branch: a.branch,
      'Sr No': a.sr_no,
      'Audit Book Ref': a.audit_book_ref,
      'Audit Year': a.audit_year,
      'Date Purchased': a.date_purchased || 'Unknown',
      'Opening Balance Date': a.opening_balance_date || '',
      'Opening Accumulated Depreciation': a.opening_accumulated ?? '',
      Classification: a.source,
      'Donor / Supplier': a.donor_supplier || '',
      Details: a.item,
      Category: a.category,
      'Dep %': a.dep_percent,
      'Original Cost': a.original_cost,
      'Accumulated Depreciation': a.position.accumulated,
      WDV: a.position.wdv,
      Status: a.position.fully ? 'Fully depreciated' : 'Active',
    }));
  if (kind === 'schedule') {
    const prev = periodLabel(date, -1);
    return list
      .filter((a) => (a.opening_balance_date || a.date_purchased) <= date)
      .map((a) => ({
        Branch: a.branch,
        'Sr No': a.sr_no,
        Details: a.item,
        'Opening WDV': position(a, prev).wdv,
        Provision: a.position.provision,
        'Closing WDV': a.position.wdv,
        Accumulated: a.position.accumulated,
      }));
  }
  const groups =
    kind === 'category'
      ? CATEGORIES
      : (await db.query('SELECT name FROM branches ORDER BY name')).rows.map((b) => b.name);
  return groups.map((name) => {
    const t = totals(list.filter((a) => (kind === 'category' ? a.category : a.branch) === name));
    return {
      [kind === 'category' ? 'Category' : 'Branch']: name,
      Assets: t.count,
      'Original cost': t.cost,
      'Accumulated dep.': t.acc,
      WDV: t.wdv,
      'Fully depreciated': t.fully,
    };
  });
}
const safeCell = (v) => (typeof v === 'string' && /^[\s]*[=+@-]/.test(v) ? "'" + v : v);
export function csv(rows) {
  const quote = (v) => '"' + String(safeCell(v) ?? '').replaceAll('"', '""') + '"';
  if (!rows.length) return 'No records\r\n';
  return (
    '\uFEFF' +
    [Object.keys(rows[0]), ...rows.map(Object.values)]
      .map((r) => r.map(quote).join(','))
      .join('\r\n')
  );
}
export function reportRoutes(app, db) {
  monthlyBranchRoutes(app, db);
  fixedAssetRoutes(app, db);
  app.get('/api/reports/:kind', async (req, res) => {
    const rows = await reportData(db, req.user, req.params.kind, req.query);
    if (!req.query.format) return res.json(rows);
    const format = z.enum(['csv', 'xlsx', 'pdf']).parse(req.query.format),
      name = `${req.params.kind}-${asOf(req.query)}.${format}`;
    await audit(
      db,
      req.user,
      'export.' + req.params.kind,
      'report',
      req.params.kind,
      scope(req.user, req.query.branch),
      `${req.params.kind} exported as ${format}; ${rows.length} rows; filters ${JSON.stringify(req.query)}`,
    );
    res.attachment(name);
    if (format === 'csv') return res.type('text/csv').send(csv(rows));
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook();
      book.creator = 'Moolai Hospital';
      const sheet = book.addWorksheet('Report');
      if (rows.length) {
        sheet.columns = Object.keys(rows[0]).map((key) => ({
          header: key,
          key,
          width: key === 'Details' || key === 'Category' ? 30 : 22,
        }));
        rows.forEach((r) => sheet.addRow(r));
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF22452B' } };
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: rows.length + 1, column: sheet.columns.length },
        };
      } else sheet.addRow(['No records']);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(Buffer.from(await book.xlsx.writeBuffer()));
    }
    const doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 28, bufferPages: true });
    res.type('application/pdf');
    doc.pipe(res);
    const headers = Object.keys(rows[0] || { Result: '' }),
      width = (doc.page.width - 56) / headers.length,
      font = headers.length > 10 ? 7 : 9;
    const heading = () => {
      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#22452b')
        .text('Moolai Hospital - ' + req.params.kind.replaceAll('-', ' '));
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#333333')
        .text(
          'Figures as of ' +
            asOf(req.query) +
            ' | ' +
            (req.user.role === 'admin' ? 'Administrator' : req.user.name),
        );
      doc.moveDown();
      const y = doc.y;
      headers.forEach((h, i) =>
        doc
          .font('Helvetica-Bold')
          .fontSize(font)
          .text(h, 28 + i * width, y, { width: width - 6 }),
      );
      doc.y = y + 38;
    };
    heading();
    for (const row of rows) {
      const vals = Object.values(row).map((v) =>
        typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v ?? ''),
      );
      doc.font('Helvetica').fontSize(font);
      const height = Math.max(
        20,
        ...vals.map((v) => doc.heightOfString(v, { width: width - 6 }) + 10),
      );
      if (doc.y + height > doc.page.height - 50) {
        doc.addPage();
        heading();
      }
      const y = doc.y;
      vals.forEach((v, i) =>
        doc
          .font('Helvetica')
          .fontSize(font)
          .text(v, 28 + i * width, y, { width: width - 6 }),
      );
      doc
        .moveTo(28, y + height - 3)
        .lineTo(doc.page.width - 28, y + height - 3)
        .strokeColor('#d9dee3')
        .stroke();
      doc.y = y + height;
    }
    if (!rows.length) doc.text('No records');
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .text(`Page ${i + 1} of ${range.count}`, 28, doc.page.height - 35, { lineBreak: false });
    }
    doc.end();
  });
}
