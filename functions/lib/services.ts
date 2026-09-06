import type { Env, Paper } from './types';
import { fetchWithRetry } from './http';

/**
 * 扩展服务：检索历史 / 收藏夹 / 相关论文 / 作者聚合 / AI 总结 / AI 问答 / 热词统计
 */

/** 客户端标识（前端 localStorage 生成的 UUID，经 X-Client-Id 头传递） */
function clientId(request: Request): string {
  return request.headers.get('X-Client-Id') || 'anonymous';
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* ================= 检索历史 ================= */

export async function listHistory(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return jsonError('数据库不可用', 503);
  const { results } = await env.DB
    .prepare('SELECT q, author, ts FROM history WHERE client_id = ?1 ORDER BY ts DESC LIMIT 15')
    .bind(clientId(request))
    .all();
  return new Response(JSON.stringify({ history: results }), jsonHeaders());
}

export async function addHistory(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return jsonError('数据库不可用', 503);
  const body = (await request.json()) as any;
  const q = String(body.q ?? '').trim();
  const author = String(body.author ?? '').trim();
  if (!q && !author) return jsonError('缺少检索内容', 400);

  const cid = clientId(request);
  const db = env.DB;
  // 去重：删除同条旧记录再插入
  await db
    .prepare("DELETE FROM history WHERE client_id = ?1 AND q = ?2 AND IFNULL(author,'') = ?3")
    .bind(cid, q, author)
    .run();
  await db
    .prepare('INSERT INTO history (client_id, q, author, ts) VALUES (?1, ?2, ?3, ?4)')
    .bind(cid, q, author, Date.now())
    .run();
  // 仅保留最近 15 条
  await db
    .prepare(
      'DELETE FROM history WHERE client_id = ?1 AND id NOT IN (SELECT id FROM history WHERE client_id = ?1 ORDER BY ts DESC LIMIT 15)',
    )
    .bind(cid)
    .run();
  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

export async function clearHistory(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return jsonError('数据库不可用', 503);
  await env.DB.prepare('DELETE FROM history WHERE client_id = ?1').bind(clientId(request)).run();
  return new Response(JSON.stringify({ ok: true }), jsonHeaders());
}

/* ================= 收藏夹 ================= */

export async function listFavorites(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return jsonError('数据库不可用', 503);
  const { results } = await env.DB
    .prepare('SELECT * FROM favorites WHERE client_id = ?1 ORDER BY added_at DESC')
    .bind(clientId(request))
    .all();
  const papers = (results as any[]).map((r) => ({
    title: r.title,
    authors: JSON.parse(r.authors ?? '[]'),
    year: r.year ?? undefined,
    venue: r.venue ?? undefined,
    url: r.url,
    doi: r.doi ?? undefined,
    pdfUrl: r.pdf_url ?? undefined,
    source: r.source,
  }));
  return new Response(JSON.stringify({ favorites: papers }), jsonHeaders());
}

export async function toggleFavorite(env: Env, request: Request): Promise<Response> {
  if (!env.DB) return jsonError('数据库不可用', 503);
  const body = (await request.json()) as any;
  const p = body.paper;
  if (!p?.title || !p?.url) return jsonError('缺少论文信息', 400);

  const cid = clientId(request);
  const id = djb2(p.doi ? `doi:${p.doi}` : p.url);
  const db = env.DB;

  if (body.action === 'add') {
    await db
      .prepare(
        `INSERT INTO favorites (id, client_id, title, authors, year, venue, url, doi, pdf_url, source, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET added_at = excluded.added_at`,
      )
      .bind(
        id, cid, p.title, JSON.stringify(p.authors ?? []), p.year ?? null, p.venue ?? null,
        p.url, p.doi ?? null, p.pdfUrl ?? null, p.source ?? null, Date.now(),
      )
      .run();
    return new Response(JSON.stringify({ ok: true, favorited: true }), jsonHeaders());
  }

  await db.prepare('DELETE FROM favorites WHERE id = ?1 AND client_id = ?2').bind(id, cid).run();
  return new Response(JSON.stringify({ ok: true, favorited: false }), jsonHeaders());
}

/* ================= 相关论文推荐 ================= */

export async function relatedWorks(env: Env, url: URL): Promise<Response> {
  const doi = (url.searchParams.get('doi') ?? '').trim();
  const title = (url.searchParams.get('title') ?? '').trim();
  if (!doi && !title) return jsonError('缺少 doi 或 title 参数', 400);

  const cacheKey = `related:${doi || title}`;
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) return new Response(JSON.stringify(cached), jsonHeaders());

  // DOI 直查；失败时用标题搜索兜底
  let work: any = null;
  if (doi) {
    const wRes = await fetchWithRetry(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`, undefined, 3, 1000);
    if (wRes.ok) work = await wRes.json();
  }
  if (!work && title) {
    const tRes = await fetchWithRetry(
      `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=1&mailto=paperscout@example.com`,
      undefined, 3, 1000,
    );
    if (tRes.ok) work = ((await tRes.json()) as any)?.results?.[0] ?? null;
  }
  if (!work) return jsonError('未在 OpenAlex 中找到该论文', 404);

  const ids: string[] = (work.related_works ?? [])
    .map((u: string) => u.split('/').pop())
    .filter(Boolean)
    .slice(0, 10);
  if (!ids.length) return new Response(JSON.stringify({ related: [] }), jsonHeaders());

  const rRes = await fetchWithRetry(
    `https://api.openalex.org/works?filter=ids.openalex:${ids.join('|')}&per_page=10&mailto=paperscout@example.com`,
    undefined, 2,
  );
  if (!rRes.ok) return jsonError(`OpenAlex 查询失败（HTTP ${rRes.status}）`, 502);
  const rData = (await rRes.json()) as any;

  const related = ((rData.results ?? []) as any[]).map((w) => ({
    title: w.display_name ?? '(无标题)',
    authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).slice(0, 6),
    year: w.publication_year ?? undefined,
    venue: w.primary_location?.source?.display_name ?? undefined,
    url: w.doi || w.primary_location?.landing_page_url || w.id,
    citations: w.cited_by_count ?? 0,
    openAccess: w.open_access?.is_oa ?? false,
  }));

  const result = { related };
  ctxSafePut(env, cacheKey, result, 86400);
  return new Response(JSON.stringify(result), jsonHeaders());
}

/* ================= 作者聚合 ================= */

export async function authorProfile(env: Env, url: URL): Promise<Response> {
  const name = (url.searchParams.get('name') ?? '').trim();
  if (!name) return jsonError('缺少 name 参数', 400);

  const cacheKey = `author:${name.toLowerCase()}`;
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) return new Response(JSON.stringify(cached), jsonHeaders());

  const sRes = await fetchWithRetry(
    `https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per_page=1&mailto=paperscout@example.com`,
    undefined, 2,
  );
  if (!sRes.ok) return jsonError(`OpenAlex 查询失败（HTTP ${sRes.status}）`, 502);
  const sData = (await sRes.json()) as any;
  const author = sData.results?.[0];
  if (!author) return jsonError('未找到该作者', 404);

  const wRes = await fetchWithRetry(
    `https://api.openalex.org/works?filter=author.id:${author.id}&sort=cited_by_count:desc&per_page=10&mailto=paperscout@example.com`,
    undefined, 2,
  );
  const wData = wRes.ok ? ((await wRes.json()) as any) : { results: [] };

  const result = {
    profile: {
      name: author.display_name,
      worksCount: author.works_count ?? 0,
      citedByCount: author.cited_by_count ?? 0,
      hIndex: author.summary_stats?.h_index ?? 0,
      institution: author.last_known_institutions?.[0]?.display_name ?? author.affiliations?.[0]?.institution?.display_name,
      orcid: author.orcid ?? undefined,
    },
    works: ((wData.results ?? []) as any[]).map((w) => ({
      title: w.display_name ?? '(无标题)',
      authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).slice(0, 6),
      year: w.publication_year ?? undefined,
      venue: w.primary_location?.source?.display_name ?? undefined,
      url: w.doi || w.primary_location?.landing_page_url || w.id,
      citations: w.cited_by_count ?? 0,
      openAccess: w.open_access?.is_oa ?? false,
    })),
  };

  ctxSafePut(env, cacheKey, result, 86400);
  return new Response(JSON.stringify(result), jsonHeaders());
}

/* ================= AI 总结 ================= */

export async function aiSummarize(env: Env, request: Request): Promise<Response> {
  if (!env.AI) return jsonError('AI 服务不可用', 503);
  const body = (await request.json()) as any;
  const query = String(body.query ?? '').trim();
  const papers = (body.papers ?? []) as any[];
  if (!papers.length) return jsonError('缺少论文数据', 400);

  const context = papers
    .slice(0, 10)
    .map((p, i) => `[${i + 1}] ${p.title} (${p.year ?? 'n.d.'}, 被引${p.citations ?? 0})\n摘要: ${(p.abstract ?? '').slice(0, 500)}`)
    .join('\n\n');

  const cacheKey = `sum:${djb2(query + context)}`;
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) return new Response(JSON.stringify(cached), jsonHeaders());

  const r: any = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      {
        role: 'system',
        content:
          '你是一位学术研究助手。基于用户提供的论文列表，用简体中文写一段 200 字左右的研究现状总结：先概括该主题的整体图景，再指出 2-3 个主要方向或共识，最后提一句可能的空白点。不要罗列论文编号，不要编造论文中不存在的内容。',
      },
      { role: 'user', content: `检索主题：${query || '（未提供）'}\n\n论文列表：\n${context}` },
    ],
    max_tokens: 800,
  });

  const result = { summary: String(r?.response ?? '').trim() };
  if (!result.summary) return jsonError('AI 未能生成总结', 502);
  ctxSafePut(env, cacheKey, result, 86400);
  return new Response(JSON.stringify(result), jsonHeaders());
}

/* ================= AI 问答 ================= */

export async function aiAsk(env: Env, url: URL): Promise<Response> {
  if (!env.AI) return jsonError('AI 服务不可用', 503);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return jsonError('缺少问题（q）', 400);

  const cacheKey = `ask:${q.toLowerCase()}`;
  const cached = await env.CACHE.get(cacheKey, 'json');
  if (cached) return new Response(JSON.stringify(cached), jsonHeaders());

  // 从 OpenAlex + Crossref 检索带摘要的论文作为回答依据
  const sources: { title: string; url: string; abstract: string }[] = [];
  const oa: any = await fetchWithRetry(
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per_page=8&mailto=paperscout@example.com`,
    undefined, 3, 1000,
  ).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  if (oa?.results) {
    for (const w of oa.results as any[]) {
      const words: { pos: number; word: string }[] = [];
      for (const [word, positions] of Object.entries(w.abstract_inverted_index ?? {})) {
        for (const pos of positions as number[]) words.push({ pos, word });
      }
      words.sort((a, b) => a.pos - b.pos);
      const abstract = words.map((x) => x.word).join(' ');
      if (!abstract) continue;
      sources.push({
        title: w.display_name ?? '',
        url: w.doi || w.primary_location?.landing_page_url || w.id,
        abstract: abstract.slice(0, 600),
      });
      if (sources.length >= 6) break;
    }
  }

  // OpenAlex 被限流时降级 Crossref（带摘要检索）
  if (!sources.length) {
    const cr: any = await fetchWithRetry(
      `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=6&select=DOI,title,abstract,URL&mailto=paperscout@example.com`,
      undefined, 1,
    ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const it of cr?.message?.items ?? []) {
      const abstract = (it.abstract ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (!abstract) continue;
      sources.push({
        title: it.title?.[0] ?? '',
        url: it.URL ?? (it.DOI ? `https://doi.org/${it.DOI}` : ''),
        abstract: abstract.slice(0, 600),
      });
      if (sources.length >= 6) break;
    }
  }

  if (!sources.length) return jsonError('未能检索到与问题相关的论文', 404);

  const context = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.abstract}`).join('\n\n');
  const r: any = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      {
        role: 'system',
        content:
          '你是一位学术问答助手。基于提供的论文摘要回答用户问题，用简体中文，300 字以内。要求：只在论文内容范围内回答；关键论断后标注来源编号如 [1][2]；结尾用一行「参考来源：」列出编号对应的论文标题。',
      },
      { role: 'user', content: `问题：${q}\n\n论文摘要：\n${context}` },
    ],
    max_tokens: 900,
  });

  const result = { answer: String(r?.response ?? '').trim(), sources };
  if (!result.answer) return jsonError('AI 未能生成回答', 502);
  ctxSafePut(env, cacheKey, result, 86400);
  return new Response(JSON.stringify(result), jsonHeaders());
}

/* ================= 热词统计 ================= */

export async function bumpKeywordStats(env: Env, query: string): Promise<void> {
  if (!query) return;
  try {
    const raw = (await env.CACHE.get('stats:keywords', 'json')) as Record<string, number> | null;
    const map = raw ?? {};
    const kw = query.slice(0, 60).toLowerCase();
    map[kw] = (map[kw] ?? 0) + 1;
    // 只保留前 200 个热词
    const top = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 200);
    await env.CACHE.put('stats:keywords', JSON.stringify(Object.fromEntries(top)), {
      expirationTtl: 86400 * 30,
    });
  } catch {
    /* 统计失败不影响主流程 */
  }
}

export async function keywordStats(env: Env): Promise<Response> {
  const raw = (await env.CACHE.get('stats:keywords', 'json')) as Record<string, number> | null;
  const top = Object.entries(raw ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([keyword, count]) => ({ keyword, count }));
  return new Response(JSON.stringify({ top }), jsonHeaders());
}

/* ================= 工具 ================= */

function jsonHeaders(): ResponseInit {
  return {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, ...jsonHeaders() });
}

/** fire-and-forget 的 KV 写入（在请求上下文外安全执行） */
function ctxSafePut(env: Env, key: string, value: unknown, ttl: number): void {
  env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl }).catch(() => {});
}
