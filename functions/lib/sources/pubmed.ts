import type { Paper, SearchParams, SourceAdapter } from '../types';

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
