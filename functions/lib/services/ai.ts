import { SEARCH, AI, CACHE_TTL_S } from '../config';
import { AppError, errorEnvelope, okEnvelope } from '../errors';
import { verifyCitations, stripInvalidSentences } from '../ai/verify';
import { SYSTEM_PROMPT, EXTRACT_PROMPT, DSL_PROMPT, PROMPT_VERSION, buildEvidence } from '../ai/prompts';
import { consumeQuota, todayUtc } from '../infra/quota';
import { newRequestId, logInfo, logWarn } from '../infra/log';
import { fetchUpstream } from '../infra/http';
import { getWorkDetail } from './work';

/**
 * AI 三端点（REBUILD_PLAN 5.9 / M6-01~07）：
 * POST /api/ai/summarize  — 一组文献研究现状（300 字，[n] 引用校验）
 * POST /api/ai/ask        — 带证据问答（SSE 流式 + 拒答 + 停止）
 * POST /api/ai/extract    — 单篇精读（贡献/方法/证据强度/局限）
 * 配额：ai_global / ai_usage（D1 原子 upsert，M1-10 已建表）；缓存：KV 24h；降级：AI 不可用不影响检索。
 * 零幻觉：AI 输出必须含 [n] 引用（verifyCitations），不可校验即拒答。
 */

/** @typedef {import('../errors').AppError} AppErrorT */

function makeAi() { return AI; }

/**
 * 调 Workers AI 模型
 * @param {{ AI?: Ai }} env
 * @param {string} prompt
 */
async function runModel(env: { AI?: Ai }, prompt: string): Promise<string> {
  const binding = env?.AI;
  if (!binding) throw new AppError('AI_UNAVAILABLE', 'AI 暂不可用，文献结果不受影响', { retryable: true });
  try {
    const r = await binding.run(AI.MODEL_PRIMARY, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1024,
    });
    const raw: any = r;
    return String(raw?.response ?? '') || '';
  } catch (e: unknown) {
    logWarn('ai:model-failed', e instanceof Error ? e.message.slice(0, 80) : String(e));
    throw new AppError('AI_UNAVAILABLE', 'AI 暂不可用，文献结果不受影响', { retryable: true });
  }
}

/** 429 处理 */
function mapAiError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('429') || msg.includes('rate')) return new AppError('RATE_LIMITED', 'AI 请求过于频繁，请 1 分钟后重试', { retryable: true });
  return new AppError('AI_UNAVAILABLE', 'AI 暂不可用', { retryable: true });
}

/** AI KV 缓存（24h） */
async function aiCacheGet(env: { CACHE?: KVNamespace } | undefined, kind: string, input: string): Promise<any | null> {
  if (!env?.CACHE) return null;
  try {
    const key = `ai:${kind}:${PROMPT_VERSION}:${input}`;
    return await env.CACHE.get(key, 'json');
  } catch { return null; }
}
async function aiCachePut(env: { CACHE?: KVNamespace } | undefined, kind: string, input: string, result: any): Promise<void> {
  if (!env?.CACHE) return;
  try {
    const key = `ai:${kind}:${PROMPT_VERSION}:${input}`;
    await env.CACHE.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_S.AI });
  } catch (e) { console.warn('ai:cache-put-failed', e instanceof Error ? e.message : String(e)); }
}

/** SHA-1-like 简易 hash（FNV-1a） */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

/* ==================== POST /api/ai/summarize ==================== */

/**
 * @param {Request} request
 * @param {{ AI?: Ai, DB?: D1Database, CACHE?: KVNamespace }} env
 */
export async function handleSummarize(request: Request, env: { AI?: Ai; DB?: D1Database; CACHE?: KVNamespace }): Promise<Response> {
  const body: any = await request.json().catch(() => ({}));
  const papers = (/** @type {any} */ (body)).papers ?? [];
  if (!Array.isArray(papers) || !papers.length || papers.length > AI.MAX_PAPERS) throw new AppError('BAD_PARAM', `papers 需为 1..${AI.MAX_PAPERS} 条`);
  const clientId = request.headers.get('X-Client-Id') ?? 'anon';

  // 配额（M6-02：全局 + 单 client D1 原子 upsert）
  const db = env?.DB;
  if (db) {
    const quota = await consumeQuota(db, { day: todayUtc(), kind: 'summarize', clientId, globalLimit: AI.QUOTA.summarize.global, clientLimit: AI.QUOTA.summarize.client });
    if (!quota.ok) {
      return new Response(JSON.stringify(errorEnvelope(new AppError('AI_QUOTA_EXCEEDED', '今日 AI 额度已用完（免费额度保护），明天 00:00 UTC 重置'), 'q')), { status: 429, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
  }

  // 缓存
  const inputHash = fnv(papers.map((p) => p.doi ?? p.title).sort().join('|'));
  const cached = await aiCacheGet(env, 'summarize', inputHash);
  if (cached) return new Response(JSON.stringify(okEnvelope({ ...cached, cached: true }, { requestId: newRequestId() })), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  // Prompt
  const evidence = buildEvidence(papers);
  const prompt = `请基于以下文献，写一篇 300 字左右的中文研究现状总结。每个论断标注 [编号]。\n\n${evidence}`;

  // 调模型
  const answer = await runModel(env, prompt);
  // 引用校验（零幻觉底线）
  const v = verifyCitations(answer, papers.length);
  if (!v.ok) {
    if (v.reason === 'insufficient') throw new AppError('AI_UNAVAILABLE', '现有文献不足以回答该问题', { retryable: false });
    const stripped = stripInvalidSentences(answer, v.invalidIds);
    const out = { summary: stripped, citations: v.citedIds, verified: false };
    await aiCachePut(env, 'summarize', inputHash, out);
    return new Response(JSON.stringify(okEnvelope(out, { requestId: newRequestId() })), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const out = { summary: answer, citations: v.citedIds, verified: true };
  await aiCachePut(env, 'summarize', inputHash, out);
  return new Response(JSON.stringify(okEnvelope(out, { requestId: newRequestId() })), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/* ==================== POST /api/ai/ask（SSE 流式） ==================== */

/**
 * @param {Request} request
 * @param {{ AI?: Ai, DB?: D1Database, CACHE?: KVNamespace }} env
 */
export async function handleAsk(request: Request, env: { AI?: Ai; DB?: D1Database; CACHE?: KVNamespace }): Promise<Response> {
  const body: any = await request.json().catch(() => ({}));
  const question = String((/** @type {any} */ (body)).question ?? '').trim();
  const papers = (/** @type {any} */ (body)).papers ?? [];
  if (!question || question.length > 500) throw new AppError('BAD_QUERY', '请输入 ≤500 字的问题');
  if (!Array.isArray(papers) || !papers.length) throw new AppError('BAD_PARAM', '需要提供检索结果作为证据');
  const clientId = request.headers.get('X-Client-Id') ?? 'anon';

  // 配额
  const db = env?.DB;
  if (db) {
    const quota = await consumeQuota(db, { day: todayUtc(), kind: 'ask', clientId, globalLimit: AI.QUOTA.ask.global, clientLimit: AI.QUOTA.ask.client });
    if (!quota.ok) throw new AppError('AI_QUOTA_EXCEEDED', '今日 AI 额度已用完');
  }

  const evidence = buildEvidence(papers);
  const prompt = `用户问题：${question}\n\n请基于以下文献回答。每个论断标注 [编号]。\n\n${evidence}`;

  // SSE 流式（M6-04）
  const rid = newRequestId();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const answer = await runModel(env, prompt);
        const v = verifyCitations(answer, papers.length);
        if (v.reason === 'insufficient') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, refusal: true, message: '现有文献不足以回答该问题' })}\n\n`));
        } else {
          // 逐句推送（模拟流式；实际模型一次性返回，此处按句切分提供"打字机"体验）
          const clean = v.ok ? answer : stripInvalidSentences(answer, v.invalidIds);
          const sentences = clean.split(/(?<=[。！？\n])/);
          for (const s of sentences) {
            if (s.trim()) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: s })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, citations: v.citedIds, verified: v.ok })}\n\n`));
        }
      } catch (e) {
        const err = mapAiError(e);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Request-Id': rid,
    },
  });
}

/* ==================== POST /api/ai/extract ==================== */

/**
 * 单篇精读（M6-07）
 * @param {Request} request
 * @param {{ AI?: Ai, DB?: D1Database, CACHE?: KVNamespace }} env
 */
export async function handleExtract(request: Request, env: { AI?: Ai; DB?: D1Database; CACHE?: KVNamespace }): Promise<Response> {
  const body: any = await request.json().catch(() => ({}));
  const doi = String(body.doi ?? '');
  if (!doi) throw new AppError('BAD_PARAM', '请提供 doi');
  const clientId = request.headers.get('X-Client-Id') ?? 'anon';

  const db = env?.DB;
  if (db) {
    const quota = await consumeQuota(db, { day: todayUtc(), kind: 'extract', clientId, globalLimit: AI.QUOTA.extract.global, clientLimit: AI.QUOTA.extract.client });
    if (!quota.ok) throw new AppError('AI_QUOTA_EXCEEDED', '今日 AI 额度已用完');
  }

  // 缓存
  const inputHash = fnv(doi);
  const cached = await aiCacheGet(env, 'extract', inputHash);
  if (cached) return new Response(JSON.stringify(okEnvelope({ ...cached, cached: true }, { requestId: newRequestId() })), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  // 获取论文元数据
  const detail = await getWorkDetail(doi);
  const abstract = detail.work.abstract ?? '';
  if (!abstract) throw new AppError('AI_UNAVAILABLE', '该论文无摘要，AI 无法分析');

  const prompt = `<paper>\n标题：${detail.work.title}\n摘要：${abstract.slice(0, 800)}\n</paper>\n\n请分析。`;
  const answer = await runModel(env, prompt);
  const v = verifyCitations(answer, 1);
  const out = { analysis: v.ok ? answer : stripInvalidSentences(answer, v.invalidIds), verified: v.ok };
  await aiCachePut(env, 'extract', inputHash, out);
  return new Response(JSON.stringify(okEnvelope(out, { requestId: newRequestId() })), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

/* ==================== 自然语言 → DSL（M6-08） ==================== */

/**
 * @param {Request} request
 * @param {{ AI?: Ai }} env
 */
export async function handleDsl(request: Request, env: { AI?: Ai }): Promise<Response> {
  const body: any = await request.json().catch(() => ({}));
  const input = String((/** @type {any} */ (body)).input ?? '').trim();
  if (!input || input.length > 200) throw new AppError('BAD_QUERY', '请输入 ≤200 字的检索描述');

  const prompt = `${DSL_PROMPT}${input}`;
  const answer = await runModel(env, prompt);
  const dsl = answer.trim().replace(/^["']|["']$/g, '');
  return new Response(JSON.stringify(okEnvelope({ dsl, input }, { requestId: newRequestId() })), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
