import type { FetchRawFn, Paper, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchUpstream } from '../infra/http';

/**
 * PubMed 数据源 —— 生物医学与生命科学文献（NIH）
 * API: https://www.ncbi.nlm.nih.gov/books/NBK25500/ (E-utilities)
 */

const SOURCE_NAME = 'PubMed';

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>|<${tag}[^/>]*/>`));
  if (!m) return '';
  return stripTags(m[0].replace(new RegExp(`</?${tag}[^>]*>`, 'g'), ''));
}

export const pubmed: SourceAdapter = {
  id: 'pubmed',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const termParts: string[] = [params.query];
    if (params.author) termParts.push(`${params.author}[Author]`);
    const yearFilter =
      params.yearFrom && params.yearTo
        ? ` AND ${params.yearFrom}:${params.yearTo}[PDAT]`
        : params.yearFrom
          ? ` AND ${params.yearFrom}:3000[PDAT]`
          : params.yearTo
            ? ` AND 1000:${params.yearTo}[PDAT]`
            : '';

    const searchSp = new URLSearchParams({
      db: 'pubmed',
      term: termParts.join(' AND ') + yearFilter,
      retmax: String(Math.min(params.limit, 30)),
      retstart: String((params.page - 1) * params.limit),
      retmode: 'json',
      sort: params.sort === 'newest' ? 'pub_date' : 'relevance',
    });
    const searchRes = await fetch(`${BASE}/esearch.fcgi?${searchSp}`);
    if (!searchRes.ok) throw new Error(`PubMed HTTP ${searchRes.status}`);
    const searchData = (await searchRes.json()) as any;
    const ids: string[] = searchData?.esearchresult?.idlist ?? [];
    if (!ids.length) return [];

    const sumSp = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'json' });
    const sumRes = await fetch(`${BASE}/esummary.fcgi?${sumSp}`);
    if (!sumRes.ok) throw new Error(`PubMed HTTP ${sumRes.status}`);
    const sumData = (await sumRes.json()) as any;
    const docs = (sumData?.result ?? {}) as Record<string, any>;

    return ids
      .map((id) => docs[id])
      .filter(Boolean)
      .map((d): Paper => ({
        title: stripTags(d.title ?? '(无标题)'),
        authors: (d.authors ?? []).map((a: any) => a.name).slice(0, 12),
        year: d.pubdate ? Number(d.pubdate.slice(0, 4)) || undefined : undefined,
        venue: d.fulljournalname || d.source || undefined,
        url: `https://pubmed.ncbi.nlm.nih.gov/${d.uid}/`,
        pdfUrl: (d.articleids ?? []).find((x: any) => x?.idtype === 'pmc')
          ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${(d.articleids ?? []).find((x: any) => x?.idtype === 'pmc').value}/pdf/`
          : undefined,
        type: 'journal' as const,
        source: 'pubmed',
        sourceName: SOURCE_NAME,
        openAccess: (d.articleids ?? []).some((x: any) => x?.idtype === 'pmc'),
      }));
  },
};

/* ==================== v3 fetchRaw 层（M1-01）==================== */

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 30);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const termParts: string[] = [params.query];
  if (params.author) termParts.push(`${params.author}[Author]`);
  if (params.yearFrom && params.yearTo) termParts.push(`${params.yearFrom}:${params.yearTo}[PDAT]`);
  else if (params.yearFrom) termParts.push(`${params.yearFrom}:3000[PDAT]`);
  else if (params.yearTo) termParts.push(`1000:${params.yearTo}[PDAT]`);

  const searchSp = new URLSearchParams({
    db: 'pubmed',
    term: termParts.join(' AND '),
    retmax: String(limit),
    retstart: String(offset),
    retmode: 'json',
    sort: params.sort === 'newest' ? 'pub_date' : 'relevance',
  });
  const t0 = Date.now();
  const searchRes = await fetchUpstream<any>(`${BASE}/esearch.fcgi?${searchSp}`, { source: 'PubMed' });
  if (!searchRes.ok) return { records: [], error: searchRes.error, elapsedMs: searchRes.elapsedMs, httpStatus: searchRes.status };
  const ids: string[] = searchRes.data?.esearchresult?.idlist ?? [];
  if (!ids.length) return { records: [], elapsedMs: Date.now() - t0 };

  const sumSp = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'json' });
  const sumRes = await fetchUpstream<any>(`${BASE}/esummary.fcgi?${sumSp}`, { source: 'PubMed' });
  if (!sumRes.ok) return { records: [], error: sumRes.error, elapsedMs: sumRes.elapsedMs, httpStatus: sumRes.status };

  const docs = (sumRes.data?.result ?? {}) as Record<string, any>;
  const fetchedAt = Date.now();
  const records: RawRecord[] = ids
    .map((id) => docs[id])
    .filter(Boolean)
    .map((d) => {
      const pmc = (d.articleids ?? []).find((x: any) => x?.idtype === 'pmc');
      return {
        source: 'pubmed' as const,
        sourceName: 'PubMed',
        fetchedAt,
        title: stripTags(String(d.title ?? '')),
        authors: (d.authors ?? []).map((a: any) => a?.name).filter(Boolean).slice(0, 25),
        year: d.pubdate ? Number(String(d.pubdate).slice(0, 4)) || undefined : undefined,
        venue: d.fulljournalname || d.source || undefined,
        venueType: 'journal' as const,
        abstract: undefined, // esummary 不含摘要；如需摘要需 efetch（暂不请求，见 SOURCES.md 能力矩阵）
        url: `https://pubmed.ncbi.nlm.nih.gov/${d.uid}/`,
        pdfUrl: pmc ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc.value}/pdf/` : undefined,
        type: 'journal' as const,
        openAccess: pmc ? true : undefined,
        nativeId: String(d.uid ?? ''),
      };
    });
  return { records, elapsedMs: Date.now() - t0 };
};
