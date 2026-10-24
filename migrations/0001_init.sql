-- PaperScout v3 数据模型（REBUILD_PLAN 7.4）
-- 禁止再手工执行 schema.sql；本文件由 wrangler d1 migrations apply 管理（只前进，不回滚）。
-- 原则：不存 PII、不存用户明文内容（收藏/笔记在 IndexedDB）、每表都有预算上限（BUDGET.md）。

CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
  query_hash TEXT NOT NULL,      -- 归一化 query 的 hash
  query_sample TEXT,             -- 截断 120 字，仅用于热词（用户可关闭）
  lang TEXT, sources_ok INTEGER, sources_total INTEGER,
  elapsed_ms INTEGER, result_count INTEGER, cached INTEGER,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_day ON search_log(day);

-- AI 配额（按天 × 客户端 × 能力）
CREATE TABLE IF NOT EXISTS ai_usage (
  day TEXT NOT NULL, client_id TEXT NOT NULL, kind TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, client_id, kind)
);

-- 全局 AI 配额（单行/天）
CREATE TABLE IF NOT EXISTS ai_global (
  day TEXT NOT NULL, kind TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);

-- 源健康（按天聚合，由 Warmer 写入，非热路径）
CREATE TABLE IF NOT EXISTS source_health (
  day TEXT NOT NULL, source TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0, fail INTEGER NOT NULL DEFAULT 0,
  avg_ms INTEGER, last_error TEXT,
  PRIMARY KEY (day, source)
);

-- 热词（Warmer 每日聚合）
CREATE TABLE IF NOT EXISTS keyword_daily (
  day TEXT NOT NULL, keyword TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (day, keyword)
);

-- 分享快照（只读，7/30/永久）
CREATE TABLE IF NOT EXISTS shares (
  code TEXT PRIMARY KEY,            -- 6 位 base62
  kind TEXT NOT NULL,               -- results | evidence | report
  payload TEXT NOT NULL,            -- JSON（≤ 60KB，精简字段，无 client_id）
  title TEXT,
  owner_token TEXT NOT NULL,        -- 撤回凭证（哈希后存）
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

-- 加密云备份（服务端只见密文）
CREATE TABLE IF NOT EXISTS backup (
  client_id TEXT PRIMARY KEY,
  blob TEXT NOT NULL,               -- base64 密文（AES-GCM，密钥不出浏览器）
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 用户反馈（1 行/次，不存 IP）
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT, message TEXT NOT NULL, page TEXT, contact TEXT,
  ts INTEGER NOT NULL
);

-- KV 写预算监控（每次 KV 写 bucket 计数 +1，用于证明未超 300/天）
CREATE TABLE IF NOT EXISTS kv_write_log (
  day TEXT NOT NULL, bucket TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);

-- 客户端错误聚合（脱敏，10s 批量 1 行）
CREATE TABLE IF NOT EXISTS client_error (
  day TEXT NOT NULL, fingerprint TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  sample TEXT, PRIMARY KEY (day, fingerprint)
);
