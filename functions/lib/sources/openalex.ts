import type { FetchRawFn, Paper, PaperType, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';
import { fetchUpstream } from '../infra/http';
import { CONTACT_EMAIL, DEFAULT_SITE_ORIGIN, SEARCH, userAgent } from '../config';

/** OpenAlex type → PaperScout type（注意：OpenAlex 新版词表用 article 表示期刊论文） */
function mapType(t?: string): PaperType | undefined {
  switch (t) {
    case 'article':
    case 'journal-article':
      return 'journal';
    case 'proceedings-article':
    case 'conference-paper':
    case 'proceedings':
      return 'conference';
    case 'preprint':
      return 'preprint';
    default:
      return 'other';
  }
}

/**
 * OpenAlex 数据源 —— 2.5 亿+ 学术文献，覆盖国际与中文期刊（含 CNKI 收录刊）
 * API: https://docs.openalex.org/
 */

const SOURCE_NAME = 'OpenAlex';

/** 从倒排索引重建摘要文本 */
function rebuildAbstract(inverted?: Record<string, number[]>): string | undefined {
  if (!inverted) return undefined;
  const words: { pos: number; word: string }[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) words.push({ pos, word });
  }
  words.sort((a, b) => a.pos - b.pos);
  const text = words.map((w) => w.word).join(' ');
  return text.length > 400 ? text.slice(0, 400) + '…' : text;
}

/**
 * OpenAlex「礼貌池」联系邮箱：真实邮箱可显著提升速率上限（A-24 已修，M0-07）
 * 参考 https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication
 * 值来自 lib/config.ts 唯一来源；User-Agent 按 5.1.3 规范构造。
 */
const USER_AGENT = userAgent(DEFAULT_SITE_ORIGIN);

export const openalex: SourceAdapter = {
  id: 'openalex',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    const filters: string[] = [];
    if (params.yearFrom && params.yearTo) filters.push(`from_publication_date:${params.yearFrom}-01-01`, `to_publication_date:${params.yearTo}-12-31`);
    else if (params.yearFrom) filters.push(`from_publication_date:${params.yearFrom}-01-01`);
    else if (params.yearTo) filters.push(`to_publication_date:${params.yearTo}-12-31`);

    const sp = new URLSearchParams({
      search: params.query,
      per_page: String(Math.min(params.limit, 50)),
      page: String(params.page),
      mailto: CONTACT_EMAIL,
    });
    // BUG 修复：OpenAlex 只支持逗号合并的 filter 语法（如 type:journal-article），
    // 不支持 filter.type / filter.author.search 点号写法（会返回 400）
    if (params.author) filters.push(`raw_author_name.search:${params.author}`);
    if (params.paperType === 'journal') filters.push('type:article');
    if (params.paperType === 'conference') filters.push('type:proceedings-article');
    if (params.paperType === 'preprint') filters.push('type:preprint');
    if (filters.length) sp.set('filter', filters.join(','));
    if (params.sort === 'newest') sp.set('sort', 'publication_date:desc');
    if (params.sort === 'citations') sp.set('sort', 'cited_by_count:desc');

    // fetchWithRetry 自动重试 429/5xx（4 次指数退避），缓解共享出口 IP 限流
    const reqOpt = { headers: { 'User-Agent': USER_AGENT } };
    const res = await fetchWithRetry(`https://api.openalex.org/works?${sp}`, reqOpt, 4, 1200);
    if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);

    const data = (await res.json()) as any;
    const results = (data.results ?? []) as any[];

    return results
      .map((w): Paper => {
        const doi: string | undefined = w.doi?.replace('https://doi.org/', '') || undefined;
        const url: string =
          w.primary_location?.landing_page_url ||
          w.doi ||
          w.id ||
          '';
        return {
          title: w.display_name ?? '(无标题)',
          authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).slice(0, 12),
          year: w.publication_year ?? undefined,
          venue: w.primary_location?.source?.display_name ?? w.type ?? undefined,
          abstract: rebuildAbstract(w.abstract_inverted_index),
          url,
          pdfUrl: w.best_oa_location?.pdf_url || w.primary_location?.pdf_url || undefined,
          doi,
          citations: w.cited_by_count ?? 0,
          type: mapType(w.type),
          source: 'openalex',
          sourceName: SOURCE_NAME,
          openAccess: w.open_access?.is_oa ?? false,
        };
      })
      .filter((p) => p.url);
  },
};

/* ==================== v3 fetchRaw 层（M1-01）==================== */

function venueTypeOf(sourceType?: string, workType?: string): RawRecord['venueType'] {
  if (/preprint/i.test(String(workType))) return 'preprint';
  switch (sourceType) {
    case 'journal': return 'journal';
    case 'conference': return 'conference';
    case 'repository': return 'repository';
    default: return 'unknown';
  }
}

export const fetchRaw: FetchRawFn = async (params: SearchParams, opts): Promise<RawFetchResult> => {
  const limit = Math.min(opts?.limit ?? params.limit, SEARCH.PER_SOURCE_LIMIT);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const filters: string[] = [];
  if (params.yearFrom) filters.push(`from_publication_date:${params.yearFrom}-01-01`);
  if (params.yearTo) filters.push(`to_publication_date:${params.yearTo}-12-31`);
  if (params.author) filters.push(`raw_author_name.search:${params.author}`);
  if (params.paperType === 'journal') filters.push('type:article');
  if (params.paperType === 'conference') filters.push('type:proceedings-article');
  if (params.paperType === 'preprint') filters.push('type:preprint');

  const sp = new URLSearchParams({
    search: params.query,
    per_page: String(limit),
    page: String(Math.floor(offset / limit) + 1),
    mailto: CONTACT_EMAIL,
  });
  if (filters.length) sp.set('filter', filters.join(','));
  if (params.sort === 'newest') sp.set('sort', 'publication_date:desc');
  if (params.sort === 'citations') sp.set('sort', 'cited_by_count:desc');

  const res = await fetchUpstream<any>(`https://api.openalex.org/works?${sp}`, { source: 'OpenAlex' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const results = (res.data?.results ?? []) as any[];
  const fetchedAt = Date.now();
  const records: RawRecord[] = results.map((w) => {
    const doi = String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined;
    return {
      source: 'openalex' as const,
      sourceName: 'OpenAlex',
      fetchedAt,
      title: String(w.display_name ?? ''),
      authors: (w.authorships ?? []).map((a: any) => a?.author?.display_name).filter(Boolean).slice(0, 25),
      year: w.publication_year ?? undefined,
      venue: w.primary_location?.source?.display_name ?? undefined,
      venueType: venueTypeOf(w.primary_location?.source?.type, w.type),
      abstract: rebuildAbstract(w.abstract_inverted_index),
      doi,
      url: w.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : w.id || undefined),
      pdfUrl: w.best_oa_location?.pdf_url || w.primary_location?.pdf_url || undefined,
      citations: typeof w.cited_by_count === 'number' ? w.cited_by_count : undefined,
      type: mapType(w.type),
      openAccess: w.open_access?.is_oa === true ? true : undefined,
      nativeId: typeof w.id === 'string' ? w.id.split('/').pop() : undefined,
    };
  });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
