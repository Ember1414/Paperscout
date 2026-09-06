-- PaperScout D1 数据库结构
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  q TEXT NOT NULL,
  author TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_client ON history(client_id, ts DESC);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,            -- doi 或 url 的 hash
  client_id TEXT NOT NULL,
  title TEXT NOT NULL,
  authors TEXT,                   -- JSON 数组字符串
  year INTEGER,
  venue TEXT,
  url TEXT NOT NULL,
  doi TEXT,
  pdf_url TEXT,
  source TEXT,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fav_client ON favorites(client_id, added_at DESC);
