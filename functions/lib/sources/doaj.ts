import type { FetchRawFn, Paper, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';
import { fetchUpstream } from '../infra/http';

/**
 * DOAJ 数据源 —— 全球开放获取期刊目录（8 万+ 期刊，900 万+ 论文，全部免费全文）
 * API: https://doaj.org/api/
 */

const SOURCE_NAME = 'DOAJ';

export const doaj: SourceAdapter = {
  id: 'doaj',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const q = params.author ? `(${params.query}) AND author:"${params.author}"` : params.query;
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(q)}?pageSize=${Math.min(params.limit, 30)}&page=${params.page}`;

    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`DOAJ HTTP ${res.status}`);

    const data = (await res.json()) as any;
    const results = (data.results ?? []) as any[];

    let papers: Paper[] = results
      .map((r): Paper => {
        const b = r.bibjson ?? {};
        const fulltext = (b.link ?? []).find((l: any) => l.type === 'fulltext')?.url;
        const doi = (b.identifier ?? []).find((x: any) => x.type === 'doi')?.id;
        return {
          title: b.title ?? '(无标题)',
          authors: (b.author ?? []).map((a: any) => a.name).filter(Boolean),
          year: b.year ? Number(b.year) : undefined,
          venue: b.journal?.title ?? undefined,
          abstract: b.abstract
            ? b.abstract.length > 400
              ? b.abstract.slice(0, 400) + '…'
              : b.abstract
            : undefined,
          url: fulltext || (doi ? `https://doi.org/${doi}` : r.id ? `https://doaj.org/article/${r.id}` : ''),
          pdfUrl: fulltext && /\.pdf(\?|$)/i.test(fulltext) ? fulltext : undefined,
          doi,
          type: 'journal' as const,
          citations: undefined,
          source: 'doaj',
          sourceName: SOURCE_NAME,
          openAccess: true, // DOAJ 收录的全部是开放获取
        };
      })
      .filter((p) => p.url);

    if (params.yearFrom) papers = papers.filter((p) => !p.year || p.year >= params.yearFrom!);
    if (params.yearTo) papers = papers.filter((p) => !p.year || p.year <= params.yearTo!);

    return papers;
  },
};

/* ==================== v3 fetchRaw 层（M1-03）==================== */

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 30);
  const page = Math.floor((opts?.offset ?? (params.page - 1) * limit) / limit) + 1;

  const q = params.author ? `(${params.query}) AND author:"${params.author}"` : params.query;
  const url = `https://doaj.org/api/search/articles/${encodeURIComponent(q)}?pageSize=${limit}&page=${page}`;

  const res = await fetchUpstream<any>(url, { source: 'DOAJ' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const results = (res.data?.results ?? []) as any[];
  const fetchedAt = Date.now();
  let records: RawRecord[] = results.map((r) => {
    const b = r.bibjson ?? {};
    const fulltext = (b.link ?? []).find((l: any) => l.type === 'fulltext')?.url;
    const doi = (b.identifier ?? []).find((x: any) => x.type === 'doi')?.id;
    return {
      source: 'doaj' as const,
      sourceName: 'DOAJ',
      fetchedAt,
      title: String(b.title ?? ''),
      authors: (b.author ?? []).map((a: any) => a?.name).filter(Boolean).slice(0, 25),
      year: b.year ? Number(b.year) || undefined : undefined,
      venue: b.journal?.title || undefined,
      venueType: 'journal' as const,
      abstract: b.abstract || undefined,
      doi,
      url: fulltext || (doi ? `https://doi.org/${doi}` : r.id ? `https://doaj.org/article/${r.id}` : undefined),
      pdfUrl: fulltext && /\.pdf(\?|$)/i.test(fulltext) ? fulltext : undefined,
      type: 'journal' as const,
      openAccess: true, // DOAJ 收录的全为 OA
      nativeId: r.id || doi,
    };
  });
  // DOAJ 无原生年份过滤（客户端过滤）
  if (params.yearFrom) records = records.filter((r) => !r.year || r.year >= params.yearFrom!);
  if (params.yearTo) records = records.filter((r) => !r.year || r.year <= params.yearTo!);
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
