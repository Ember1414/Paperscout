import { SEARCH } from '../config';
import { AppError } from '../errors';
import { fetchUpstream } from '../infra/http';
import { canonicalHash, l0Get, l0Put, l1Get, l1Put, l2Get } from '../infra/cache';
import { Semaphore } from '../infra/semaphore';
import { parseQuery, extractDoi } from '../query/parse';
import { expandQuery } from '../query/dict';
import { coolDown, isCoolingDown } from '../infra/cooldown';
import { diversifyByVenue } from '../core/diversify';
import { activeSources, DEFAULT_CORE_SOURCES, SOURCES, truncateByTier } from '../sources/registry';
import { fuseRecords } from '../core/fusion';
import { rankWorks } from '../core/rank';
import {
  appendToPool,
  createPool,
  markOffsets,
  MAX_APPEND_ROUNDS,
  needsMoreRecall,
  slicePage,
  type SearchPool,
} from '../core/pool';
import type { FetchRawFn, RawFetchResult, RawRecord, SourceDef, Work } from '../types';

/**
 * 检索编排器（REBUILD_PLAN 5.1.2 / 5.4 / 7.7）：
 * 解析 → 源选择（能力矩阵+语言/类型规则+9 源上限）→ 并发 6 fan-out
 * （4.5s 软超时 + 6.5s 硬截止）→ 融合 → 过滤 → 重排 → 结果池 → 切片。
 * DOI 意图跳过 fan-out 直查（OpenAlex→Crossref 兜底）。
 * 池存融合后的 Work；追加召回批次独立融合后按 id 去重并入，全池重排（保证跨页排序一致）。
 */

export interface V3SearchParams {
  q: string;
  author?: string;
  src?: string[];
  from?: number;
  to?: number;
  type?: 'all' | 'journal' | 'conference' | 'preprint';
  lang?: 'all' | 'zh' | 'en';
  field?: string;
  sort?: 'smart' | 'relevance' | 'newest' | 'citations';
  page: number;
  limit: number;
}

export interface SourceStatus {
  id: string;
  name: string;
  status: 'ok' | 'timeout' | 'rate_limited' | 'error' | 'skipped';
  ms: number;
  count: number;
}

export interface V3SearchResult {
  items: Work[];
  total: number;
  poolSize: number;
  page: number;
  limit: number;
  hasMore: boolean;
  exhausted: boolean;
  partial: boolean;
  sources: SourceStatus[];
  parsed: { intent: string; lang: string; terms: string[] };
  queryHash: string;
  /** 命中的缓存层（X-Cache 头用）；undefined = miss */
  cacheLayer?: 'l0' | 'l1' | 'l2';
  /** 全部源失败时返回的 L1 旧池（7.7 降级，前端显示提示条） */
  stale?: boolean;
}

export interface OrchestratorDeps {
  /** 测试注入：覆盖参与 fan-out 的源 */
  sourcesOverride?: (SourceDef & { fetchRaw: FetchRawFn })[];
  /** 测试注入：全局硬截止（毫秒） */
  totalBudgetMs?: number;
  /** Workers 运行时注入：KV 绑定（L2 只读）与 waitUntil（L1 写挂靠，A-07） */
  env?: { CACHE?: KVNamespace };
  ctx?: { waitUntil: (p: Promise<unknown>) => void };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- 参数解析（7.5 契约；兼容 v2 参数名） ---------- */

export function parseV3Params(url: URL): V3SearchParams {
  const sp = url.searchParams;
  const q = (sp.get('q') ?? sp.get('query') ?? '').trim();
  const doiParam = (sp.get('doi') ?? '').trim();
  const author = (sp.get('author') ?? '').trim() || undefined;
  if (!q && !doiParam) throw new AppError('BAD_QUERY', '检索式不完整，请补充关键词');
  if (q.length > SEARCH.MAX_QUERY_LENGTH) throw new AppError('BAD_QUERY', `检索词过长（最多 ${SEARCH.MAX_QUERY_LENGTH} 字）`);

  const srcRaw = (sp.get('src') ?? sp.get('sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const validIds = new Set(Object.keys(SOURCES));
  const src = srcRaw.filter((s) => validIds.has(s));

  const from = Number(sp.get('from') ?? sp.get('yearFrom') ?? 0) || undefined;
  const to = Number(sp.get('to') ?? sp.get('yearTo') ?? 0) || undefined;
  if (from && to && from > to) throw new AppError('BAD_PARAM', '起始年份不能晚于结束年份');
  if (from && (from < 1800 || from > 2100)) throw new AppError('BAD_PARAM', '年份不合法（1800..2100）');
  if (to && (to < 1800 || to > 2100)) throw new AppError('BAD_PARAM', '年份不合法（1800..2100）');

  const typeRaw = sp.get('type') ?? sp.get('paperType') ?? 'all';
  if (!['all', 'journal', 'conference', 'preprint'].includes(typeRaw)) throw new AppError('BAD_PARAM', 'type 参数不合法');
  const langRaw = sp.get('lang') ?? sp.get('language') ?? 'all';
  if (!['all', 'zh', 'en'].includes(langRaw)) throw new AppError('BAD_PARAM', 'lang 参数不合法');
  const sortRaw = sp.get('sort') ?? 'smart';
  if (!['smart', 'relevance', 'newest', 'cited', 'citations'].includes(sortRaw)) throw new AppError('BAD_PARAM', 'sort 参数不合法');
  const limit = Number(sp.get('limit') ?? 20);
  if (![20, 50].includes(limit)) throw new AppError('BAD_PARAM', 'limit 仅支持 20 或 50');
  const page = Number(sp.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > SEARCH.MAX_PAGE) throw new AppError('BAD_PARAM', `page 超出范围（1..${SEARCH.MAX_PAGE}），请缩小筛选范围`);

  return {
    q: q || doiParam,
    author,
    src: src.length ? src : undefined,
    from,
    to,
    type: typeRaw as V3SearchParams['type'],
    lang: langRaw as V3SearchParams['lang'],
    field: sp.get('field') ?? undefined,
    sort: (sortRaw === 'cited' ? 'citations' : sortRaw) as V3SearchParams['sort'],
    page,
    limit,
  };
}

/* ---------- 源选择（5.1.2 能力矩阵规则） ---------- */

export function selectSourceDefs(params: V3SearchParams, parsedIntent: string): SourceDef[] {
  if (parsedIntent === 'doi') return [SOURCES.openalex, SOURCES.crossref];
  const requested = (params.src ?? []) as never[];
  let rules: SourceDef[] = params.src?.length
    ? activeSources(requested)
    : activeSources(DEFAULT_CORE_SOURCES);
  const has = (id: string) => rules.some((d) => d.id === id);
  if (params.lang === 'zh') {
    if (!has('openalex')) rules.unshift(SOURCES.openalex);
    if (!has('crossref')) rules.unshift(SOURCES.crossref);
  }
  if (params.type === 'preprint') {
    // 移除仅正式出版的源（5.1.2：type=preprint 时移除 PubMed/DOAJ）
    rules = rules.filter((d) => !['pubmed', 'doaj'].includes(d.id));
  }
  return truncateByTier(rules, SEARCH.MAX_ACTIVE_SOURCES).selected;
}

/* ---------- DOI 直查 ---------- */

async function doiDirect(doi: string): Promise<{ records: RawRecord[]; statuses: SourceStatus[] }> {
  const statuses: SourceStatus[] = [];
  const recs: RawRecord[] = [];
  const clean = doi.toLowerCase().replace(/^https?:\/\/doi\.org\//i, '');
  const oa = await fetchUpstream<any>(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(clean)}`, { source: 'OpenAlex' });
  if (oa.ok && oa.data) {
    recs.push(openalexSingleToRaw(oa.data));
    statuses.push({ id: 'openalex', name: 'OpenAlex', status: 'ok', ms: oa.elapsedMs, count: 1 });
  } else if (!oa.ok) {
    statuses.push({ id: 'openalex', name: 'OpenAlex', status: oa.error?.kind === 'rate_limited' ? 'rate_limited' : 'error', ms: oa.elapsedMs, count: 0 });
    const cr = await fetchUpstream<any>(`https://api.crossref.org/works/${encodeURIComponent(clean)}`, { source: 'Crossref' });
    if (cr.ok && cr.data?.message) {
      recs.push(crossrefSingleToRaw(cr.data.message));
      statuses.push({ id: 'crossref', name: 'Crossref', status: 'ok', ms: cr.elapsedMs, count: 1 });
    } else {
      statuses.push({ id: 'crossref', name: 'Crossref', status: !cr.ok && cr.error?.kind === 'rate_limited' ? 'rate_limited' : 'error', ms: cr.elapsedMs, count: 0 });
    }
  }
  return { records: recs, statuses };
}

function openalexSingleToRaw(w: any): RawRecord {
  const doi = String(w.doi ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined;
  return {
    source: 'openalex' as const, sourceName: 'OpenAlex', fetchedAt: Date.now(),
    title: String(w.display_name ?? ''), authors: (w.authorships ?? []).map((a: any) => a?.author?.display_name).filter(Boolean).slice(0, 25),
    year: w.publication_year ?? undefined, venue: w.primary_location?.source?.display_name ?? undefined,
    abstract: undefined, doi, url: w.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : ''),
    pdfUrl: w.best_oa_location?.pdf_url || undefined, citations: w.cited_by_count ?? 0,
    type: w.type === 'preprint' ? 'preprint' : 'journal', openAccess: w.open_access?.is_oa === true ? true : undefined,
    nativeId: typeof w.id === 'string' ? w.id.split('/').pop() : undefined,
  };
}

function crossrefSingleToRaw(it: any): RawRecord {
  const year = it.issued?.['date-parts']?.[0]?.[0];
  return {
    source: 'crossref' as const, sourceName: 'Crossref', fetchedAt: Date.now(),
    title: String(it.title?.[0] ?? ''), authors: (it.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 25),
    year: typeof year === 'number' ? year : undefined, venue: it['container-title']?.[0] ?? undefined,
    doi: String(it.DOI ?? '').toLowerCase() || undefined, url: it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : ''),
    citations: it['is-referenced-by-count'] ?? 0,
    type: it.type === 'proceedings-article' ? 'conference' : it.type === 'posted-content' ? 'preprint' : 'journal',
    openAccess: (it.link ?? []).some((l: any) => l['content-type'] === 'application/pdf') ? true : undefined,
  };
}

/* ---------- 编排主流程 ---------- */

function mapStatus(kind: string | undefined): SourceStatus['status'] {
  if (!kind) return 'ok';
  if (kind === 'timeout') return 'timeout';
  if (kind === 'rate_limited') return 'rate_limited';
  return 'error';
}

export async function runSearch(params: V3SearchParams, deps: OrchestratorDeps = {}): Promise<V3SearchResult> {
  const parsed = parseQuery(params.q);
  // M2-14 查询扩展：中英互译（打分词并入 + zh 召回后缀仅给声明支持的源）
  const expansion = expandQuery(params.q, parsed.terms, parsed.cjkWhole);
  const scoredParsed = expansion.scoreTerms.length ? { ...parsed, terms: [...parsed.terms, ...expansion.scoreTerms] } : parsed;
  const recallSuffix = expansion.recallSuffix; // 语言过滤由 applyFilters 负责：lang=zh 只看中文，lang=all（默认）下英文扩展词生效
  const t0 = Date.now();
  const totalBudget = deps.totalBudgetMs ?? SEARCH.TOTAL_BUDGET_MS;
  const sort = params.sort ?? 'smart';
  const typeFilter = params.type ?? 'all';
  const langFilter = params.lang ?? 'all';

  const applyFilters = (works: Work[]): Work[] =>
    works.filter((w) => {
      if (parsed.excluded.length && parsed.excluded.some((e) => w.title.toLowerCase().includes(e))) return false;
      if (langFilter === 'zh' && w.lang !== 'zh') return false;
      if (langFilter === 'en' && w.lang !== 'en') return false;
      if (typeFilter !== 'all' && w.type !== typeFilter) return false; // A-04：严格过滤，未知类型不出现
      return true;
    });

  const hashInput = { q: params.q, author: parsed.fieldTags.find((t) => t.key === 'author')?.value, src: params.src, from: params.from, to: params.to, type: params.type, lang: params.lang, field: params.field, sort: params.sort };
  const queryHash = canonicalHash(hashInput);
  const cacheKey = `pool:${queryHash}`;
  const meta = (partial: boolean): Pick<V3SearchResult, 'parsed' | 'queryHash' | 'partial'> => ({
    parsed: { intent: parsed.intent, lang: parsed.lang, terms: parsed.terms },
    queryHash,
    partial,
  });

  // 缓存读取：L0(60s) → L1 Cache API(600s) → L2 KV（在线只读，仅 Warmer 预热写入）（7.6）
  let cached = l0Get<SearchPool>(cacheKey);
  if (!cached.value) cached = await l1Get<SearchPool>(queryHash);
  if (!cached.value) cached = await l2Get<SearchPool>(deps.env?.CACHE, cacheKey);
  if (cached.value && !isPool(cached.value)) cached = { value: undefined, layer: undefined };
  if (cached.value) {
    // 命中：跳过 fan-out，直接切片（page/limit 不进 hash，A-08）
    const pool = cached.value;
    const slice = slicePage(pool, params.page, params.limit, pool.exhausted ?? true);
    return {
      items: slice.items, total: slice.items.length, poolSize: pool.items.length,
      page: params.page, limit: params.limit, hasMore: slice.hasMore, exhausted: slice.exhausted,
      cacheLayer: cached.layer, sources: [], ...meta(false),
    };
  }

  // DOI 意图：跳过 fan-out（5.1.2）
  if (parsed.intent === 'doi') {
    const doi = extractDoi(params.q) ?? params.q.trim();
    const { records, statuses } = await doiDirect(doi);
    if (!records.length) {
      if (statuses.every((s) => s.status !== 'ok')) throw new AppError('UPSTREAM_TIMEOUT', 'DOI 查询的数据源暂时不可用，请稍后重试', { retryable: true });
      return { items: [], total: 0, poolSize: 0, page: params.page, limit: params.limit, hasMore: false, exhausted: true, sources: statuses, ...meta(false) };
    }
    const works = rankWorks(applyFilters(fuseRecords(records)), scoredParsed, sort);
    return {
      items: works, total: works.length, poolSize: works.length, page: 1, limit: params.limit,
      hasMore: false, exhausted: true, sources: statuses, ...meta(false),
    };
  }

  // 参与源
  const defs = deps.sourcesOverride ?? (selectSourceDefs(params, parsed.intent) as (SourceDef & { fetchRaw: FetchRawFn })[]);
  const usable = defs.filter((d) => typeof d.fetchRaw === 'function') as (SourceDef & { fetchRaw: FetchRawFn })[];
  if (!usable.length) throw new AppError('ALL_SOURCES_FAILED', '数据源暂时都不可用', { retryable: true });

  // M2-14：DSL 字段标签落到源参数（author:/year:；parse 已产出 fieldTags）
  const authorTag = parsed.fieldTags.find((t) => t.key === 'author')?.value;
  const yearTag = parsed.fieldTags.find((t) => t.key === 'year')?.value ?? '';
  const yearPair = yearTag.match(/^(d{4})(?:-(d{4}))?$/);
  const effectiveAuthor = params.author ?? authorTag;
  const effectiveFrom = params.from ?? (yearPair ? Number(yearPair[1]) : undefined);
  const effectiveTo = params.to ?? (yearPair ? Number(yearPair[2] ?? yearPair[1]) : undefined);

  const searchParams = {
    ...params,
    query: parsed.cleanQuery || effectiveAuthor || params.q,
    sources: usable.map((d) => d.id),
    language: (params.lang ?? 'all') as 'all' | 'zh' | 'en',
    paperType: (params.type ?? 'all') as 'all' | 'journal' | 'conference' | 'preprint',
    sort: (params.sort ?? 'smart') as 'smart' | 'relevance' | 'newest' | 'citations',
    author: effectiveAuthor,
    yearFrom: effectiveFrom,
    yearTo: effectiveTo,
    page: 1,
  };

  const statuses: Record<string, SourceStatus> = {};
  const offsets: Record<string, number> = {};
  const collected: RawRecord[] = [];
  const semaphore = new Semaphore(SEARCH.MAX_CONCURRENCY);
  const deadline = t0 + totalBudget;
  let timedOut = false;

  const recallRound = async (baseOffsets: Record<string, number>): Promise<void> => {
    const tasks = usable.map(async (def) => {
      if (isCoolingDown(def.id)) {
        statuses[def.id] = { id: def.id, name: def.name, status: 'skipped', ms: 0, count: 0 };
        return;
      }
      const offset = baseOffsets[def.id] ?? 0;
      const startedAt = Date.now();
      let result: RawFetchResult;
      try {
        result = await semaphore.run(() => def.fetchRaw(searchParams, { limit: SEARCH.PER_SOURCE_LIMIT, offset, querySuffix: recallSuffix }));
      } catch {
        // fetchRaw 契约不抛；防御性兜底仍须记录（1.5 禁止静默）
        statuses[def.id] = { id: def.id, name: def.name, status: 'error', ms: Date.now() - startedAt, count: 0 };
        return;
      }
      const ms = Date.now() - startedAt;
      if (!statuses[def.id] || statuses[def.id].status === 'timeout') {
        statuses[def.id] = {
          id: def.id, name: def.name,
          status: result.error ? mapStatus(result.error.kind) : 'ok',
          ms, count: result.records.length,
        };
      }
      // M2-15：429 → 本 isolate 内冷却 60s（不写 KV；追加轮直接跳过冷却中的源）
      if (result.error?.kind === 'rate_limited') coolDown(def.id);
      collected.push(...result.records);
      offsets[def.id] = offset + SEARCH.PER_SOURCE_LIMIT;
    });
    // 全局硬截止（7.7）：超时后未返回的源记 timeout，已得结果照常返回
    await Promise.race([
      Promise.all(tasks),
      sleep(totalBudget).then(() => {
        timedOut = true;
        for (const d of usable) if (!statuses[d.id]) statuses[d.id] = { id: d.id, name: d.name, status: 'timeout', ms: totalBudget, count: 0 };
      }),
    ]);
  };

  // 首轮召回
  await recallRound(offsets);
  // 全部源失败且无任何结果 → 503（7.7；L1/L2 旧结果兜底在 M1-09 接入）
  if (!collected.length && statuses && !Object.values(statuses).some((s) => s.status === 'ok')) {
    // 7.7 全部源失败：有 L1 旧池 → 返回旧结果 + stale 标记；否则 503
    const stale = await l1Get<SearchPool>(queryHash);
    if (stale.value?.items?.length) {
      const sp = slicePage(stale.value, params.page, params.limit, stale.value.exhausted ?? true);
      return {
        items: sp.items, total: sp.items.length, poolSize: stale.value.items.length,
        page: params.page, limit: params.limit, hasMore: sp.hasMore, exhausted: sp.exhausted,
        stale: true, cacheLayer: 'l1', sources: Object.values(statuses), ...meta(true),
      };
    }
    throw new AppError('ALL_SOURCES_FAILED', '数据源暂时都不可用', { retryable: true });
  }
  let ranked0 = rankWorks(applyFilters(fuseRecords(collected)), scoredParsed, sort);
  if (sort === 'smart') ranked0 = diversifyByVenue(ranked0, { maxInARow: 2 }); // M2-15 多样性：同 venue 连续 ≤2
  let poolItems = ranked0;
  let pool: SearchPool = { ...createPool(queryHash, poolItems), offsets: { ...offsets } };

  // 追加召回（池不足且未耗尽，最多 3 轮；召回原始记录独立融合后并入，全池重排保证跨页一致）
  const anyFullPage = () => usable.some((d) => (statuses[d.id]?.count ?? 0) >= SEARCH.PER_SOURCE_LIMIT);
  let rounds = 0;
  if (anyFullPage() && Date.now() < deadline) {
    while (
      rounds < MAX_APPEND_ROUNDS &&
      pool.items.length < SEARCH.POOL_TARGET &&
      Date.now() < deadline
    ) {
      rounds++;
      const before = collected.length;
      await recallRound(offsets);
      const fresh = collected.slice(before);
      if (!fresh.length) break;
      const fusedBatch = rankWorks(applyFilters(fuseRecords(fresh)), scoredParsed, sort);
      pool = markOffsets(appendToPool(pool, fusedBatch), offsets);
      pool.items = sort === 'smart' ? diversifyByVenue(rankWorks(pool.items, scoredParsed, sort), { maxInARow: 2 }) : rankWorks(pool.items, scoredParsed, sort);
    }
  }

  // 池上限兜底（≤ POOL_TARGET）
  pool.items = pool.items.slice(0, SEARCH.POOL_TARGET);

  // exhausted：上游无更多（无源满页）或追加轮次用尽或池已满
  const exhausted = !anyFullPage() || rounds >= MAX_APPEND_ROUNDS || pool.items.length >= SEARCH.POOL_TARGET;

  pool.exhausted = exhausted;
  // 7.6：禁止缓存空结果——空池仅 L0 防抖 60s，防上游瞬断被放大
  if (pool.items.length === 0) {
    l0Put(`pool:${queryHash}`, pool, SEARCH.EMPTY_RESULT_TTL_S);
  } else {
    l0Put(`pool:${queryHash}`, pool, SEARCH.CACHE_TTL_S);
    if (deps.ctx) {
      deps.ctx.waitUntil(l1Put(queryHash, pool)); // A-07：写入挂 waitUntil，防 isolate 回收丢缓存
    }
  }

  const slice = slicePage(pool, params.page, params.limit, exhausted);
  const statusList = usable.map((d) => statuses[d.id] ?? { id: d.id, name: d.name, status: 'skipped' as const, ms: 0, count: 0 });
  return {
    items: slice.items,
    total: slice.items.length,
    poolSize: pool.items.length,
    page: params.page,
    limit: params.limit,
    hasMore: slice.hasMore,
    exhausted,
    sources: statusList,
    ...meta(timedOut || statusList.some((s) => s.status === 'timeout' || s.status === 'rate_limited' || s.status === 'error')),
  };
}

/** 池结构校验（防缓存坏数据） */
function isPool(p: unknown): p is SearchPool {
  const v = p as SearchPool;
  return Boolean(v && Array.isArray(v.items) && typeof v.key === 'string');
}
