import { afterEach, describe, expect, it, vi } from 'vitest';
import { openalex } from '../../functions/lib/sources/openalex';
import type { SearchParams } from '../../functions/lib/types';

/** M0-07：所有 OpenAlex 请求必须带礼貌池 mailto（A-24 修复的回归防护） */
describe('OpenAlex 礼貌池接入（M0-07）', () => {
  afterEach(() => vi.unstubAllGlobals());

  const baseParams = (): SearchParams => ({
    query: 'graph neural network',
    sources: ['openalex'],
    limit: 20,
    page: 1,
    sort: 'smart',
    language: 'all',
    paperType: 'all',
  });

  function stubFetch() {
    const calls: { url: string; ua?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), ua: (init?.headers as Record<string, string>)?.['User-Agent'] });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }));
    return calls;
  }

  it('正例：请求 URL 携带 mailto=owner 邮箱', async () => {
    const calls = stubFetch();
    await openalex.search(baseParams());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('mailto=2669788267%40qq.com');
  });

  it('正例：User-Agent 为 3.0 规范格式（5.1.3），含站点与 mailto', async () => {
    const calls = stubFetch();
    await openalex.search(baseParams());
    expect(calls[0].ua).toMatch(/^PaperScout\/3\.0 \(\+https?:\/\/\S+; mailto:2669788267@qq\.com\)$/);
  });

  it('边界：翻页与年份过滤时 mailto 仍在', async () => {
    const calls = stubFetch();
    await openalex.search({ ...baseParams(), page: 3, yearFrom: 2023, yearTo: 2026 });
    expect(calls[0].url).toContain('page=3');
    expect(calls[0].url).toContain('mailto=2669788267%40qq.com');
  });

  it('边界：作者/类型过滤时 mailto 仍在', async () => {
    const calls = stubFetch();
    await openalex.search({ ...baseParams(), author: 'bengio', paperType: 'preprint' });
    expect(calls[0].url).toContain('raw_author_name.search');
    expect(calls[0].url).toContain('type%3Apreprint'); // filter 经 URLSearchParams 编码
    expect(calls[0].url).toContain('mailto=2669788267%40qq.com');
  });

  it('反例：不得回退到占位邮箱 paperscout@example.com', async () => {
    const calls = stubFetch();
    await openalex.search(baseParams());
    expect(calls[0].url).not.toContain('example.com');
    expect(calls[0].ua).not.toContain('example.com');
  });
});
