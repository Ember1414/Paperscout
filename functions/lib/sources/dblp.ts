import type { FetchRawFn, Paper, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';
import { fetchUpstream } from '../infra/http';

/**
 * DBLP 数据源 —— 计算机科学权威文献库（1000 万+ 记录）
 * API: https://dblp.org/faq/How+to+use+the+dblp+search+API.html
 */

const SOURCE_NAME = 'DBLP';

/** DBLP 的 authors 字段可能是对象或数组，统一归一化 */
function normalizeAuthors(raw: any): string[] {
  if (!raw?.author) return [];
  const list = Array.isArray(raw.author) ? raw.author : [raw.author];
  return list.map((a: any) => a?.text).filter(Boolean);
}

export const dblp: SourceAdapter = {
  id: 'dblp',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const q = params.author ? `${params.query} ${params.author}` : params.query;
    const sp = new URLSearchParams({
      q,
      h: String(Math.min(params.limit, 30)),
      f: String((params.page - 1) * params.limit),
      format: 'json',
    });

    // DBLP 偶发 503：更长退避重试
    const res = await fetchWithRetry(
      `https://dblp.org/search/publ/api?${sp}`,
      { headers: { 'User-Agent': 'PaperScout/2.0 (https://paperscout.pages.dev)' } },
      3,
      1500,
    );
    if (!res.ok) throw new Error(`DBLP HTTP ${res.status}`);

    const data = (await res.json()) as any;
    const hits = (data?.result?.hits?.hit ?? []) as any[];

    let papers: Paper[] = hits
      .map((h): Paper => {
        const info = h.info ?? {};
        const doi: string | undefined = typeof info.doi === 'string' ? info.doi : undefined;
        const url: string = info.ee || (doi ? `https://doi.org/${doi}` : info.url || '');
        return {
          title: typeof info.title === 'string' ? info.title.replace(/\.$/, '') : '(无标题)',
          authors: normalizeAuthors(info.authors),
          year: info.year ? Number(info.year) : undefined,
          venue: Array.isArray(info.venue) ? info.venue[0] : info.venue || undefined,
          url,
          pdfUrl: typeof info.ee === 'string' && info.ee.endsWith('.pdf') ? info.ee : undefined,
          doi,
          type: /conference|workshop|symposium/i.test(String(info.type ?? '')) ? 'conference' : 'journal',
          source: 'dblp',
          sourceName: SOURCE_NAME,
          openAccess: /\/ee\/|openaccess/i.test(String(info.ee ?? '')),
        };
      })
      .filter((p) => p.url);

    if (params.yearFrom) papers = papers.filter((p) => !p.year || p.year >= params.yearFrom!);
    if (params.yearTo) papers = papers.filter((p) => !p.year || p.year <= params.yearTo!);

    return papers;
  },
};

/* ==================== v3 fetchRaw 层（M1-01）==================== */

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 30);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const sp = new URLSearchParams({
    q: params.author ? `${params.query} ${params.author}` : params.query,
    h: String(limit),
    f: String(offset),
    format: 'json',
  });

  const res = await fetchUpstream<any>(`https://dblp.org/search/publ/api?${sp}`, { source: 'DBLP' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const hits = (res.data?.result?.hits?.hit ?? []) as any[];
  const fetchedAt = Date.now();
  let records: RawRecord[] = hits.map((h) => {
    const info = h.info ?? {};
    const doi = typeof info.doi === 'string' ? info.doi : undefined;
    const url = info.ee || (doi ? `https://doi.org/${doi}` : info.url || undefined);
    const venue = Array.isArray(info.venue) ? info.venue[0] : info.venue;
    const confLike = /conference|workshop|symposium/i.test(String(info.type ?? ''));
    return {
      source: 'dblp' as const,
      sourceName: 'DBLP',
      fetchedAt,
      title: typeof info.title === 'string' ? info.title.replace(/\.$/, '') : '',
      authors: normalizeAuthors(info.authors).slice(0, 25),
      year: info.year ? Number(info.year) || undefined : undefined,
      venue: venue || undefined,
      venueType: confLike ? 'conference' : venue ? 'journal' : 'unknown',
      doi,
      url: url || undefined,
      pdfUrl: typeof info.ee === 'string' && info.ee.endsWith('.pdf') ? info.ee : undefined,
      type: confLike ? 'conference' : 'journal',
      openAccess: /\/ee\/|openaccess/i.test(String(info.ee ?? '')) ? true : undefined,
      nativeId: typeof info.key === 'string' ? info.key : doi,
    };
  });
  // DBLP 无原生年份过滤（capability: client）——客户端过滤
  if (params.yearFrom) records = records.filter((r) => !r.year || r.year >= params.yearFrom!);
  if (params.yearTo) records = records.filter((r) => !r.year || r.year <= params.yearTo!);
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
