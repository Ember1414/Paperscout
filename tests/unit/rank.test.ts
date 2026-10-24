import { describe, expect, it } from 'vitest';
import { parseQuery } from '../../functions/lib/query/parse';
import { rankWorks, SORT_WEIGHTS } from '../../functions/lib/core/rank';
import { explainChips } from '../../functions/lib/core/explain';
import { fuseRecords } from '../../functions/lib/core/fusion';
import { cjkBigrams } from '../../functions/lib/query/parse';
import type { RawRecord, Work } from '../../functions/lib/types';

const rec = (over: Partial<RawRecord> & { title: string; source: RawRecord['source'] }): RawRecord =>
  ({ sourceName: over.source.toUpperCase(), fetchedAt: 1e12, authors: [], ...over } as RawRecord);
const year = new Date().getFullYear();

function makeWorks(): Work[] {
  return fuseRecords([
    rec({ source: 'openalex', title: 'Graph Neural Networks', year, venue: 'NeurIPS', citations: 1500, doi: '10.11/gnn.1', type: 'conference', openAccess: true, pdfUrl: 'https://a.org/p.pdf', abstract: 'We study graph neural networks extensively.' }),
    rec({ source: 'crossref', title: 'Graph Neural Networks', year, doi: '10.11/gnn.1', citations: 1400 }),
    rec({ source: 'semanticscholar', title: 'Graph Neural Networks', year, doi: '10.11/gnn.1', citations: 1600 }),
    rec({ source: 'openalex', title: 'Quantum Error Correction', year: 2021, citations: 50, doi: '10.11/qec.1', abstract: 'Quantum matters.' }),
    rec({ source: 'arxiv', title: 'A brand new preprint about transformers', year, type: 'preprint', openAccess: true, pdfUrl: 'https://b.org/x.pdf' }),
    rec({ source: 'dblp', title: 'Old obscure survey with no citations anywhere', year: 2001, venue: 'Random Workshop' }),
  ]);
}

describe('parseQuery（5.1.1 / 附录 B）', () => {
  it('正例：短语、排除、字段标签', () => {
    const p = parseQuery('"graph neural network" -survey author:bengio year:2020-2024');
    expect(p.phrases).toEqual(['graph neural network']);
    expect(p.excluded).toEqual(['survey']);
    expect(p.fieldTags).toEqual([{ key: 'author', value: 'bengio' }, { key: 'year', value: '2020-2024' }]);
    expect(p.intent).toBe('author');
  });
  it('正例：裸 DOI 意图', () => {
    expect(parseQuery('10.1038/s41586-023-06221-2').intent).toBe('doi');
    expect(parseQuery('doi:10.5555/abc').intent).toBe('doi');
  });
  it('正例：中文 2-gram + 整串保留（附录 B 示例：的 保留在 bigram 中）', () => {
    const p = parseQuery('大语言模型的幻觉');
    expect(p.terms).toEqual(['大语', '语言', '言模', '模型', '型的', '的幻', '幻觉']);
    expect(p.cjkWhole).toBe('大语言模型的幻觉');
    expect(cjkBigrams('量子')).toEqual(['量子']);
    expect(p.lang).toBe('zh');
  });
  it('反例：空查询零词；question 意图', () => {
    expect(parseQuery('   ').terms).toEqual([]);
    expect(parseQuery('this paper 如何 improve accuracy').intent).toBe('question');
  });
});

describe('rankWorks（5.3.1 公式）', () => {
  it('score.parts 五分项齐全且 total=加权和', () => {
    const parsed = parseQuery('graph neural networks');
    const [w] = rankWorks(makeWorks(), parsed, 'smart');
    const p = w.score!.parts;
    for (const k of Object.keys(SORT_WEIGHTS)) expect(typeof p[k]).toBe('number');
    const expectTotal =
      SORT_WEIGHTS.relevance * p.relevance + SORT_WEIGHTS.quality * p.quality +
      SORT_WEIGHTS.recency * p.recency + SORT_WEIGHTS.availability * p.availability +
      SORT_WEIGHTS.agreement * p.agreement;
    expect(w.score!.total).toBeCloseTo(expectTotal, 10);
  });
  it('relevance：命中词的论文显著高于无关论文', () => {
    const parsed = parseQuery('graph neural networks');
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const gnn = works.find((w) => w.title === 'Graph Neural Networks')!;
    const qec = works.find((w) => w.title === 'Quantum Error Correction')!;
    expect(gnn.score!.parts.relevance).toBeGreaterThan(qec.score!.parts.relevance);
  });
  it('quality：被引对数 + 顶会加成；quality 分项 [0,1.15]', () => {
    const parsed = parseQuery('test');
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const gnn = works.find((w) => w.title === 'Graph Neural Networks')!;
    const old = works.find((w) => w.title.startsWith('Old obscure'))!;
    expect(gnn.score!.parts.quality).toBeGreaterThan(old.score!.parts.quality);
    expect(gnn.score!.parts.quality).toBeLessThanOrEqual(1.15);
  });
  it('recency：指数衰减 exp(-age/6)；新论文 > 2001 年', () => {
    const parsed = parseQuery('test');
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const fresh = works.find((w) => w.title === 'Graph Neural Networks')!;
    const old = works.find((w) => w.title.startsWith('Old obscure'))!;
    expect(fresh.score!.parts.recency).toBeCloseTo(1, 5);
    expect(old.score!.parts.recency).toBeCloseTo(Math.exp(-(year - 2001) / 6), 5);
  });
  it('availability：OA+PDF=1；agreement：3 源=1', () => {
    const parsed = parseQuery('test');
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const gnn = works.find((w) => w.title === 'Graph Neural Networks')!;
    expect(gnn.score!.parts.availability).toBe(1);
    expect(gnn.score!.parts.agreement).toBe(1);
  });
  it('sort=newest/cited 只按该键（所见即所得）', () => {
    const parsed = parseQuery('test');
    const byYear = rankWorks(makeWorks(), parsed, 'newest');
    const years = byYear.map((w) => w.year ?? 0);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    const byCited = rankWorks(makeWorks(), parsed, 'citations');
    const cites = byCited.map((w) => w.citations ?? 0);
    expect([...cites].sort((a, b) => b - a)).toEqual(cites);
  });
});

describe('explainChips（5.3.2：chip 必须与数据一致）', () => {
  const parsed = parseQuery('graph neural networks');
  const ctx = { citationsTopDecile: 300 };

  it('高被引 chip 文案含真实数字；按贡献度取前三（GNN：精确匹配/高被引/顶会）', () => {
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const gnn = works.find((w) => w.title === 'Graph Neural Networks')!;
    const chips = explainChips(gnn, parsed, ctx);
    expect(chips).toEqual(['标题完全匹配', '高被引 1.5k', '顶会/顶刊']);
    expect(chips.length).toBeLessThanOrEqual(3);
  });
  it('池内 Top 10% 阈值触发 本主题高影响（无更高优先级 chip 时可见）', () => {
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const qec = works.find((w) => w.title === 'Quantum Error Correction')!;
    const chips = explainChips(qec, parsed, { citationsTopDecile: 40 });
    expect(chips).toContain('本主题高影响');
  });
  it('agreement chip：无更高优先级 chip 时 3 源收录可见', () => {
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const gnn = works.find((w) => w.title === 'Graph Neural Networks')!;
    // 抹掉全部更高优先级条件：低被引、旧、非 OA、无顶会名、非精确标题
    const bare: Work = { ...gnn, venue: 'Some Workshop', title: 'Unrelated Words Only', citations: 10, year: year - 2, openAccess: false, pdfUrl: undefined };
    const chips = explainChips(bare, parseQuery('zzz'), { citationsTopDecile: 100000 });
    expect(chips).toEqual(['3 源一致收录']);
  });
  it('低被引、旧、非 OA 的论文不触发任何 chip 或仅无关 chip', () => {
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const old = works.find((w) => w.title.startsWith('Old obscure'))!;
    const chips = explainChips(old, parsed, { citationsTopDecile: 300 });
    expect(chips).not.toContain('高被引 0');
    expect(chips).not.toContain('顶会/顶刊');
  });
  it('新预印本触发 最新预印本', () => {
    const works = rankWorks(makeWorks(), parsed, 'smart');
    const pre = works.find((w) => w.title.includes('brand new preprint'))!;
    expect(explainChips(pre, parsed, ctx)).toContain('最新预印本');
  });
});
