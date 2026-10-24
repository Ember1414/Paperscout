import { fetchUpstream } from '../infra/http';

/**
 * 引用上下文（REBUILD_PLAN M3-06 基础版）：S2 citations with contexts。
 * S2 限流高发（R-01）——失败返回空数组，前端该区块显示"暂无"且不影响主流程（DoD 原文）。
 */

export interface CitationContext {
  citingPaperId: string;
  citingTitle: string;
  year?: number;
  contexts: string[];
}

/** @param {string} doi */
export async function getContexts(doi: string): Promise<{ contexts: CitationContext[]; available: boolean }> {
  const clean = doi.trim().toLowerCase();
  const res = await fetchUpstream<any>(
    `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(clean)}/citations?fields=title,year,contexts&limit=10`,
    { source: 'Semantic Scholar', timeoutMs: 5000 },
  );
  if (!res.ok) return { contexts: [], available: false };
  const rows = (res.data?.data ?? []) as any[];
  const contexts = rows
    .filter((/** @type {any} */ r) => Array.isArray(r?.contexts) && r.contexts.length && r?.citingPaper?.title)
    .map((/** @type {any} */ r) => ({
      citingPaperId: String(r.citingPaper.paperId ?? ''),
      citingTitle: String(r.citingPaper.title),
      year: r.citingPaper.year ?? undefined,
      contexts: ((r.contexts ?? []) as string[]).slice(0, 2).map((c) => String(c).slice(0, 300)),
    }));
  return { contexts, available: contexts.length > 0 };
}
