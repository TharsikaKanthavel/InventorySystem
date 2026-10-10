-- Historical purchases may have an unknown date. Never invent a purchase date.
ALTER TABLE assets MODIFY date_purchased date NULL, MODIFY audit_year integer NULL,
 ADD opening_balance_date date NULL,
 ADD opening_accumulated numeric(14,2) NULL,
 ADD opening_import_key char(64) NULL,
 ADD purchase_date_note varchar(500) NULL,
 ADD UNIQUE KEY assets_opening_import(branch_id,opening_import_key),
 ADD CONSTRAINT assets_opening_valid CHECK (
 (opening_balance_date IS NULL AND opening_accumulated IS NULL AND date_purchased IS NOT NULL)
 OR (opening_balance_date IS NOT NULL AND opening_accumulated IS NOT NULL
 AND opening_accumulated>=0 AND opening_accumulated<=original_cost-1
 AND (date_purchased IS NULL OR date_purchased<=opening_balance_date)));
