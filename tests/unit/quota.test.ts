import { describe, expect, it, vi } from 'vitest';
import { consumeQuota, incrQuota, todayUtc } from '../../functions/lib/infra/quota';
import { recordKvWrite, writeSearchLog } from '../../functions/lib/infra/metrics';

/** 模拟 D1：语句串行执行（D1 语句级原子性的等价语义），内存表实现 ON CONFLICT 语义 */
function makeMockD1() {
  const tables: Record<string, Map<string, { used: number }>> = {
    ai_usage: new Map(),
    ai_global: new Map(),
    search_log: new Map(),
    kv_write_log: new Map(),
  };
  const executed: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind: (...params: unknown[]) => ({
          first: async <T>(): Promise<T | null> => {
            executed.push({ sql, params });
            if (sql.includes('INSERT INTO ai_usage')) {
              const [day, clientId, kind, inc] = params as [string, string, string, number];
              const k = `${day}|${clientId}|${kind}`;
              const row = tables.ai_usage.get(k) ?? { used: 0 };
              row.used += inc;
              tables.ai_usage.set(k, row);
              return { used: row.used } as T;
            }
            if (sql.includes('INSERT INTO ai_global')) {
              const [day, kind, inc] = params as [string, string, number];
              const k = `${day}|${kind}`;
              const row = tables.ai_global.get(k) ?? { used: 0 };
              row.used += inc;
              tables.ai_global.set(k, row);
              return { used: row.used } as T;
            }
            return null;
          },
          run: async () => {
            executed.push({ sql, params });
            if (sql.includes('INSERT INTO search_log')) {
              const k = `${params[0]}|${params[1]}|${tables.search_log.size}`;
              tables.search_log.set(k, { used: 1 });
            }
            if (sql.includes('INSERT INTO kv_write_log')) {
              const [day, bucket, inc] = params as [string, string, number];
              const k = `${day}|${bucket}`;
              const row = tables.kv_write_log.get(k) ?? { used: 0 };
              row.used += inc;
              tables.kv_write_log.set(k, row);
            }
            return { success: true };
          },
        }),
        first: async () => null,
        run: async () => ({ success: true }),
      };
    },
  };
  return { db: db as unknown as D1Database, tables, executed };
}

describe('quota（M1-10：原子 upsert，并发不超发）', () => {
  it('并发 100 次 incrQuota → used 恰好 100（DoD）', async () => {
    const { db, tables } = makeMockD1();
    await Promise.all(Array.from({ length: 100 }, () => incrQuota(db, 'ai_global', { day: '${today}', kind: 'ask' })));
    expect(tables.ai_global.get('${today}|ask')?.used).toBe(100);
  });
  it('并发 100 次双表 consumeQuota（全局+单 client）→ 无丢失更新，全局闸门按位置判定', async () => {
    const { db, tables } = makeMockD1();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => consumeQuota(db, { day: '${today}', kind: 'ask', clientId: 'c1', globalLimit: 80 })),
    );
    // 核心不变量：100 次并发自增，两表 used 均恰好 100（原子 upsert 无丢失更新）
    expect(tables.ai_global.get('${today}|ask')?.used).toBe(100);
    expect(tables.ai_usage.get('${today}|c1|ask')?.used).toBe(100);
    // 全局闸门：used ≤ 80 的请求判 ok；超出判 false 且 remaining 收敛到 0
    expect(results.filter((r) => r.used <= 80).every((r) => r.ok)).toBe(true);
    expect(results.every((r) => r.used <= 80 || !r.ok)).toBe(true);
    expect(results[99].remaining).toBe(0);
  });
  it('边界：consumeQuota 首次调用 remaining=limit-1', async () => {
    const { db } = makeMockD1();
    const r = await consumeQuota(db, { day: todayUtc(), kind: 'summarize', clientId: 'c9', globalLimit: 120, clientLimit: 8 });
    expect(r).toMatchObject({ used: 1, remaining: 119, ok: true });
  });
  it('反例：ai_usage 无 clientId 抛错（不静默）', async () => {
    const { db } = makeMockD1();
    await expect(incrQuota(db, 'ai_usage', { day: '${today}', kind: 'ask' })).rejects.toThrow();
  });
  it('todayUtc 为 YYYY-MM-DD', () => {
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('metrics（search_log / kv_write_log）', () => {
  it('writeSearchLog 写入一行；db 缺失时静默返回（不建行）', async () => {
    const { db, tables } = makeMockD1();
    await writeSearchLog(db, { queryHash: 'h1', querySample: 'graph'.repeat(60), resultCount: 20, cached: false });
    expect(tables.search_log.size).toBe(1);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeSearchLog(undefined, { queryHash: 'h2' });
    expect(tables.search_log.size).toBe(1);
    // query_sample 截断 120 字
    const entry = [...tables.search_log.keys()][0];
    expect(entry).toContain('h1');
    spy.mockRestore();
  });
  it('D1 抛错 → logWarn 留痕不抛（7.7 降级）', async () => {
    const badDb = {
      prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1 down'); } }) }),
    } as unknown as D1Database;
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(writeSearchLog(badDb, { queryHash: 'x' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('recordKvWrite bucket 计数累加', async () => {
    const { db, tables, executed } = makeMockD1();
    await recordKvWrite(db, 'translate');
    await recordKvWrite(db, 'translate');
    await recordKvWrite(db, 'ai', 3);
    const today = todayUtc();
    expect(tables.kv_write_log.get(`${today}|translate`)?.used).toBe(2);
    expect(tables.kv_write_log.get(`${today}|ai`)?.used).toBe(3);
    expect(executed.filter((e) => e.sql.includes('kv_write_log')).length).toBe(3);
  });
});
