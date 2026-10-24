import { describe, expect, it } from 'vitest';
import { expandQuery, DICT_SIZE } from '../../functions/lib/query/dict';
import { parseQuery } from '../../functions/lib/query/parse';

describe('expandQuery（M2-14 中英互译扩展）', () => {
  it('正例：中文查询 → 英文等价召回 + 打分词', () => {
    const parsed = parseQuery('大语言模型 幻觉');
    const { recallSuffix, scoreTerms } = expandQuery('大语言模型 幻觉', parsed.terms, parsed.cjkWhole);
    expect(recallSuffix).toContain('large language model');
    expect(recallSuffix).toContain('hallucination');
    expect(scoreTerms).toContain('large');
    expect(scoreTerms).toContain('model');
    expect(scoreTerms).toContain('hallucination');
  });

  it('正例：英文查询 → 中文等价（crossref CJK 召回）', () => {
    const parsed = parseQuery('graph neural network');
    const { recallSuffix } = expandQuery('graph neural network', parsed.terms, parsed.cjkWhole);
    expect(recallSuffix).toContain('图神经网络');
  });

  it('正例：词典无整串时单词级兜底', () => {
    const parsed = parseQuery('quantum computing 纠错');
    const { recallSuffix } = expandQuery('quantum computing 纠错', parsed.terms, parsed.cjkWhole);
    expect(recallSuffix).toContain('error correction'); // 单词级兜底（词典不做组合推理）
  });

  it('反例：无映射查询不产出扩展（宁缺毋滥）', () => {
    const parsed = parseQuery('asdfqwerzzz');
    const { recallSuffix, scoreTerms } = expandQuery('asdfqwerzzz', parsed.terms, parsed.cjkWhole);
    expect(recallSuffix).toBe('');
    expect(scoreTerms).toEqual([]);
  });

  it('边界：混合语言查询只补缺失语向', () => {
    const parsed = parseQuery('transformer 预训练');
    const { recallSuffix } = expandQuery('transformer 预训练', parsed.terms, parsed.cjkWhole);
    // 预训练 → pre-training；transformer 无中文条目
    expect(recallSuffix).toContain('pre-training');
    expect(recallSuffix).not.toContain('transformer');
  });

  it('边界：scoreTerms 不与原查询词重复', () => {
    const parsed = parseQuery('deep learning 深度学习');
    const { scoreTerms } = expandQuery('deep learning 深度学习', parsed.terms, parsed.cjkWhole);
    expect(scoreTerms.every((t) => !parsed.terms.includes(t))).toBe(true);
  });

  it('词典规模合理（≥60 对，防手滑清空）', () => {
    expect(DICT_SIZE).toBeGreaterThanOrEqual(60);
  });
});
