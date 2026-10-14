-- Optional manual schema setup; index.php also creates these tables.
CREATE TABLE IF NOT EXISTS rows (
  tbl VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  data LONGTEXT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  seq BIGINT NOT NULL,
  PRIMARY KEY (tbl, id),
  KEY idx_rows_seq (seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS meta (
  meta_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  meta_value LONGTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS sessions (
  hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  user_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  expires BIGINT NOT NULL,
  KEY idx_sessions_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS punches (
  client_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  user_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  result LONGTEXT NOT NULL,
  created BIGINT NOT NULL,
  KEY idx_punches_user_created (user_id, created)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS fails (
  k VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  n INT NOT NULL,
  t BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
