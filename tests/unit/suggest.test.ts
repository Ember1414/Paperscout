import { describe, expect, it } from 'vitest';
import { editDistance, suggestFrom } from '../../functions/lib/core/suggest';

const POOL = {
  hotKeywords: [
    'graph neural network', 'graph convolutional network', 'large language model',
    'reinforcement learning', 'quantum computing', 'deep learning survey',
  ],
};

describe('editDistance', () => {
  it('正例与边界', () => {
    expect(editDistance('quantum', 'quantun')).toBe(1);
    expect(editDistance('neural', 'neuronal')).toBe(2); // 插入 o、n 两步
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('', 'ab')).toBe(2);
  });
  it('反例：差距过大提前剪枝', () => {
    expect(editDistance('quantum', 'zzzzzzz')).toBeGreaterThan(2);
  });
});

describe('suggestFrom（M2-10）', () => {
  it('前缀匹配热词', () => {
    const r = suggestFrom('graph', POOL);
    expect(r.map((s) => s.text)).toContain('graph neural network');
    expect(r.map((s) => s.text)).toContain('graph convolutional network');
    expect(r.every((s) => s.kind === 'prefix')).toBe(true);
  });
  it('拼写纠正：编辑距离 ≤2 的最近热词（quantun → quantum computing）', () => {
    const r = suggestFrom('quantun', POOL);
    expect(r.some((s) => s.kind === 'spell' && s.text === 'quantum computing')).toBe(true);
  });
  it('同义词/缩写展开：llm → large language model', () => {
    expect(suggestFrom('llm', POOL)).toEqual([{ text: 'large language model', kind: 'synonym' }]);
    expect(suggestFrom('大模型', POOL).some((s) => s.text === 'large language model')).toBe(true);
  });
  it('相关术语：graph neural network → graph convolutional network', () => {
    const r = suggestFrom('graph neural network', POOL);
    expect(r.some((s) => s.kind === 'related')).toBe(true);
  });
  it('反例：过短/超长输入返回空；无匹配返回空', () => {
    expect(suggestFrom('a', POOL)).toEqual([]);
    expect(suggestFrom('x'.repeat(61), POOL)).toEqual([]);
    expect(suggestFrom('zzzzzz', POOL)).toEqual([]);
  });
});
