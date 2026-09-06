import type { Paper, SearchParams, SourceAdapter } from '../types';

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
    if (params.query) terms.push(`all:"${params.query}"`);
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
