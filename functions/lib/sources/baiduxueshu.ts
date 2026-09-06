import type { Paper, SearchParams, SourceAdapter } from '../types';
import { fetchWithRetry } from '../http';

/**
 * 中文文献聚合源
 *
 * 主通道：百度学术爬虫（聚合知网/万方/维普）—— 但百度对数据中心 IP 有严格反爬（403），
 * 大概率被拦截；
 * 降级通道：OpenAlex `language:zh` 原生筛选（2.5 亿+ 文献中的中文期刊部分，稳定可用）。
 * 因此该源永远不会报错失败，总能提供中文论文。
 */

const SOURCE_NAME = '中文文献聚合';

const BAIDU_BASE = 'https://xueshu.baidu.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
function stripTags(s: string): string {
  return clean(s.replace(/<[^>]*>/g, ''));
}

/** 主通道：爬取百度学术搜索结果页 */
async function crawlBaidu(params: SearchParams): Promise<Paper[]> {
  const offset = (params.page - 1) * params.limit;
  const sp = new URLSearchParams({
    wd: params.query,
    pn: String(offset),
    rsv_bp: '0',
    tn: 'SE_baiduxueshu_c1gjeupa',
    ie: 'utf-8',
  });
  if (params.author) sp.set('author', params.author);

  const res = await fetch(`${BAIDU_BASE}/s?${sp}`, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': `${BAIDU_BASE}/`,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Upgrade-Insecure-Requests': '1',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`百度学术 HTTP ${res.status}`);

  const html = await res.text();
  if (html.includes('百度安全验证') || html.includes('wappass')) {
    throw new Error('百度学术触发反爬验证');
  }

  const blocks = html.split(/class="result[^"]*sc_default_result[^"]*"/).slice(1);
  const papers: Paper[] = [];

  for (const block of blocks) {
    const titleMatch = block.match(/<h3[^>]*class="t"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    let url = titleMatch[1];
    if (url.startsWith('/')) url = BAIDU_BASE + url;

    const infoMatch = block.match(/<div class="sc_info"[^>]*>([\s\S]*?)<\/div>/);
    const infoText = infoMatch ? stripTags(infoMatch[1]) : '';
    const infoParts = infoText.split(/[·|]/).map((s) => clean(s)).filter(Boolean);

    const yearMatch = infoText.match(/(19|20)\d{2}/);
    const year = yearMatch ? Number(yearMatch[0]) : undefined;

    const absMatch = block.match(/class="c_abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const abstract = absMatch ? stripTags(absMatch[1]).slice(0, 400) : undefined;

    const citeMatch = block.match(/被引量[：:]\s*(\d+)/);

    papers.push({
      title: stripTags(titleMatch[2]),
      authors: infoParts.filter((s) => !/^(19|20)\d{2}$/.test(s)).slice(0, 8),
      year,
      venue: infoParts.find((s) => s.includes('《'))?.replace(/[《》]/g, ''),
      abstract,
      url,
      citations: citeMatch ? Number(citeMatch[1]) : undefined,
      source: 'baiduxueshu',
      sourceName: '百度学术',
      openAccess: block.includes('免费下载') || block.includes('开放获取'),
    });
    if (papers.length >= params.limit) break;
  }

  if (!papers.length) throw new Error('百度学术页面解析失败');
  return papers;
}

/** 降级通道 1：OpenAlex 中文文献（language:zh 原生筛选，稳定可用） */
async function openalexChinese(params: SearchParams): Promise<Paper[]> {
  const filters = ['language:zh'];
  if (params.yearFrom) filters.push(`from_publication_date:${params.yearFrom}-01-01`);
  if (params.yearTo) filters.push(`to_publication_date:${params.yearTo}-12-31`);

  const sp = new URLSearchParams({
    search: params.query,
    filter: filters.join(','),
    per_page: String(Math.min(params.limit, 30)),
    page: String(params.page),
    mailto: 'paperscout@example.com',
  });
  if (params.author) sp.set('filter', `${sp.get('filter')},raw_author_name.search:${params.author}`);

  // OpenAlex 共享出口 IP 限流频繁：加重试与更长退避
  const res = await fetchWithRetry(`https://api.openalex.org/works?${sp}`, undefined, 3, 1000);
  if (!res.ok) throw new Error(`OpenAlex 中文降级 HTTP ${res.status}`);

  const data = (await res.json()) as any;
  return ((data.results ?? []) as any[])
    .map((w): Paper => {
      const doi: string | undefined = w.doi?.replace('https://doi.org/', '') || undefined;
      return {
        title: w.display_name ?? '(无标题)',
        authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).slice(0, 12),
        year: w.publication_year ?? undefined,
        venue: w.primary_location?.source?.display_name ?? undefined,
        abstract: undefined,
        url: w.primary_location?.landing_page_url || w.doi || '',
        doi,
        citations: w.cited_by_count ?? 0,
        source: 'baiduxueshu',
        sourceName: '中文文献聚合',
        openAccess: w.open_access?.is_oa ?? false,
      };
    })
    .filter((p) => p.url);
}

/** 降级通道 2：Crossref 中文关键词检索 + CJK 标题过滤（OpenAlex 限流时的最后保底） */
async function crossrefChinese(params: SearchParams): Promise<Paper[]> {
  const sp = new URLSearchParams({
    query: params.query,
    rows: String(Math.min(params.limit * 2, 40)),
    offset: String((params.page - 1) * params.limit),
    select: 'DOI,title,author,issued,container-title,URL,is-referenced-by-count,type',
    mailto: 'paperscout@example.com',
  });

  const res = await fetchWithRetry(`https://api.crossref.org/works?${sp}`);
  if (!res.ok) throw new Error(`Crossref 中文降级 HTTP ${res.status}`);

  const data = (await res.json()) as any;
  return ((data?.message?.items ?? []) as any[])
    .map((it): Paper => {
      const year = it.issued?.['date-parts']?.[0]?.[0];
      return {
        title: it.title?.[0] ?? '(无标题)',
        authors: (it.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 12),
        year: typeof year === 'number' ? year : undefined,
        venue: it['container-title']?.[0] ?? undefined,
        url: it.URL ?? (it.DOI ? `https://doi.org/${it.DOI}` : ''),
        doi: it.DOI,
        citations: it['is-referenced-by-count'] ?? 0,
        type: it.type === 'proceedings-article' ? 'conference' : it.type === 'journal-article' ? 'journal' : 'other',
        source: 'baiduxueshu',
        sourceName: '中文文献聚合',
      };
    })
    .filter((p) => p.url && /[\u3400-\u4dbf\u4e00-\u9fff]/.test(p.title))
    .filter((p) => !params.yearFrom || !p.year || p.year >= params.yearFrom!)
    .filter((p) => !params.yearTo || !p.year || p.year <= params.yearTo!);
}

export const baiduxueshu: SourceAdapter = {
  id: 'baiduxueshu',
  name: '中文文献聚合',

  async search(params: SearchParams): Promise<Paper[]> {
    if (!params.query) return [];

    // 三重保障：百度学术爬虫 → OpenAlex 中文 → Crossref 中文
    // 该源总能产出中文论文，不会报错失败
    try {
      const papers = await crawlBaidu(params);
      if (params.yearFrom) papers.filter((p) => !p.year || p.year >= params.yearFrom!);
      return papers;
    } catch {
      /* 主通道被反爬拦截，走降级 */
    }

    try {
      return await openalexChinese(params);
    } catch {
      return await crossrefChinese(params);
    }
  },
};
