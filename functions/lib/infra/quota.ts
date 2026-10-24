import type { Env } from '../types';

/**
 * D1 配额（REBUILD_PLAN 7.4 ai_usage / ai_global）：
 * 原子 upsert——单条 SQL `INSERT ... ON CONFLICT DO UPDATE SET used = used + 1 RETURNING used`
 * 由 D1 语句级事务保证并发不超发（M6 AI 端点接入；此处提供纯配额层与原子性测试桩）。
 */

export interface QuotaCheck {
  used: number;
  limit: number;
  remaining: number;
  ok: boolean;
}

/** 单步自增并返回新值（原子）。D1 失败时抛给上层决定降级（配额层不静默放行，由调用方选策略） */
export async function incrQuota(
  db: D1Database,
  table: 'ai_usage' | 'ai_global',
  key: { day: string; kind: string; clientId?: string },
  increment = 1,
): Promise<number> {
  if (table === 'ai_usage' && !key.clientId) throw new Error('ai_usage 需要 clientId');
  const stmt =
    table === 'ai_usage'
      ? db.prepare(
          `INSERT INTO ai_usage (day, client_id, kind, used) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (day, client_id, kind) DO UPDATE SET used = used + ?4
           RETURNING used`,
        ).bind(key.day, key.clientId, key.kind, increment)
      : db.prepare(
          `INSERT INTO ai_global (day, kind, used) VALUES (?1, ?2, ?3)
           ON CONFLICT (day, kind) DO UPDATE SET used = used + ?3
           RETURNING used`,
        ).bind(key.day, key.kind, increment);
  const res = await stmt.first<{ used: number }>();
  if (!res) throw new Error('quota upsert 无返回行');
  return res.used;
}

/** 检查+扣减组合：先 incr，再判断是否超限（超限不回滚——差额极小且避免二次写；M6 用余量预判降低超发概率） */
export async function consumeQuota(
  db: D1Database,
  opts: { day: string; kind: string; clientId?: string; globalLimit: number; clientLimit?: number; n?: number },
): Promise<QuotaCheck> {
  const n = opts.n ?? 1;
  const globalUsed = await incrQuota(db, 'ai_global', { day: opts.day, kind: opts.kind }, n);
  const clientUsed = opts.clientId ? await incrQuota(db, 'ai_usage', { day: opts.day, kind: opts.kind, clientId: opts.clientId }, n) : undefined;
  const remaining = Math.max(0, opts.globalLimit - globalUsed);
  const clientOk = opts.clientLimit === undefined || clientUsed === undefined ? true : clientUsed <= opts.clientLimit;
  return { used: globalUsed, limit: opts.globalLimit, remaining, ok: globalUsed <= opts.globalLimit && clientOk };
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
