import { z } from 'zod';
import { CATEGORIES, today } from './depreciation.js';
export const text = z.string().trim().min(1).max(500);
export const uuid = z.uuid();
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s &&
      s >= '1900-01-01' &&
      s <= '2200-12-31',
    'Invalid date',
  );
export const password = z
  .string()
  .min(12)
  .max(72)
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');
export const assetSchema = z.object({
  branch_id: uuid,
  audit_book_ref: text,
  date_purchased: date.refine((s) => s <= today(), 'Purchase date cannot be in the future'),
  donation_source_id: uuid,
  donor_supplier: z.string().trim().max(500).default(''),
  item_id: uuid,
  category: z.enum(CATEGORIES),
  dep_percent: z.coerce.number().positive().max(100),
  original_cost: z.coerce
    .number()
    .min(1)
    .max(999999999999.99)
    .refine(
      (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.01,
      'Use at most two decimal places',
    ),
  version: z.number().int().positive().optional(),
});
export const userSchema = z
  .object({
    name: text,
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    role: z.enum(['admin', 'branch_user']),
    branch_id: uuid.nullable(),
    active: z.boolean().default(true),
  })
  .refine(
    (u) => (u.role === 'admin' ? u.branch_id === null : !!u.branch_id),
    'Branch users require a branch; administrators do not',
  );
export const fail = (status, message) => Object.assign(new Error(message), { status });
