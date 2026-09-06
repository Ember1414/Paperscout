import type { Paper, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';

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
