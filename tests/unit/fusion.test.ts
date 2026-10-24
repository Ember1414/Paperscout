import { describe, expect, it } from 'vitest';
import { fuseRecords } from '../../functions/lib/core/fusion';
import type { RawRecord } from '../../functions/lib/types';

const rec = (over: Partial<RawRecord> & { title: string; source: RawRecord['source'] }): RawRecord => ({
  sourceName: over.source.toUpperCase(),
  fetchedAt: 1_700_000_000_000,
  authors: [],
  ...over,
} as RawRecord);

describe('融合：同论文合并', () => {
  it('同 DOI 的 4 源记录合并为 1 条，provenance=4，置信度 A', () => {
    const works = fuseRecords([
      rec({ source: 'openalex', title: 'Deep Learning', doi: '10.1038/DL.1', year: 2023, venue: 'Nature', citations: 1203, type: 'journal', authors: ['Yoshua Bengio'] }),
      rec({ source: 'crossref', title: 'Deep Learning', doi: '10.1038/dl.1', year: 2023, venue: 'Nature', citations: 980, type: 'journal' }),
      rec({ source: 'semanticscholar', title: 'Deep Learning', doi: '10.1038/DL.1', year: 2023, citations: 1100 }),
      rec({ source: 'arxiv', title: 'Deep Learning', doi: '10.1038/dl.1', year: 2023, type: 'preprint' }),
    ]);
    expect(works).toHaveLength(1);
    const w = works[0];
    expect(w.sources).toHaveLength(4);
    expect(w.confidence).toBe('A');
    expect(w.doi).toBe('10.1038/dl.1');
    expect(w.id).toBe('doi:10.1038/dl.1');
  });

  it('引文数取口径优先（OpenAlex），不做 max；citationsBySource 全保留', () => {
    const w = fuseRecords([
      rec({ source: 'crossref', title: 'Same Title Here', doi: '10.12/aa.bb', year: 2024, venue: 'J', citations: 9000 }),
      rec({ source: 'openalex', title: 'Same Title Here', doi: '10.12/AA.BB', year: 2024, citations: 1203 }),
      rec({ source: 'semanticscholar', title: 'Same Title Here', doi: '10.12/aa.bb', year: 2024, citations: 2000 }),
    ])[0];
    expect(w.citations).toBe(1203); // 不是 max 9000
    expect(w.citationsBySource).toEqual({ crossref: 9000, openalex: 1203, semanticscholar: 2000 });
  });

  it('字段择优：正式 venue 胜预印本仓库；URL 优先 doi.org；title 取最长非截断', () => {
    const w = fuseRecords([
      rec({ source: 'arxiv', title: 'Same Title Here', year: 2024, venue: 'arXiv 预印本', url: 'http://arxiv.org/abs/1', type: 'preprint' }),
      rec({ source: 'crossref', title: 'Same Title Here: Extended Version', year: 2024, venue: 'Real Journal', url: 'https://doi.org/10.12/cc.dd', type: 'journal' }),
    ])[0];
    expect(w.venue).toBe('Real Journal');
    expect(w.url).toBe('https://doi.org/10.12/cc.dd');
    expect(w.title).toBe('Same Title Here: Extended Version');
    expect(w.type).toBe('journal'); // journal 主张强于 preprint
    expect(w.lang).toBe('en');
  });

  it('k2 合并：同指纹且年份差 ≤1；k3 兜底：去副标题+姓氏+dice≥0.92', () => {
    const w = fuseRecords([
      rec({ source: 'openalex', title: 'Large Language Models: A Survey', year: 2023, authors: ['Alice Chen'] }),
      rec({ source: 'crossref', title: 'Large Language Models', year: 2024, authors: ['Bob Chen'] }),
    ]);
    expect(w).toHaveLength(1);
  });

  it('arXiv 与 DOI 双版本合并后 type 判 journal（非全 preprint）', () => {
    const w = fuseRecords([
      rec({ source: 'arxiv', title: 'Attention Is All You Need', year: 2017, type: 'preprint', openAccess: true }),
      rec({ source: 'openalex', title: 'Attention Is All You Need', year: 2017, doi: '10.5555/att', type: 'conference' }),
    ])[0];
    expect(w.type).toBe('conference');
    expect(w.openAccess).toBe(true); // OA 是存在性事实
  });
});

describe('融合：反例（不得合并）', () => {
  it('同标题不同年份（差 >1 且 k3 不中）→ 不合并', () => {
    const works = fuseRecords([
      rec({ source: 'openalex', title: 'ImageNet Classification with Deep CNNs', year: 2012, authors: ['Alice Wu'] }),
      rec({ source: 'crossref', title: 'ImageNet Classification with Deep CNNs', year: 2020, authors: ['Bob Yan'] }),
    ]);
    expect(works).toHaveLength(2);
  });

  it('两篇不同论文（同标题不同 DOI）→ 不合并', () => {
    const works = fuseRecords([
      rec({ source: 'openalex', title: 'A Study of Graphs', doi: '10.12/aaa.bbb', year: 2020 }),
      rec({ source: 'crossref', title: 'A Study of Graphs', doi: '10.22/ccc.ddd', year: 2020 }),
    ]);
    expect(works).toHaveLength(2);
    expect(new Set(works.map((w) => w.doi))).toEqual(new Set(['10.12/aaa.bbb', '10.22/ccc.ddd']));
  });

  it('DOI 冲突拆分：A(doi1)–B(无DOI)–C(doi2) 传递链 → 拆为独立簇', () => {
    const works = fuseRecords([
      rec({ source: 'openalex', title: 'Fuzzy Matching Papers', doi: '10.11/xx.yy', year: 2021 }),
      rec({ source: 'dblp', title: 'Fuzzy Matching Papers', year: 2021 }), // 无 DOI，k2 会被两侧命中
      rec({ source: 'crossref', title: 'Fuzzy Matching Papers', doi: '10.22/zz.ww', year: 2021 }),
    ]);
    const dois = works.map((w) => w.doi).filter(Boolean).sort();
    expect(dois).toEqual(['10.11/xx.yy', '10.22/zz.ww']);
  });

  it('空/无标题记录被丢弃', () => {
    const works = fuseRecords([
      rec({ source: 'openalex', title: '   ' }),
      rec({ source: 'crossref', title: 'Valid Paper', year: 2024 }),
    ]);
    expect(works).toHaveLength(1);
  });
});

describe('置信度分级（5.2.5）', () => {
  it('A：DOI + ≥2 源 + 年份 + venue', () => {
    const w = fuseRecords([
      rec({ source: 'openalex', title: 'Conf A Paper', doi: '10.12/a.1', year: 2024, venue: 'Venue' }),
      rec({ source: 'crossref', title: 'Conf A Paper', doi: '10.12/a.1', year: 2024, venue: 'Venue' }),
    ])[0];
    expect(w.confidence).toBe('A');
  });
  it('B：DOI 单源', () => {
    const w = fuseRecords([rec({ source: 'openalex', title: 'Single Source DOI Paper', doi: '10.12/b.1', year: 2024, venue: 'V' })])[0];
    expect(w.confidence).toBe('B');
  });
  it('B：无 DOI 但 2 源一致', () => {
    const w = fuseRecords([
      rec({ source: 'openalex', title: 'No DOI Two Sources Paper', year: 2024, venue: 'V' }),
      rec({ source: 'crossref', title: 'No DOI Two Sources Paper', year: 2024, venue: 'V' }),
    ])[0];
    expect(w.confidence).toBe('B');
  });
  it('C：单源且无 DOI', () => {
    const w = fuseRecords([rec({ source: 'zenodo', title: 'Lone Repository Item', year: 2024, venue: 'Zenodo 仓库' })])[0];
    expect(w.confidence).toBe('C');
  });
});

describe('中文与作者合并', () => {
  it('中文论文 lang=zh；作者跨源去重且 sourceRank 累计', () => {
    const w = fuseRecords([
      rec({ source: 'openalex', title: '大语言模型幻觉综述', year: 2024, venue: '计算机学报', authors: ['王伟', '李明'] }),
      rec({ source: 'crossref', title: '大语言模型幻觉综述', year: 2024, venue: '计算机学报', authors: ['王伟'] }),
    ])[0];
    expect(w.lang).toBe('zh');
    expect(w.confidence).toBe('B'); // 无 DOI：2 源一致判 B（A 必须 DOI + 2 源）
    const wang = w.authors.find((a) => a.name.includes('王'));
    expect(wang?.sourceRank).toBe(2);
    expect(w.authors.find((a) => a.name.includes('李'))).toBeTruthy();
  });
});

describe('重复率（M1 门：金标准复测口径）', () => {
  it('50 条随机记录融合后无 DOI 重复', () => {
    const records: RawRecord[] = [];
    for (let i = 0; i < 50; i++) {
      records.push(rec({ source: 'openalex', title: `Unique Paper Number ${i}`, doi: `10.9999/gen.${i}`, year: 2020 + (i % 5) }));
      if (i % 3 === 0) records.push(rec({ source: 'crossref', title: `Unique Paper Number ${i}`, doi: `10.9999/GEN.${i}`, year: 2020 + (i % 5) }));
    }
    const works = fuseRecords(records);
    const ids = works.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(works).toHaveLength(50);
  });
});
