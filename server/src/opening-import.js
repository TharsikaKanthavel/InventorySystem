import { z } from 'zod';
import { date, text, fail } from './validation.js';
import { CATEGORIES, toCents, monthlyProvision } from './depreciation.js';
import { OPENING_DATE } from './opening-workbook.js';
import { insertAndRead } from './db.js';
const normal = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
const money = z.number().finite().min(0).max(999999999999.99);
const openingSchema = z
  .object({
    audit_book_ref: text,
    item: text,
    source: z.enum(['Hospital', 'Donation']),
    donor_supplier: z.string().trim().max(500).default(''),
    category: z.enum(CATEGORIES),
    date_purchased: date.nullable(),
    purchase_date_note: text.nullable(),
    original_cost: money.min(1),
    dep_percent: z.coerce.number().positive().max(100),
    opening_balance_date: z.literal(OPENING_DATE),
    opening_accumulated: money,
    opening_wdv: money.min(1),
    opening_import_key: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((a, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message });
    if (a.date_purchased && a.date_purchased > OPENING_DATE)
      issue(
        'Purchase date must be on or before 30 April 2026. Import later purchases using the new-assets template.',
      );
    if (toCents(a.original_cost) - toCents(a.opening_accumulated) !== toCents(a.opening_wdv))
      issue('Opening cost must equal accumulated depreciation plus WDV (to the cent).');
  });
export async function validateOpeningRows(db, branchId, rows) {
  const branch = (await db.query('SELECT id,name FROM branches WHERE id=$1', [branchId])).rows[0];
  if (!branch) throw fail(400, 'Unknown branch');
  const existing = new Set(
    (
      await db.query(
        'SELECT opening_import_key FROM assets WHERE branch_id=$1 AND opening_import_key IS NOT NULL',
        [branchId],
      )
    ).rows.map((a) => a.opening_import_key),
  );
  const seen = new Set();
  return rows.map((r) => {
    const errors = [...(r.parseErrors || [])];
    if (r.branch && normal(r.branch) !== normal(branch.name))
      errors.push('Workbook branch must match selected branch: ' + branch.name);
    const parsed = openingSchema.safeParse(r);
    if (!parsed.success)
      errors.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    if (seen.has(r.opening_import_key))
      errors.push('Duplicate asset details in this worksheet. Review these rows before importing.');
    if (existing.has(r.opening_import_key))
      errors.push('This opening asset has already been imported into this branch.');
    seen.add(r.opening_import_key);
    return {
      ...r,
      branch: branch.name,
      errors,
      data: parsed.success ? { ...parsed.data, branch_id: branchId } : null,
      monthly_provision: parsed.success
        ? Math.min(
            monthlyProvision(r.original_cost, r.dep_percent),
            Math.max(0, toCents(r.opening_wdv) - 100) / 100,
          )
        : null,
    };
  });
}
// Lookup creation occurs only in the confirmed import transaction, never in preview.
export async function openingLookups(c, b) {
  for (const [table, name, key] of [
    ['items', b.item, 'item_id'],
    ['sources', b.source, 'donation_source_id'],
  ]) {
    await c.query(`INSERT INTO ${table}(name) VALUES($1) ON DUPLICATE KEY UPDATE name=name`, [
      name,
    ]);
    b[key] = (await c.query(`SELECT id FROM ${table} WHERE name=$1`, [name])).rows[0].id;
  }
  return b;
}
