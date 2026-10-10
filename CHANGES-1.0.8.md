# Web 1.0.8 workflow changes

## Classification and donor/supplier

- Hospital and Donation are the only choices for new assets, normal imports and classification corrections.
- Donor / Supplier is optional free text, separate from classification. It appears in asset details and the asset-register export. Leave it blank if not needed.
- New-purchase templates include an optional Donor / Supplier column. Older templates still work. Opening-balance workbooks may also include this column.
- Admins can open an asset's Schedule and select Correct classification / donor. A reason is required and before/after values are audited. This also works for imported opening balances without changing costs, rates, dates or accumulated depreciation.
- Existing Hospital and Donation records keep their classification. The migration preserves any legacy descriptive source names in donor/supplier rather than deleting them; ambiguous legacy names are shown as Needs classification until corrected. No such legacy names are added to the dropdown.

## Exceptional reset

Open Admin > Asset register > Reset branch assets.

Existing reset protections remain: one branch, downloaded archive, administrator password, exact confirmation phrase, reason, expiry and changed-record detection.

After financial figures have been approved, select Protect approved records from reset. Enter the approved-through date, approval reference/reason, password and PROTECT plus the branch name. This permanently disables routine reset and restore for that branch, including already-prepared reset requests. It does not affect the other branch. The action is audited and has no ordinary undo button.

This is a reset safeguard, not a full accounting-period lock. Ordinary asset edits are not automatically blocked by the approved-through date. Financial corrections to imported balances still require a separately reviewed migration; this release does not add a financial adjustment ledger or a migration wizard.

## Upgrade

1. Preserve a full MySQL backup and close applications that write to the database.
2. Extract this separate web release. Configure server/.env with your existing settings; none are shipped in the ZIP.
3. Run npm ci, npm run db:migrate, npm run build, then npm start.
4. Do not seed an existing database. Verify reports before and after upgrading.

Desktop v1.0.7 and previously supplied ZIP files remain unchanged. This release has not been deployed to the hospital database.
