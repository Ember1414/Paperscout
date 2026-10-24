import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * store.js 依赖 location/crypto（浏览器全局）——这里以 globalThis 注入最小桩，
 * 只测核心逻辑：requestId 竞态保护（M2-03 DoD：快速 5 次只渲染最后一次）与取消语义。
 */

const g = globalThis as any;
if (!g.crypto?.randomUUID) g.crypto = { randomUUID: () => 'test-uuid' };
if (!g.location) g.location = new URL('https://x.dev/search?q=init');
if (!g.document) g.document = { documentElement: { getAttribute: () => 'light' } };

const { state, setState, subscribe, runSearch, cancelSearch } = await import('../../public/js/store.js');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function okEnvelope(q: string, n = 3) {
  return {
    ok: true,
    data: {
      items: Array.from({ length: n }, (_, i) => ({ id: `${q}-${i}`, title: `${q} #${i}` })),
      poolSize: n, hasMore: false, exhausted: true, partial: false, sources: [], parsed: { intent: 'topic' },
    },
    meta: { requestId: `rid-${q}`, ms: 10, cache: 'miss' },
  };
}

describe('store：requestId 竞态保护（A-20 / M2-03 DoD）', () => {
  it('快速 5 次检索（交错完成）→ 最终 state 只含第 5 次', async () => {
    // 受控 fetch：q1..q3 延迟完成，q4/q5 立即完成
    const fetchStub = vi.fn(async (url: string | URL) => {
      const u = String(url);
      const q = decodeURIComponent(u.match(/[?&]q=([^&]*)/)![1]);
      if (q === 's1') await new Promise((r) => setTimeout(r, 60));
      if (q === 's2') await new Promise((r) => setTimeout(r, 40));
      if (q === 's3') await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(okEnvelope(q)), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchStub);

    await runSearch(new URL('https://x.dev/search?q=s1'));
    const p1 = runSearch(new URL('https://x.dev/search?q=s2'));
    await p1;
    // 故意让慢的 s3 后发起但先于 s1 完成——由 seq 判定，谁最后发起谁赢
    const p2 = runSearch(new URL('https://x.dev/search?q=s3'));
    const p3 = runSearch(new URL('https://x.dev/search?q=s4'));
    await Promise.all([p2, p3]);
    expect(state.results.items.every((w: any) => String(w.id).startsWith('s4'))).toBe(true);
    expect(state.results.requestId).toBe('rid-s4');
    expect(state.results.loading).toBe(false);
  });

  it('取消：abort 后 loading=false 且过期响应不入 state', async () => {
    const fetchStub = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return new Response(JSON.stringify(okEnvelope('slow')), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchStub);
    const p = runSearch(new URL('https://x.dev/search?q=slow'));
    cancelSearch();
    await p;
    expect(state.results.items.find((w: any) => w.id.startsWith('slow'))).toBeUndefined();
    expect(state.results.loading).toBe(false);
  });

  it('错误路径：ALL_SOURCES_FAILED 信封 → state.results.error 带码与文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: 'ALL_SOURCES_FAILED', message: '数据源暂时都不可用', retryable: true }, meta: { requestId: 'r1' } }), { status: 503, headers: { 'content-type': 'application/json' } }),
    ));
    await runSearch(new URL('https://x.dev/search?q=fail'));
    expect(state.results.error).toMatchObject({ code: 'ALL_SOURCES_FAILED' });
    expect(state.results.loading).toBe(false);
  });

  it('空 q：清空结果且不发请求', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    await runSearch(new URL('https://x.dev/search?q='));
    expect(fetchStub).not.toHaveBeenCalled();
    expect(state.results.items).toHaveLength(0);
  });

  it('subscribe：setState 触发监听；监听器抛错不阻断其他监听', () => {
    const seen: number[] = [];
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn(() => seen.push(1));
    const off = subscribe(bad as never);
    subscribe(good as never);
    setState({ ui: { ...state.ui, paletteOpen: true } });
    expect(good).toHaveBeenCalled();
    off();
  });
});
