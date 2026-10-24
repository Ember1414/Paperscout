import { describe, expect, it } from 'vitest';
import { clearCooldowns, coolDown, isCoolingDown, RATE_LIMIT_COOLDOWN_MS } from '../../functions/lib/infra/cooldown';
import { diversifyByVenue } from '../../functions/lib/core/diversify';
import type { Work } from '../../functions/lib/types';

describe('源级内存冷却（M2-15，7.7 isolate 内实现）', () => {
  it('正例：coolDown 后 isCoolingDown 为 true', () => {
    clearCooldowns();
    coolDown('openalex');
    expect(isCoolingDown('openalex')).toBe(true);
    expect(isCoolingDown('crossref')).toBe(false);
  });
  it('边界：到期自动解除（过去时间戳）', () => {
    clearCooldowns();
    coolDown('s2', -1); // 已过期
    expect(isCoolingDown('s2')).toBe(false);
  });
  it('边界：默认时长 60s（预算：单 isolate 内有效）', () => {
    expect(RATE_LIMIT_COOLDOWN_MS).toBe(60_000);
  });
  it('反例：未冷却的源不受影响', () => {
    clearCooldowns();
    expect(isCoolingDown('dblp')).toBe(false);
  });
});

describe('结果多样性（M2-15，同 venue 连续 ≤2）', () => {
  const w = (id: string, venue: string): Work => ({
    id, title: id, authors: [], venue, venueType: 'journal', url: `https://x/${id}`,
    citationsBySource: {}, type: 'journal', openAccess: false, lang: 'en', sources: [], confidence: 'B',
  });

  it('正例：连发 4 条同 venue → 第 3 条起顺延', () => {
    const items = [w('a', 'Nature'), w('b', 'Nature'), w('c', 'Nature'), w('d', 'Nature'), w('e', 'Science')];
    const out = diversifyByVenue(items, { maxInARow: 2 });
    expect(out.map((x) => x.venue).slice(0, 3)).toEqual(['Nature', 'Nature', 'Science']);
    expect(out).toHaveLength(5);
  });
  it('正例：穿插的其他 venue 会重置连续计数', () => {
    const items = [w('a', 'Nature'), w('b', 'Science'), w('c', 'Nature'), w('d', 'Nature')];
    const out = diversifyByVenue(items);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']); // 连续未超 2，不动
  });
  it('边界：短列表不动', () => {
    const items = [w('a', 'X'), w('b', 'X'), w('c', 'X')];
    expect(diversifyByVenue(items, { maxInARow: 2 })).toHaveLength(3);
  });
  it('反例：venue 缺失按独立处理不误伤', () => {
    const items = [w('a', ''), w('b', ''), w('c', ''), w('d', '')];
    const out = diversifyByVenue(items);
    // 空 venue 同名（'∅'）也受限——但顺序保持稳定
    expect(out).toHaveLength(4);
  });
});

import { isTopVenue } from '../../functions/lib/core/venues';

describe('顶刊白名单扩容（M3-09，130 条）', () => {
  it('抽样准确率 ≥90%（DoD）', () => {
    const checks = [
      ['NeurIPS', true], ['Nature', true], ['ICML', true], ['论文 2024', false],
      ['Journal of Uncertain Results', false],
      ['IEEE Transactions on Pattern Analysis and Machine Intelligence', true],
      ['ArXiv preprint', false], ['计算机学报', true], ['Random Workshop Proceedings', false],
      ['Proceedings of the 35th NeurIPS', true],
      ['Science Advances', true], ['Econometrica', true], ['Applied Energy', true],
      ['全球剩余物质学报', false],
    ];
    let hit = 0;
    for (const [v, expect] of checks) {
      if (isTopVenue(v) === expect) hit++;
      else console.log('MISS:', v);
    }
    expect(hit / checks.length).toBeGreaterThanOrEqual(0.9);
  });
});
