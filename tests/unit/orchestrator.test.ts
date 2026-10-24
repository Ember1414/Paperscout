import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSearch, selectSourceDefs, parseV3Params } from '../../functions/lib/services/search';
import { l0Clear } from '../../functions/lib/infra/cache';
import type { FetchRawFn, RawRecord, SearchParams, SourceDef } from '../../functions/lib/types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const okDef = (id: string, n: number, delayMs = 0): SourceDef & { fetchRaw: FetchRawFn } => ({
  id: id as never,
  name: id.toUpperCase(),
  tier: 'core',
  mode: 'keyword',
  probe: 'verified',
  caps: { yearFilter: false, typeFilter: false, author: false, abstract: false, citations: false, pdf: false, zhCoverage: 'none', phrase: false },
  fetchRaw: (async (params: SearchParams, opts): Promise<RawFetchResultAlias> => {
    if (delayMs) await sleep(delayMs);
    return {
      records: Array.from({ length: n }, (_, i) => ({
        source: id as never,
        sourceName: id.toUpperCase(),
        fetchedAt: Date.now(),
        title: `${id} paper ${opts?.offset ?? 0}-${i}`,
        authors: [],
        year: 2024,
        doi: `10.${id.length}${id.charCodeAt(0) % 97}.t${(opts?.offset ?? 0)}.${i}`,
        url: `https://example.org/${id}/${i}`,
        type: 'journal' as const,
        citations: n - i,
      })),
      elapsedMs: delayMs,
    };
  }) as FetchRawFn,
});

type RawFetchResultAlias = { records: RawRecord[]; elapsedMs: number };

const slowDef = (id: string, delayMs: number): SourceDef & { fetchRaw: FetchRawFn } => ({
  ...okDef(id, 3),
  fetchRaw: (async (): Promise<RawFetchResultAlias> => {
    await sleep(delayMs);
    return { records: [], elapsedMs: delayMs };
  }) as FetchRawFn,
});

const failDef = (id: string, kind: 'rate_limited' | 'http'): SourceDef & { fetchRaw: FetchRawFn } => ({
  ...okDef(id, 1),
  fetchRaw: (async (): Promise<RawFetchResultAlias> => ({ records: [], elapsedMs: 5, error: { kind, message: `${id} ${kind}` } })) as FetchRawFn,
});

afterEach(() => {
  vi.restoreAllMocks();
  l0Clear(); // L0 缓存模块级共享，清掉避免用例间串池
});

const baseParams = { q: 'test query', page: 1, limit: 20, sort: 'smart' as const };

describe('编排器（M1-08 DoD）', () => {
  it('mock 超时源：仍返回其余源结果且 partial=true、该源 status=timeout', async () => {
    const result = await runSearch(
      { ...baseParams, q: 'timeout probe q', limit: 20 },
      { sourcesOverride: [okDef('openalex', 5), slowDef('slow', 1500)], totalBudgetMs: 300 },
    );
    expect(result.items.length).toBeGreaterThan(0); // 其余源照常返回
    expect(result.partial).toBe(true);
    const slow = result.sources.find((s) => s.id === 'slow');
    expect(slow?.status).toBe('timeout');
    const ok = result.sources.find((s) => s.id === 'openalex');
    expect(ok?.status).toBe('ok');
    expect(ok?.count).toBe(5);
  }, 10_000);

  it('全部源失败 → ALL_SOURCES_FAILED（AppError）', async () => {
    await expect(
      runSearch({ ...baseParams, q: 'all fail q' }, { sourcesOverride: [failDef('a', 'http'), failDef('b', 'rate_limited')], totalBudgetMs: 500 }),
    ).rejects.toMatchObject({ code: 'ALL_SOURCES_FAILED' });
  });

  it('单源 429/失败：其余源正常，partial=true 不抛异常（7.7 降级）', async () => {
    const result = await runSearch({ ...baseParams, q: 'partial degrade q' }, { sourcesOverride: [okDef('openalex', 4), failDef('bad', 'rate_limited')] });
    expect(result.items).toHaveLength(4);
    expect(result.partial).toBe(true);
    expect(result.sources.find((s) => s.id === 'bad')?.status).toBe('rate_limited');
  });

  it('DOI 意图走直查（mock fetch），单条结果', async () => {
    const workJson = {
      id: 'https://openalex.org/W123',
      doi: 'https://doi.org/10.1038/test.1',
      display_name: 'A Direct DOI Paper',
      publication_year: 2023,
      cited_by_count: 42,
      type: 'article',
      open_access: { is_oa: true },
      primary_location: { landing_page_url: 'https://www.nature.com/x', source: { display_name: 'Nature', type: 'journal' } },
      authorships: [{ author: { display_name: 'A Author' } }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(workJson), { status: 200, headers: { 'content-type': 'application/json' } })));
    const result = await runSearch({ ...baseParams, q: '10.1038/test.1' });
    expect(result.parsed.intent).toBe('doi');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('A Direct DOI Paper');
    expect(result.items[0].confidence).toBe('B'); // 单源 DOI
  }, 15_000);

  it('分页：池切片且页间互斥（A-02 语义）', async () => {
    const mk = () => [okDef('openalex', 50), okDef('crossref', 50), okDef('arxiv', 50), okDef('europepmc', 50)];
    const p1 = await runSearch({ ...baseParams, page: 1, limit: 20 }, { sourcesOverride: mk(), totalBudgetMs: 5000 });
    // 用相同 override 重建（L0 缓存 key 相同会命中——验证缓存命中后翻页一致性）
    const p2 = await runSearch({ ...baseParams, page: 2, limit: 20 }, { sourcesOverride: mk(), totalBudgetMs: 5000 });
    const ids1 = new Set(p1.items.map((w) => w.id));
    const ids2 = new Set(p2.items.map((w) => w.id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false); // 无重复
    expect(p2.page).toBe(2);
  }, 20_000);

  it('类型过滤：type=conference 严格排除预印本与其他（A-04）', async () => {
    const mixed: SourceDef & { fetchRaw: FetchRawFn } = {
      ...okDef('openalex', 3),
      fetchRaw: (async (): Promise<RawFetchResultAlias> => ({
        records: [
          { source: 'openalex', sourceName: 'OA', fetchedAt: 1, title: 'Conf paper A', authors: [], year: 2024, type: 'conference', url: 'https://x/1' },
          { source: 'openalex', sourceName: 'OA', fetchedAt: 1, title: 'Journal paper B', authors: [], year: 2024, type: 'journal', url: 'https://x/2' },
          { source: 'openalex', sourceName: 'OA', fetchedAt: 1, title: 'Preprint C', authors: [], year: 2024, type: 'preprint', url: 'https://x/3' },
          { source: 'openalex', sourceName: 'OA', fetchedAt: 1, title: 'Unknown type D', authors: [], year: 2024, url: 'https://x/4' },
        ],
        elapsedMs: 1,
      })) as FetchRawFn,
    };
    const result = await runSearch({ ...baseParams, q: 'type filter q', type: 'conference' }, { sourcesOverride: [mixed] });
    expect(result.items.map((w) => w.title)).toEqual(['Conf paper A']);
  });

  it('排除词：-survey 过滤标题含 survey 的结果', async () => {
    const mixed: SourceDef & { fetchRaw: FetchRawFn } = {
      ...okDef('openalex', 2),
      fetchRaw: (async (): Promise<RawFetchResultAlias> => ({
        records: [
          { source: 'openalex', sourceName: 'OA', fetchedAt: 1, title: 'GNN Survey', authors: [], year: 2024, type: 'journal', url: 'https://x/1' },
          { source: 'openalex', sourceName: 'OA', fetchedAt: 1, title: 'GNN Methods', authors: [], year: 2024, type: 'journal', url: 'https://x/2' },
        ],
        elapsedMs: 1,
      })) as FetchRawFn,
    };
    const result = await runSearch({ ...baseParams, q: 'GNN -survey' }, { sourcesOverride: [mixed] });
    expect(result.items.map((w) => w.title)).toEqual(['GNN Methods']);
  });

  it('9 源上限与档位截断（selectSourceDefs）', () => {
    const defs = selectSourceDefs({ ...baseParams, src: ['openalex', 'crossref', 'arxiv', 'semanticscholar', 'pubmed', 'dblp', 'doaj', 'hal', 'zenodo', 'openaire', 'datacite'] }, 'topic');
    expect(defs.length).toBeLessThanOrEqual(9);
    // dbbl 外链状态不会通过 activeSources 进入
    expect(defs.map((d) => d.id)).not.toContain('dblp');
  });

  it('参数校验：超长 q、page>10、非法 limit、缺 q', () => {
    const long = 'x'.repeat(201);
    const url = (qs: string) => new URL(`https://x/api/search?${qs}`);
    expect(() => parseV3Params(url(`q=${long}`))).toThrow();
    expect(() => parseV3Params(url('q=test&page=11'))).toThrow();
    expect(() => parseV3Params(url('q=test&limit=30'))).toThrow();
    expect(() => parseV3Params(url('a=b'))).toThrow();
    expect(() => parseV3Params(url("q='; DROP TABLE x;--"))).not.toThrow(); // 注入串合法（当普通文本）
  });
});
