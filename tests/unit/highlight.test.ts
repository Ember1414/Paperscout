import { describe, expect, it } from 'vitest';
import { highlightHtml } from '../../public/js/ui/card.js';

describe('highlightHtml（M2-15 关键词高亮，P0 补齐）', () => {
  it('正例：拉丁词按词边界高亮', () => {
    const out = highlightHtml('Graph Neural Network', ['graph', 'neural', 'network']);
    expect(out).toContain('<mark class="ps-hl">Graph</mark>');
    expect((out.match(/<mark/g) ?? []).length).toBe(3);
  });
  it('正例：CJK 子串高亮', () => {
    const out = highlightHtml('大语言模型的幻觉研究', ['幻觉']);
    expect(out).toContain('<mark class="ps-hl">幻觉</mark>');
  });
  it('边界：先转义再匹配，不产生真实脚本标签', () => {
    const out = highlightHtml('<script>alert(1)</script>', ['script']);
    expect(out).not.toContain('<script>'); // mark 只包转义实体内的词，无真实标签
    expect(out).toContain('&lt;');
  });
  it('反例：空词表原样返回；短词忽略', () => {
    expect(highlightHtml('abc', [])).toBe('abc');
    expect(highlightHtml('a and x', ['a'])).toBe('a and x'); // 长度 <2 忽略
  });
});
