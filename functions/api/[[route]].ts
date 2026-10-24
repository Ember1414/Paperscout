import type { Env, LegacySourceId, Paper } from '../lib/types';
import { runSearch, parseV3Params } from '../lib/services/search';
import { AppError, errorEnvelope, internalEnvelope, okEnvelope } from '../lib/errors';
import { logError, logInfo, newRequestId } from '../lib/infra/log';
import { writeSearchLog } from '../lib/infra/metrics';
import { getSuggestions, validateSuggestParams } from '../lib/services/suggest';
import { getWorkDetail } from '../lib/services/work';
import { parseParams, filterByLanguage, filterByType, HttpError, jsonResponse, mergeResults, sortPapers, ADAPTERS, VALID_SOURCES } from '../lib/aggregate';
import { getTrending } from '../lib/crawler';
import { readHealth, isCoolingDown, recordSuccess, recordFailure } from '../lib/sourceHealth';
import {
  listHistory, addHistory, clearHistory,
  listFavorites, toggleFavorite,
  relatedWorks, authorProfile,
  aiSummarize, aiAsk,
  bumpKeywordStats, keywordStats,
} from '../lib/services';

/**
 * PaperScout API 路由（Cloudflare Pages Functions）
 * /api/search   —— 多源聚合检索（env.SEARCH_V3 === '1' 时走 v3 编排器，8.5 迁移 feature flag）
 * /api/sources  —— 数据源列表
 * /api/trending —— 爬虫抓取的 arXiv 最新论文
 * /api/health   —— 健康检查
 */

/** v3 /api/search：新响应信封 { ok, data, meta }；data.items 与 data.papers 双字段保证 R-08 兼容 */
async function handleSearchV3(request: Request, env: Env, ctx: EventContext<Env, any, any>): Promise<Response> {
  const rid = newRequestId();
  const t0 = Date.now();
  const url = new URL(request.url);
  try {
    const params = parseV3Params(url);
    const result = await runSearch(params, { env, ctx });
    const ms = Date.now() - t0;
    logInfo(rid, 'search.v3', { q: params.q.slice(0, 60), ms, poolSize: result.poolSize, partial: result.partial, cache: result.cacheLayer ?? 'miss' });
    // search_log：仅未命中缓存的检索计 1 行（waitUntil 异步写，D1 失败降级放行）
    if (!result.cacheLayer) {
      ctx.waitUntil(
        writeSearchLog(env.DB, {
          queryHash: result.queryHash,
          querySample: params.q,
          lang: params.lang ?? 'all',
          sourcesOk: result.sources.filter((s0) => s0.status === 'ok').length,
          sourcesTotal: result.sources.length,
          elapsedMs: ms,
          resultCount: result.total,
          cached: false,
        }),
      );
    }
    const body = okEnvelope(
      {
        ...result,
        // 兼容字段（R-08）：legacy 前端读取 items / papers 任一
        papers: result.items,
      },
      { requestId: rid, ms, cache: result.cacheLayer ?? 'miss' },
    );
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-Id': rid,
        'X-Cache': result.cacheLayer ?? 'miss',
      },
    });
  } catch (error) {
    const ms = Date.now() - t0;
    if (error instanceof AppError) {
      logInfo(rid, 'search.v3', { code: error.code, ms });
      return new Response(JSON.stringify(errorEnvelope(error, rid)), {
        status: error.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    logError(rid, 'search.v3', { ms, err: error instanceof Error ? error.message.slice(0, 120) : String(error) });
    return new Response(JSON.stringify(internalEnvelope(rid)), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

async function handleSearch(request: Request, env: Env, ctx: EventContext<Env, any, any>): Promise<Response> {
  const url = new URL(request.url);
  const params = parseParams(url);

  // KV 缓存热点查询（10 分钟）；v3：智能排序 + 新数据源
  const cacheKey = `search:v3:${JSON.stringify(params)}`;
  const cached = await env.CACHE.get<Paper[]>(cacheKey, 'json');
  if (cached) {
    return jsonResponse({ cached: true, total: cached.length, papers: cached });
  }

  // 并行查询所有选定数据源；熔断冷却中的源直接跳过（不报错、不耗时）
  const health = await readHealth(env);
  const settled = await Promise.allSettled(
    params.sources.map((s) => {
      if (isCoolingDown(health, s)) {
        return Promise.resolve({ __cooldown: true });
      }
      return ADAPTERS[s as LegacySourceId].search(params).then(
        (v) => {
          ctx.waitUntil(recordSuccess(env, s));
          return v;
        },
        (err) => {
          ctx.waitUntil(recordFailure(env, s));
          throw err;
        },
      );
    }),
  );

  const errors: string[] = [];
  const cooldown: string[] = [];
  const lists: Paper[][] = [];
  settled.forEach((r, i) => {
    const name = ADAPTERS[params.sources[i] as LegacySourceId].name;
    if (r.status === 'fulfilled') {
      if (Array.isArray(r.value)) lists.push(r.value);
      else cooldown.push(name); // 熔断冷却中，自动跳过
    } else {
      errors.push(`${name}: ${r.reason?.message ?? '未知错误'}`);
    }
  });

  if (!lists.length) {
    throw new HttpError(502, `所有数据源均不可用 —— ${errors.join('; ') || '未知错误'}`);
  }

  // 语言筛选（中文 / 英文 / 全部）—— 严格模式：选中文则只返回中文结果
  const langFiltered = lists.map((list) => filterByLanguage(list, params.language));
  // 文献类型筛选（期刊 / 会议 / 预印本）
  const finalLists = langFiltered.map((list) => filterByType(list, params.paperType));

  const papers = sortPapers(mergeResults(finalLists), params.sort, params.query);

  // BUG 修复：空结果不缓存（部分源限流导致的空结果会在下下次请求中自动恢复）
  if (papers.length) {
    ctx.waitUntil(env.CACHE.put(cacheKey, JSON.stringify(papers), { expirationTtl: 600 }));
  }

  return jsonResponse({
    cached: false,
    total: papers.length,
    page: params.page,
    language: params.language,
    paperType: params.paperType,
    // 源可用性统计：成功 N / 共 M（K 个熔断冷却中）
    sourcesOk: lists.length,
    sourcesTotal: params.sources.length,
    cooldown,
    papers,
    errors,
  });
}

/**
 * 翻译接口：代理免费翻译服务（无需密钥），结果 KV 缓存 24 小时
 * GET /api/translate?q=<待翻译文本>&tl=<目标语言，默认 zh-CN>
 * 主通道：Google Translate gtx 端点；备用通道：MyMemory
 */
async function handleTranslate(url: URL, env: Env, ctx: EventContext<Env, any, any>): Promise<Response> {
  const text = (url.searchParams.get('q') ?? '').trim();
  const tl = url.searchParams.get('tl') || 'zh-CN';
  if (!text) throw new HttpError(400, '缺少待翻译文本（q）');
  if (text.length > 4000) throw new HttpError(400, '文本过长（上限 4000 字符）');

  const cacheKey = `translate:${tl}:${text}`;
  const cached = await env.CACHE.get<{ translated: string; provider: string }>(cacheKey, 'json');
  if (cached) return jsonResponse({ ...cached, cached: true });

  let translated = '';
  let provider = '';

  // 通道 1：Google Translate gtx
  try {
    const upstream =
      'https://translate.googleapis.com/translate_a/single?' +
      new URLSearchParams({ client: 'gtx', sl: 'auto', tl, dt: 't', q: text });
    const res = await fetch(upstream, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      translated = (data?.[0] ?? []).map((seg: any) => seg?.[0] ?? '').join('').trim();
      if (translated) provider = 'google';
    }
  } catch (e) {
    // 走备用通道，但必须留痕（G-10）
    console.warn('translate:channel-failed', e instanceof Error ? e.message : String(e));
  }

  // 通道 2：MyMemory（备用）
  if (!translated) {
    const sourceLang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en';
    const mmUrl =
      'https://api.mymemory.translated.net/get?' +
      new URLSearchParams({ q: text.slice(0, 500), langpair: `${sourceLang}|${tl}` });
    const res = await fetch(mmUrl);
    if (res.ok) {
      const data = (await res.json()) as any;
      translated = String(data?.responseData?.translatedText ?? '').trim();
      if (translated) provider = 'mymemory';
    }
  }

  // 通道 3：Cloudflare Workers AI 专用翻译模型 m2m100（自有基础设施，最可靠的兜底）
  if (!translated && env.AI) {
    try {
      const src = /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
      const tgt = tl === 'zh-CN' || tl === 'zh' ? 'zh' : 'en';
      const r: any = await env.AI.run('@cf/meta/m2m100-1.2b', {
        text: text.slice(0, 900),
        source_lang: src,
        target_lang: tgt,
      });
      translated = String(r?.translated_text ?? '').trim();
      if (translated) provider = 'workers-ai';
    } catch (e) {
      // 走最后兜底，但必须留痕（G-10）
      console.warn('translate:channel-failed', e instanceof Error ? e.message : String(e));
    }
  }

  // 通道 4：Workers AI 大模型指令翻译（m2m100 失败时的最终兜底）
  if (!translated && env.AI) {
    try {
      const r: any = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          {
            role: 'system',
            content:
              tl === 'zh-CN'
                ? 'You are a professional academic translator. Translate the user text into Simplified Chinese. Output ONLY the translation, no explanations.'
                : `Translate the user text into ${tl}. Output ONLY the translation.`,
          },
          { role: 'user', content: text },
        ],
        max_tokens: 2000,
      });
      translated = String(r?.response ?? '').trim();
      if (translated) provider = 'workers-ai-llm';
    } catch (e) {
      // 全部通道失败，留痕（G-10）后由 502 兜底
      console.warn('translate:all-channels-failed', e instanceof Error ? e.message : String(e));
    }
  }

  if (!translated) throw new HttpError(502, '翻译服务均不可用，请稍后重试');

  const result = { translated, target: tl, provider };
  ctx.waitUntil(env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 }));
  return jsonResponse(result);
}

/**
 * 数据源诊断：从当前边缘节点探测各上游的可达性
 * GET /api/diag —— 运维排查利器
 */
async function handleDiag(): Promise<Response> {
  const targets: [string, string, number][] = [
    ['arXiv', 'https://export.arxiv.org/api/query?search_query=all:test&max_results=1', 200],
    ['OpenAlex', 'https://api.openalex.org/works?search=test&per_page=1', 200],
    ['Crossref', 'https://api.crossref.org/works?rows=1', 200],
    ['SemanticScholar', 'https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1', 200],
    ['PubMed', 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=test&retmode=json&retmax=1', 200],
    ['DBLP', 'https://dblp.org/search/publ/api?q=test&h=1&format=json', 200],
    ['DOAJ', 'https://doaj.org/api/search/articles/test?pageSize=1', 200],
    ['EuropePMC', 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=test&format=json&pageSize=1', 200],
    ['OpenAIRE', 'https://api.openaire.eu/search/publications?keywords=test&size=1', 200],
    ['Zenodo', 'https://zenodo.org/api/records?q=test&size=1', 200],
    ['翻译(Google)', 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=hi', 200],
    ['翻译(MyMemory)', 'https://api.mymemory.translated.net/get?q=hi&langpair=en|zh-CN', 200],
  ];

  const results = await Promise.all(
    targets.map(async ([name, url, expect]): Promise<[string, string, number | string, number]> => {
      const start = Date.now();
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'PaperScout/2.0 diag', 'Accept-Language': 'zh-CN,zh;q=0.9' },
          signal: AbortSignal.timeout(10000),
        });
        return [name, res.status === expect ? 'OK' : '异常', res.status, Date.now() - start];
      } catch (e: any) {
        return [name, '失败', String(e?.message ?? e).slice(0, 60), Date.now() - start];
      }
    }),
  );

  return jsonResponse({
    checkedAt: new Date().toISOString(),
    summary: results.filter((r) => r[1] === 'OK').length + '/' + results.length + ' 可用',
    results,
  });
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const url = new URL(request.url);
  // params.route 对应 [[route]] 捕获的路径段数组，如 ['search']
  const route = Array.isArray(params.route) ? params.route.join('/') : String(params.route ?? '');

  try {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    switch (route) {
      case 'search':
        if (env.SEARCH_V3 === '1') return await handleSearchV3(request, env, ctx);
        return await handleSearch(request, env, ctx);

      case 'sources':
        return jsonResponse({
          sources: VALID_SOURCES.map((id) => ({ id, name: ADAPTERS[id].name })),
        });

      case 'trending': {
        // ?refresh=1 绕过缓存，实时重新抓取
        const refresh = url.searchParams.get('refresh') === '1';
        return jsonResponse(await getTrending(env, ctx, refresh));
      }

      case 'translate':
        return await handleTranslate(url, env, ctx);

      case 'history':
        if (request.method === 'POST') return await addHistory(env, request);
        if (request.method === 'DELETE') return await clearHistory(env, request);
        return await listHistory(env, request);

      case 'favorites':
        if (request.method === 'POST') return await toggleFavorite(env, request);
        return await listFavorites(env, request);

      case 'related':
        return await relatedWorks(env, url);

      case 'author':
        return await authorProfile(env, url);

      case 'summarize':
        if (request.method !== 'POST') return jsonResponse({ error: '请使用 POST' }, 405);
        return await aiSummarize(env, request);

      case 'ask':
        return await aiAsk(env, url);

      case 'stats':
        return await keywordStats(env);

      case 'work': {
        const wid = url.searchParams.get('id') ?? '';
        if (!wid) return new Response(JSON.stringify(errorEnvelope(new AppError('BAD_QUERY', '缺少文献 id（?id=doi:10.x/y）'), newRequestId())), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        const wt0 = Date.now();
        const detail = await getWorkDetail(wid, env);
        return new Response(JSON.stringify(okEnvelope(detail, { requestId: newRequestId(), ms: Date.now() - wt0 })), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      }

      case 'suggest': {
        const q = validateSuggestParams(url);
        const result = await getSuggestions(env.DB, q);
        return jsonResponse({ ok: true, data: result, meta: { requestId: newRequestId() } });
      }

      case 'health':
        return jsonResponse({ status: 'ok', time: new Date().toISOString() });

      case 'diag':
        return await handleDiag();

      default:
        return jsonResponse({ error: '接口不存在' }, 404);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    console.error('Unhandled error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: '服务器内部错误：' + detail }, 500);
  }
};
