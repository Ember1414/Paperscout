import { CACHE_TTL_S } from '../config';

/**
 * 分层缓存（7.6）：L0 内存（isolate 级，60s）→ L1 Cache API（M1-09）→ L2 KV（仅 Warmer 写，M1-09）。
 * M1-08 先交付 L0 + canonical hash；L1/L2 与 X-Cache 头在 M1-09 补齐。
 */

export interface CacheGetResult<T> {
  value: T | undefined;
  layer: 'l0' | 'l1' | 'l2' | undefined;
}

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

/**
 * canonical hash（7.6 要点）：源排序、去默认值、trim、小写关键词。
 * **禁止** JSON.stringify(params)（A-08 的缓存 key 含分页参数问题在这里根治——page/limit 不进 hash）。
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
