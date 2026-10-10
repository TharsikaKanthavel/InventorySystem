import { z } from 'zod';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { listAssets, scope, audit } from './assets.js';
import { CATEGORIES, today, toCents } from './depreciation.js';
import { uuid, fail } from './validation.js';
export async function monthlyBranchData(db, user, q) {
  const month = z
    .string()
    .regex(/^(19\d{2}|20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/)
    .parse(q.month);
  const branchId = scope(user, q.branch);
  if (!branchId) throw fail(400, 'Select one branch for this report');
  const branch = (await db.query('SELECT id,name FROM branches WHERE id=$1', [branchId])).rows[0];
  if (!branch) throw fail(404, 'Branch not found');
  let source = null;
  if (q.source) {
    const sourceId = uuid.parse(q.source);
    source = (await db.query('SELECT id,name FROM sources WHERE id=$1', [sourceId])).rows[0];
    if (!source) throw fail(404, 'Source not found');
  }
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
  const assets = await listAssets(db, user, { branch: branchId, asOf: end, source: source?.id });
  if (assets.some((a) => a.opening_balance_date && month <= a.opening_balance_date.slice(0, 7)))
    throw fail(400, 'Monthly depreciation for imported opening assets is available from May 2026.');
  const rows = CATEGORIES.map((category) => ({
    category,
    provision:
      assets
        .filter(
          (a) => a.category === category && (a.opening_balance_date || a.date_purchased) <= end,
        )
        .reduce((sum, a) => sum + toCents(a.position.provision), 0) / 100,
  }));
  const label = new Date(month + '-01T00:00:00Z').toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return {
    branch: branch.name,
    branchId,
    month,
    sourceId: source?.id || null,
    source: source?.name || 'All sources',
    projected: month > today().slice(0, 7),
    title: `${branch.name} Branch - Depreciation for the Month of ${label}${source ? ' - ' + source.name : ''}`,
    rows,
    total: rows.reduce((s, r) => s + toCents(r.provision), 0) / 100,
  };
}
export function monthlyBranchRoutes(app, db) {
  app.get('/api/reports/monthly-branch', async (req, res) => {
    const report = await monthlyBranchData(db, req.user, req.query);
    if (!req.query.format) return res.json(report);
    const format = z.enum(['xlsx', 'pdf']).parse(req.query.format);
    await audit(
      db,
      req.user,
      'export.monthly-branch',
      'report',
      'monthly-branch',
      report.branchId,
      `${report.branch} monthly depreciation exported as ${format} for ${report.month}; source: ${report.source}`,
    );
    res.attachment(
      `${report.branch}-Depreciation-${report.month}-${report.source.replace(/[^a-zA-Z0-9-]/g, '-')}.${format}`,
    );
    const title = report.title + (report.projected ? ' (Projected)' : '');
    const rows = [...report.rows, { category: 'Total', provision: report.total }];
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook();
      book.creator = 'Moolai Hospital';
      const sheet = book.addWorksheet('Monthly depreciation');
      sheet.columns = [{ width: 48 }, { width: 25 }];
      sheet.mergeCells('A1:B1');
      sheet.getCell('A1').value = title;
      sheet.getCell('A1').font = { bold: true, size: 13 };
      sheet.getCell('A1').alignment = { wrapText: true, vertical: 'middle' };
      sheet.getRow(1).height = 42;
      sheet.addRow(['Asset Category', 'Depreciation (LKR)']);
      rows.forEach((r) => sheet.addRow([r.category, r.provision]));
      for (let n = 2; n <= 8; n++) {
        sheet.getRow(n).height = 26;
        sheet.getRow(n).eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' },
          };
        });
      }
      sheet.getRow(2).font = { bold: true };
      sheet.getRow(8).font = { bold: true };
      sheet.getColumn(2).numFmt = '#,##0.00';
      sheet.pageSetup = {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        printArea: 'A1:B8',
      };
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(Buffer.from(await book.xlsx.writeBuffer()));
    }
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.type('application/pdf');
    doc.pipe(res);
    doc.font('Helvetica-Bold').fontSize(15).text(title, { align: 'center' });
    doc.moveDown();
    const x = 40,
      width = doc.page.width - 80,
      split = width * 0.67,
      height = 32;
    let y = doc.y;
    const draw = (left, right, bold) => {
      doc.rect(x, y, width, height).stroke();
      doc
        .moveTo(x + split, y)
        .lineTo(x + split, y + height)
        .stroke();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11);
      doc.text(left, x + 8, y + 10, { width: split - 16 });
      doc.text(right, x + split + 8, y + 10, { width: width - split - 16, align: 'right' });
      y += height;
    };
    draw('Asset Category', 'Depreciation (LKR)', true);
    rows.forEach((r) =>
      draw(
        r.category,
        r.provision.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        r.category === 'Total',
      ),
    );
    doc.end();
  });
}
