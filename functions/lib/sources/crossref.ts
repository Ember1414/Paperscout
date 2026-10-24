import type { FetchRawFn, Paper, PaperType, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';
import { fetchUpstream } from '../infra/http';
import { CONTACT_EMAIL } from '../config';

/** Crossref type → PaperScout type */
function mapType(t?: string): PaperType | undefined {
  switch (t) {
    case 'journal-article':
      return 'journal';
    case 'proceedings-article':
      return 'conference';
    case 'posted-content':
      return 'preprint';
    default:
      return 'other';
  }
}

/**
 * Crossref 数据源 —— 1.4 亿+ DOI 注册记录，覆盖几乎所有正式出版物
 * API: https://api.crossref.org/swagger-ui/index.html
 */

const SOURCE_NAME = 'Crossref';

/** v3 摘要清洗：去 JATS 标签，上限 3000 字（SEARCH.ABSTRACT_MAX_CHARS） */
function stripJatsLong(s?: string): string | undefined {
  if (!s) return undefined;
  const text = s
    .replace(/<jats:p>|<\/?jats:[^>]*>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 3000 ? text.slice(0, 3000) + '…' : text || undefined;
}

function stripJats(s?: string): string | undefined {
  if (!s) return undefined;
  const text = s
    .replace(/<jats:p>|<\/jats:p>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 400 ? text.slice(0, 400) + '…' : text || undefined;
}

export const crossref: SourceAdapter = {
  id: 'crossref',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    const queryParts: string[] = [params.query];
    if (params.author) queryParts.push(params.author);

    const sp = new URLSearchParams({
      // query.bibliographic 按题名/作者/出版信息匹配，相关性优于通用 query
      'query.bibliographic': queryParts.join(' '),
      rows: String(Math.min(params.limit, 40)),
      offset: String((params.page - 1) * params.limit),
      select: 'DOI,title,author,issued,container-title,URL,abstract,is-referenced-by-count,link,type',
      mailto: 'paperscout@example.com',
    });
    // 文献类型原生筛选（Crossref 语法：filter=type:xxx）
    if (params.paperType === 'journal') sp.set('filter', 'type:journal-article');
    if (params.paperType === 'conference') sp.set('filter', 'type:proceedings-article');
    if (params.paperType === 'preprint') sp.set('filter', 'type:posted-content');
    if (params.sort === 'newest') {
      sp.set('sort', 'published');
      sp.set('order', 'desc');
    }
    if (params.sort === 'citations') {
      sp.set('sort', 'is-referenced-by-count');
      sp.set('order', 'desc');
    }

    const res = await fetchWithRetry(`https://api.crossref.org/works?${sp}`);
    if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);

    const data = (await res.json()) as any;
    const items = (data?.message?.items ?? []) as any[];

    let papers: Paper[] = items
      .map((it): Paper => {
        const year = it.issued?.['date-parts']?.[0]?.[0];
        return {
          title: it.title?.[0] ?? '(无标题)',
          authors: (it.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 12),
          year: typeof year === 'number' ? year : undefined,
          venue: it['container-title']?.[0] ?? undefined,
          abstract: stripJats(it.abstract),
          url: it.URL ?? (it.DOI ? `https://doi.org/${it.DOI}` : ''),
          pdfUrl: (it.link ?? []).find((l: any) => l['content-type'] === 'application/pdf')?.URL,
          doi: it.DOI,
          citations: it['is-referenced-by-count'] ?? 0,
          type: mapType(it.type),
          source: 'crossref',
          sourceName: SOURCE_NAME,
          openAccess: (it.link ?? []).some((l: any) => l['content-type'] === 'application/pdf'),
        };
      })
      .filter((p) => p.url);

    if (params.yearFrom) papers = papers.filter((p) => !p.year || p.year >= params.yearFrom!);
    if (params.yearTo) papers = papers.filter((p) => !p.year || p.year <= params.yearTo!);

    return papers;
  },
};

/* ==================== v3 fetchRaw 层（M1-01；mailto 修复 A-24/D-006）==================== */

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 40);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const filters: string[] = [];
  if (params.paperType === 'journal') filters.push('type:journal-article');
  if (params.paperType === 'conference') filters.push('type:proceedings-article');
  if (params.paperType === 'preprint') filters.push('type:posted-content');
  if (params.yearFrom) filters.push(`from-pub-date:${params.yearFrom}-01-01`);
  if (params.yearTo) filters.push(`until-pub-date:${params.yearTo}-12-31`);

  const sp = new URLSearchParams({
    'query.bibliographic': params.author ? `${params.query} ${params.author}` : params.query,
    rows: String(limit),
    offset: String(offset),
    select: 'DOI,title,author,issued,container-title,URL,abstract,is-referenced-by-count,link,type',
    mailto: CONTACT_EMAIL,
  });
  if (filters.length) sp.set('filter', filters.join(','));
  if (params.sort === 'newest') { sp.set('sort', 'published'); sp.set('order', 'desc'); }
  if (params.sort === 'citations') { sp.set('sort', 'is-referenced-by-count'); sp.set('order', 'desc'); }

  const res = await fetchUpstream<any>(`https://api.crossref.org/works?${sp}`, { source: 'Crossref' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const items = (res.data?.message?.items ?? []) as any[];
  const fetchedAt = Date.now();
  const records: RawRecord[] = items.map((it) => {
    const year = it.issued?.['date-parts']?.[0]?.[0];
    const doi = String(it.DOI ?? '') || undefined;
    const pdfLink = (it.link ?? []).find((l: any) => l['content-type'] === 'application/pdf')?.URL;
    return {
      source: 'crossref' as const,
      sourceName: 'Crossref',
      fetchedAt,
      title: String(it.title?.[0] ?? ''),
      authors: (it.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 25),
      year: typeof year === 'number' ? year : undefined,
      venue: it['container-title']?.[0] || undefined,
      venueType: it.type === 'proceedings-article' ? 'conference' : it.type === 'posted-content' ? 'preprint' : it.type === 'journal-article' ? 'journal' : 'unknown',
      abstract: stripJatsLong(it.abstract),
      doi,
      url: it.URL || (doi ? `https://doi.org/${doi}` : undefined),
      pdfUrl: pdfLink || undefined,
      citations: typeof it['is-referenced-by-count'] === 'number' ? it['is-referenced-by-count'] : undefined,
      type: mapType(it.type),
      openAccess: pdfLink ? true : undefined,
      nativeId: doi,
    };
  });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
