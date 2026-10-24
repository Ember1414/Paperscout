import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRaw as openalexRaw } from '../../functions/lib/sources/openalex';
import { fetchRaw as crossrefRaw } from '../../functions/lib/sources/crossref';
import { fetchRaw as arxivRaw } from '../../functions/lib/sources/arxiv';
import { fetchRaw as s2Raw } from '../../functions/lib/sources/semanticscholar';
import { fetchRaw as pubmedRaw } from '../../functions/lib/sources/pubmed';
import { fetchRaw as dblpRaw } from '../../functions/lib/sources/dblp';
import { SOURCES, activeSources, truncateByTier } from '../../functions/lib/sources/registry';
import type { SearchParams } from '../../functions/lib/types';

const FIX = (name: string) => readFileSync(join('tests/fixtures', name), 'utf8');
const params = (over: Partial<SearchParams> = {}): SearchParams => ({
  query: 'test', sources: [], limit: 20, page: 1, sort: 'smart', language: 'all', paperType: 'all', ...over,
});
const jsonRes = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('registry（19 源 / 四档 / 能力矩阵）', () => {
  it('恰好 19 源：核心 6 / 学科 6 / 开放 4 / 可选 3', () => {
    const all = Object.values(SOURCES);
    expect(all).toHaveLength(19);
    expect(all.filter((s) => s.tier === 'core')).toHaveLength(6);
    expect(all.filter((s) => s.tier === 'subject')).toHaveLength(6);
    expect(all.filter((s) => s.tier === 'open')).toHaveLength(4);
    expect(all.filter((s) => s.tier === 'optional')).toHaveLength(3);
  });
  it('百度源已移除（D-03）', () => {
    expect(SOURCES.baiduxueshu).toBeUndefined();
    expect(Object.keys(SOURCES)).not.toContain('baiduxueshu');
  });
  it('activeSources 只放行 probe=verified 且已接入 adapter 的源（M1-03 后 12 个）', () => {
    const active = activeSources(Object.keys(SOURCES) as never);
    expect(active.every((s) => s.probe === 'verified')).toBe(true);
    const ids = active.map((s) => s.id);
    // M1-02 实测排除：DBLP Anubis 封锁、SciELO/J-STAGE/ChinaXiv 不可接、IEEE/Springer/Scopus 需 key
    expect(ids).not.toContain('dblp');
    expect(ids).not.toContain('scielo');
    expect(ids).not.toContain('jstage');
    expect(ids).not.toContain('chinaxiv');
    expect(ids).not.toContain('ieee');
    expect(ids).not.toContain('springer');
    expect(ids).not.toContain('scopus');
    expect(ids).toContain('hal');
    expect(ids).toContain('datacite');
    expect(ids).toHaveLength(12);
  });
  it('按档位截断：核心优先，超出 MAX_ACTIVE_SOURCES 的丢弃并如实返回', () => {
    const all = Object.values(SOURCES).filter((s) => s.tier !== 'optional');
    const { selected, dropped } = truncateByTier(all, 9);
    expect(selected).toHaveLength(9);
    expect(dropped).toHaveLength(7);
    expect(selected.slice(0, 6).every((s) => s.tier === 'core')).toBe(true);
  });
  it('能力矩阵抽查与 5.1.2 表一致', () => {
    expect(SOURCES.openalex.caps).toMatchObject({ yearFilter: 'native', citations: true, zhCoverage: 'strong' });
    expect(SOURCES.arxiv.caps.citations).toBe(false);
    expect(SOURCES.dblp.caps.yearFilter).toBe('client');
    expect(SOURCES.pubmed.caps.abstract).toBe(false); // D-010
    expect(SOURCES.biorxiv.mode).toBe('recent');
  });
});

describe('OpenAlex fetchRaw', () => {
  it('映射 DOI/摘要倒排/OA/venueType，URL 带 mailto', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return jsonRes(FIX('openalex.json'));
    }));
    const r = await openalexRaw(params());
    expect(r.error).toBeUndefined();
    expect(r.records).toHaveLength(2);
    const [a, b] = r.records;
    expect(a.doi).toBe('10.1038/s41586-023-06221-2'); // 归一化小写去前缀
    expect(a.abstract).toBe('Deep learning works');
    expect(a.openAccess).toBe(true);
    expect(a.pdfUrl).toContain('.pdf');
    expect(a.venueType).toBe('journal');
    expect(a.nativeId).toBe('W2100837269');
    expect(b.venueType).toBe('preprint'); // preprint 主张优先于 repository 托管地
    expect(b.openAccess).toBeUndefined();
    expect(calls[0]).toContain('mailto=2669788267%40qq.com');
  });
  it('上游 500 → 不抛异常，返回 error.kind=http + 空记录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const r = await openalexRaw(params());
    expect(r.records).toEqual([]);
    expect(r.error?.kind).toBe('http');
  });
  it('上游返回 HTML（content-type 不符）→ parse 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>block page</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const r = await openalexRaw(params());
    expect(r.error?.kind).toBe('parse');
  });
  it('网络异常（fetch reject）→ network 错误，不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const r = await openalexRaw(params());
    expect(r.error?.kind).toBe('network');
    expect(r.records).toEqual([]);
  });
});

describe('Crossref fetchRaw', () => {
  it('映射 JATS 摘要清洗/作者/年份/类型；mailto 用真实邮箱（D-006）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('crossref.json'))));
    const r = await crossrefRaw(params());
    const [a, b] = r.records;
    expect(a.abstract).toBe('First paragraph. Method We did things.');
    expect(a.authors).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(a.year).toBe(2024);
    expect(a.type).toBe('journal');
    expect(b.type).toBe('preprint');
    expect(b.citations).toBe(0);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('mailto=2669788267%40qq.com');
    expect(url).not.toContain('example.com');
  });
  it('年份过滤进入原生 filter（from-pub-date）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('crossref.json'))));
    await crossrefRaw(params({ yearFrom: 2023, yearTo: 2026 }));
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('from-pub-date%3A2023-01-01');
    expect(url).toContain('until-pub-date%3A2026-12-31');
  });
});

describe('arXiv fetchRaw', () => {
  it('解析 Atom：标题/作者/年份/PDF/预印本类型', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(FIX('arxiv.xml'), { status: 200, headers: { 'content-type': 'application/atom+xml' } })));
    const r = await arxivRaw(params({ query: 'graph neural networks' }));
    expect(r.records).toHaveLength(2);
    const [a] = r.records;
    expect(a.title).toBe('Graph Neural Networks 101');
    expect(a.authors).toEqual(['Alice Chen', 'Bob Li']);
    expect(a.year).toBe(2024);
    expect(a.abstract).toContain('& special chars'); // 实体解码
    expect(a.type).toBe('preprint');
    expect(a.pdfUrl).toBe('http://arxiv.org/pdf/2401.12345');
    expect(a.nativeId).toBe('2401.12345');
  });
  it('年份过滤生成 submittedDate 原生区间', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(FIX('arxiv.xml'), { status: 200 })));
    await arxivRaw(params({ yearFrom: 2023, yearTo: 2026 }));
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('submittedDate%3A%5B202301010000%20TO%20202612312359%5D');
  });
});

describe('Semantic Scholar fetchRaw', () => {
  it('映射 externalIds.OII/ citationCount / openAccessPdf', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('semanticscholar.json'))));
    const r = await s2Raw(params());
    const [a, b] = r.records;
    expect(a.doi).toBe('10.5555/3295222');
    expect(a.citations).toBe(90000);
    expect(a.pdfUrl).toContain('.pdf');
    expect(b.year).toBeUndefined();
    expect(b.citations).toBeUndefined();
  });
  it('429 → rate_limited，不抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', { status: 429 })));
    const r = await s2Raw(params());
    expect(r.error?.kind).toBe('rate_limited');
  });
});

describe('PubMed fetchRaw（两步调用）', () => {
  it('esearch → esummary 串联，PMCID 转 OA/PDF', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url);
      return jsonRes(u.includes('esearch') ? FIX('pubmed-esearch.json') : FIX('pubmed-esummary.json'));
    }));
    const r = await pubmedRaw(params({ query: 'CRISPR base editing' }));
    expect(r.records).toHaveLength(2);
    const [a, b] = r.records;
    expect(a.nativeId).toBe('37734567');
    expect(a.openAccess).toBe(true);
    expect(a.pdfUrl).toContain('PMC10540001');
    expect(b.openAccess).toBeUndefined();
  });
  it('esearch 零命中 → 空记录且不调用 esummary', async () => {
    const fn = vi.fn(async () => jsonRes(JSON.stringify({ esearchresult: { idlist: [] } })));
    vi.stubGlobal('fetch', fn);
    const r = await pubmedRaw(params());
    expect(r.records).toEqual([]);
    expect(r.error).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('DBLP fetchRaw', () => {
  it('作者对象/数组双形态、会议与期刊类型、客户端年份过滤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('dblp.json'))));
    const all = await dblpRaw(params());
    expect(all.records).toHaveLength(2);
    expect(all.records[0].authors).toEqual(['Ashish Vaswani', 'Noam Shazeer']);
    expect(all.records[0].type).toBe('conference');
    expect(all.records[0].venueType).toBe('conference');
    expect(all.records[1].venue).toBe('Nature'); // 数组取第一个
    expect(all.records[1].type).toBe('journal');
    const recent = await dblpRaw(params({ yearFrom: 2020 })); // 客户端过滤掉 2017
    expect(recent.records).toHaveLength(1);
    expect(recent.records[0].year).toBe(2024);
    const r2 = await dblpRaw(params({ yearFrom: 2025 }));
    expect(r2.records).toHaveLength(0);
  });
});
