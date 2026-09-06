import type { Paper, SearchParams, SourceAdapter } from '../types';

/**
 * Europe PMC 数据源 —— 欧洲生物医学文献库（含 PubMed + 预印本 + 专利，60 亿+ 记录引用网络）
 * API: https://europepmc.org/RestfulWebService
 */

const SOURCE_NAME = 'Europe PMC';

function stripTags(s?: string): string | undefined {
  if (!s) return undefined;
  const text = s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 400 ? text.slice(0, 400) + '…' : text || undefined;
}

export const europepmc: SourceAdapter = {
  id: 'europepmc',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const parts: string[] = [`(${params.query})`];
    if (params.author) parts.push(`AUTH:"${params.author}"`);
    if (params.yearFrom && params.yearTo) parts.push(`(PUB_YEAR:[${params.yearFrom} TO ${params.yearTo}])`);
    else if (params.yearFrom) parts.push(`(PUB_YEAR:[${params.yearFrom} TO 2100])`);
    else if (params.yearTo) parts.push(`(PUB_YEAR:[1000 TO ${params.yearTo}])`);

    const sp = new URLSearchParams({
      query: parts.join(' AND '),
      format: 'json',
      pageSize: String(Math.min(params.limit, 30)),
      page: String(params.page),
      resultType: 'core',
    });
    if (params.sort === 'newest') sp.set('sort', 'P_PDATE_D desc');
    if (params.sort === 'citations') sp.set('sort', 'CITED desc');

    const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${sp}`);
    if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}`);

    const data = (await res.json()) as any;
    const results = (data?.resultList?.result ?? []) as any[];

    return results
      .map((r): Paper => {
        const url = r.doi
          ? `https://doi.org/${r.doi}`
          : r.pmcid
            ? `https://europepmc.org/article/PMC/${r.pmcid}`
            : r.pmid
              ? `https://europepmc.org/article/MED/${r.pmid}`
              : '';
        return {
          title: r.title ?? '(无标题)',
          authors: (r.authorString ?? '')
            .split(/,\s*/)
            .map((a: string) => a.trim())
            .filter(Boolean)
            .slice(0, 12),
          year: r.pubYear ? Number(r.pubYear) : undefined,
          venue: r.journalTitle ?? r.bookOrReportDetails?.publisher ?? undefined,
          abstract: stripTags(r.abstractText),
          url,
          pdfUrl: r.pmcid ? `https://europepmc.org/articles/${r.pmcid}/pdf` : undefined,
          doi: r.doi,
          citations: r.citedByCount ?? 0,
          type: 'journal' as const,
          source: 'europepmc',
          sourceName: SOURCE_NAME,
          openAccess: r.isOpenAccess === 'Y' || r.inEPMC === 'Y',
        };
      })
      .filter((p) => p.url);
  },
};
