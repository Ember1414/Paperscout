import type { FetchRawFn, Paper, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchUpstream } from '../infra/http';

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

/* ==================== v3 fetchRaw 层（M1-03）==================== */

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 30);
  const page = Math.floor((opts?.offset ?? (params.page - 1) * limit) / limit) + 1;

  const parts: string[] = [`(${params.query})`];
  if (params.author) parts.push(`AUTH:"${params.author}"`);
  if (params.yearFrom && params.yearTo) parts.push(`(PUB_YEAR:[${params.yearFrom} TO ${params.yearTo}])`);
  else if (params.yearFrom) parts.push(`(PUB_YEAR:[${params.yearFrom} TO 2100])`);
  else if (params.yearTo) parts.push(`(PUB_YEAR:[1000 TO ${params.yearTo}])`);

  const sp = new URLSearchParams({
    query: parts.join(' AND '),
    format: 'json',
    pageSize: String(limit),
    page: String(page),
    resultType: 'core',
  });
  if (params.sort === 'newest') sp.set('sort', 'P_PDATE_D desc');
  if (params.sort === 'citations') sp.set('sort', 'CITED desc');

  const res = await fetchUpstream<any>(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?${sp}`, { source: 'Europe PMC' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const results = (res.data?.resultList?.result ?? []) as any[];
  const fetchedAt = Date.now();
  const records: RawRecord[] = results
    .filter((r) => r.title)
    .map((r) => {
      const url = r.doi ? `https://doi.org/${r.doi}` : r.pmcid ? `https://europepmc.org/article/PMC/${r.pmcid}` : r.pmid ? `https://europepmc.org/article/MED/${r.pmid}` : undefined;
      const isPreprint = String(r.source ?? '').toUpperCase() === 'PPR';
      return {
        source: 'europepmc' as const,
        sourceName: 'Europe PMC',
        fetchedAt,
        title: String(r.title),
        authors: String(r.authorString ?? '').split(/,\s*/).map((a: string) => a.trim()).filter(Boolean).slice(0, 25),
        year: r.pubYear ? Number(r.pubYear) || undefined : undefined,
        venue: r.journalTitle ?? r.bookOrReportDetails?.publisher ?? undefined,
        venueType: isPreprint ? 'preprint' : 'journal',
        abstract: stripTags(r.abstractText),
        doi: r.doi || undefined,
        url,
        pdfUrl: r.pmcid ? `https://europepmc.org/articles/${r.pmcid}/pdf` : undefined,
        citations: typeof r.citedByCount === 'number' ? r.citedByCount : undefined,
        type: isPreprint ? 'preprint' : 'journal',
        openAccess: r.isOpenAccess === 'Y' || r.inEPMC === 'Y' ? true : undefined,
        nativeId: r.pmid || r.pmcid || undefined,
      };
    });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
