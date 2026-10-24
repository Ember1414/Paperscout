import { describe, expect, it } from 'vitest';
import {
  appendToPool,
  createPool,
  deserializePool,
  markOffsets,
  needsMoreRecall,
  MAX_APPEND_ROUNDS,
  serializePool,
  slicePage,
} from '../../functions/lib/core/pool';
import type { Work } from '../../functions/lib/types';

const work = (i: number): Work => ({
  id: `doi:10.99/pool.${i}`,
  title: `Pool Paper ${i}`,
  authors: [],
  year: 2024,
  venueType: 'journal',
  url: `https://doi.org/10.99/pool.${i}`,
  citationsBySource: {},
  type: 'journal',
  openAccess: false,
  lang: 'en',
  sources: [],
  confidence: 'B',
});

describe('结果池（5.4 / A-02 修复）', () => {
  it('切片：page1..5 的 id 集合互斥（DoD 脚本断言）', () => {
    let pool = createPool('k', Array.from({ length: 100 }, (_, i) => work(i)));
    const seen = new Set<string>();
    for (let page = 1; page <= 5; page++) {
      const s = slicePage(pool, page, 20, false);
      expect(s.items).toHaveLength(20);
      for (const w of s.items) {
        expect(seen.has(w.id)).toBe(false); // 无重复
        seen.add(w.id);
      }
      // 100 条池 5 页 ×20 已取完，hasMore=false 且 exhausted=true 由调用方判定
    }
    expect(seen.size).toBe(100);
    const beyond = slicePage(pool, 6, 20, true);
    expect(beyond.items).toHaveLength(0);
    expect(beyond.hasMore).toBe(false);
  });
  it('翻页不发新召回：池足够时 needsRecall=false', () => {
    const pool = createPool('k', Array.from({ length: 200 }, (_, i) => work(i)));
    for (const page of [1, 2, 3]) {
      const s = slicePage(pool, page, 50, false);
      expect(s.needsRecall).toBe(false);
    }
    // 第 4 页开始（150..200）才触边
    const s4 = slicePage(pool, 4, 50, false);
    expect(s4.needsRecall).toBe(true);
  });
  it('追加幂等：重叠批次去重合并；offsets 累计', () => {
    let pool = createPool('k', [work(1), work(2)]);
    pool = appendToPool(pool, [work(2), work(3)]);
    expect(pool.items.map((w) => w.id)).toEqual(['doi:10.99/pool.1', 'doi:10.99/pool.2', 'doi:10.99/pool.3']);
    pool = markOffsets(pool, { openalex: 50 });
    expect(pool.offsets.openalex).toBe(50);
  });
  it('needsMoreRecall：未达 POOL_TARGET 且未耗尽才召回；轮次上限 3', () => {
    const small = createPool('k', [work(1)]);
    expect(needsMoreRecall(small, false)).toBe(true);
    expect(needsMoreRecall(small, true)).toBe(false);
    const full = createPool('k', Array.from({ length: 200 }, (_, i) => work(i)));
    expect(needsMoreRecall(full, false)).toBe(false);
    expect(MAX_APPEND_ROUNDS).toBe(3);
  });
  it('序列化往返保真；坏输入返回 undefined（不抛）', () => {
    const pool = createPool('k', [work(9)]);
    const restored = deserializePool(serializePool(pool));
    expect(restored?.items[0].id).toBe('doi:10.99/pool.9');
    expect(deserializePool('not json')).toBeUndefined();
    expect(deserializePool('{"key":1}')).toBeUndefined();
  });
});
