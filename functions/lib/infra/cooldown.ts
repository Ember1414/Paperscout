/**
 * 源级内存冷却（M2-15 / REBUILD_PLAN 7.7 的 isolate 内实现）：
 * 429 后本 isolate 内对该源退避 60s——不写 KV（铁律"热路径 KV 只读"），
 * isolate 生命周期短、影响天然有限；跨请求健康仍由 Warmer→D1 聚合（M7）。
 */

/** @type {Map<string, number>} sourceId → 冷却截止时间戳 */
const cooling = new Map();

/** 429 后的冷却时长 */
export const RATE_LIMIT_COOLDOWN_MS = 60_000;

/** @param {string} sourceId @param {number} [ms] */
export function coolDown(sourceId: string, ms: number = RATE_LIMIT_COOLDOWN_MS): void {
  cooling.set(sourceId, Date.now() + ms);
}

/** @param {string} sourceId */
export function isCoolingDown(sourceId: string): boolean {
  const until = cooling.get(sourceId);
  if (!until) return false;
  if (until < Date.now()) {
    cooling.delete(sourceId);
    return false;
  }
  return true;
}

/** 测试/调试用 */
export function clearCooldowns(): void {
  cooling.clear();
}
