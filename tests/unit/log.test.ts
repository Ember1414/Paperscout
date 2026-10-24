import { afterEach, describe, expect, it, vi } from 'vitest';
import { logError, logInfo, logWarn, newRequestId } from '../../functions/lib/infra/log';

describe('结构化日志（7.8）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('正例：logInfo 输出单行 JSON，含 lvl/rid/route/ts', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logInfo('a1b2', 'search', { ms: 123, cache: 'l1' });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ lvl: 'info', rid: 'a1b2', route: 'search', ms: 123, cache: 'l1' });
    expect(typeof parsed.ts).toBe('number');
  });
  it('正例：logWarn/logError 分别走 console.warn/error', () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    logWarn('r1', 'search', { msg: '源超时' });
    logError('r1', 'search', { code: 'ALL_SOURCES_FAILED' });
    expect(w).toHaveBeenCalledOnce();
    expect(e).toHaveBeenCalledOnce();
    expect(JSON.parse(w.mock.calls[0][0] as string).lvl).toBe('warn');
    expect(JSON.parse(e.mock.calls[0][0] as string).lvl).toBe('error');
  });
  it('边界：fields 为空时仍输出合法 JSON', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logInfo('r2', 'health');
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.rid).toBe('r2');
  });
  it('边界：循环引用字段不抛异常，且显式告警不静默', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => logInfo('r3', 'x', circular)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith('log:unserializable-fields');
    expect(logSpy).toHaveBeenCalledOnce();
  });
  it('反例：结构化输出必须是单行（可直接被日志流 grep）', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logInfo('r4', 'x', { nested: { deep: [1, 2] } });
    const out = spy.mock.calls[0][0] as string;
    expect(out).not.toContain('\n');
  });
});

describe('requestId（7.3 中间件第 1 步）', () => {
  it('正例：8 位、字母数字', () => {
    const rid = newRequestId();
    expect(rid).toMatch(/^[0-9a-f]{8}$/);
  });
  it('边界：多次调用互不相同（抽查 50 次）', () => {
    const set = new Set(Array.from({ length: 50 }, () => newRequestId()));
    expect(set.size).toBe(50);
  });
});
