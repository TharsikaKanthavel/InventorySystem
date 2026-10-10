// Parse untrusted workbooks outside the API thread, with a memory/time limit in the caller.
import { parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import { parseOpeningWorkbook } from './opening-workbook.js';
try {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(workerData.bytes || workerData));
  if (workerData.mode === 'opening') {
    parentPort.postMessage(parseOpeningWorkbook(workbook, workerData.sheet));
  } else {
    const sheet =
      workbook.getWorksheet('Assets') || workbook.worksheets.find((s) => s.state === 'visible');
    if (!sheet) throw new Error('No visible worksheet found');
    if (sheet.rowCount > 501 || sheet.columnCount > 32)
      throw new Error(
        'Use at most 500 data rows and 32 columns. Remove unused formatted rows before uploading.',
      );
    const rows = [];
    sheet.eachRow((row, number) => {
      const cells = [];
      for (let n = 1; n <= sheet.columnCount; n++) {
        const cell = row.getCell(n);
        let value = cell.value;
        if (value instanceof Date) value = value.toISOString().slice(0, 10);
        else if (value && typeof value === 'object') {
          if ('formula' in value || 'sharedFormula' in value)
            value = { error: 'Formulas are not accepted. Paste values only.' };
          else if (value.richText) value = value.richText.map((r) => r.text).join('');
          else if (value.text) value = value.text;
          else value = { error: 'Unsupported cell value' };
        }
        if (typeof value === 'string' && value.length > 500)
          value = { error: 'Cell exceeds 500 characters' };
        cells.push({
          value: value ?? '',
          percent: typeof cell.numFmt === 'string' && cell.numFmt.includes('%'),
        });
      }
      if (cells.some((c) => c.value !== '')) rows.push({ number, cells });
    });
    parentPort.postMessage({ sheet: sheet.name, rows });
  }
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
