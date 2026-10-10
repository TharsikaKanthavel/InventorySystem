CREATE TABLE IF NOT EXISTS asset_resets (
 id char(36) PRIMARY KEY,
 branch_id char(36) NOT NULL,
 requested_by char(36) NOT NULL,
 snapshot json NOT NULL,
 fingerprint char(64) NOT NULL,
 status enum('prepared','completed','restored') NOT NULL DEFAULT 'prepared',
 downloaded_at datetime(3),
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 completed_at datetime(3),
 restored_at datetime(3),
 FOREIGN KEY (branch_id) REFERENCES branches(id),
 FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
