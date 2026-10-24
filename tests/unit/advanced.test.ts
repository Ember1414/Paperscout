import { describe, expect, it } from 'vitest';

// buildDsl 是 public/js/views/advanced.js 的纯函数（零 DOM 依赖）——直接导入
const { buildDsl } = await import('../../public/js/views/advanced.js');

/** @type {any} */
const g = (op: string, clauses: any[]) => ({ op, clauses });
const c = (field: string, value: string) => ({ field, value });

describe('buildDsl（附录 B 语法，M2-07）', () => {
  it('正例：AND 组展开为多词', () => {
    expect(buildDsl([g('and', [c('any', 'graph'), c('any', 'neural')])])).toBe('graph neural');
  });
  it('正例：OR 组加括号', () => {
    expect(buildDsl([g('or', [c('any', 'transformer'), c('any', 'rnn')])])).toBe('(transformer OR rnn)');
  });
  it('正例：NOT 组逐词加 -', () => {
    expect(buildDsl([g('not', [c('any', 'survey'), c('any', 'review')])])).toBe('-survey -review');
  });
  it('正例：字段前缀与标题短语', () => {
    expect(buildDsl([g('and', [c('author', 'bengio'), c('title', 'deep learning')])])).toBe('author:bengio "deep learning"');
    expect(buildDsl([g('and', [c('doi', '10.1038/x.1'), c('venue', 'Nature')])])).toBe('doi:10.1038/x.1 venue:Nature');
  });
  it('边界：多词任意字段加引号；空值子句剔除', () => {
    expect(buildDsl([g('and', [c('any', 'large language model')])])).toBe('"large language model"');
    expect(buildDsl([g('and', [c('any', ''), c('any', 'x')])])).toBe('x');
  });
  it('边界：单元素 OR 组不加括号', () => {
    expect(buildDsl([g('or', [c('any', 'solo')])])).toBe('solo');
  });
  it('反例：全空 → 空 DSL', () => {
    expect(buildDsl([g('and', [c('any', '')]), g('not', [c('any', '  ')])])).toBe('');
  });
  it('组合：AND + OR + NOT 完整示例（S-28 用例形态）', () => {
    const dsl = buildDsl([g('and', [c('any', 'graph neural network')]), g('not', [c('any', 'survey')])]);
    expect(dsl).toBe('"graph neural network" -survey');
  });
});
