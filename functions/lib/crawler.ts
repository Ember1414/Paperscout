import type { Env } from './types';

/**
 * 爬虫模块 —— 抓取 arXiv 最新论文榜单（计算机科学全类目）
 *
 * 工作方式：
 * 1. 优先「爬取」arXiv 官方列表页 HTML（https://arxiv.org/list/cs/recent），
 *    正则解析出最新提交的论文标题 / 作者 / 链接；
 * 2. 若页面结构变化导致解析失败，自动降级为 arXiv 官方 API（按提交时间倒序）；
 * 3. 结果写入 KV 缓存 1 小时，避免高频抓取、对上游友好。
 */

export interface TrendingPaper {
  title: string;
  authors: string[];
  url: string;
  /** 数据获取方式：scrape = 爬虫解析页面 / api = 官方 API 降级 */
  via: 'scrape' | 'api';
}

export interface TrendingResult {
  crawledAt: string;
  papers: TrendingPaper[];
  via: 'scrape' | 'api' | 'cache';
}

const CACHE_KEY = 'crawler:arxiv:trending:v2';
const CACHE_TTL = 120; // 2 分钟短缓存：基本实时，同时避免高频抓取对上游造成压力

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripTags(s: string): string {
  return clean(
    s
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
}

/** 爬虫：解析 arXiv 列表页 HTML */
async function scrapeArxivList(): Promise<TrendingPaper[]> {
  const res = await fetch('https://arxiv.org/list/cs/recent', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PaperScout/1.0; +https://paperscout.pages.dev)',
    },
  });
  if (!res.ok) throw new Error(`arXiv 列表页 HTTP ${res.status}`);

  const html = await res.text();
  const blocks = html.split('arxiv-result').slice(1);

  const papers: TrendingPaper[] = [];
  for (const block of blocks) {
    // 标题：<p class="title is-5 mathjax"> ... </p>
    const titleMatch = block.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/);
    // 作者：<p class="authors"> ... </p>
    const authorsMatch = block.match(/class="authors"[^>]*>([\s\S]*?)<\/p>/);
    // 原文链接：https://arxiv.org/abs/xxxx.xxxxx (取第一个)
    const idMatch = block.match(/arxiv\.org\/abs\/([\w.\-/]+)/);

    if (!titleMatch || !idMatch) continue;

    const authors = authorsMatch
      ? stripTags(authorsMatch[1]).replace(/^Authors:/i, '')
          .split(/,\s*/)
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];

    papers.push({
      title: stripTags(titleMatch[1]).replace(/^Title:/i, ''),
      authors,
      url: `https://arxiv.org/abs/${idMatch[1].replace(/v\d+$/, '')}`,
      via: 'scrape',
    });
    if (papers.length >= 12) break;
  }

  if (!papers.length) throw new Error('arXiv 页面结构变化，爬虫解析失败');
  return papers;
}

/** 降级方案：arXiv 官方 API 按提交时间倒序 */
async function arxivApiFallback(): Promise<TrendingPaper[]> {
  const url =
    'https://export.arxiv.org/api/query?' +
    new URLSearchParams({
      search_query: 'cat:cs.*',
      start: '0',
      max_results: '12',
      sortBy: 'submittedDate',
      sortOrder: 'descending',
    });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`arXiv API HTTP ${res.status}`);

  const xml = await res.text();
  return xml
    .split('<entry>')
    .slice(1)
    .map((entry) => {
      const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '';
      const idUrl = entry.match(/<id[^>]*>([\s\S]*?)<\/id>/)?.[1] ?? '';
      const authors: string[] = [];
      const authorRe = /<name>([\s\S]*?)<\/name>/g;
      let am: RegExpExecArray | null;
      while ((am = authorRe.exec(entry)) !== null) authors.push(clean(am[1]));

      return {
        title: stripTags(title),
        authors: authors.slice(0, 6),
        url: idUrl.replace(/v\d+$/, '').trim(),
        via: 'api' as const,
      };
    })
    .filter((p) => p.title && p.url);
}

/**
 * 获取热门论文：缓存 → 爬虫 → API 降级
 * @param refresh 为 true 时绕过缓存强制重新抓取（前端「实时刷新」按钮）
 */
export async function getTrending(
  env: Env,
  ctx?: { waitUntil(p: Promise<unknown>): void },
  refresh = false,
): Promise<TrendingResult> {
  if (!refresh) {
    const cached = await env.CACHE.get<TrendingResult>(CACHE_KEY, 'json');
    if (cached) return { ...cached, via: 'cache' };
  }

  let papers: TrendingPaper[];
  let via: 'scrape' | 'api';
  try {
    papers = await scrapeArxivList();
    via = 'scrape';
  } catch {
    papers = await arxivApiFallback();
    via = 'api';
  }

  const result: TrendingResult = { crawledAt: new Date().toISOString(), papers, via };
  if (ctx) {
    ctx.waitUntil(env.CACHE.put(CACHE_KEY, JSON.stringify(result), { expirationTtl: CACHE_TTL }));
  } else {
    await env.CACHE.put(CACHE_KEY, JSON.stringify(result), { expirationTtl: CACHE_TTL });
  }
  return result;
}
