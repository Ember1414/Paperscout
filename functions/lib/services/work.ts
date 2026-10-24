import { SEARCH } from '../config';
import { AppError } from '../errors';
import { fetchUpstream } from '../infra/http';
import { l1Get, l1Put } from '../infra/cache';
import { CONTACT_EMAIL } from '../config';

/**
 * /api/work（REBUILD_PLAN 5.5 / M3-01）：单篇详情——完整元数据 + 参考文献/被引/相似 + 被引趋势。
 * 数据源：OpenAlex 优先（引文/机构/主题最全），Crossref 兜底基础元数据；
 * 引文列表来自 OpenAlex（referenced_works 水合 + cites: 反查），S2 引用上下文走 /api/citations（M3-06 懒加载）。
 * 缓存：L1 24h（5.5 表）。
 */

export interface WorkListItem {
  id: string;
  doi?: string;
  title: string;
  year?: number;
  venue?: string;
  citations?: number;
}

export interface WorkAuthor {
  name: string;
  institution?: string;
}

export interface WorkDetail {
  id: string;
  doi?: string;
  openalexId?: string;
  title: string;
  authors: WorkAuthor[];
  year?: number;
  publicationDate?: string;
  venue?: string;
  venueType?: string;
  type?: string;
  abstract?: string;
  citations?: number;
  openAccess: boolean;
  pdfUrl?: string;
  landingUrl?: string;
  lang?: string;
  institutions: string[];
  countsByYear: [number, number][];
  citedByCount?: number;
  referencedCount?: number;
}

export interface WorkDetailResult {
  work: WorkDetail;
  references: WorkListItem[];
  citedBy: WorkListItem[];
  similar: WorkListItem[];
  metricsFetchedAt: string;
  providers: string[];
}

const MAILTO = `mailto=${CONTACT_EMAIL}`;

/** @param {string} id 形如 doi:10.x/y | W1234 | https://openalex.org/W1234 */
function resolveOpenAlexPath(id: string): string | null {
  const raw = String(id ?? '').trim();
  if (/^10\./.test(raw) || raw.startsWith('doi:')) {
    const doi = raw.replace(/^doi:/, '');
    return `doi:${doi}`;
  }
  const wMatch = raw.match(/(W\d{6,})/);
  if (wMatch) return wMatch[1];
  return null;
}

/** OpenAlex 单篇 → 详情结构（含机构/趋势；引用列表由调用方水合） */
function mapDetail(w: any): WorkDetail {
  const doi = String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined;
  const institutions = (w.authorships ?? [])
    .flatMap((a: any) => (a?.institutions ?? []).map((i: any) => i?.display_name).filter(Boolean))
    .filter((x: string, i: number, arr: string[]) => arr.indexOf(x) === i)
    .slice(0, 8);
  return {
    id: doi ? `doi:${doi}` : String(w.id ?? '').split('/').pop() ?? '',
    doi,
    openalexId: typeof w.id === 'string' ? w.id.split('/').pop() : undefined,
    title: String(w.display_name ?? ''),
    authors: (w.authorships ?? []).slice(0, 30).map((a: any) => ({
      name: String(a?.author?.display_name ?? ''),
      institution: a?.institutions?.[0]?.display_name || undefined,
    })),
    year: w.publication_year ?? undefined,
    publicationDate: w.publication_date || undefined,
    venue: w.primary_location?.source?.display_name || undefined,
    venueType: w.primary_location?.source?.type || undefined,
    type: w.type || undefined,
    abstract: rebuildAbstract(w.abstract_inverted_index),
    citations: typeof w.cited_by_count === 'number' ? w.cited_by_count : undefined,
    openAccess: w.open_access?.is_oa === true,
    pdfUrl: w.best_oa_location?.pdf_url || w.primary_location?.pdf_url || undefined,
    landingUrl: w.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : undefined),
    lang: w.language || undefined,
    institutions,
    countsByYear: (w.counts_by_year ?? []).map((c: any) => [Number(c.year), Number(c.cited_by_count)] as [number, number]),
    citedByCount: w.cited_by_count,
    referencedCount: Array.isArray(w.referenced_works) ? w.referenced_works.length : undefined,
  };
}

/** 倒排索引 → 摘要 */
function rebuildAbstract(inverted?: Record<string, number[]>): string | undefined {
  if (!inverted) return undefined;
  const words: { pos: number; word: string }[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) words.push({ pos, word });
  }
  words.sort((a, b) => a.pos - b.pos);
  const text = words.map((x) => x.word).join(' ');
  return text.length > 5000 ? text.slice(0, 5000) + '…' : text || undefined;
}

/** OpenAlex work → 列表项（参考文献/被引/相似共用） */
function toListItem(w: any): WorkListItem {
  const doi = String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined;
  return {
    id: doi ? `doi:${doi}` : String(w.id ?? '').split('/').pop() ?? '',
    doi,
    title: String(w.display_name ?? ''),
    year: w.publication_year ?? undefined,
    venue: w.primary_location?.source?.display_name || undefined,
    citations: typeof w.cited_by_count === 'number' ? w.cited_by_count : undefined,
  };
}

/** 批量水合 OpenAlex id（| 分隔，≤25/次；失败返回空——引文列表是增强层） */
async function hydrateIds(ids: string[], limit: number): Promise<WorkListItem[]> {
  const slice = ids.slice(0, limit).map((x) => x.split('/').pop() ?? x);
  if (!slice.length) return [];
  const res = await fetchUpstream<any>(
    `https://api.openalex.org/works?filter=openalex:${slice.join('|')}&per-page=${limit}&${MAILTO}`,
    { source: 'OpenAlex', timeoutMs: 8000 },
  );
  if (!res.ok) return [];
  return ((res.data?.results ?? []) as any[]).map(toListItem);
}

/** Crossref 兜底（OpenAlex 不可用时的基础元数据；无引文列表） */
async function crossrefFallback(doi: string): Promise<WorkDetailResult> {
  const res = await fetchUpstream<any>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { source: 'Crossref' });
  if (!res.ok || !res.data?.message) throw new AppError('NOT_FOUND', '没有找到这篇文献');
  const m = res.data.message;
  const year = m.issued?.['date-parts']?.[0]?.[0];
  return {
    work: {
      id: `doi:${doi}`,
      doi,
      title: String(m.title?.[0] ?? ''),
      authors: (m.author ?? []).slice(0, 30).map((a: any) => ({ name: [a.given, a.family].filter(Boolean).join(' ') })),
      year: typeof year === 'number' ? year : undefined,
      publicationDate: undefined,
      venue: m['container-title']?.[0] || undefined,
      venueType: m.type === 'proceedings-article' ? 'conference' : 'journal',
      type: m.type,
      abstract: (m.abstract ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || undefined,
      citations: m['is-referenced-by-count'],
      openAccess: false,
      pdfUrl: undefined,
      landingUrl: m.URL || `https://doi.org/${doi}`,
      institutions: [],
      countsByYear: [],
      citedByCount: m['is-referenced-by-count'],
      referencedCount: m['references-count'],
    },
    references: [],
    citedBy: [],
    similar: [],
    metricsFetchedAt: new Date().toISOString(),
    providers: ['Crossref'],
  };
}

/** @param {string} id */
export async function getWorkDetail(id: string, env?: { CACHE?: KVNamespace }): Promise<WorkDetailResult> {
  const path = resolveOpenAlexPath(id);
  if (!path) throw new AppError('NOT_FOUND', '没有找到这篇文献（仅支持 DOI 或 OpenAlex id）');

  const cacheKey = `work:${path}`;
  try {
    const cached = await l1Get<WorkDetailResult>(cacheKey);
    if (cached.value) return cached.value;
  } catch (e) {
    console.warn('work:l1-read-failed', e instanceof Error ? e.message : String(e));
  }

  const oa = await fetchUpstream<any>(`https://api.openalex.org/works/${path.startsWith('doi:') ? `doi:${path.slice(4)}` : path}?${MAILTO}`, { source: 'OpenAlex', timeoutMs: SEARCH.PER_SOURCE_TIMEOUT_MS });
  if (!oa.ok) {
    const doi = path.startsWith('doi:') ? path.slice(4) : undefined;
    if (doi) return crossrefFallback(doi);
    if (oa.error?.message?.includes('404') || oa.status === 404) throw new AppError('NOT_FOUND', '没有找到这篇文献');
    throw new AppError('UPSTREAM_TIMEOUT', '数据源暂时不可用，请稍后重试', { retryable: true });
  }

  const w = oa.data;
  const work = mapDetail(w);
  const openalexId = work.openalexId ?? '';

  const [references, citedBy, related] = await Promise.all([
    hydrateIds(Array.isArray(w.referenced_works) ? w.referenced_works : [], 20),
    openalexId
      ? fetchUpstream<any>(
          `https://api.openalex.org/works?filter=cites:${openalexId}&sort=cited_by_count:desc&per-page=20&${MAILTO}`,
          { source: 'OpenAlex', timeoutMs: 8000 },
        ).then((r) => ((r.data?.results ?? []) as any[]).map(toListItem)).catch(() => [] as WorkListItem[])
      : Promise.resolve([] as WorkListItem[]),
    hydrateIds(Array.isArray(w.related_works) ? w.related_works : [], 10),
  ]);

  // 相似 = related 去掉自身与参考文献重叠，保证 ≥0 且与当前论文不重复（5.5）
  const refSet = new Set(references.map((r) => r.id));
  const similar = related.filter((r) => r.id !== work.id && !refSet.has(r.id));

  const result: WorkDetailResult = {
    work,
    references,
    citedBy,
    similar,
    metricsFetchedAt: new Date().toISOString(),
    providers: ['OpenAlex'],
  };

  try {
    // 防坏缓存：三列表全空且无摘要（上游部分失败的形态）不写 24h 缓存
    const substantial = result.references.length > 0 || result.citedBy.length > 0 || result.similar.length > 0 || Boolean(work.abstract);
    if (work.title && substantial) await l1Put(cacheKey, result, 86_400); // 5.5：24h
  } catch (e) {
    console.warn('work:l1-write-failed', e instanceof Error ? e.message : String(e));
  }
  return result;
}
