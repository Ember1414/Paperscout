import type { Paper, PaperType, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';

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
 * OpenAlex「礼貌池」联系邮箱：替换为真实邮箱可显著提升速率上限
 * 参考 https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication
 */
const CONTACT_EMAIL = 'paperscout@example.com';

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
    const reqOpt = { headers: { 'User-Agent': `PaperScout/2.0 (https://paperscout.pages.dev; mailto:${CONTACT_EMAIL})` } };
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
