// @ts-check
/**
 * API 请求封装（7.2）：超时/取消/错误码映射/信封解析。
 * 错误文案与 7.5 表一致（禁止"未知错误"类无信息文案，6.8）。
 */

/** @typedef {Record<string, string>} ApiQuery */

/** 7.5 错误码 → 前端文案 */
const ERROR_TEXT = /** @type {const} */ ({
  BAD_QUERY: '检索式不完整，请补充关键词',
  BAD_PARAM: '参数不合法',
  ALL_SOURCES_FAILED: '数据源暂时都不可用',
  UPSTREAM_TIMEOUT: '某个数据源响应慢，已使用其余结果',
  NOT_FOUND: '没有找到这篇文献',
  RATE_LIMITED: '请求过于频繁，请 1 分钟后重试',
  AI_QUOTA_EXCEEDED: '今日 AI 额度已用完',
  AI_UNAVAILABLE: 'AI 暂不可用，文献结果不受影响',
  INTERNAL: '服务异常，请稍后重试',
});

export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   * @param {boolean} retryable
   */
  constructor(code, message, status, retryable) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * 统一 GET 请求（10s 超时；AbortSignal 由调用方注入用于竞态取消）
 * @template T
 * @param {string} path
 * @param {ApiQuery} [query]
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<T>}
 */
export async function apiGet(path, query = {}, opts = {}) {
  const sp = new URLSearchParams(query);
  const url = `${path}${sp.toString() ? `?${sp}` : ''}`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 10_000);
  const signal = opts.signal ? anySignal([opts.signal, timeout.signal]) : timeout.signal;
  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (res.status === 429) throw new ApiError('RATE_LIMITED', ERROR_TEXT.RATE_LIMITED, 429, true);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = body?.error;
      const code = typeof err?.code === 'string' && err.code in ERROR_TEXT ? /** @type {keyof typeof ERROR_TEXT} */ (err.code) : 'INTERNAL';
      throw new ApiError(code, typeof err?.message === 'string' ? err.message : ERROR_TEXT[code], res.status, Boolean(err?.retryable));
    }
    return body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (/** @type {any} */ (e)?.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', '网络连接失败，请检查网络后重试', 0, true);
  } finally {
    clearTimeout(timer);
  }
}

/** 组合多个 AbortSignal
 * @param {AbortSignal[]} signals */
function anySignal(signals) {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) ctrl.abort();
    else s.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

/**
 * 检索（v3 信封；兼容 papers 字段）
 * @param {ApiQuery} query
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function searchApi(query, opts = {}) {
  const body = await apiGet('/api/search', query, opts);
  const data = body?.data ?? body; // v2 兼容：无信封时顶层字段
  return {
    requestId: /** @type {string} */ (body?.meta?.requestId ?? ''),
    ms: /** @type {number} */ (body?.meta?.ms ?? 0),
    cache: /** @type {string} */ (body?.meta?.cache ?? ''),
    items: /** @type {any[]} */ (Array.isArray(data?.items) ? data.items : Array.isArray(data?.papers) ? data.papers : []),
    poolSize: /** @type {number} */ (data?.poolSize ?? data?.items?.length ?? 0),
    hasMore: /** @type {boolean} */ (Boolean(data?.hasMore)),
    exhausted: /** @type {boolean} */ (Boolean(data?.exhausted)),
    partial: /** @type {boolean} */ (Boolean(data?.partial)),
    stale: /** @type {boolean} */ (Boolean(data?.stale)),
    sources: /** @type {any[]} */ (Array.isArray(data?.sources) ? data.sources : []),
    parsed: /** @type {any} */ (data?.parsed ?? {}),
  };
}

/**
 * 单篇详情（M3-01）
 * @param {string} id doi:… / W123…
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function workApi(id, opts = {}) {
  const body = await apiGet('/api/work', { id }, opts);
  return /** @type {any} */ (body?.data ?? body);
}
