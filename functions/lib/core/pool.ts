import { SEARCH } from '../config';
import type { Work } from '../types';

/**
 * 结果池（REBUILD_PLAN 5.4 / 修复 A-02 跨源分页错位）：
 * 首次检索召回 POOL_TARGET 条融合排序后入池；page=N 从池切片；
 * 池不足且未耗尽时触发"追加召回"（各源 offset+PER_SOURCE_LIMIT，最多 3 轮）。
 * 池不落 D1/KV（在线路径零 KV 写）；序列化后的池由上层放 L1/L2 缓存。
 */

export interface SearchPool {
  /** queryHash（canonical，不含 page/limit） */
  key: string;
  /** 排序后的 Work 列表 */
  items: Work[];
  /** 各源已召回深度（offset），追加召回用 */
  offsets: Record<string, number>;
  /** 上游各源声称的总数（可选，用于 exhausted 判定） */
  upstreamTotals: Record<string, number | undefined>;
  createdAt: number;
  updatedAt: number;
}

export function createPool(key: string, items: Work[]): SearchPool {
  return { key, items, offsets: {}, upstreamTotals: {}, createdAt: Date.now(), updatedAt: Date.now() };
}

export function appendToPool(pool: SearchPool, batch: Work[]): SearchPool {
  // 幂等追加：按 id 去重（追加召回可能与池内记录重叠）
  const seen = new Set(pool.items.map((w) => w.id));
  const fresh = batch.filter((w) => !seen.has(w.id));
  return { ...pool, items: [...pool.items, ...fresh], updatedAt: Date.now() };
}

export function markOffsets(pool: SearchPool, offsets: Record<string, number>): SearchPool {
  return { ...pool, offsets: { ...pool.offsets, ...offsets }, updatedAt: Date.now() };
}

export interface PoolSlice {
  items: Work[];
  page: number;
  limit: number;
  poolSize: number;
  hasMore: boolean;
  /** 池已耗尽（无更多可召回） */
  exhausted: boolean;
  /** 需要追加召回：池不够下一页且未耗尽 */
  needsRecall: boolean;
}

export function slicePage(pool: SearchPool, page: number, limit: number, exhausted: boolean): PoolSlice {
  const start = (page - 1) * limit;
  const items = pool.items.slice(start, start + limit);
  const endReached = start + limit >= pool.items.length;
  return {
    items,
    page,
    limit,
    poolSize: pool.items.length,
    hasMore: !exhausted || start + limit < pool.items.length,
    exhausted,
    needsRecall: !exhausted && endReached,
  };
}

/** 池是否需要扩容（目标 POOL_TARGET，未达且未耗尽） */
export function needsMoreRecall(pool: SearchPool, exhausted: boolean): boolean {
  return !exhausted && pool.items.length < SEARCH.POOL_TARGET;
}

/** 追加召回轮次上限（5.4：最多 3 轮） */
export const MAX_APPEND_ROUNDS = 3;

/** 池序列化（L1/L2 存储用）：剥离函数字段，纯数据 */
export function serializePool(pool: SearchPool): string {
  return JSON.stringify(pool);
}

export function deserializePool(raw: string): SearchPool | undefined {
  try {
    const p = JSON.parse(raw) as SearchPool;
    if (!p || !Array.isArray(p.items) || typeof p.key !== 'string') return undefined;
    return p;
  } catch {
    return undefined;
  }
}
