import type { LanguageFilter, Paper, PaperTypeFilter, SearchParams, SourceId } from './types';
import { ADAPTERS, VALID_SOURCES } from './adapters';

/** 参数解析与结果聚合 */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 解析并校验检索参数 */
export function parseParams(url: URL): SearchParams {
  const q = url.searchParams;
  const query = (q.get('q') ?? '').trim();
  const author = (q.get('author') ?? '').trim() || undefined;
  if (!query && !author) {
    throw new HttpError(400, '请至少提供主题关键词（q）或作者（author）');
  }

  const yearFrom = Number(q.get('yearFrom')) || undefined;
  const yearTo = Number(q.get('yearTo')) || undefined;
  if (yearFrom && yearTo && yearFrom > yearTo) {
    throw new HttpError(400, '起始年份不能晚于结束年份');
  }

  const rawSources = (q.get('sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const sources = (rawSources.length ? rawSources : [...VALID_SOURCES]).filter((s) =>
    VALID_SOURCES.includes(s as SourceId),
  ) as SourceId[];
  if (!sources.length) sources.push('openalex');

  const limit = Math.min(Math.max(Number(q.get('limit')) || 20, 5), 60);
  const page = Math.min(Math.max(Number(q.get('page')) || 1, 1), 20);
  const langParam = q.get('language');
  const language: LanguageFilter = langParam === 'zh' || langParam === 'en' ? langParam : 'all';
  const typeParam = q.get('paperType');
  const paperType: PaperTypeFilter =
    typeParam === 'journal' || typeParam === 'conference' || typeParam === 'preprint'
      ? typeParam
      : 'all';
  // 学科领域筛选（目前作用于 arXiv 分类）
  const fieldParam = (q.get('field') ?? '').trim().toLowerCase();
  const field = ['cs', 'physics', 'math', 'bio', 'ee'].includes(fieldParam) ? fieldParam : undefined;
  // 排序：默认「按质量综合」智能排序
  const sortParam = q.get('sort');
  const sort: SearchParams['sort'] =
    sortParam === 'relevance' || sortParam === 'newest' || sortParam === 'citations'
      ? sortParam
      : 'smart';

  return { query, author, yearFrom, yearTo, sources, limit, sort, page, language, paperType, field };
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

/** 按语言筛选：中文 = 标题/摘要含 CJK 字符；英文 = 不含 CJK 字符 */
export function filterByLanguage(papers: Paper[], language: LanguageFilter): Paper[] {
  if (language === 'all') return papers;
  return papers.filter((p) => {
    const text = `${p.title} ${p.abstract ?? ''}`;
    return language === 'zh' ? CJK_RE.test(text) : !CJK_RE.test(p.title);
  });
}

/** 按文献类型筛选（类型未知的论文保留，避免结果过少） */
export function filterByType(papers: Paper[], paperType: PaperTypeFilter): Paper[] {
  if (paperType === 'all') return papers;
  return papers.filter((p) => !p.type || p.type === paperType);
}

/** 规范化标题用于去重 */
function titleKey(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

/** 合并各源结果：按 DOI 与标题去重，保留信息最全的一条 */
export function mergeResults(lists: Paper[][]): Paper[] {
  const byKey = new Map<string, Paper>();
  for (const list of lists) {
    for (const p of list) {
      const key = p.doi ? `doi:${p.doi.toLowerCase()}` : `t:${titleKey(p.title)}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, p);
        continue;
      }
      const merged: Paper = {
        ...existing,
        authors: existing.authors.length >= p.authors.length ? existing.authors : p.authors,
        year: existing.year ?? p.year,
        venue: existing.venue || p.venue,
        abstract: existing.abstract || p.abstract,
        url: existing.url || p.url,
        pdfUrl: existing.pdfUrl || p.pdfUrl,
        type: existing.type ?? p.type,
        doi: existing.doi || p.doi,
        citations: Math.max(existing.citations ?? 0, p.citations ?? 0),
        openAccess: existing.openAccess || p.openAccess,
        sourceName:
          existing.sourceName === p.sourceName
            ? existing.sourceName
            : `${existing.sourceName} / ${p.sourceName}`,
      };
      byKey.set(key, merged);
    }
  }
  return [...byKey.values()];
}

/** 质量评分：被引次数（对数）+ 时效性 + 开放获取 + PDF 可下载加权 */
function qualityScore(p: Paper): number {
  const thisYear = new Date().getFullYear();
  const citations = Math.log10((p.citations ?? 0) + 1) * 4; // 100 次被引 ≈ 8 分
  const age = p.year ? thisYear - p.year : 15;
  const recency = Math.max(0, 2.5 - age * 0.15); // 当年 2.5 分，逐年衰减
  const oa = p.openAccess ? 0.5 : 0;
  const pdf = p.pdfUrl ? 0.4 : 0;
  return citations + recency + oa + pdf;
}

/** 构建检索词：英文按空格拆分，中文整体作为一个词 */
function buildTerms(query: string): string[] {
  const t = query.trim().toLowerCase();
  if (!t) return [];
  return t.split(/\s+/).filter((w) => w.length > 0);
}

/**
 * 文本相关性评分（0-10+）：
 * - 完整短语命中标题 +6 / 摘要 +2
 * - 单个检索词命中标题 +2.5 / 摘要 +0.6
 * 修复：此前智能排序只看被引和时效，完全不考虑与关键词的内容匹配度，
 * 导致高被引但跑题的论文排在最前
 */
export function textRelevance(p: Paper, query: string): number {
  const terms = buildTerms(query);
  if (!terms.length) return 0;
  const title = (p.title ?? '').toLowerCase();
  const abstract = (p.abstract ?? '').toLowerCase();
  let score = 0;

  const phrase = query.trim().toLowerCase();
  if (terms.length > 1) {
    if (title.includes(phrase)) score += 6;
    if (abstract.includes(phrase)) score += 2;
  }
  for (const term of terms) {
    if (title.includes(term)) score += 2.5;
    else if (abstract.includes(term)) score += 0.6;
  }
  return score;
}

export function sortPapers(papers: Paper[], sort: SearchParams['sort'], query: string): Paper[] {
  if (sort === 'newest') {
    papers.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  } else if (sort === 'citations') {
    papers.sort((a, b) => (b.citations ?? 0) - (a.citations ?? 0));
  } else if (sort === 'smart') {
    // 智能排序 = 文本相关性（权重 1.2）+ 质量评分
    // 相关性占主导：先保证跑题，再在同等相关性中按被引/时效/OA 排序
    papers.sort(
      (a, b) =>
        textRelevance(b, query) * 1.2 + qualityScore(b) -
        (textRelevance(a, query) * 1.2 + qualityScore(a)),
    );
  } else {
    // relevance：纯文本相关性排序（不再依赖各源返回顺序，跨源统一比较）
    papers.sort((a, b) => textRelevance(b, query) - textRelevance(a, query));
  }
  return papers;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

export { ADAPTERS, VALID_SOURCES };
