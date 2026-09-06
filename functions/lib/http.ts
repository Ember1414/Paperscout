const RETRYABLE = new Set([429, 409, 500, 502, 503, 504]);

/** 上游请求超时（毫秒）：防止慢源拖垮整体响应 */
const UPSTREAM_TIMEOUT_MS = 12000;

/**
 * 带自动重试的 fetch：
 * - 对 429/409/5xx 状态码重试（指数退避 + 抖动）
 * - 对超时 / 网络错误同样重试（BUG 修复：此前超时不重试，
 *   导致 DBLP / OpenAIRE 等偶发超时的源被直接判失败）
 * - 每次尝试使用全新的超时信号
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries = 2,
  baseBackoffMs = 700,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (!RETRYABLE.has(res.status) || attempt === retries) {
        return res;
      }

      // 可重试状态码：退避后重试
      const jitter = Math.random() * 200;
      await new Promise((r) => setTimeout(r, baseBackoffMs * (attempt + 1) + jitter));
    } catch (error) {
      // 超时 / 网络错误：同样退避重试
      lastError = error;
      if (attempt === retries) throw error;
      const jitter = Math.random() * 200;
      await new Promise((r) => setTimeout(r, baseBackoffMs * (attempt + 1) + jitter));
    }
  }

  throw lastError ?? new Error('fetch failed');
}
