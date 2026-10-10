UPDATE branches SET name = CASE name WHEN 'Branch A' THEN 'JAFFNA' WHEN 'Branch B' THEN 'MOOLAI' END WHERE name IN ('Branch A','Branch B');
UPDATE users SET name='JAFFNA Clerk' WHERE name='Branch A Clerk' AND branch_id IN (SELECT id FROM branches WHERE name='JAFFNA');
UPDATE users SET name='MOOLAI Clerk' WHERE name='Branch B Clerk' AND branch_id IN (SELECT id FROM branches WHERE name='MOOLAI');
