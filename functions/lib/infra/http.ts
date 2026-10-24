import { SEARCH, siteOrigin, userAgent } from '../config';
import type { UpstreamError } from '../types';

/**
 * 统一上游调用（REBUILD_PLAN 5.1.3 / 7.7）：
 * - 软超时（AbortSignal）+ 仅 429/5xx 重试 1 次（400ms 退避 + 抖动）
 * - 永不抛异常给编排层，失败返回 { ok:false, error }
 * - content-type 守卫：上游返回 HTML 视为源故障（parse_error）
 */

export interface UpstreamOk<T> {
  ok: true;
  status: number;
  data: T;
  text?: string;
  elapsedMs: number;
}
export interface UpstreamFail {
  ok: false;
  status?: number;
  data?: undefined;
  text?: string;
  elapsedMs: number;
  error: UpstreamError;
}
export type UpstreamResult<T = unknown> = UpstreamOk<T> | UpstreamFail;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface FetchUpstreamOpts {
  source: string;
  timeoutMs?: number;
  retry?: number;
  headers?: Record<string, string>;
  /** 期望响应类型，默认 json；text 用于 XML/Atom */
  expect?: 'json' | 'text';
}

export async function fetchUpstream<T = unknown>(url: string, opts: FetchUpstreamOpts): Promise<UpstreamResult<T>> {
  const timeoutMs = opts.timeoutMs ?? SEARCH.PER_SOURCE_TIMEOUT_MS;
  const retry = opts.retry ?? SEARCH.RETRY_MAX;
  const headers = { 'User-Agent': userAgent(siteOrigin()), ...opts.headers };
  const t0 = Date.now();
  let last: UpstreamFail | null = null;

  for (let attempt = 0; attempt <= retry; attempt++) {
    if (attempt > 0) {
      const backoff = SEARCH.RETRY_BACKOFF_MS * attempt + Math.random() * SEARCH.RETRY_JITTER_MS;
      await new Promise((r) => setTimeout(r, backoff));
    }
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      const elapsedMs = Date.now() - t0;

      if (!res.ok) {
        const kind: UpstreamError['kind'] = res.status === 429 ? 'rate_limited' : 'http';
        last = { ok: false, status: res.status, elapsedMs, error: { kind, message: `${opts.source} HTTP ${res.status}`, status: res.status } };
        if (RETRYABLE_STATUS.has(res.status) && attempt < retry) continue;
        return last;
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (opts.expect === 'text') {
        const text = await res.text();
        if (/<html[\s>]/i.test(text.slice(0, 512))) {
          return { ok: false, status: res.status, text, elapsedMs, error: { kind: 'parse', message: `${opts.source} 返回 HTML 而非预期内容`, status: res.status } };
        }
        return { ok: true, status: res.status, text, data: undefined as T, elapsedMs };
      }

      if (!/json/i.test(contentType)) {
        // content-type 不匹配（7.7：上游返回 HTML 视为源故障）
        const body = await res.text();
        return { ok: false, status: res.status, text: body.slice(0, 512), elapsedMs, error: { kind: 'parse', message: `${opts.source} content-type 异常（${contentType || 'none'}）`, status: res.status } };
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        return { ok: false, status: res.status, elapsedMs, error: { kind: 'parse', message: `${opts.source} 响应不是合法 JSON`, status: res.status } };
      }
      return { ok: true, status: res.status, data: data as T, elapsedMs };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = /timeout|abort/i.test(msg);
      last = {
        ok: false,
        elapsedMs: Date.now() - t0,
        error: { kind: isTimeout ? 'timeout' : 'network', message: `${opts.source} ${isTimeout ? '超时' : '网络错误'}：${msg.slice(0, 80)}` },
      };
      if (attempt < retry) continue;
      return last;
    }
  }
  return last as UpstreamFail;
}
