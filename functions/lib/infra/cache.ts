import { CACHE_TTL_S } from '../config';

/**
 * 分层缓存（REBUILD_PLAN 7.6）：
 *   L0 内存（isolate 级，60s，≤50 项）→ L1 Cache API（caches.default，600s）→ L2 KV（**在线只读**，仅 Warmer 预热写入）。
 * 铁律（1.2）：热路径 KV 只读不写；L1 写必须挂 ctx.waitUntil（A-07 修复）。
 * L1 key 形如 https://cache.internal/search/<queryHash>；queryHash 不含 page/limit（A-08 根治）。
 */

export interface CacheGetResult<T> {
  value: T | undefined;
  layer: 'l0' | 'l1' | 'l2' | undefined;
}

/* ---------- L0 ---------- */

/** isolate 级 L0：≤50 项（7.6），TTL 60s */
const l0 = new Map<string, { value: unknown; expiresAt: number }>();
const L0_MAX = 50;

export function l0Get<T>(key: string): CacheGetResult<T> {
  const hit = l0.get(key);
  if (!hit) return { value: undefined, layer: undefined };
  if (hit.expiresAt < Date.now()) {
    l0.delete(key);
    return { value: undefined, layer: undefined };
  }
  return { value: hit.value as T, layer: 'l0' };
}

export function l0Clear(): void {
  l0.clear();
}

export function l0Put(key: string, value: unknown, ttlS: number = CACHE_TTL_S.L0): void {
  if (l0.size >= L0_MAX) {
    // 淘汰最早过期项（近似 LRU）
    let oldestKey: string | undefined;
    let oldest = Infinity;
    for (const [k, v] of l0) {
      if (v.expiresAt < oldest) {
        oldest = v.expiresAt;
        oldestKey = k;
      }
    }
    if (oldestKey) l0.delete(oldestKey);
  }
  l0.set(key, { value, expiresAt: Date.now() + ttlS * 1000 });
}

/* ---------- L1 Cache API ---------- */

const L1_PREFIX = 'https://cache.internal/search/';

export function l1Key(queryHash: string): string {
  return `${L1_PREFIX}${queryHash}`;
}

export async function l1Get<T>(queryHash: string): Promise<CacheGetResult<T>> {
  if (typeof caches === 'undefined') return { value: undefined, layer: undefined };
  try {
    const cache = caches.default;
    const res = await cache.match(l1Key(queryHash));
    if (!res) return { value: undefined, layer: undefined };
    const value = (await res.json()) as T;
    return { value, layer: 'l1' };
  } catch {
    return { value: undefined, layer: undefined };
  }
}

/** L1 写入由调用方通过 ctx.waitUntil 调用（A-07：fire-and-forget 会被 isolate 回收打断） */
export async function l1Put(queryHash: string, value: unknown, ttlS: number = CACHE_TTL_S.L1_POOL): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const res = new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttlS}` },
    });
    await caches.default.put(new Request(l1Key(queryHash)), res);
  } catch {
    // Cache API 不可用（本地/受限环境）时降级到 L0；此 catch 带注释（G-10 合规）
  }
}

/* ---------- L2 KV（在线只读！）---------- */

export async function l2Get<T>(kv: KVNamespace | undefined, key: string): Promise<CacheGetResult<T>> {
  if (!kv) return { value: undefined, layer: undefined };
  try {
    const raw = await kv.get(key, 'json');
    if (raw === null) return { value: undefined, layer: undefined };
    return { value: raw as T, layer: 'l2' };
  } catch {
    return { value: undefined, layer: undefined };
  }
}

/* ---------- canonical hash（7.6）---------- */

/**
 * canonical hash：源排序、去默认值、trim、小写关键词。
 * **禁止** JSON.stringify(params)（v2 A-08：缓存 key 含 page/limit 导致命中率极低）。
 */
export function canonicalHash(params: {
  q: string;
  src?: string[];
  from?: number;
  to?: number;
  type?: string;
  lang?: string;
  field?: string;
  sort?: string;
}): string {
  const canonical: string[] = [];
  canonical.push(`q=${(params.q ?? '').trim().toLowerCase()}`);
  if (params.src?.length) canonical.push(`src=${[...params.src].sort().join(',')}`);
  if (params.from) canonical.push(`from=${params.from}`);
  if (params.to) canonical.push(`to=${params.to}`);
  if (params.type && params.type !== 'all') canonical.push(`type=${params.type}`);
  if (params.lang && params.lang !== 'all') canonical.push(`lang=${params.lang}`);
  if (params.field) canonical.push(`field=${params.field}`);
  if (params.sort && params.sort !== 'smart') canonical.push(`sort=${params.sort}`);
  const s = canonical.join('&');
  // FNV-1a（非加密用途）
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + '-' + (s.length > 40 ? s.slice(0, 40) : s).replace(/[^a-z0-9]/gi, '');
}
