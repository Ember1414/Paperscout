import type { FetchRawFn, Paper, RawFetchResult, RawRecord, SearchParams, SourceAdapter } from '../types';
import { fetchUpstream } from '../infra/http';

/**
 * arXiv 数据源 —— 计算机、物理、数学等领域预印本
 * API: https://info.arxiv.org/help/api/user-manual.html (Atom)
 */

const SOURCE_NAME = 'arXiv';

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extract(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? stripTags(m[1]) : '';
}

export const arxiv: SourceAdapter = {
  id: 'arxiv',
  name: SOURCE_NAME,

  async search(params: SearchParams): Promise<Paper[]> {
    const terms: string[] = [];
    // 多词查询：逐词 AND（召回优于整句短语匹配，跨源合并后再按相关性排序）
    // 单词查询：直接短语匹配
    const words = params.query.trim().split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      terms.push(words.map((w) => `all:"${w}"`).join(' AND '));
    } else if (params.query) {
      terms.push(`all:"${params.query}"`);
    }
    if (params.author) terms.push(`au:"${params.author}"`);
    // 学科领域筛选（arXiv 分类）
    const FIELD_MAP: Record<string, string> = {
      cs: 'cs',
      physics: 'physics',
      math: 'math',
      bio: 'q-bio',
      ee: 'eess',
    };
    if (params.field && FIELD_MAP[params.field]) terms.push(`cat:${FIELD_MAP[params.field]}.*`);

    const searchQuery = terms.join(' AND ');
    if (!searchQuery) return [];

    const url =
      'https://export.arxiv.org/api/query?' +
      new URLSearchParams({
        search_query: searchQuery,
        start: String((params.page - 1) * params.limit),
        max_results: String(Math.min(params.limit, 30)),
        sortBy: params.sort === 'newest' ? 'submittedDate' : 'relevance',
        sortOrder: 'descending',
      });

    const res = await fetch(url, {
      headers: { 'User-Agent': 'PaperScout/1.0 (https://paperscout.pages.dev)' },
    });
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);

    const xml = await res.text();
    const entries = xml.split('<entry>').slice(1).map((e) => e.split('</entry>')[0]);

    return entries.map((entry) => {
      const idUrl = extract(entry, 'id'); // e.g. http://arxiv.org/abs/2401.12345v2
      const absUrl = idUrl.replace(/v\d+$/, '');

      const authors: string[] = [];
      const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
      let am: RegExpExecArray | null;
      while ((am = authorRe.exec(entry)) !== null) authors.push(stripTags(am[1]));

      const published = extract(entry, 'published');
      const year = published ? Number(published.slice(0, 4)) : undefined;

      return {
        title: extract(entry, 'title'),
        authors,
        year,
        venue: 'arXiv 预印本',
        abstract: extract(entry, 'summary'),
        url: absUrl,
        pdfUrl: absUrl.replace('/abs/', '/pdf/'),
        type: 'preprint' as const,
        source: 'arxiv' as const,
        sourceName: SOURCE_NAME,
        openAccess: true,
      };
    });
  },
};

/* ==================== v3 fetchRaw 层（M1-01）==================== */

export const fetchRaw: FetchRawFn = async (params, opts): Promise<RawFetchResult> => {
  if (!params.query) return { records: [], elapsedMs: 0 };
  const limit = Math.min(opts?.limit ?? params.limit, 30);
  const offset = opts?.offset ?? (params.page - 1) * limit;

  const words = params.query.trim().split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  if (words.length > 1) terms.push(words.map((w) => `all:"${w}"`).join(' AND '));
  else terms.push(`all:"${params.query}"`);
  if (params.author) terms.push(`au:"${params.author}"`);
  // 年份过滤：arXiv 原生 submittedDate 区间（capability: yearFilter=native）
  if (params.yearFrom || params.yearTo) {
    const from = params.yearFrom ? `${params.yearFrom}01010000` : '100001010000';
    const to = params.yearTo ? `${params.yearTo}12312359` : '999912312359';
    terms.push(`submittedDate:[${from} TO ${to}]`);
  }

  // search_query 含 arXiv 区间语法（[] 与空格），整体 encodeURIComponent（空格→%20，arXiv 接受）
  const searchQuery = encodeURIComponent(terms.join(' AND '));
  const rest = new URLSearchParams({
    start: String(offset),
    max_results: String(limit),
    sortBy: params.sort === 'newest' ? 'submittedDate' : 'relevance',
    sortOrder: 'descending',
  });

  const res = await fetchUpstream<string>(`https://export.arxiv.org/api/query?search_query=${searchQuery}&${rest}`, { source: 'arXiv', expect: 'text' });
  if (!res.ok) return { records: [], error: res.error, elapsedMs: res.elapsedMs, httpStatus: res.status };

  const xml = res.text ?? '';
  const entries = xml.split('<entry>').slice(1).map((e) => e.split('</entry>')[0]);
  const fetchedAt = Date.now();
  const records: RawRecord[] = entries.map((entry) => {
    const idUrl = extract(entry, 'id');
    const absUrl = idUrl.replace(/v\d+$/, '');
    const authors: string[] = [];
    const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
    let am: RegExpExecArray | null;
    while ((am = authorRe.exec(entry)) !== null) authors.push(stripTags(am[1]));
    const published = extract(entry, 'published');
    const arxivId = absUrl.split('/abs/')[1] || undefined;
    return {
      source: 'arxiv' as const,
      sourceName: 'arXiv',
      fetchedAt,
      title: extract(entry, 'title'),
      authors: authors.slice(0, 25),
      year: published ? Number(published.slice(0, 4)) || undefined : undefined,
      venue: 'arXiv',
      venueType: 'preprint' as const,
      abstract: extract(entry, 'summary') || undefined,
      url: absUrl || undefined,
      pdfUrl: absUrl ? absUrl.replace('/abs/', '/pdf/') : undefined,
      type: 'preprint' as const,
      openAccess: true,
      nativeId: arxivId,
    };
  });
  return { records, elapsedMs: res.elapsedMs, httpStatus: res.status };
};
