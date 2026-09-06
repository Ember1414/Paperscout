import type { Env, SourceId } from './types';

/**
 * 数据源熔断器（Circuit Breaker）
 *
 * 背景：Cloudflare Workers 共享出口 IP，OpenAlex / Semantic Scholar / DBLP 等
 * 上游对整个 IP 段限流，单个请求内重试无法穿过限流窗口。
 *
 * 策略：
 * - 连续失败 ≥3 次 → 熔断打开，冷却 5 分钟（期间跳过该源的网络调用，不报错）
 * - 任一次成功 → 立即复位
 * - 冷却结束 → 半开状态自动恢复探测
 * - 状态存 KV（KV 有分钟级最终一致性，对熔断场景足够）
 */

const HEALTH_KEY = 'health:sources:v1';
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

export interface SourceHealth {
  fails: number;
  lastFail: number;
  /** 熔断打开截止时间 */
  openUntil: number;
}

type HealthMap = Partial<Record<SourceId, SourceHealth>>;

export async function readHealth(env: Env): Promise<HealthMap> {
  return (await env.CACHE.get(HEALTH_KEY, 'json')) ?? {};
}

async function writeHealth(env: Env, map: HealthMap): Promise<void> {
  await env.CACHE.put(HEALTH_KEY, JSON.stringify(map), { expirationTtl: 86400 });
}

/** 该源是否处于熔断冷却中 */
export function isCoolingDown(map: HealthMap, sourceId: SourceId, now = Date.now()): boolean {
  const h = map[sourceId];
  return Boolean(h && h.openUntil > now);
}

export async function recordSuccess(env: Env, sourceId: SourceId): Promise<void> {
  const map = await readHealth(env);
  if (!map[sourceId]) return; // 本来就健康，无需写
  delete map[sourceId];
  await writeHealth(env, map);
}

export async function recordFailure(env: Env, sourceId: SourceId): Promise<void> {
  const map = await readHealth(env);
  const h: SourceHealth = map[sourceId] ?? { fails: 0, lastFail: 0, openUntil: 0 };
  h.fails += 1;
  h.lastFail = Date.now();
  if (h.fails >= FAIL_THRESHOLD) {
    h.openUntil = Date.now() + COOLDOWN_MS;
    h.fails = 0; // 冷却结束后重新计数
  }
  map[sourceId] = h;
  await writeHealth(env, map);
}
