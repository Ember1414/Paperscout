import { describe, expect, it } from 'vitest';
import { verifyCitations, stripInvalidSentences } from '../../functions/lib/ai/verify';

describe('verifyCitations（5.9.3，M6-01）', () => {
  it('正例：合法引用', () => {
    const r = verifyCitations('这篇论文提出了新方法 [1]。实验证明了效果 [2]。', 3);
    expect(r).toEqual({ ok: true, citedIds: [1, 2], invalidIds: [] });
  });
  it('正例：连续编号 [1][2]', () => {
    const r = verifyCitations('引用 [1][2] 证明', 3);
    expect(r.ok).toBe(true);
    expect(r.citedIds).toEqual([1, 2]);
  });
  it('正例：范围 [1-3] 视为 1,2,3', () => {
    const r = verifyCitations('见 [1-3]。', 3);
    expect(r.citedIds).toEqual([1, 2, 3]);
  });
  it('反例：无引用 → no_citation', () => {
    const r = verifyCitations('没有任何引用标记。', 3);
    expect(r).toEqual({ ok: false, citedIds: [], invalidIds: [], reason: 'no_citation' });
  });
  it('反例：越界引用 → invalid_citation', () => {
    const r = verifyCitations('引用 [5]。', 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_citation');
    expect(r.invalidIds).toEqual([5]);
  });
  it('反例：INSUFFICIENT_EVIDENCE → insufficient', () => {
    const r = verifyCitations('INSUFFICIENT_EVIDENCE', 3);
    expect(r.reason).toBe('insufficient');
  });
  it('边界：sourceCount=0 时任何引用都越界', () => {
    const r = verifyCitations('引用 [1]。', 0);
    expect(r.ok).toBe(false);
  });
  it('反例：空字符串', () => {
    expect(verifyCitations('', 3).reason).toBe('no_citation');
  });
});

describe('stripInvalidSentences', () => {
  it('剔除含越界引用的句子', () => {
    const answer = '这是正确的 [1]。这是有问题的 [5]。这也是正确的 [2]。';
    const out = stripInvalidSentences(answer, [5]);
    expect(out).not.toContain('[5]');
    expect(out).toContain('[1]');
    expect(out).toContain('[2]');
  });
  it('无越界时不修改', () => {
    const s = '正常引用 [1]。';
    expect(stripInvalidSentences(s, [])).toBe(s);
  });
});
