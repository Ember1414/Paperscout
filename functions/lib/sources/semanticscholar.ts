import type { FetchRawFn, Paper, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';
import { fetchUpstream } from '../infra/http';

/**
 * Semantic Scholar 数据源 —— 2 亿+ 论文，含引用分析
 * API: https://api.semanticscholar.org/api-docs/graph (免费，有限速)
 */

const SOURCE_NAME = 'Semantic Scholar';

export const semanticscholar: SourceAdapter = {
  id: 'semanticscholar',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const sp = new URLSearchParams({
      query: params.author ? `${params.query} ${params.author}` : params.query,
      limit: String(Math.min(params.limit, 30)),
      offset: String((params.page - 1) * params.limit),
      fields: 'title,authors,year,venue,abstract,url,citationCount,externalIds,openAccessPdf',
    });
    if (params.yearFrom || params.yearTo) {
      sp.set('year', `${params.yearFrom ?? ''}-${params.yearTo ?? ''}`);
    }

    // Semantic Scholar 免费档限流严格，自动重试缓解
    const res = await fetchWithRetry(`https://api.semanticscholar.org/graph/v1/paper/search?${sp}`, undefined, 2, 1000);
    if (res.status === 429) throw new Error('Semantic Scholar 限流，请稍后重试');
    if (!res.ok) throw new Error(`Semantic Scholar HTTP ${res.status}`);

    const data = (await res.json()) as any;

    return ((data.data ?? []) as any[])
      .map((p): Paper => {
        const doi: string | undefined = p.externalIds?.DOI;
        const url: string = p.url || (doi ? `https://doi.org/${doi}` : '');
        const abstract = p.abstract
          ? p.abstract.length > 400
            ? p.abstract.slice(0, 400) + '…'
            : p.abstract
          : undefined;
        return {
          title: p.title ?? '(无标题)',
          authors: (p.authors ?? []).map((a: any) => a.name).slice(0, 12),
          year: p.year ?? undefined,
          venue: p.venue || undefined,
          abstract,
          url,
          pdfUrl: p.openAccessPdf?.url || undefined,
          doi,
          citations: p.citationCount ?? 0,
          source: 'semanticscholar',
          sourceName: SOURCE_NAME,
          openAccess: Boolean(p.openAccessPdf?.url),
        };
      })
      .filter((p) => p.url);
  },
};

/* ==================== v3 fetchRaw 层（M1-01）==================== */

function s2Type(pubTypes?: string[]): RawRecord['type'] {
  if (!pubTypes?.length) return undefined;
  if (pubTypes.includes('JournalArticle')) return 'journal';
  if (pubTypes.includes('Conference')) return 'conference';
  return undefined;
}

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 30);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const sp = new URLSearchParams({
    query: params.author ? `${params.query} ${params.author}` : params.query,
    limit: String(limit),
    offset: String(offset),
    fields: 'title,authors,year,venue,abstract,url,citationCount,externalIds,openAccessPdf,publicationTypes',
  });
  if (params.yearFrom || params.yearTo) sp.set('year', `${params.yearFrom ?? ''}-${params.yearTo ?? ''}`);

  const res = await fetchUpstream<any>(`https://api.semanticscholar.org/graph/v1/paper/search?${sp}`, { source: 'Semantic Scholar' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const fetchedAt = Date.now();
  const records: RawRecord[] = ((res.data?.data ?? []) as any[]).map((p) => {
    const doi = p.externalIds?.DOI || undefined;
    return {
      source: 'semanticscholar' as const,
      sourceName: 'Semantic Scholar',
      fetchedAt,
      title: String(p.title ?? ''),
      authors: (p.authors ?? []).map((a: any) => a?.name).filter(Boolean).slice(0, 25),
      year: p.year ?? undefined,
      venue: p.venue || undefined,
      abstract: p.abstract || undefined,
      doi,
      url: p.url || (doi ? `https://doi.org/${doi}` : undefined),
      pdfUrl: p.openAccessPdf?.url || undefined,
      citations: typeof p.citationCount === 'number' ? p.citationCount : undefined,
      type: s2Type(p.publicationTypes),
      openAccess: p.openAccessPdf?.url ? true : undefined,
      nativeId: p.paperId || doi,
    };
  });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
