import { suggestFrom } from '../core/suggest';
import { AppError } from '../errors';

/**
 * /api/suggest 服务（M2-10）：热词池取自 D1 search_log（近 7 天 GROUP BY，只读）；
 * D1 不可用时返回空建议（联想是增强层，不阻塞输入）。
 */

const EMPTY_HOT = { hotKeywords: [] as string[] };

/** @param {D1Database | undefined} db @param {string} q */
export async function getSuggestions(db: D1Database | undefined, q: string) {
  if (!db) return { suggestions: suggestFrom(q, EMPTY_HOT), source: 'none' as const };
  try {
    const res = await db
      .prepare(
        `SELECT query_sample AS s, COUNT(*) AS n FROM search_log
         WHERE day >= ?1 AND query_sample IS NOT NULL AND length(query_sample) >= 2
         GROUP BY query_sample ORDER BY n DESC LIMIT 200`,
      )
      .bind(new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10))
      .all<{ s: string }>();
    const hot = (res.results ?? []).map((r) => r.s);
    return { suggestions: suggestFrom(q, { hotKeywords: hot }), source: 'd1' as const };
  } catch (e) {
    // 联想降级：不阻塞输入（M2-10 DoD），留痕不静默
    console.warn('suggest:d1-failed', e instanceof Error ? e.message.slice(0, 80) : String(e));
    return { suggestions: suggestFrom(q, EMPTY_HOT), source: 'fallback' as const };
  }
}

/** @param {URL} url */
export function validateSuggestParams(url: URL): string {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) throw new AppError('BAD_QUERY', '缺少建议词 q');
  if (q.length > 60) throw new AppError('BAD_PARAM', '建议词过长（≤60 字）');
  return q;
}
