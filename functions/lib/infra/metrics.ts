import { todayUtc } from './quota';
import { logWarn } from './log';

/**
 * 统计写入（REBUILD_PLAN 7.4 / 7.8）：
 * - search_log：每次未命中缓存的 v3 检索 1 行（ctx.waitUntil 异步写，不阻塞响应）
 * - kv_write_log：KV 写预算监控（bucket 计数；M1 在线 0 写，M7 Warmer 接入）
 * D1 失败 → 降级放行（7.7：统计/配额失败不硬阻断），仅 logWarn 留痕。
 */

export interface SearchLogEntry {
  queryHash: string;
  querySample?: string;
  lang?: string;
  sourcesOk?: number;
  sourcesTotal?: number;
  elapsedMs?: number;
  resultCount?: number;
  cached?: boolean;
}

export async function writeSearchLog(db: D1Database | undefined, entry: SearchLogEntry): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO search_log (day, query_hash, query_sample, lang, sources_ok, sources_total, elapsed_ms, result_count, cached, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        todayUtc(),
        entry.queryHash,
        entry.querySample ? entry.querySample.slice(0, 120) : null,
        entry.lang ?? null,
        entry.sourcesOk ?? null,
        entry.sourcesTotal ?? null,
        entry.elapsedMs ?? null,
        entry.resultCount ?? null,
        entry.cached ? 1 : 0,
        Date.now(),
      )
      .run();
  } catch (e) {
    // 统计失败不影响检索（7.7 降级），留痕不静默
    logWarn('metrics', 'search_log', { err: e instanceof Error ? e.message.slice(0, 80) : String(e) });
  }
}

export async function recordKvWrite(db: D1Database | undefined, bucket: string, n = 1): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO kv_write_log (day, bucket, n) VALUES (?1, ?2, ?3)
         ON CONFLICT (day, bucket) DO UPDATE SET n = n + ?3`,
      )
      .bind(todayUtc(), bucket, n)
      .run();
  } catch (e) {
    logWarn('metrics', 'kv_write_log', { err: e instanceof Error ? e.message.slice(0, 80) : String(e) });
  }
}
