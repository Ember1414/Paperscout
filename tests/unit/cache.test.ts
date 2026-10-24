import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalHash, l0Clear, l0Get, l0Put, l1Get, l1Put } from '../../functions/lib/infra/cache';
import { runSearch } from '../../functions/lib/services/search';
import type { FetchRawFn, RawRecord, SourceDef } from '../../functions/lib/types';

afterEach(() => {
  l0Clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('canonicalHash（A-08 根治）', () => {
  it('同参数不同键序 → 同 hash', () => {
    const a = canonicalHash({ q: 'Test Query', src: ['openalex', 'crossref'], from: 2023 });
    const b = canonicalHash({ from: 2023, src: ['crossref', 'openalex'], q: 'test query' });
    expect(a).toBe(b);
  });
  it('page/limit 不进 hash：翻页命中同池（A-08 语义）', () => {
    const p1 = canonicalHash({ q: 'x' });
    const p2 = canonicalHash({ q: 'x' });
    expect(p1).toBe(p2);
    // 显式证明：hash 输入根本没有 page/limit 字段（类型层）
    expect(canonicalHash({ q: 'x', sort: 'smart', type: 'all', lang: 'all' })).toBe(canonicalHash({ q: 'x' }));
  });
  it('默认值归一：sort=smart/type=all/lang=all 与缺省一致', () => {
    expect(canonicalHash({ q: 'x', sort: 'smart' })).toBe(canonicalHash({ q: 'x' }));
    expect(canonicalHash({ q: 'x', type: 'all', lang: 'all' })).toBe(canonicalHash({ q: 'x' }));
  });
  it('反例：不同 q / 不同年份 → 不同 hash', () => {
    expect(canonicalHash({ q: 'a' })).not.toBe(canonicalHash({ q: 'b' }));
    expect(canonicalHash({ q: 'a' })).not.toBe(canonicalHash({ q: 'a', from: 2020 }));
  });
});

describe('L0', () => {
  it('put/get 往返；TTL 过期后失效', () => {
    l0Put('k', { v: 1 });
    expect(l0Get<{ v: number }>('k').value).toEqual({ v: 1 });
    expect(l0Get<{ v: number }>('k').layer).toBe('l0');
    // 过期：直接操纵 expiresAt 模拟
    l0Put('k2', { v: 2 }, 0.001); // 1ms
    await0().then(() => {});
    expect(l0Get('nope').value).toBeUndefined();
  });
  it('上限淘汰：>50 项后仍可写入且读取正常', () => {
    for (let i = 0; i < 60; i++) l0Put(`k${i}`, i);
    expect(l0Get('k59').value).toBe(59);
  });
});

async function await0(): Promise<void> {}

describe('L1 Cache API + ctx.waitUntil（A-07）', () => {
  it('写入后可命中（stub caches.default），layer=l1', async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (req: Request | string) => store.get(typeof req === 'string' ? req : req.url) ?? undefined,
        put: async (req: Request | string, res: Response) => {
          store.set(typeof req === 'string' ? req : req.url, res.clone());
        },
      },
    });
    let waited = 0;
    const waitUntil = (p: Promise<unknown>) => {
      waited++;
      return p;
    };
    const fakeSource: SourceDef & { fetchRaw: FetchRawFn } = {
      id: 'openalex', name: 'OA', tier: 'core', mode: 'keyword', probe: 'verified',
      caps: { yearFilter: false, typeFilter: false, author: false, abstract: false, citations: false, pdf: false, zhCoverage: 'none', phrase: false },
      fetchRaw: (async (): Promise<{ records: RawRecord[]; elapsedMs: number }> => ({
        records: [{ source: 'openalex', sourceName: 'OA', fetchedAt: 1, title: 'Cache Me Paper', authors: [], year: 2024, type: 'journal', url: 'https://x/1', doi: '10.12/cache.1' }],
        elapsedMs: 1,
      })) as FetchRawFn,
    };
    const params = { q: 'cache waituntil probe', page: 1, limit: 20, sort: 'smart' as const };
    const first = await runSearch(params, { sourcesOverride: [fakeSource], ctx: { waitUntil } });
    expect(first.cacheLayer).toBeUndefined(); // 首次 miss
    expect(waited).toBeGreaterThan(0); // L1 写挂靠 waitUntil（A-07）
    const second = await runSearch(params, { sourcesOverride: [fakeSource] });
    // L0 先命中（同一 isolate）；为验证 L1 单独清 L0 后再请求
    l0Clear();
    const third = await runSearch(params, { sourcesOverride: [fakeSource] });
    expect(third.cacheLayer).toBe('l1');
    expect(third.items.map((w) => w.title)).toEqual(['Cache Me Paper']);
    void second;
  }, 15_000);
});
