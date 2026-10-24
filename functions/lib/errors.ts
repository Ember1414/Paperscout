/**
 * 统一错误模型与响应信封（REBUILD_PLAN 7.5）。
 * 错误码枚举与前端文案一一对应，禁止 handler 直接抛裸字符串。
 */

export const ERROR_CODES = [
  'BAD_QUERY',
  'BAD_PARAM',
  'ALL_SOURCES_FAILED',
  'UPSTREAM_TIMEOUT',
  'NOT_FOUND',
  'RATE_LIMITED',
  'AI_QUOTA_EXCEEDED',
  'AI_UNAVAILABLE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_QUERY: 400,
  BAD_PARAM: 400,
  ALL_SOURCES_FAILED: 503,
  UPSTREAM_TIMEOUT: 504,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  AI_QUOTA_EXCEEDED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
};

/** 可安全回显给用户的错误；上游原始错误文本禁止直接透出（1.5 第 2 条） */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: ErrorCode, message: string, opts?: { retryable?: boolean }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = opts?.retryable ?? (code === 'UPSTREAM_TIMEOUT' || code === 'RATE_LIMITED' || code === 'AI_UNAVAILABLE');
    this.status = HTTP_STATUS[code];
  }
}

export function errorStatus(code: ErrorCode): number {
  return HTTP_STATUS[code];
}

/** 成功信封：{ ok, data, meta } */
export function okEnvelope<T>(data: T, meta: { requestId: string; ms?: number; cache?: string }) {
  return { ok: true as const, data, meta };
}

/** 失败信封：{ ok:false, error:{ code, message, retryable }, meta } */
export function errorEnvelope(err: AppError, requestId: string) {
  return {
    ok: false as const,
    error: { code: err.code, message: err.message, retryable: err.retryable },
    meta: { requestId },
  };
}

/** 未知错误 → INTERNAL（不回显 detail，仅留 requestId 供日志追踪） */
export function internalEnvelope(requestId: string) {
  return {
    ok: false as const,
    error: { code: 'INTERNAL' as const, message: '服务异常（已记录 requestId）', retryable: false },
    meta: { requestId },
  };
}
