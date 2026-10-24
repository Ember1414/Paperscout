import { todayUtc } from '../infra/quota';

/**
 * /api/status（REBUILD_PLAN 7.8 / M3-10）：健康 + 配额 + 版本（脱敏）。
 * 数据来自 D1 聚合（search_log / kv_write_log / ai_usage）+ source_health（Warmer 写入，M7 起有数据）；
 * 非实时探测（DoD 原文）——D1 不可用时字段降级为 null，前端显示"—"。
 */

export interface StatusResult {
  version: string;
  time: string;
  sources: { id: string; name: string; ok24h: number | null; fail24h: number | null; avgMs24h: number | null; rate: string }[];
  today: {
    searches: number | null;
    avgMs: number | null;
    cacheHitRate: string | null;
    kvWrites: number | null;
    aiCalls: number | null;
    aiQuotaGlobal: { used: number; limit: number } | null;
  };
  notes: string[];
}

/** 源清单（与 registry 同步的静态名单；健康数据等 Warmer 聚合） */
const SOURCE_IDS: [string, string][] = [
  ['openalex', 'OpenAlex'], ['crossref', 'Crossref'], ['arxiv', 'arXiv'],
  ['semanticscholar', 'Semantic Scholar'], ['pubmed', 'PubMed'],
  ['europepmc', 'Europe PMC'], ['doaj', 'DOAJ'], ['hal', 'HAL'],
  ['openaire', 'OpenAIRE'], ['zenodo', 'Zenodo'], ['datacite', 'DataCite'],
];

export const STATUS_VERSION = '3.0.0-alpha';

export async function getStatus(db: D1Database | undefined): Promise<StatusResult> {
  const day = todayUtc();
  /** @type {StatusResult['sources']} */
  const sources = [];
  /** @type {StatusResult['today']} */
  let today: StatusResult['today'] = {
    searches: null, avgMs: null, cacheHitRate: null, kvWrites: null, aiCalls: null, aiQuotaGlobal: null,
  };
  /** @type {string[]} */
  const notes = [];

  // source_health 近 24h（Warmer M7 起写入；当前为空显示 —）
  if (db) {
    try {
      const shRes = await db.prepare('SELECT source, ok, fail, avg_ms FROM source_health WHERE day = ?1').bind(day).all<{ source: string; ok: number; fail: number; avg_ms: number }>();
      const map = new Map((shRes.results ?? []).map((r) => [r.source, r]));
      for (const [id, name] of SOURCE_IDS) {
        const row = map.get(id);
        const ok = row?.ok ?? 0;
        const fail = row?.fail ?? 0;
        sources.push({
          id, name,
          ok24h: ok, fail24h: fail,
          avgMs24h: row?.avg_ms ?? null,
          rate: ok + fail > 0 ? `${Math.round((ok / (ok + fail)) * 100)}%` : '—',
        });
      }
      if (!shRes.results?.length) notes.push('源健康由定时预热聚合（M7 上线后展示 24h 成功率）');
    } catch (e) {
      notes.push('源健康数据暂不可用（D1 查询失败）');
      console.warn('status:source-health-failed', e instanceof Error ? e.message : String(e));
      for (const [id, name] of SOURCE_IDS) sources.push({ id, name, ok24h: null, fail24h: null, avgMs24h: null, rate: '—' });
    }

    // 今日统计
    try {
      const agg = await db.prepare(
        `SELECT COUNT(*) AS n, AVG(elapsed_ms) AS avg_ms,
                SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS hit_rate
         FROM search_log WHERE day = ?1`,
      ).bind(day).first<{ n: number; avg_ms: number; hit_rate: number }>();
      today.searches = agg?.n ?? 0;
      today.avgMs = agg?.avg_ms ? Math.round(agg.avg_ms) : null;
      today.cacheHitRate = agg?.hit_rate != null ? `${Math.round(agg.hit_rate * 100)}%` : null;
    } catch (e) {
      console.warn('status:search-log-failed', e instanceof Error ? e.message : String(e));
    }

    // KV 写今日
    try {
      const kv = await db.prepare('SELECT SUM(n) AS n FROM kv_write_log WHERE day = ?1').bind(day).first<{ n: number }>();
      today.kvWrites = kv?.n ?? 0;
    } catch (e) {
      console.warn('status:query-failed', e instanceof Error ? e.message : String(e));
    }

    // AI 配额（M6 起使用）
    try {
      const ai = await db.prepare('SELECT kind, used FROM ai_global WHERE day = ?1').bind(day).all<{ kind: string; used: number }>();
      const total = (ai.results ?? []).reduce((a, r) => a + r.used, 0);
      today.aiCalls = total;
      today.aiQuotaGlobal = { used: total, limit: 350 }; // summarize 120 + ask 80 + extract 150
    } catch (e) {
      console.warn('status:ai-usage-failed', e instanceof Error ? e.message : String(e));
    }
  } else {
    notes.push('D1 绑定不可用');
  }

  return {
    version: STATUS_VERSION,
    time: new Date().toISOString(),
    sources,
    today,
    notes,
  };
}
