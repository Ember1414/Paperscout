import { describe, expect, it } from 'vitest';
import {
  AppError,
  ERROR_CODES,
  errorEnvelope,
  errorStatus,
  internalEnvelope,
  okEnvelope,
} from '../../functions/lib/errors';

describe('错误码与 HTTP 状态映射（7.5 表）', () => {
  it('正例：每个错误码都有唯一非零状态', () => {
    for (const code of ERROR_CODES) {
      expect(errorStatus(code)).toBeGreaterThan(0);
    }
  });
  it('正例：与 7.5 的映射一致', () => {
    expect(errorStatus('BAD_QUERY')).toBe(400);
    expect(errorStatus('BAD_PARAM')).toBe(400);
    expect(errorStatus('NOT_FOUND')).toBe(404);
    expect(errorStatus('RATE_LIMITED')).toBe(429);
    expect(errorStatus('AI_QUOTA_EXCEEDED')).toBe(429);
    expect(errorStatus('ALL_SOURCES_FAILED')).toBe(503);
    expect(errorStatus('AI_UNAVAILABLE')).toBe(503);
    expect(errorStatus('UPSTREAM_TIMEOUT')).toBe(504);
    expect(errorStatus('INTERNAL')).toBe(500);
  });
  it('边界：错误码恰好 9 个，无重复', () => {
    expect(new Set(ERROR_CODES).size).toBe(9);
  });
  it('反例：非法错误码在运行时无映射（类型层已拦截），不得产出合法状态', () => {
    // @ts-expect-error 故意传入非法错误码
    expect(errorStatus('NOT_A_CODE')).toBeUndefined();
  });
});

describe('AppError', () => {
  it('正例：携带 code 与显式 status', () => {
    const e = new AppError('UPSTREAM_TIMEOUT', 'Crossref 响应超时');
    expect(e.code).toBe('UPSTREAM_TIMEOUT');
    expect(e.status).toBe(504);
    expect(e.message).toBe('Crossref 响应超时');
  });
  it('正例：可重试码默认 retryable=true', () => {
    expect(new AppError('UPSTREAM_TIMEOUT', 'x').retryable).toBe(true);
    expect(new AppError('RATE_LIMITED', 'x').retryable).toBe(true);
    expect(new AppError('AI_UNAVAILABLE', 'x').retryable).toBe(true);
  });
  it('边界：非可重试码默认 retryable=false', () => {
    expect(new AppError('BAD_QUERY', 'x').retryable).toBe(false);
    expect(new AppError('INTERNAL', 'x').retryable).toBe(false);
  });
  it('边界：显式 opts.retryable 覆盖默认值', () => {
    expect(new AppError('ALL_SOURCES_FAILED', 'x', { retryable: true }).retryable).toBe(true);
    expect(new AppError('UPSTREAM_TIMEOUT', 'x', { retryable: false }).retryable).toBe(false);
  });
  it('反例：@ts-expect-error 拦截非法错误码（运行时退化为 undefined code，映射不存在）', () => {
    // @ts-expect-error 非法错误码
    const e = new AppError('WRONG', 'x');
    expect(e.status).toBeUndefined();
  });
});

describe('响应信封（7.5）', () => {
  it('成功信封：ok=true，meta 透传 requestId/ms/cache', () => {
    const env = okEnvelope({ items: [] }, { requestId: 'a1b2', ms: 12, cache: 'l1' });
    expect(env).toEqual({ ok: true, data: { items: [] }, meta: { requestId: 'a1b2', ms: 12, cache: 'l1' } });
  });
  it('失败信封：ok=false，error 含 code/message/retryable', () => {
    const env = errorEnvelope(new AppError('RATE_LIMITED', '请求过于频繁，请 1 分钟后重试'), 'a1b2');
    expect(env.ok).toBe(false);
    expect(env.error).toEqual({ code: 'RATE_LIMITED', message: '请求过于频繁，请 1 分钟后重试', retryable: true });
    expect(env.meta).toEqual({ requestId: 'a1b2' });
  });
  it('边界：INTERNAL 信封不回显原始 detail', () => {
    const env = internalEnvelope('zz99');
    expect(JSON.stringify(env)).not.toContain('stack');
    expect(env.error.message).not.toMatch(/Error|exception/i);
    expect(env.meta.requestId).toBe('zz99');
  });
  it('反例：失败信封绝不携带 data 字段', () => {
    const env = errorEnvelope(new AppError('NOT_FOUND', '没有找到这篇文献'), 'a1b2');
    expect('data' in env).toBe(false);
  });
});
