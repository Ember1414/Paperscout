import { describe, expect, it } from 'vitest';
import { paramsFromUrl, queryFromParams, searchUrl, toApiQuery, SEARCH_DEFAULTS } from '../../public/js/url.js';

const url = (s: string) => new URL(`https://paperscout.pages.dev${s}`);

describe('paramsFromUrl（4.2 契约）', () => {
  it('正例：完整参数解析', () => {
    const p = paramsFromUrl(url('/search?q=gnn&src=openalex,crossref&from=2023&to=2026&type=conference&lang=zh&sort=cited&page=2&limit=50&view=table&sel=doi%3Ax.1'));
    expect(p).toMatchObject({ q: 'gnn', src: ['openalex', 'crossref'], from: 2023, to: 2026, type: 'conference', lang: 'zh', sort: 'cited', page: 2, limit: 50, view: 'table', sel: 'doi:x.1' });
  });
  it('默认值：无参数时回默认', () => {
    const p = paramsFromUrl(url('/search?q=test'));
    expect(p).toMatchObject({ type: 'all', lang: 'all', sort: 'smart', page: 1, limit: 20, view: 'list', src: [] });
  });
  it('边界：非法值回退默认（宽容解析）', () => {
    const p = paramsFromUrl(url('/search?q=x&page=99&limit=33&sort=bogus&view=grid&from=1700&type=thesis'));
    expect(p.page).toBe(1);
    expect(p.limit).toBe(20);
    expect(p.sort).toBe('smart');
    expect(p.view).toBe('list');
    expect(p.from).toBeUndefined();
    expect(p.type).toBe('all');
  });
  it('边界：q 截断 200 字', () => {
    const p = paramsFromUrl(url(`/search?q=${'x'.repeat(300)}`));
    expect(p.q).toHaveLength(200);
  });
});

describe('queryFromParams（默认值省略 → 链接短）', () => {
  it('正例：默认值不进 URL', () => {
    const q = queryFromParams({ ...SEARCH_DEFAULTS, q: 'test', src: [], from: undefined, to: undefined, field: '', sel: '' } as never);
    expect(q).toBe('?q=test');
  });
  it('正例：非默认值全部保留', () => {
    const q = queryFromParams({ q: 'x', src: ['openalex'], from: 2023, to: 2026, type: 'journal', lang: 'zh', field: 'cs', sort: 'newest', page: 3, limit: 50, view: 'compact', sel: 'doi:a' } as never);
    expect(q).toContain('q=x');
    expect(q).toContain('src=openalex');
    expect(q).toContain('from=2023');
    expect(q).toContain('type=journal');
    expect(q).toContain('view=compact');
    expect(q).toContain('sel=doi%3Aa');
  });
  it('往返保真：url → params → url 一致', () => {
    const u = url('/search?q=%E5%A4%A7%E8%AF%AD%E8%A8%80%E6%A8%A1%E5%9E%8B&lang=zh&from=2023&sort=cited&page=2');
    const p = paramsFromUrl(u);
    const again = paramsFromUrl(url(`/search${queryFromParams(p)}`));
    expect(again).toEqual(p);
  });
});

describe('searchUrl / toApiQuery', () => {
  it('searchUrl 生成 /search?…', () => {
    expect(searchUrl({ q: 'gnn' })).toBe('/search?q=gnn');
    expect(searchUrl({ q: 'gnn', type: 'conference' })).toBe('/search?q=gnn&type=conference');
  });
  it('toApiQuery：默认值不发送', () => {
    const q = toApiQuery({ q: 'x', src: [], type: 'all', lang: 'all', field: '', sort: 'smart', page: 1, limit: 20, from: undefined, to: undefined, view: 'list', sel: '' } as never);
    expect(q).toEqual({ q: 'x', page: '1', limit: '20' });
  });
  it('toApiQuery：非默认值发送且 sort=cited 直传', () => {
    const q = toApiQuery({ q: 'x', src: ['openalex', 'crossref'], type: 'preprint', lang: 'zh', field: '', sort: 'cited', page: 2, limit: 50, from: 2023, to: undefined, view: 'list', sel: '' } as never);
    expect(q).toMatchObject({ src: 'openalex,crossref', type: 'preprint', lang: 'zh', sort: 'cited', page: '2', limit: '50', from: '2023' });
  });
});
