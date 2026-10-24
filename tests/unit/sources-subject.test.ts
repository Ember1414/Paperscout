import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRaw as europepmcRaw } from '../../functions/lib/sources/europepmc';
import { fetchRaw as doajRaw } from '../../functions/lib/sources/doaj';
import { fetchRaw as halRaw } from '../../functions/lib/sources/hal';
import { fetchRaw as zenodoRaw } from '../../functions/lib/sources/zenodo';
import { fetchRaw as openaireRaw } from '../../functions/lib/sources/openaire';
import { fetchRaw as dataciteRaw } from '../../functions/lib/sources/datacite';
import { fetchRaw as biorxivRaw } from '../../functions/lib/sources/biorxiv';
import type { SearchParams } from '../../functions/lib/types';

const FIX = (name: string) => readFileSync(join('tests/fixtures', name), 'utf8');
const params = (over: Partial<SearchParams> = {}): SearchParams => ({
  query: 'test', sources: [], limit: 20, page: 1, sort: 'smart', language: 'all', paperType: 'all', ...over,
});
const jsonRes = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
const textRes = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } });

afterEach(() => vi.unstubAllGlobals());

describe('Europe PMC fetchRaw', () => {
  it('作者串拆分、摘要去标签、preprint 识别（source=PPR）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('europepmc.json'))));
    const r = await europepmcRaw(params());
    expect(r.records).toHaveLength(2);
    const [a, b] = r.records;
    expect(a.authors).toEqual(['Avants B', 'Lee J', 'Chen S']);
    expect(a.abstract).toBe('We review new models in biology.');
    expect(a.openAccess).toBe(true);
    expect(a.pdfUrl).toContain('europepmc.org');
    expect(b.venueType).toBe('preprint');
    expect(b.type).toBe('preprint');
  });
  it('500 → 错误不抛', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    const r = await europepmcRaw(params());
    expect(r.error?.kind).toBe('http');
    expect(r.records).toEqual([]);
  });
});

describe('DOAJ fetchRaw', () => {
  it('bibjson 映射、fulltext→pdfUrl、OA 恒 true、客户端年份过滤', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('doaj.json'))));
    const all = await doajRaw(params());
    expect(all.records).toHaveLength(2);
    expect(all.records[0].doi).toBe('10.5555/doaj.1');
    expect(all.records[0].pdfUrl).toContain('.pdf');
    expect(all.records[0].openAccess).toBe(true);
    const recent = await doajRaw(params({ yearFrom: 2026 }));
    // 2025 年那条被客户端过滤；无年份记录按 F-07 语义保留（由前端标注"年份未知"）
    expect(recent.records).toHaveLength(1);
    expect(recent.records[0].year).toBeUndefined();
  });
});

describe('HAL fetchRaw', () => {
  it('COMM→conference、UNPUBLISHED→preprint、作者数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('hal.json'))));
    const r = await halRaw(params());
    const [a, b] = r.records;
    expect(a.type).toBe('conference');
    expect(a.venueType).toBe('conference');
    expect(a.pdfUrl).toContain('hal.science');
    expect(b.type).toBe('preprint');
    expect(b.venueType).toBe('preprint');
    expect(b.url).toContain('hal.science/hal-09876543');
  });
});

describe('Zenodo fetchRaw', () => {
  it('repository 归类、HTML 摘要去标签、文件 PDF', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('zenodo.json'))));
    const r = await zenodoRaw(params());
    const [a] = r.records;
    expect(a.venueType).toBe('repository');
    expect(a.abstract).toBe('Zenodo HTML description');
    expect(a.pdfUrl).toContain('data.pdf');
    expect(a.openAccess).toBe(true);
  });
});

describe('OpenAIRE fetchRaw（XML）', () => {
  it('creator 循环、DOI classid、bestaccessright→OA', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes(FIX('openaire.xml'))));
    const r = await openaireRaw(params());
    const [a] = r.records;
    expect(a.title).toBe('OpenAIRE aggregated publication');
    expect(a.authors).toEqual(['Jane Collaborator', 'John Lead']);
    expect(a.doi).toBe('10.5555/openaire.1');
    expect(a.year).toBe(2022);
    expect(a.openAccess).toBe(true);
    expect(a.venue).toBe('EU Journal');
  });
});

describe('DataCite fetchRaw', () => {
  it('DOI 小写、dataset→repository、摘要按 descriptionType 取', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('datacite.json'))));
    const r = await dataciteRaw(params());
    const [a] = r.records;
    expect(a.doi).toBe('10.5555/datacite.1');
    expect(a.venueType).toBe('repository');
    expect(a.abstract).toBe('Datacite abstract.');
    expect(a.openAccess).toBe(true);
  });
  it('无 title 的记录被丢弃', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(JSON.stringify({ data: [{ attributes: { doi: '10.1/x' } }] }))));
    const r = await dataciteRaw(params());
    expect(r.records).toHaveLength(0);
  });
});

describe('bioRxiv fetchRaw（recent 模式）', () => {
  it('忽略 query 按日期窗口返回，作者分号拆分', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(FIX('biorxiv.json'))));
    const r = await biorxivRaw(params({ query: 'anything ignored' }));
    const [a] = r.records;
    expect(a.type).toBe('preprint');
    expect(a.authors).toEqual(['Alpha A', 'Beta B']);
    expect(a.year).toBe(2026);
    expect(a.openAccess).toBe(true);
  });
});
