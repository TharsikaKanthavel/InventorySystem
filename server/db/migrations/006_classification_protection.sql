ALTER TABLE assets ADD donor_supplier varchar(500) NOT NULL DEFAULT '';
INSERT INTO sources(name) VALUES('Hospital'),('Donation') ON DUPLICATE KEY UPDATE name=name;
UPDATE assets a JOIN sources s ON s.id=a.donation_source_id
 SET a.donor_supplier=s.name WHERE LOWER(TRIM(s.name)) NOT IN ('hospital','donation');
UPDATE assets a JOIN sources old ON old.id=a.donation_source_id JOIN sources canonical ON canonical.name='Hospital'
 SET a.donation_source_id=canonical.id WHERE LOWER(TRIM(old.name)) IN ('hospital purchase','h');
UPDATE assets a JOIN sources old ON old.id=a.donation_source_id JOIN sources canonical ON canonical.name='Donation'
 SET a.donation_source_id=canonical.id WHERE LOWER(TRIM(old.name))='d';
CREATE TABLE IF NOT EXISTS branch_reset_protection (
 branch_id char(36) PRIMARY KEY,
 approved_through date NOT NULL,
 reason varchar(500) NOT NULL,
 approved_by char(36) NOT NULL,
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(branch_id) REFERENCES branches(id),
 FOREIGN KEY(approved_by) REFERENCES users(id)
) ENGINE=InnoDB;
