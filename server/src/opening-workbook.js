import { createHash } from 'node:crypto';
export const OPENING_DATE = '2026-04-30';
const normal = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
const label = (v) => normal(v).replace(/[^a-z0-9]/g, '');
function value(cell) {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) {
      if (typeof cell.result !== 'number' || !Number.isFinite(cell.result))
        throw new Error(
          'Formula has no saved numeric result. Recalculate and save in Excel first.',
        );
      return cell.result;
    }
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.error) throw new Error('Excel error: ' + v.error);
    throw new Error('Unsupported cell value');
  }
  return typeof v === 'string' ? v.trim() : (v ?? '');
}
function headers(sheet) {
  for (let r = 1; r <= Math.min(sheet.rowCount, 40); r++) {
    const map = {};
    sheet.getRow(r).eachCell((c, col) => {
      map[label(c.text)] = col;
    });
    if (map.details && map.originalcost && map.assetcategory && map.datepurchased) {
      const acc = Object.keys(map).find((h) => h.includes('accumulated') && h.includes('30042026'));
      const wdv = Object.keys(map).find(
        (h) => h.includes('writtendownvalue') && h.includes('30042026'),
      );
      if (acc && wdv) return { row: r, map, acc: map[acc], wdv: map[wdv] };
    }
  }
  return null;
}
const categories = {
  computeraccessors: 'Computer Accessories',
  computeraccessories: 'Computer Accessories',
  furniturefitting: 'Furniture & Fitting',
  landbuilding: 'Land & Building',
  machineriesequipment: 'Machineries & Equipment',
  medicalequipment: 'Medical Equipment',
};
export function parseOpeningWorkbook(book, selectedSheet) {
  const candidates = book.worksheets.filter((s) => s.state === 'visible' && headers(s));
  const sheets = candidates.map((s) => s.name);
  if (!sheets.length)
    throw new Error(
      'No fixed-assets sheet with cost, accumulated depreciation and WDV dated 30 April 2026 was found.',
    );
  if (!selectedSheet && sheets.length > 1) return { sheets, needsSheet: true };
  const sheet = selectedSheet ? candidates.find((s) => s.name === selectedSheet) : candidates[0];
  if (!sheet) throw new Error('Select one of the detected asset worksheets.');
  if (sheet.rowCount > 10000 || sheet.columnCount > 200)
    throw new Error('Opening workbook exceeds 10,000 worksheet rows or 200 columns.');
  const h = headers(sheet),
    rows = [],
    occurrences = new Map();
  for (let r = h.row + 1; r <= sheet.rowCount; r++) {
    const excel = sheet.getRow(r);
    const itemCell = excel.getCell(h.map.details),
      catCell = excel.getCell(h.map.assetcategory);
    if (
      !itemCell.value &&
      !excel.getCell(h.map.originalcost).value &&
      !excel.getCell(h.map.donationhospital || h.map.source || 5).value
    )
      continue; // Ignore formatting and category labels.
    const row = { row: r, parseErrors: [], warnings: [], opening_balance_date: OPENING_DATE };
    const get = (col, name) => {
      try {
        return col ? value(excel.getCell(col)) : '';
      } catch (e) {
        row.parseErrors.push(name + ': ' + e.message);
        return '';
      }
    };
    row.item = get(h.map.details, 'Details');
    row.category =
      categories[label(get(h.map.assetcategory, 'Category'))] ||
      get(h.map.assetcategory, 'Category');
    row.donor_supplier = h.map.donorsupplier ? get(h.map.donorsupplier, 'Donor / Supplier') : '';
    row.source = get(h.map.donationhospital || h.map.source, 'Source');
    row.source = ['hospital', 'donation'].includes(normal(row.source))
      ? normal(row.source).replace(/^./, (c) => c.toUpperCase())
      : row.source;
    row.branch = get(h.map.branchmchorjaffna || h.map.branch, 'Branch');
    if (normal(row.branch) === 'mch') row.branch = 'MOOLAI';
    row.date_purchased = get(h.map.datepurchased, 'Purchase date') || null;
    row.purchase_date_note = null;
    if (typeof row.date_purchased === 'string') {
      const match = row.date_purchased.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      if (match)
        row.date_purchased = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      else if (/^\d{1,2}[./]\d{4}$/.test(row.date_purchased) || row.date_purchased.includes('&')) {
        row.purchase_date_note = row.date_purchased;
        row.date_purchased = null;
        row.warnings.push(
          'Partial or multiple purchase dates retained as a note: ' + row.purchase_date_note,
        );
      }
    }
    if (!row.date_purchased)
      row.warnings.push('Purchase date unknown; calculations start from the opening balance.');
    row.audit_book_ref = get(h.map.auditbookref, 'Audit reference') || `OPEN-20260430-R${r}`;
    if (!excel.getCell(h.map.auditbookref || 2).value)
      row.warnings.push('Opening import reference assigned because the audit reference is blank.');
    row.dep_percent = get(h.map.dep || h.map.deppercent, 'Dep %');
    if (
      excel.getCell(h.map.dep || h.map.deppercent || 8).numFmt?.includes('%') &&
      typeof row.dep_percent === 'number'
    )
      row.dep_percent *= 100;
    row.original_cost = get(h.map.originalcost, 'Original cost');
    row.opening_accumulated = get(h.acc, 'Opening accumulated depreciation');
    row.opening_wdv = get(h.wdv, 'Opening WDV');
    for (const key of ['original_cost', 'opening_accumulated', 'opening_wdv']) {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key]))
        row.parseErrors.push(key + ': a saved numeric value is required.');
      else row[key] = Math.round((row[key] + Number.EPSILON) * 100) / 100;
    }
    const identity = JSON.stringify([
      normal(row.item),
      row.date_purchased,
      row.purchase_date_note,
      normal(row.source),
      row.category,
      Number(row.dep_percent),
      row.original_cost,
    ]);
    const occurrence = (occurrences.get(identity) || 0) + 1;
    occurrences.set(identity, occurrence);
    if (occurrence > 1)
      row.warnings.push(
        'Another row has the same asset details; this will be saved as a separate asset.',
      );
    row.opening_import_key = createHash('sha256')
      .update(identity + ':' + occurrence)
      .digest('hex');
    rows.push(row);
    if (rows.length > 500) throw new Error('Import at most 500 asset rows at a time.');
  }
  if (!rows.length) throw new Error('No asset rows found in the selected worksheet.');
  return { sheets, sheet: sheet.name, rows, opening: true };
}
