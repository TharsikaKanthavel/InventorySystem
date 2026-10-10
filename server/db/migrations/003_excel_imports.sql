CREATE TABLE IF NOT EXISTS asset_imports (
 id char(36) PRIMARY KEY DEFAULT (UUID()),
 requested_by char(36) NOT NULL,
 branch_id char(36) NOT NULL,
 filename varchar(200) NOT NULL,
 import_rows json NOT NULL,
 status enum('preview','committed') NOT NULL DEFAULT 'preview',
 result json,
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 expires_at datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3) + INTERVAL 30 MINUTE),
 committed_at datetime(3),
 FOREIGN KEY (requested_by) REFERENCES users(id),
 FOREIGN KEY (branch_id) REFERENCES branches(id),
 KEY asset_imports_expiry(status,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
