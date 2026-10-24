import { describe, expect, it } from 'vitest';
import {
  AI,
  BUDGET,
  CACHE_TTL_S,
  CONTACT_EMAIL,
  RATE_LIMIT_PER_MIN,
  SEARCH,
  VALID,
  WARMER,
  siteOrigin,
  userAgent,
} from '../../functions/lib/config';

/** 常量唯一来源的"锚点测试"：与 REBUILD_PLAN 5.1.2 / 5.9 / BUDGET.md 逐项对账，防手滑改动 */
describe('SEARCH（5.1.2 关键数值表）', () => {
  it('与规划书 5.1.2 逐项一致', () => {
    expect(SEARCH.PER_SOURCE_TIMEOUT_MS).toBe(4500);
    expect(SEARCH.TOTAL_BUDGET_MS).toBe(6500);
    expect(SEARCH.MAX_CONCURRENCY).toBe(6);
    expect(SEARCH.POOL_TARGET).toBe(200);
    expect(SEARCH.PER_SOURCE_LIMIT).toBe(50);
    expect(SEARCH.CACHE_TTL_S).toBe(600);
    expect(SEARCH.RETRY_MAX).toBe(1);
  });
  it('边界：软超时 < 硬截止；并发不超过平台出站连接上限 6', () => {
    expect(SEARCH.PER_SOURCE_TIMEOUT_MS).toBeLessThan(SEARCH.TOTAL_BUDGET_MS);
    expect(SEARCH.MAX_CONCURRENCY).toBeLessThanOrEqual(6);
  });
  it('边界：单次调用源数 ≤9 且 < 平台子请求上限 50（含重试与 KV/D1 操作余量）', () => {
    expect(SEARCH.MAX_ACTIVE_SOURCES).toBeLessThanOrEqual(9);
    expect(SEARCH.MAX_ACTIVE_SOURCES * (SEARCH.RETRY_MAX + 1)).toBeLessThan(50);
  });
  it('反例：并发 6 不可配成 9 源同时打满（附录 A 规则 2）', () => {
    expect(SEARCH.MAX_CONCURRENCY).toBeLessThan(SEARCH.MAX_ACTIVE_SOURCES);
  });
});

describe('AI 配额（5.9.1 表）', () => {
  it('与规划书 5.9.1 一致', () => {
    expect(AI.QUOTA.summarize).toEqual({ global: 120, client: 8 });
    expect(AI.QUOTA.ask).toEqual({ global: 80, client: 5 });
    expect(AI.QUOTA.extract).toEqual({ global: 150, client: 20 });
    expect(AI.TRANSLATE_GLOBAL_DAILY).toBe(200);
    expect(AI.BODY_LIMIT_BYTES).toBe(32_768);
    expect(AI.MAX_PAPERS).toBe(12);
  });
  it('边界：单 client 配额 < 全局配额（否则单人可吃光全局）', () => {
    for (const q of Object.values(AI.QUOTA)) {
      expect(q.client).toBeLessThan(q.global);
    }
  });
  it('边界：模型名在免费版可用范围（BUDGET.md：llama-3.3-70b-fp8-fast / m2m100-1.2b）', () => {
    expect(AI.MODEL_PRIMARY).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(AI.MODEL_TRANSLATE).toBe('@cf/meta/m2m100-1.2b');
  });
  it('反例：prompt 缓存 key 必须含 PROMPT_VERSION（附录 C）', () => {
    expect(AI.PROMPT_VERSION).toMatch(/^v\d+$/);
  });
});

describe('Warmer 与额度红线（DECISIONS D-001 / BUDGET.md）', () => {
  it('Warmer 60min/轮 ≤8 key → KV 写 ≤192/天', () => {
    expect(WARMER.INTERVAL_MINUTES).toBe(60);
    expect(WARMER.MAX_KV_KEYS_PER_RUN).toBe(8);
    expect((24 * 60) / WARMER.INTERVAL_MINUTES * WARMER.MAX_KV_KEYS_PER_RUN).toBeLessThanOrEqual(192);
  });
  it('在线 KV 写 ≤108/天，Warmer + 在线 ≤300/天（P-20）', () => {
    expect(BUDGET.KV_WRITE_ONLINE_DAILY).toBeLessThanOrEqual(108);
    expect(WARMER.MAX_KV_KEYS_PER_RUN * 24 + BUDGET.KV_WRITE_ONLINE_DAILY).toBeLessThanOrEqual(BUDGET.KV_WRITE_DAILY);
    expect(BUDGET.KV_WRITE_DAILY).toBeLessThanOrEqual(300);
  });
  it('边界：AI Neuron 预算留 40% 余量（≤6000/10000）', () => {
    expect(BUDGET.AI_NEURONS_DAILY).toBe(6_000);
  });
  it('反例：限流表不得高于 7.9 规定值', () => {
    expect(RATE_LIMIT_PER_MIN.search).toBe(30);
    expect(RATE_LIMIT_PER_MIN.ai).toBe(5);
    expect(RATE_LIMIT_PER_MIN.translate).toBe(10);
  });
});

describe('缓存 TTL 与参数白名单', () => {
  it('正例：翻译/AI 24h，抽取 7d（5.9.1）', () => {
    expect(CACHE_TTL_S.TRANSLATE).toBe(86_400);
    expect(CACHE_TTL_S.AI).toBe(86_400);
    expect(CACHE_TTL_S.AI_EXTRACT).toBe(7 * 86_400);
  });
  it('边界：年份窗口 1800..2100；limit 仅 20/50；page ≤10（7.5 契约）', () => {
    expect(VALID.YEARS).toEqual({ MIN: 1800, MAX: 2100 });
    expect(VALID.SORTS).toContain('smart');
    expect(SEARCH.ALLOWED_LIMITS).toEqual([20, 50]);
    expect(SEARCH.MAX_PAGE).toBe(10);
  });
  it('反例：白名单不含未定义枚举', () => {
    expect(VALID.LANGS).not.toContain('jp');
    expect(VALID.TYPES).not.toContain('thesis');
  });
});

describe('礼貌池与 UA（5.1.3 / M0-07）', () => {
  it('正例：CONTACT_EMAIL 为 owner 提供的真实邮箱', () => {
    expect(CONTACT_EMAIL).toBe('2669788267@qq.com');
    expect(CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });
  it('正例：UA 含 3.0 标识、站点与 mailto', () => {
    const ua = userAgent('https://paperscout.pages.dev');
    expect(ua).toContain('PaperScout/3.0');
    expect(ua).toContain('mailto:2669788267@qq.com');
  });
  it('边界：siteOrigin 支持环境变量覆盖（preview 场景）', () => {
    expect(siteOrigin({ SITE_ORIGIN: 'https://abc.paperscout.pages.dev' })).toBe('https://abc.paperscout.pages.dev');
    expect(siteOrigin(undefined)).toBeTruthy();
    expect(siteOrigin({})).toBeTruthy();
  });
  it('反例：空字符串环境变量回退缺省，不产出空 origin', () => {
    expect(siteOrigin({ SITE_ORIGIN: '' })).not.toBe('');
  });
});
