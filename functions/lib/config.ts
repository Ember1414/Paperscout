/**
 * 全部魔法数字与常量的唯一来源（REBUILD_PLAN 5.1.2 / 5.9 / 7.4 / BUDGET.md）。
 * 规则：其他文件禁止出现魔法数字；改动任何数值须同步 docs/BUDGET.md 或 docs/DECISIONS.md。
 */

/** OpenAlex / Unpaywall 礼貌池邮箱（owner 提供，M0-07） */
export const CONTACT_EMAIL = '2669788267@qq.com';

/**
 * 站点 origin 仅用于构造上游自述（User-Agent / 礼貌池），功能逻辑不得依赖它做路由判断。
 * preview 环境用 SITE_ORIGIN 环境变量覆盖（对应红线"不写死域名"；Warmer 走 TARGET_ORIGIN）。
 */
export const DEFAULT_SITE_ORIGIN = 'https://paperscout.pages.dev';

export function siteOrigin(env?: { SITE_ORIGIN?: string }): string {
  return env?.SITE_ORIGIN || DEFAULT_SITE_ORIGIN;
}

export function userAgent(origin: string): string {
  return `PaperScout/3.0 (+${origin}; mailto:${CONTACT_EMAIL})`;
}

/** 检索编排（5.1.2 关键数值） */
export const SEARCH = {
  PER_SOURCE_TIMEOUT_MS: 4500,
  TOTAL_BUDGET_MS: 6500,
  MAX_CONCURRENCY: 6, // = Workers 免费版同时出站连接上限，不可调高（BUDGET.md §3）
  POOL_TARGET: 200,
  PER_SOURCE_LIMIT: 50,
  MAX_ACTIVE_SOURCES: 9, // 单次检索实际调用源数上限（附录 A）
  MAX_PAGE: 10,
  ALLOWED_LIMITS: [20, 50],
  CACHE_TTL_S: 600,
  RETRY_MAX: 1, // 仅 429/5xx；退避 400ms + 抖动
  RETRY_BACKOFF_MS: 400,
  RETRY_JITTER_MS: 200,
  MAX_QUERY_LENGTH: 200,
  EMPTY_RESULT_TTL_S: 60, // 空结果防抖缓存
  ABSTRACT_MAX_CHARS: 3000,
} as const;

/** 各类缓存 TTL（秒）（7.4 KV 命名空间表 / 7.6 分层缓存） */
export const CACHE_TTL_S = {
  L0: 60,
  L1_POOL: 600,
  L2_POOL: 600,
  TRANSLATE: 86_400,
  AI: 86_400,
  AI_EXTRACT: 7 * 86_400,
  AVAILABILITY: 86_400,
  WORK: 86_400,
  SUGGEST: 3_600,
  TRENDING: 300,
  SOURCES: 300,
  STATS_HOT: 3_600,
  CFG_SOURCES: 300,
} as const;

/** Workers AI（5.9）：模型 / 超时 / 配额（次/天） */
export const AI = {
  MODEL_PRIMARY: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  MODEL_TRANSLATE: '@cf/meta/m2m100-1.2b',
  TIMEOUT_MS: 20_000,
  BODY_LIMIT_BYTES: 32_768,
  MAX_PAPERS: 12,
  MAX_ABSTRACT_CHARS: 800,
  PROMPT_VERSION: 'v1',
  /** 全局 / 单 client 日配额；translate 仅全局 */
  QUOTA: {
    summarize: { global: 120, client: 8 },
    ask: { global: 80, client: 5 },
    extract: { global: 150, client: 20 },
  },
  TRANSLATE_GLOBAL_DAILY: 200,
} as const;

/** 内存令牌桶限流（次/分钟/IP，7.9） */
export const RATE_LIMIT_PER_MIN = {
  search: 30,
  suggest: 60,
  work: 60,
  availability: 30,
  citations: 30,
  similar: 30,
  author: 60,
  org: 60,
  venue: 60,
  ai: 5,
  translate: 10,
  share: 5,
  backup: 10,
  feedback: 5,
  log: 30,
  notifications: 10,
} as const;

/** Warmer（DECISIONS D-001：60min/轮、≤8 key → KV 写 ≤192/天） */
export const WARMER = {
  INTERVAL_MINUTES: 60,
  MAX_KV_KEYS_PER_RUN: 8,
  HOT_KEYWORDS_FOR_POOL: 7,
} as const;

/** 免费额度红线（BUDGET.md；kv_write_log 实测超标时触发降级） */
export const BUDGET = {
  KV_WRITE_DAILY: 300,
  KV_WRITE_ONLINE_DAILY: 108,
  AI_NEURONS_DAILY: 6_000,
  D1_WRITE_DAILY: 5_000,
} as const;

/** 参数白名单（7.5 /api/search 契约） */
export const VALID = {
  SORTS: ['smart', 'relevance', 'newest', 'cited'] as const,
  TYPES: ['all', 'journal', 'conference', 'preprint'] as const,
  LANGS: ['all', 'zh', 'en'] as const,
  FIELDS: ['cs', 'physics', 'math', 'bio', 'med', 'econ'] as const,
  YEARS: { MIN: 1800, MAX: 2100 },
} as const;
